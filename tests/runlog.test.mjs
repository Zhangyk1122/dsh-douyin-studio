/**
 * tests/runlog.test.mjs —— 动作账的验收
 * ============================================================================
 * 钉四件事：
 *   ① 一行一条 JSON，能读回来
 *   ② 失败要留 stage/error —— 这是它存在的唯一理由
 *   ③ 超长字段截断，不把日志写炸
 *   ④ 文件不存在 / 坏行不抛异常
 * ============================================================================
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dys-runlog-'))
process.env.DOUYIN_STUDIO_HOME = HOME

const { logRun, readRuns, summarize, runlogFile } = await import('../lib/runlog.mjs')

test('写一条，能读回来', () => {
	const row = logRun({ kind: 'reply', target: 'c123', ok: true, took: 1200 })
	assert.ok(row)
	const rows = readRuns(5)
	assert.equal(rows.length, 1)
	assert.equal(rows[0].kind, 'reply')
	assert.equal(rows[0].target, 'c123')
	assert.equal(rows[0].ok, true)
	assert.equal(rows[0].took, 1200)
})

test('失败必须留 stage 和 error', () => {
	logRun({ kind: 'dm', target: '辰辰辰chen', ok: false, stage: 'page', error: '会话没打开（等不到输入框）' })
	const rows = readRuns(2)
	const last = rows[rows.length - 1]
	assert.equal(last.ok, false)
	assert.equal(last.stage, 'page')
	assert.match(last.error, /会话没打开/)
})

test('超长字段被截断，不会写出天文数字的日志', () => {
	logRun({ kind: 'x'.repeat(100), target: 'y'.repeat(500), error: 'z'.repeat(500) })
	const rows = readRuns(1)
	assert.ok(rows[0].kind.length <= 24)
	assert.ok(rows[0].target.length <= 90)
	assert.ok(rows[0].error.length <= 200)
})

test('summarize：总数/成败/按动作分组/最近一次失败', () => {
	const rows = readRuns(10)
	const s = summarize(rows)
	assert.equal(s.total, rows.length)
	assert.ok(s.fail >= 1)
	assert.ok(s.byKind.reply >= 1)
	assert.equal(s.lastFail.ok, false)
})

test('坏行被跳过，不影响其它行', () => {
	writeFileSync(runlogFile(), '{"ok":true,"kind":"a"}\nnot-json\n{"ok":true,"kind":"b"}\n', 'utf8')
	const rows = readRuns(10)
	assert.equal(rows.length, 2)
	assert.equal(rows[1].kind, 'b')
})

test('文件不存在时 readRuns 返回空数组', () => {
	const before = process.env.DOUYIN_STUDIO_HOME
	process.env.DOUYIN_STUDIO_HOME = join(HOME, 'nope')
	assert.deepEqual(readRuns(3), [])
	process.env.DOUYIN_STUDIO_HOME = before
})

test('落盘是真的（文件里有一行完整 JSON）', () => {
	const text = readFileSync(runlogFile(), 'utf8')
	assert.ok(text.endsWith('\n'))
	assert.ok(text.split('\n').filter(Boolean).length >= 3)
})
