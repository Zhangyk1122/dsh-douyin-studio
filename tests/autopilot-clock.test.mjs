/**
 * tests/autopilot-clock.test.mjs —— 定点任务要对表，不能靠 30 分钟顺风车（0.4.5）
 * ============================================================================
 * 2026-11-07：`reportAt: 22:30`，应用 22:19 重启，tick 落在 22:19 / 22:49，
 * 日报就晚了 19 分钟。这里只钉纯函数与"明细账落文件"两件事，不起定时器。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DOUYIN_STUDIO_HOME = mkdtempSync(join(tmpdir(), 'dys-clock-'))

const { clockMinutes, msToNextClock } = await import('../lib/autopilot.mjs')

test('clockMinutes：正常读数', () => {
	assert.equal(clockMinutes('22:30'), 1350)
	assert.equal(clockMinutes('00:05'), 5)
	assert.equal(clockMinutes(' 9:00 '), 540)
})

test('clockMinutes：读不出来返回 null，不猜时间', () => {
	assert.equal(clockMinutes(''), null)
	assert.equal(clockMinutes('25:00'), null)
	assert.equal(clockMinutes('22:70'), null)
	assert.equal(clockMinutes('晚上'), null)
})

test('msToNextClock：还没到点 → 今天等', () => {
	const now = new Date(2026, 10, 7, 22, 0, 0)
	assert.equal(msToNextClock(1350, now), 30 * 60000)
})

test('msToNextClock：过了点 → 排到明天，不是负数', () => {
	const now = new Date(2026, 10, 7, 22, 49, 0)
	assert.equal(msToNextClock(1350, now), (23 * 60 + 41) * 60000)
})

test('msToNextClock：正好卡在点上 → 明天（今天那一次该由调用方先跑）', () => {
	const now = new Date(2026, 10, 7, 22, 30, 0)
	assert.equal(msToNextClock(1350, now), 24 * 60 * 60000)
})

test('msToNextClock：null 就返回 null', () => {
	assert.equal(msToNextClock(null, new Date()), null)
})

test('autopilot-log.jsonl：明细账落在 state 同目录，追加不覆盖', async () => {
	const { appendLogLine, logFile } = await import('../lib/autopilot.mjs')
	assert.equal(logFile(), join(process.env.DOUYIN_STUDIO_HOME, 'autopilot-log.jsonl'))
	appendLogLine({ at: '2026-11-07T14:49:01.582Z', kind: 'report', ok: true })
	appendLogLine({ at: '2026-11-07T15:49:01.582Z', kind: 'report', ok: false, error: '会话没打开（等不到输入框）' })
	const rows = readFileSync(logFile(), 'utf8').trim().split('\n')
	assert.equal(rows.length, 2, '两行都在，第二行没有覆盖第一行')
	assert.equal(JSON.parse(rows[0]).kind, 'report')
	assert.equal(JSON.parse(rows[1]).ok, false)
})

