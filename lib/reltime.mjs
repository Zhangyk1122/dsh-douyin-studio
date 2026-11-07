/**
 * lib/reltime.mjs —— 抖音时间戳的唯一解析与展示口径
 * ============================================================================
 * 背景（2026-11-05 用户截图：1 小时前显示成「9 小时前」）：
 *   抖音接口给的 `create_date` 形如 `2026-11-05 10:26:24`，**没有时区标记，实际是 UTC**。
 *   `Date.parse('2026-11-05 10:26:24')` 按本地时间解析 ⇒ 在东八区整整差 8 小时，
 *   "1 小时前" 就变成了 "9 小时前"。picks.mjs 里踩过一次，收件箱这条路上又踩了一次。
 *
 * 口径（只此一份，前端不再自己算）：
 *   · 无标记的 `YYYY-MM-DD HH:mm:ss` → 当 UTC
 *   · 只有日期的 `YYYY-MM-DD` → 当本地零点（那天几点不重要，算"几天前"要稳）
 *   · 带 Z / 带偏移的 ISO → 原样
 *   · 数字 → 毫秒
 *
 * 展示分档（跨天要能看出来，别把"昨天 23:00"说成"3 小时前"）：
 *   刚刚 / N 分钟前 / N 小时前（同一天）/ 昨天 HH:MM / N 天前（<7）/ MM-DD（跨年带年份）
 * ============================================================================
 */

const UNMARKED = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

const pad2 = (n) => String(n).padStart(2, '0')

/** 任意形态的时间 → 毫秒；认不出来返回 NaN（调用方自己决定怎么显示）。 */
export function parseDouyinTime(v) {
	if (typeof v === 'number' && Number.isFinite(v)) return v
	const s = String(v == null ? '' : v).trim()
	if (!s) return NaN
	const m = UNMARKED.exec(s)
	if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))
	const d = DATE_ONLY.exec(s)
	if (d) return new Date(+d[1], +d[2] - 1, +d[3]).getTime()
	const t = Date.parse(s)
	return Number.isFinite(t) ? t : NaN
}

/** 统一成带 Z 的 ISO，给前端 `new Date()` 用 —— 这样前端怎么解都不会再差 8 小时。 */
export function toIsoZ(v) {
	const t = parseDouyinTime(v)
	return Number.isFinite(t) ? new Date(t).toISOString() : ''
}

const sameDay = (a, b) =>
	a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** 人看的相对时间。now 可注入，方便单测。 */
export function relTime(v, now = Date.now()) {
	const t = parseDouyinTime(v)
	if (!Number.isFinite(t)) return ''
	const ms = Math.max(0, now - t)
	const min = Math.round(ms / 60000)
	if (min < 1) return '刚刚'
	if (min < 60) return min + ' 分钟前'

	const d = new Date(t)
	const n = new Date(now)
	const hrs = Math.round(min / 60)
	if (sameDay(d, n)) return hrs + ' 小时前'

	const y = new Date(now)
	y.setDate(n.getDate() - 1)
	if (sameDay(d, y)) return '昨天 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())

	if (hrs < 24 * 7) return Math.max(1, Math.round(hrs / 24)) + ' 天前'
	const md = pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
	return (d.getFullYear() === n.getFullYear() ? '' : d.getFullYear() + '-') + md
}
