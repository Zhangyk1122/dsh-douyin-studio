/**
 * tests/reltime.test.mjs —— 时间口径的验收
 * ============================================================================
 * 钉四件事（2026-11-05 用户截图：「1 小时前」显示成「9 小时前」）：
 *   ① 无时区标记的 `YYYY-MM-DD HH:mm:ss` 必须当 UTC 解，不能按本地
 *   ② 跨天要能看出来：昨天 23:00 不能说成「3 小时前」
 *   ③ 分档边界：刚刚 / 分钟 / 小时 / 昨天 / 天 / 日期
 *   ④ 坏输入返回空串，不抛、不瞎编
 * 断言不依赖机器时区：用 toISOString() 造输入，用本地 Date 造 now。
 * ============================================================================
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDouyinTime, toIsoZ, relTime } from '../lib/reltime.mjs'

const NOW = new Date(2026, 10, 5, 18, 0, 0).getTime() // 本地 11-05 18:00
const ago = (ms) => new Date(NOW - ms).toISOString()
const MIN = 60000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

test('无时区标记的 create_date 按 UTC 解（不是本地）', () => {
	const t = parseDouyinTime('2026-11-05 10:26:24')
	assert.equal(t, Date.UTC(2026, 10, 5, 10, 26, 24))
})

test('带 Z 的 ISO 原样解析，数字当毫秒', () => {
	assert.equal(parseDouyinTime('2026-11-05T10:26:24.000Z'), Date.UTC(2026, 10, 5, 10, 26, 24))
	assert.equal(parseDouyinTime(1793860563748), 1793860563748)
})

test('只有日期时按本地零点（算「几天前」要稳）', () => {
	assert.equal(parseDouyinTime('2026-11-05'), new Date(2026, 10, 5).getTime())
})

test('坏输入返回 NaN，relTime 返回空串', () => {
	assert.ok(Number.isNaN(parseDouyinTime('')))
	assert.ok(Number.isNaN(parseDouyinTime('昨天')))
	assert.equal(relTime('', NOW), '')
	assert.equal(relTime('乱码', NOW), '')
})

test('toIsoZ：把无标记 UTC 变成带 Z 的 ISO', () => {
	assert.equal(toIsoZ('2026-11-05 10:26:24'), '2026-11-05T10:26:24.000Z')
	assert.equal(toIsoZ(''), '')
})

test('分档：刚刚 / 分钟 / 小时', () => {
	assert.equal(relTime(ago(20 * 1000), NOW), '刚刚')
	assert.equal(relTime(ago(5 * MIN), NOW), '5 分钟前')
	assert.equal(relTime(ago(1 * HOUR), NOW), '1 小时前')
	assert.equal(relTime(ago(3 * HOUR), NOW), '3 小时前')
})

test('跨天：昨天 17:00 必须显示「昨天 17:00」，不是「25 小时前」', () => {
	const y = new Date(2026, 10, 4, 17, 0, 0).toISOString()
	assert.equal(relTime(y, NOW), '昨天 17:00')
})

test('跨天：今天凌晨 01:00 仍是「N 小时前」（同一天）', () => {
	const early = new Date(2026, 10, 5, 1, 0, 0).toISOString()
	assert.equal(relTime(early, NOW), '17 小时前')
})

test('前几天显示「N 天前」，一周以上显示日期', () => {
	assert.equal(relTime(ago(3 * DAY), NOW), '3 天前')
	const old = new Date(2026, 9, 1, 12, 0, 0).toISOString()
	assert.match(relTime(old, NOW), /^\d{2}-\d{2}$/)
})

test('未来时间不显示成负数，兜底「刚刚」', () => {
	assert.equal(relTime(new Date(NOW + HOUR).toISOString(), NOW), '刚刚')
})

test('真实截图里那条：10:26Z 的 @，到 18:58 本地应是一小时以内', () => {
	const now = new Date(2026, 10, 5, 18, 58, 0).getTime()
	const r = relTime('2026-11-05 10:26:24', now)
	/* 10:26Z = 本地 18:26，距 18:58 是 32 分钟 —— 以前会算成 8 小时 32 分 */
	assert.equal(r, '32 分钟前')
})
