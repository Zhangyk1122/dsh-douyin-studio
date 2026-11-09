/**
 * tests/freshness.test.mjs —— 「还来不来得及回」只能有一套标准
 * ============================================================================
 * 2026-11-09 的事故：`inbox` 的 own 区按 7 天算 worth，`duty.collect` 按
 * `settings.replyFreshHours`（默认 48h）丢。于是 `/schedule` 显示 `pending: 3`，
 * 值班每轮 `scanned: 0` —— 看起来像「评论区没人说话」，其实是「两边算的不是同一件事」。
 *
 * 这组用例钉住三条：
 *   ① 时效判定本身（边界、0 = 不限、日期读不出来就放行）；
 *   ② 抖音的 create_date 是**无时区标记的 UTC**，别按本地时间算（东八区差 8 小时）；
 *   ③ 超时的评论不是「删掉」，是 `worth:false` + `blocked` 说明，人还能看见。
 * ============================================================================
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { withinFresh } from '../lib/duty.mjs'
import { freshness } from '../lib/inbox.mjs'

const NOW = Date.parse('2026-11-09T20:00:00+08:00')
/** 造一个「几小时前」的抖音格式时间（UTC、无 Z） */
const ago = (hours) => new Date(NOW - hours * 3600000).toISOString().replace(/\.\d{3}Z$/, '')

test('withinFresh：48 小时线内不 stale，线外 stale', () => {
	assert.equal(withinFresh(ago(1), 48, NOW).stale, false)
	assert.equal(withinFresh(ago(47.5), 48, NOW).stale, false)
	assert.equal(withinFresh(ago(48.5), 48, NOW).stale, true)
	assert.equal(withinFresh(ago(120), 48, NOW).stale, true)
})

test('withinFresh：freshHours = 0 / 空 / 非法 = 不限时效（老行为）', () => {
	for (const v of [0, '', null, undefined, 'abc', -5]) {
		assert.equal(withinFresh(ago(1000), v, NOW).stale, false, `freshHours=${String(v)} 不该筛人`)
	}
})

test('withinFresh：日期读不出来就放行，不猜', () => {
	for (const v of ['', null, undefined, '不是日期']) {
		const r = withinFresh(v, 48, NOW)
		assert.equal(r.stale, false)
		assert.equal(r.hours, null)
	}
})

test('withinFresh：无时区标记的 UTC 不能被当成本地时间（东八区差 8 小时）', () => {
	/* 2 小时前（UTC 写法、没有 Z）：按 UTC 解释 = 2h，按本地解释 = 10h（会误判成 stale） */
	const twoHoursAgo = ago(2)
	const r = withinFresh(twoHoursAgo, 3, NOW)
	assert.equal(r.stale, false)
	assert.ok(Math.abs(r.hours - 2) < 0.05, `算成了 ${r.hours} 小时，时区又错了`)
})

test('freshness（收件箱侧）：线和值班同一条', () => {
	const inside = freshness(47 * 60, 48)
	assert.equal(inside.worth, true)
	assert.equal(inside.stale, false)
	assert.deepEqual(inside.blocked, [])

	const outside = freshness(49 * 60, 48)
	assert.equal(outside.worth, false)
	assert.equal(outside.stale, true)
	assert.match(outside.blocked.join(), /49 小时/)
	assert.match(outside.blocked.join(), /不追了/)
})

test('freshness：不传 / 传 0 = 不设时效，老调用方行为不变', () => {
	for (const v of [0, undefined, null, '']) {
		const r = freshness(30 * 24 * 60, v)
		assert.equal(r.worth, true)
		assert.equal(r.stale, false)
	}
})
