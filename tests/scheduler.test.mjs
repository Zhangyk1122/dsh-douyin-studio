import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	clockSec, formatClock, normalizeWindows, basePoints, jitterPoints,
	planDay, backoff, decide, MIN_GAP_MIN, BREAK_AFTER,
} from '../lib/scheduler.mjs'

const legacy = { scanRounds: 3, scanFrom: 9, scanTo: 22, scanEveryMin: 240 }
const windows = {
	scanWindows: [
		{ from: '09:00', to: '12:00', times: 2, enabled: true },
		{ from: '14:00', to: '22:00', times: 3, enabled: true },
	],
}

test('clockSec：HH:MM / 小时 / 秒 / 坏值', () => {
	assert.equal(clockSec('09:30'), 9 * 3600 + 30 * 60)
	assert.equal(clockSec(9), 9 * 3600)
	assert.equal(clockSec(32400), 32400)
	assert.equal(clockSec('坏值', 123), 123)
	assert.equal(formatClock(9 * 3600 + 5 * 60), '09:05')
})

test('旧配置映射成一个窗口，不回写、不丢字段', () => {
	const n = normalizeWindows(legacy)
	assert.equal(n.mode, 'legacy')
	assert.equal(n.windows.length, 1)
	assert.equal(n.windows[0].times, 3)
	assert.equal(n.windows[0].everyMin, 240)
	assert.equal(legacy.scanWindows, undefined, '不许原地改写用户配置')
})

test('窗口制：点数 = 各窗口 times 之和，且都落在窗口内', () => {
	const n = normalizeWindows(windows)
	assert.equal(n.mode, 'windows')
	const pts = basePoints(windows)
	assert.equal(pts.length, 5)
	assert.ok(pts[0] >= 9 * 3600 && pts[1] < 12 * 3600)
	assert.ok(pts[2] >= 14 * 3600 && pts[4] < 22 * 3600)
	assert.ok(pts.every((x, i) => i === 0 || x > pts[i - 1]), '必须升序')
})

test('关掉的窗口不算数；全关掉就退回老字段', () => {
	const w = { ...windows, scanWindows: [{ ...windows.scanWindows[0], enabled: false }] }
	assert.equal(normalizeWindows(w).mode, 'legacy')
})

test('抖动按天稳定：同一天重算得到同一串点', () => {
	const base = basePoints(legacy)
	const a = jitterPoints(base, '2026-11-05')
	const b = jitterPoints(base, '2026-11-05')
	assert.deepEqual(a.points, b.points)
	assert.equal(planDay(legacy, Date.UTC(2026, 10, 5, 3, 0)).points.length,
		planDay(legacy, Date.UTC(2026, 10, 5, 9, 0)).points.length)
})

test('抖动幅度受控，且强制最小间隔', () => {
	const base = [9 * 3600, 10 * 3600, 10 * 3600 + 600]
	const j = jitterPoints(base, '2026-11-05')
	assert.ok(j.spreadMin <= 45)
	for (let i = 1; i < j.points.length; i++) {
		assert.ok(j.points[i] - j.points[i - 1] >= MIN_GAP_MIN * 60 - 1)
	}
	assert.ok(j.points.every((x) => x >= 0 && x < 86400))
})

test('跨天点位可以不同，但都在当天内', () => {
	const a = planDay(legacy, new Date(2026, 10, 5, 10, 0))
	const b = planDay(legacy, new Date(2026, 10, 6, 10, 0))
	assert.equal(a.day, '2026-11-05')
	assert.equal(b.day, '2026-11-06')
	assert.equal(a.points.length, b.points.length)
})

test('退避：0 / 1 / 3 / 6 次四档', () => {
	assert.equal(backoff(0).level, 'ok')
	assert.equal(backoff(1).factor, 2)
	assert.equal(backoff(3).factor, 4)
	assert.equal(backoff(BREAK_AFTER).level, 'stop')
	assert.equal(backoff(99).delaySec, 0)
})

const plan = (points) => ({ day: '2026-11-05', points, spreadMin: 12, gapSec: 240 * 60 })
const at = (h, m = 0) => new Date(2026, 10, 5, h, m, 0).getTime()

test('decide：还没到点 → wait，带下一轮文案', () => {
	const d = decide({ now: at(9, 0), plan: plan([10 * 3600, 14 * 3600]), done: 0, quotaLeft: 10 })
	assert.equal(d.action, 'wait')
	assert.equal(d.index, 0)
	assert.ok(d.nextIn > 0)
	assert.match(d.label, /下一轮 10:00/)
	assert.match(d.label, /±12 分钟/)
})

test('decide：到点就跑，第二轮的 index 跟着 done 走', () => {
	const d = decide({ now: at(10, 1), plan: plan([10 * 3600, 14 * 3600]), done: 0, quotaLeft: 10 })
	assert.equal(d.action, 'run')
	assert.equal(d.index, 0)
	const d2 = decide({ now: at(14, 1), plan: plan([10 * 3600, 14 * 3600]), done: 1, quotaLeft: 10 })
	assert.equal(d2.action, 'run')
	assert.equal(d2.index, 1)
})

test('额度用完：跳过但不消耗轮次', () => {
	const d = decide({ now: at(10, 1), plan: plan([10 * 3600, 14 * 3600]), done: 0, quotaLeft: 0 })
	assert.equal(d.action, 'skip-quota')
	assert.equal(d.index, -1, '不能给出可消耗的 index')
	assert.match(d.reason, /不消耗轮次/)
})

test('暂停优先于一切；连败 6 次熔断；额度为 null 不设闸', () => {
	assert.equal(decide({ now: at(10, 1), plan: plan([10 * 3600]), paused: true }).action, 'pause')
	assert.equal(decide({ now: at(10, 1), plan: plan([10 * 3600]), failures: 6 }).action, 'stop')
	assert.equal(decide({ now: at(10, 1), plan: plan([10 * 3600]), quotaLeft: null }).action, 'run')
})

test('全部刷完 / 没安排轮次', () => {
	assert.equal(decide({ now: at(20), plan: plan([10 * 3600]), done: 1 }).action, 'done')
	assert.equal(decide({ now: at(10), plan: plan([]) }).action, 'idle')
})

test('连败时点位被推后，但不会推到第二天', () => {
	const d = decide({ now: at(10, 0), plan: plan([10 * 3600]), failures: 1, quotaLeft: 10 })
	assert.equal(d.action, 'wait')
	assert.ok(d.nextAt > 10 * 3600)
	assert.ok(d.nextAt < 86400)
})
