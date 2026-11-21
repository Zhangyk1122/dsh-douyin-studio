/**
 * lib/llm-session.mjs —— 回复用的「固定会话 + 轮换」
 * ============================================================================
 * 为什么：每次 `dsh headless` 新开会话，系统提示词那 ~6.4k token 要全价付；
 * 复用同一个 session-id 时实测 cacheReadTokens=6400 / inputTokens=68（命中率 99%），
 * 单条成本从约 ¥0.0041 降到 ¥0.00013（便宜 30 倍以上）。
 *
 * 但会话不能无限续：历史会膨胀、上下文会互相污染。所以攒够轮数或跨天就换一个，
 * 换的时候把最近几轮对话压成几行带过去（不然「换会话」=「失忆」）。
 *
 * 状态：$DSH_HOME/douyin-studio/llm-session.json
 *   { sessionId, turns, bornAt, recent: [{q,a}], stat: {input, cacheRead, output, calls} }
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteJson, readJsonSafe } from './fsx.mjs'

const MAX_TURNS = Number(process.env.DOUYIN_LLM_SESSION_MAX_TURNS) || 50
const MAX_AGE_MS = (Number(process.env.DOUYIN_LLM_SESSION_MAX_HOURS) || 24) * 3600 * 1000
const KEEP_RECENT = 3

const home = () => process.env.DSH_HOME || join(homedir(), '.dsh')
export const sessionFile = () => join(home(), 'douyin-studio', 'llm-session.json')

const EMPTY = () => ({ sessionId: '', turns: 0, bornAt: 0, recent: [], stat: { input: 0, cacheRead: 0, output: 0, calls: 0 } })

export function loadSession() {
	const j = readJsonSafe(sessionFile(), null) || null
	if (!j || typeof j !== 'object') return EMPTY()
	return {
		...EMPTY(), ...j,
		recent: Array.isArray(j.recent) ? j.recent.slice(-KEEP_RECENT) : [],
		stat: { ...EMPTY().stat, ...(j.stat || {}) },
	}
}

export function saveSession(st) {
	try {
		const r = atomicWriteJson(sessionFile(), st)
		return r && r.ok
	} catch { return false }
}

/** 该不该换新会话（纯函数，好测）：没 id / 轮数到顶 / 太老了。 */
export function shouldRotate(st, { maxTurns = MAX_TURNS, maxAgeMs = MAX_AGE_MS, now = Date.now() } = {}) {
	if (!st || !st.sessionId) return true
	if (Number(st.turns) >= Math.max(1, Number(maxTurns) || MAX_TURNS)) return true
	if (Number(st.bornAt) && now - Number(st.bornAt) > maxAgeMs) return true
	return false
}

/** 换会话时带过去的上下文：最近几轮问答，压成紧凑几行。 */
export function carryOver(st) {
	const recent = Array.isArray(st && st.recent) ? st.recent.slice(-KEEP_RECENT) : []
	if (!recent.length) return ''
	const rows = recent.map((x) => {
		const q = String((x && x.q) || '').replace(/\s+/g, ' ').slice(0, 60)
		const a = String((x && x.a) || '').replace(/\s+/g, ' ').slice(0, 40)
		return '· ' + q + ' → ' + a
	})
	return '【最近几轮对话，接上语气，别重复】\n' + rows.join('\n')
}

/** 记一轮：更新轮数、最近问答、用量统计。 */
export function noteTurn(st, { q = '', a = '', usage = null } = {}) {
	st.turns = (Number(st.turns) || 0) + 1
	if (!st.bornAt) st.bornAt = Date.now()
	st.recent = [...(st.recent || []), { q: String(q).slice(0, 200), a: String(a).slice(0, 120) }].slice(-KEEP_RECENT)
	if (usage && typeof usage === 'object') {
		st.stat = st.stat || { input: 0, cacheRead: 0, output: 0, calls: 0 }
		st.stat.calls = (Number(st.stat.calls) || 0) + 1
		st.stat.input = (Number(st.stat.input) || 0) + (Number(usage.inputTokens) || 0)
		st.stat.cacheRead = (Number(st.stat.cacheRead) || 0) + (Number(usage.cacheReadTokens) || 0)
		st.stat.output = (Number(st.stat.output) || 0) + (Number(usage.outputTokens) || 0)
	}
	return st
}

/** 归零重开（换会话或出错后重建）。 */
export function resetSession(keepRecent = true) {
	const old = loadSession()
	const st = EMPTY()
	if (keepRecent) st.recent = old.recent
	st.stat = old.stat
	saveSession(st)
	return st
}

export function stats() {
	const st = loadSession()
	const s = st.stat || {}
	const total = (Number(s.input) || 0) + (Number(s.cacheRead) || 0)
	return {
		sessionId: st.sessionId,
		turns: st.turns,
		calls: s.calls || 0,
		input: s.input || 0,
		cacheRead: s.cacheRead || 0,
		output: s.output || 0,
		cacheHitRate: total ? Math.round(((Number(s.cacheRead) || 0) / total) * 100) : 0,
	}
}
