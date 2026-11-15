/**
 * 设置自洽校验：只报「这组数摆在一起会互相抵消」的情况，不改值。
 *
 * 2026-11-15 重写。原来那版按 `perDay` / `commentPerDay` 写，而 lib/settings.mjs 里
 * 根本没有这两个字段；`quietFrom` 是 '22:00' 这种字符串，`Number('22:00')` 是 NaN，
 * 那两条检查也永远不触发。结果是：写好了、有类型契约、零调用、而且**查不出任何东西**。
 * 这一版只认真实存在的字段，报的是「你设了但不会生效」那一类。
 */
import { minutesOf } from './policy.mjs'

export const HIGH_PER_DAY = 24

const num = (v, d = 0) => {
	const n = Number(v)
	return Number.isFinite(n) ? n : d
}

/**
 * 体检。返回 [{level:'error'|'warn'|'info', field, msg}]，空数组 = 没发现互相打架的。
 * @param {any} [s] 归一后的设置（readSettings() 的返回值）
 * @param {{perDay?:number}} [limits] 硬上限（tools/dy.mjs 的 LIMITS），不知道就不传
 * @returns {Array<{level:string, field:string, msg:string}>}
 */
export function checkSettings(s = {}, limits = {}) {
	const out = []
	const quietFrom = String(s.quietFrom || '')
	const quietTo = String(s.quietTo || '')
	const scanRounds = num(s.scanRounds, 0)
	const scanPerRound = num(s.scanPerRound, 0)
	const perRun = num(s.replyMaxPerRound, 2)

	/* ① 静音段本身不成立 */
	if (quietFrom && quietTo) {
		const a = minutesOf(quietFrom)
		const b = minutesOf(quietTo)
		if (a === b) out.push({ level: 'error', field: 'quiet', msg: `静音开始和结束都是 ${quietFrom}，等于没静音。要静一整天请留空。` })
	}

	/* ② 刷视频开了但每轮 0 个：一直在跑，什么也没看 */
	if (scanRounds > 0 && scanPerRound <= 0) {
		out.push({ level: 'error', field: 'scanPerRound', msg: `每天刷 ${scanRounds} 轮，但每轮看 0 个 —— 轮次白跑。` })
	}

	/* ③ 日上限是不是空头支票。
	 * ⚠️ 2026-11-15 第一版这里写反了：按「每轮 × 轮次」算出 96 就报「一天能发 100 条」，
	 * 但真正拦在前面的是 budget 的日上限（LIMITS.perDay，默认 20）—— 96 大于 20 时
	 * 是日上限先断，根本发不出 96 条。那是虚惊。该报的是反过来的情况：
	 * 轮次能给 4 条，上限却写了 20 条 → 那 20 条永远吃不到。 */
	const hardPerDay = num(limits.perDay, 0)
	const everyMin = num(s.dutyEveryMin, 30)
	if (hardPerDay > 0 && perRun > 0 && everyMin > 0) {
		const rounds = Math.floor((24 * 60) / everyMin)
		const canDo = perRun * rounds
		if (canDo < hardPerDay) {
			out.push({
				level: 'warn',
				field: 'replyMaxPerRound',
				msg: `每天上限 ${hardPerDay} 条，但每轮 ${perRun} 条 × ${rounds} 轮 = ${canDo} 条，上限吃不到；要么加轮次/每轮条数，要么把上限改成 ${canDo}。`,
			})
		}
		if (hardPerDay > HIGH_PER_DAY) {
			out.push({ level: 'warn', field: 'perDay', msg: `日上限 ${hardPerDay} 条偏多（参考：>${HIGH_PER_DAY} 条/天 ≈ 每 ${Math.round((24 * 60) / Math.max(1, hardPerDay))} 分钟一条，容易像机器）。` })
		}
	}

	/* ④ 私信分享 + 评论区 @ 一起挤在一个晚上 */
	const share = num(s.sharePerDay, 0)
	const at = num(s.atPerDay, 0)
	if (share + at > 5) {
		out.push({ level: 'warn', field: 'sharePerDay', msg: `一个晚上可能叫主人 ${share + at} 次（私信 ${share} + @ ${at}），会刷屏。` })
	}

	/* ⑤ 主动互动开着但白名单是空的：一条都碰不到 */
	if (s.engageOn === true && !String(s.engageAuthors || '').trim()) {
		out.push({ level: 'error', field: 'engageAuthors', msg: '主动互动开着，但白名单空 —— 一条都不会碰。要么填作者，要么关掉。' })
	}

	/* ⑥ 无人值守发布开着，但发布模式是「只存草稿」：这条链等于空转 */
	if (s.unattendedPublish === true && String(s.publishMode || '') === 'draft') {
		out.push({ level: 'warn', field: 'publishMode', msg: '无人值守发布开着，但发布模式是「只存草稿」—— 到点只会多一份草稿，不会真的发出去。' })
	}

	/* ⑦ 没人盯着 + 公开可见：最该确认的组合 */
	if (s.unattendedPublish === true && String(s.publishWho || '') === 'public') {
		out.push({ level: 'warn', field: 'publishWho', msg: '无人值守 + 公开可见：没有人看过就发的作品会进推荐。确认这是你要的。' })
	}

	/* ⑧ 静音段与低峰窗口重叠（重叠那段既不回也不刷，别以为是 bug） */
	const af = String(s.activeFrom || '')
	const at2 = String(s.activeTo || '')
	if (quietFrom && quietTo && af && at2) {
		const overlap = overlapMinutes(quietFrom, quietTo, af, at2)
		if (overlap > 0) {
			out.push({ level: 'info', field: 'quiet', msg: `静音段 ${quietFrom}–${quietTo} 和低峰窗口 ${af}–${at2} 重叠 ${overlap} 分钟 —— 静音优先，那一段什么都不会做。` })
		}
	}

	/* ⑨ 设了分享额度但从没配过主人（报平安/分享会找不到人）。
	 * 用 warn 不用 error：默认设置就是「有额度、没主人」，那不是配错，是还没配。 */
	if ((share > 0 || at > 0) && !String(s.ownerUid || '').trim() && !String(s.ownerNick || '').trim()) {
		out.push({ level: 'warn', field: 'ownerUid', msg: '有分享/@ 额度，但没配主人 uid 或昵称 —— 到点不知道发给谁。' })
	}

	return out
}

/** 两段跨午夜区间重叠多少分钟。 */
function overlapMinutes(f1, t1, f2, t2) {
	const a1 = minutesOf(f1)
	const b1 = minutesOf(t1)
	const a2 = minutesOf(f2)
	const b2 = minutesOf(t2)
	if (a1 < 0 || b1 < 0 || a2 < 0 || b2 < 0) return 0
	const inRange = (m, a, b) => (a <= b ? m >= a && m < b : m >= a || m < b)
	let n = 0
	for (let m = 0; m < 1440; m += 1) if (inRange(m, a1, b1) && inRange(m, a2, b2)) n += 1
	return n
}

/**
 * 有没有挡路的（level:'error'）。
 * @param {Array<{level:string}>} list checkSettings() 的结果
 * @returns {boolean}
 */
export const hasBlocker = (list) => (list || []).some((x) => x.level === 'error')
