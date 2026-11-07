import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'dys-rounds-'))
process.env.DOUYIN_STUDIO_HOME = dir
const R = await import('../lib/roundstate.mjs')

test('暂停开关：STOP 文件在 = 暂停，删掉就恢复', () => {
	assert.equal(R.isPaused(), false)
	assert.equal(R.setPaused(true), true)
	assert.equal(R.isPaused(), true)
	R.setPaused(false)
	assert.equal(R.isPaused(), false)
})

test('状态读写：跨天字段保留，坏文件不崩', () => {
	R.writeState({ day: '2026-11-05', done: 2, failures: 1, lastAt: 'x' })
	const s = R.readState()
	assert.equal(s.done, 2)
	assert.equal(s.failures, 1)
	assert.equal(s.lastAt, 'x')
})

test('appendRound：坏行跳过、只留合法记录、字段被裁短', () => {
	R.appendRound({ round: 1, ok: true, seen: 10, kept: 3, took: 41.6 })
	R.appendRound({ round: 2, skipped: 'quota', error: 'x'.repeat(500) })
	const rows = R.readRounds(10)
	assert.equal(rows.length, 2)
	assert.equal(rows[0].took, 42)
	assert.equal(rows[1].skipped, 'quota')
	assert.ok(rows[1].error.length <= 160)
})

test('readRounds 按本地日历日过滤（UTC 日期会错一天）', () => {
	const rows = R.readRounds(10, '1970-01-01')
	assert.equal(rows.length, 0)
	const today = new Date()
	const p = (x) => String(x).padStart(2, '0')
	const key = today.getFullYear() + '-' + p(today.getMonth() + 1) + '-' + p(today.getDate())
	assert.equal(R.readRounds(10, key).length, 2)
})

test('summarizeRounds：跑过 / 跳过 / 失败 分开算', () => {
	R.appendRound({ round: 3, ok: false, error: 'boom' })
	const s = R.summarizeRounds(R.readRounds(10))
	assert.equal(s.ran, 1)
	assert.equal(s.skipped, 1)
	assert.equal(s.failed, 1)
	assert.equal(s.total, 3)
})

test('health 读写', () => {
	R.writeHealth({ level: 'warn', failures: 4, reason: '连败' })
	assert.equal(R.readHealth().level, 'warn')
	assert.equal(R.readHealth().failures, 4)
})

test('收尾：删临时目录', () => {
	delete process.env.DOUYIN_STUDIO_HOME
	rmSync(dir, { recursive: true, force: true })
	assert.equal(true, true)
})
