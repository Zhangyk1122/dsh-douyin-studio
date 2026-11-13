/**
 * lib/speakup.mjs —— 什么时候该主动开口，以及绝大多数时候不该。
 *
 * 为什么（2026-11-13）：主动消息的价值在**少**。天天准点问「在吗」不是惦记，是打卡。
 * 所以这里不是「定时发」，是「有事由才说」：
 *
 *   免打扰（夜里）  → 不说
 *   今天说满了      → 不说
 *   刚说过          → 不说
 *   没有由头        → 不说
 *
 * 由头只有三种：
 *   1. 有人在我作品下留了没回的评论（pending > 0）
 *   2. 心情激动到一定程度（arousal ≥ 0.55）——刚刷到好玩的
 *   3. 今天这个时段的打算还没做，且现在是那个时段
 */

/** 默认闸门；settings 里可覆盖（speakPerDay / speakCoolMin / quietFrom / quietTo） */
export const GATES = Object.freeze({
	maxPerDay: 2,
	coolMin: 90,
	quietFrom: 1, // 1:00–8:00 不说话
	quietTo: 8,
})

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)

/**
 * @param {{now?:number, mood?:object, intent?:object, pending?:number,
 *          lastAt?:number, today?:number, gates?:object}} input
 * @returns {{ok:boolean, reason:string, why?:string}}
 */
export function decide(input = {}) {
	const now = num(input.now, Date.now())
	const hour = new Date(now).getHours()
	const g = { ...GATES, ...(input.gates && typeof input.gates === 'object' ? input.gates : {}) }
	const quietFrom = num(g.quietFrom, GATES.quietFrom)
	const quietTo = num(g.quietTo, GATES.quietTo)
	const inQuiet = quietFrom <= quietTo
		? hour >= quietFrom && hour < quietTo
		: hour >= quietFrom || hour < quietTo

	if (inQuiet) return { ok: false, reason: 'quiet', why: `${quietFrom}–${quietTo} 点不说话` }

	const today = Math.max(0, num(input.today, 0))
	if (today >= Math.max(1, num(g.maxPerDay, GATES.maxPerDay))) {
		return { ok: false, reason: 'quota', why: '今天已经说过了' }
	}

	const lastAt = num(input.lastAt, 0)
	const coolMs = Math.max(5, num(g.coolMin, GATES.coolMin)) * 60 * 1000
	if (lastAt && now - lastAt < coolMs) {
		return { ok: false, reason: 'cooldown', why: '刚说过，等一会儿' }
	}

	const pending = Math.max(0, num(input.pending, 0))
	if (pending > 0) return { ok: true, reason: 'pending', why: `有 ${pending} 条没回` }

	const mood = input.mood || {}
	if (num(mood.arousal, 0) >= 0.55) return { ok: true, reason: 'excited', why: '刚看到好玩的，想说' }

	const it = input.intent || {}
	if (it && it.text && !it.done) return { ok: true, reason: 'intent', why: '今天这段本来就想说话' }

	return { ok: false, reason: 'no-reason', why: '没由头，就不说了' }
}
