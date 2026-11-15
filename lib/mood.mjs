/**
 * lib/mood.mjs —— 她的情绪不是一句形容词，是四个会衰减的数值。
 *
 * 为什么要这个（2026-11-13）：
 *   现在文案里的「心情」全靠模型每轮现编：同一天里，一条是「阳光正好」，下一条是「有点困」，
 *   彼此无关。真人不是这样——心情有惯性，被一件事推一下，然后慢慢回到常态。
 *
 * 四个值（都夹在 0–1，valence 是 -1–1）：
 *   valence   心情好坏： -1 很糟 … +1 很好
 *   arousal   激动程度： 0 平 … 1 上头
 *   energy    精力：     0 没力气 … 1 很足
 *   affinity  亲密度：   0 刚认识 … 1 很熟（衰减极慢，30 天半衰）
 *
 * 存哪：`<studioHome>/mood.json`
 *   { rev, at, valence, arousal, energy, affinity, last:{ kind, at } }
 *
 * 规矩：
 *   - 事件只推动一点（±0.03–0.12），不做「一条消息就翻天」；
 *   - 每次读都先按经过的小时数衰减，再返回（读时衰减，不靠定时器）；
 *   - 没有事件也能衰减到基线——放着不管就是「平常」。
 */

import { join } from 'node:path'
import { studioHome } from './killswitch.mjs'
import { atomicWriteJson, readJsonSafe } from './fsx.mjs'

const HOUR = 3600 * 1000

/** 常态：不喜不悲、有点精神、对熟人略偏亲近 */
export const BASELINE = Object.freeze({ valence: 0.05, arousal: 0.32, energy: 0.55, affinity: 0.3 })

/** 各维度的半衰期（小时）：心情 6h、激动 3h、精力 4h、亲密 720h */
export const HALF_LIFE_H = Object.freeze({ valence: 6, arousal: 3, energy: 4, affinity: 720 })

/** 事件对四个值的推动量 */
export const EVENT_PUSH = Object.freeze({
	at: { valence: 0.12, arousal: 0.1, energy: -0.03, affinity: 0.02 },
	dm: { valence: 0.08, arousal: 0.05, energy: -0.02, affinity: 0.02 },
	share: { valence: 0.05, arousal: 0.03, energy: -0.01, affinity: 0.01 },
	reply: { valence: 0.05, arousal: 0.03, energy: -0.04, affinity: 0.02 },
	mention: { valence: 0.06, arousal: 0.02, energy: 0, affinity: 0.01 },
	// 失败、被无视：掉心情、更亢奋（烦躁）、更累
	fail: { valence: -0.08, arousal: 0.05, energy: -0.05, affinity: 0 },
	ignore: { valence: -0.05, arousal: 0.02, energy: -0.02, affinity: 0 },
	// 夜里歇一会儿
	rest: { valence: 0.02, arousal: -0.08, energy: 0.1, affinity: 0 },
})

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)

export const moodFile = () => join(studioHome(), 'mood.json')

function norm(raw) {
	const at = num(raw && raw.at, Date.now())
	const last = raw && raw.last && typeof raw.last === 'object' ? raw.last : null
	return {
		rev: Math.max(0, num(raw && raw.rev, 0)),
		at,
		valence: clamp(num(raw && raw.valence, BASELINE.valence), -1, 1),
		arousal: clamp(num(raw && raw.arousal, BASELINE.arousal), 0, 1),
		energy: clamp(num(raw && raw.energy, BASELINE.energy), 0, 1),
		affinity: clamp(num(raw && raw.affinity, BASELINE.affinity), 0, 1),
		last: last && last.kind ? { kind: String(last.kind).slice(0, 20), at: num(last.at, 0) } : null,
	}
}

/** 按经过的小时数往基线回落；dt<=0 原样返回 */
export function decay(state, now = Date.now()) {
	const m = norm(state)
	const dt = Math.max(0, (num(now, Date.now()) - m.at) / HOUR)
	if (dt <= 0) return m
	const out = { ...m, at: num(now, Date.now()) }
	for (const k of ['valence', 'arousal', 'energy', 'affinity']) {
		const base = k === 'valence' ? BASELINE.valence : BASELINE[k]
		const keep = Math.pow(0.5, dt / HALF_LIFE_H[k])
		out[k] = base + (m[k] - base) * keep
	}
	return out
}

/** 记一件事：kind 见 EVENT_PUSH；未知 kind 直接忽略（返回原状态，不抛） */
export function bump(state, kind, { at = Date.now(), factor = 1 } = {}) {
	const m = decay(state, at)
	const push = EVENT_PUSH[String(kind || '')]
	if (!push) return m
	const out = { ...m }
	for (const k of ['valence', 'arousal', 'energy', 'affinity']) {
		out[k] = m[k] + (push[k] || 0) * Math.max(0, Math.min(3, num(factor, 1)))
	}
	out.valence = clamp(out.valence, -1, 1)
	out.arousal = clamp(out.arousal, 0, 1)
	out.energy = clamp(out.energy, 0, 1)
	out.affinity = clamp(out.affinity, 0, 1)
	out.last = { kind: String(kind).slice(0, 20), at }
	out.rev = m.rev + 1
	return out
}

export function loadMood(now = Date.now()) {
	return decay(readJsonSafe(moodFile(), { ...BASELINE, at: now, rev: 0 }), now)
}

export function saveMood(state) {
	const m = norm({ ...state, rev: num(state && state.rev, 0) })
	atomicWriteJson(moodFile(), m)
	return m
}

/** 读出来 → 推一下 → 写回去，一步到位 */
export function note(kind, opts = {}) {
	const at = num(opts.at, Date.now())
	const next = bump(loadMood(at), kind, { ...opts, at })
	return saveMood(next)
}

/** 一句话描述，给提示词用；不要在这里写具体文案（那是模型的事） */
export function moodLine(state, now = Date.now()) {
	const m = decay(state || loadMood(now), now)
	const bits = []
	if (m.energy < 0.3) bits.push('有点没力气')
	else if (m.energy > 0.75) bits.push('精神很足')
	if (m.valence < -0.2) bits.push('心情偏低')
	else if (m.valence > 0.35) bits.push('心情不错')
	if (m.arousal > 0.7) bits.push('有点上头')
	else if (m.arousal < 0.15) bits.push('很平静')
	if (!bits.length) bits.push('平常的一天')
	const aff = m.affinity > 0.6 ? '跟常来的人很熟' : m.affinity < 0.15 ? '还有点生分' : ''
	return `你现在${bits.join('、')}${aff ? '，' + aff : ''}`
}

/** 面板/接口用的快照（四舍五入到两位，别把长小数发出去） */
export function moodSnapshot(now = Date.now()) {
	const m = decay(loadMood(now), now)
	const r = (v) => Math.round(v * 100) / 100
	return {
		valence: r(m.valence),
		arousal: r(m.arousal),
		energy: r(m.energy),
		affinity: r(m.affinity),
		at: new Date(m.at).toISOString(),
		last: m.last,
		line: moodLine(m, now),
	}
}
