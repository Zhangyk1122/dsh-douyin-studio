/**
 * 风控冷却：撞到平台的限流/风控码之后，自动停写一段时间，到点自愈。
 *
 * 只在**写**动作上生效（回复、私信、@、发布、评论带图）。读不受影响 ——
 * 出事的时候更需要看清楚现场。
 *
 * 状态文件：`<studioHome>/risk.json`
 *   { until: ISO, code: number|string, reason: string, count: number, at: ISO }
 */

import { join } from 'node:path'
import { readJsonSafe, atomicWriteJson } from './fsx.mjs'
import { studioHome } from './killswitch.mjs'

export const RISK_CODES = [352, 412, 2154, 3002]
export const RISK_RE = /(-352|-412|风控|频繁|操作太快|too\s*many|rate\s*limit|captcha|验证码|安全验证)/i
export const DEFAULT_COOLDOWN_MIN = 30
export const MAX_COOLDOWN_MIN = 360

export const riskFile = () => join(studioHome(), 'risk.json')

/** 这条错误算不算风控。（纯函数） */
export function looksLikeRisk(r) {
	if (!r) return false
	if (typeof r === 'string') return RISK_RE.test(r)
	const code = Math.abs(Number(r.code ?? r.status_code ?? r.statusCode))
	if (RISK_CODES.includes(code)) return true
	const text = [r.error, r.msg, r.message, r.stage, r.stderr].filter(Boolean).join(' ')
	return RISK_RE.test(text)
}

/** 读当前状态。**只读** —— 过期的冷却直接当没在冷却，不在这里写盘：
 *  这个函数挂在 `GET /risk` 上，面板头部每次刷新都会调，读接口不该有写副作用。 */
export function riskState(now = Date.now()) {
	const s = readJsonSafe(riskFile(), {}) || {}
	if (!s.until) return { cooling: false, until: null, code: null, reason: '', count: 0 }
	const until = Date.parse(s.until)
	if (!Number.isFinite(until) || until <= now) return { cooling: false, until: null, code: null, reason: '', count: 0 }
	return { cooling: true, until: s.until, code: s.code ?? null, reason: String(s.reason || ''), count: Number(s.count || 0) }
}

/** 冷却里就返回一句人话，没冷却返回 null。 */
export function coolingGate(now = Date.now()) {
	const st = riskState(now)
	if (!st.cooling) return null
	const left = Math.max(1, Math.round((Date.parse(st.until) - now) / 60000))
	return `撞了风控（${st.code ?? '未知码'}），先停 ${left} 分钟再写；读动作不受影响。`
}

/** 记一次风控，按次数升级冷却时长（30 → 60 → 120 分钟，封顶 6 小时）。 */
export function noteRisk(why, { code = null, minutes = 0, now = Date.now() } = {}) {
	const cur = readJsonSafe(riskFile(), {}) || {}
	const count = Number(cur.count || 0) + 1
	const base = minutes > 0 ? minutes : DEFAULT_COOLDOWN_MIN * Math.pow(2, Math.min(count - 1, 3))
	const mins = Math.min(base, MAX_COOLDOWN_MIN)
	const until = new Date(now + mins * 60000).toISOString()
	const next = { until, code, reason: String(why || '').slice(0, 200), count, at: new Date(now).toISOString() }
	atomicWriteJson(riskFile(), next)
	return { ...next, minutes: mins }
}

/** 手动解除。 */
export function clearRisk(now = Date.now()) {
	atomicWriteJson(riskFile(), { until: null, code: null, reason: '', count: 0, at: new Date(now).toISOString() })
	return { ok: true, cooling: false }
}

/** 写动作前后的统一包装：冷却中直接拒；失败像风控就记账。 */
export async function guardedWrite(fn, { now = Date.now() } = {}) {
	const gate = coolingGate(now)
	if (gate) return { ok: false, stage: 'risk', error: gate, cooling: true }
	const r = await fn()
	if (r && r.ok === false && looksLikeRisk(r)) {
		const rec = noteRisk(r.error || r.msg || r.stage || 'unknown', { code: r.code ?? null, now })
		return { ...r, risk: 'recorded', coolingUntil: rec.until, cooldownMin: rec.minutes }
	}
	return r
}
