/**
 * tests/autopilot-clock.test.mjs —— 定点任务要对表，不能靠 30 分钟顺风车（0.4.5）
 * ============================================================================
 * 2026-11-07：`reportAt: 22:30`，应用 22:19 重启，tick 落在 22:19 / 22:49，
 * 日报就晚了 19 分钟。这里只钉纯函数与"明细账落文件"两件事，不起定时器。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
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

test('rearm：没在跑就不硬拉起来（改个数字不该把机器人唤醒）', async () => {
	const A = await import('../lib/autopilot.mjs')
	A.stop()
	const r = A.rearm()
	assert.equal(r.ok, true)
	assert.equal(r.running, false)
	assert.equal(r.daily, null)
})

test('rearm：在跑时按 reportAt 重排，返回新的等待时长', async () => {
	const A = await import('../lib/autopilot.mjs')
	const { writeSettings } = await import('../lib/settings.mjs')
	writeSettings({ reportAt: '23:59' })
	A.start({ everyMin: 30, runCli: async () => ({ ok: true, results: [] }) })
	try {
		const r = A.rearm()
		assert.equal(r.running, true)
		assert.equal(r.daily.at, 23 * 60 + 59)
		assert.ok(r.daily.wait > 0 && r.daily.wait <= 24 * 3600 * 1000)
		/* 改成另一个点，再排一次要跟着变（这就是 0.4.7 修的那个洞） */
		writeSettings({ reportAt: '00:07' })
		const r2 = A.rearm()
		assert.equal(r2.daily.at, 7)
	} finally { A.stop() }
})

test('status().nextReportAt：只增字段，没排上是 null、排上了是 ISO', async () => {
	const A = await import('../lib/autopilot.mjs')
	const { writeSettings } = await import('../lib/settings.mjs')
	A.stop()
	assert.equal(A.status().nextReportAt, null, '停着的时候没有下一次')
	writeSettings({ reportAt: '22:30' })
	A.start({ everyMin: 30, runCli: async () => ({ ok: true, results: [] }) })
	try {
		const iso = A.status().nextReportAt
		assert.match(String(iso), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
		const d = new Date(iso)
		assert.equal(d.getHours() * 60 + d.getMinutes(), 22 * 60 + 30, '本地时间应该是 22:30')
	} finally { A.stop() }
	assert.equal(A.status().nextReportAt, null)
})

test('rotateLog：到顶转成 .1，只留一代，账不丢', async () => {
	const A = await import('../lib/autopilot.mjs')
	const file = join(process.env.DOUYIN_STUDIO_HOME, 'rot.log')
	writeFileSync(file, 'a'.repeat(50) + '\n', 'utf8')
	assert.equal(A.rotateLog(file, 1000).rotated, false, '没到顶不转')
	writeFileSync(file, 'b'.repeat(80) + '\n', 'utf8')
	const r = A.rotateLog(file, 1000)
	assert.equal(r.rotated, false)
	writeFileSync(file, 'c'.repeat(1200) + '\n', 'utf8')
	const r2 = A.rotateLog(file, 1000)
	assert.equal(r2.rotated, true)
	assert.equal(r2.size, 1201)
	assert.ok(existsSync(file + '.1'), '老的一代留在 .1')
	assert.equal(existsSync(file), false, '转完原文件不在，下次 append 会新建')
	/* 再超一次：.1 被覆盖，不会攒出 .2 / .3 */
	writeFileSync(file, 'd'.repeat(1200) + '\n', 'utf8')
	A.rotateLog(file, 1000)
	assert.equal(existsSync(file + '.2'), false, '只留一代')
})

