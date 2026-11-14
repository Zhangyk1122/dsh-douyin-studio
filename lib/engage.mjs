/**
 * 主动互动的「白名单 + 额度」（2026-11-05，灰度第一版）
 * ============================================================================
 * 能力上限最高、也最容易封号的一条。这一版**只做规划器，不做执行器**：
 *   - 从已收集的候选（`picks.json`）里挑出"白名单作者"的视频；
 *   - 每人每天最多 1 条、整体不超过 `engagePerDay`、两条之间至少 `engageGapSec`；
 *   - 输出一份"今天会碰谁"的清单，真动作仍然走 `comment_at` / `share` 那条老路，
 *     且必须显式 confirm。
 * 为什么先不自动执行：模型自己决定"该给谁评论"这件事，一次判断错就是公开事故。
 * 先让人看三天清单，再谈放行 —— 这就是灰度。
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { studioHome } from './killswitch.mjs'

/** 互动账本：`$DOUYIN_STUDIO_HOME/engage.jsonl` */
export const engageFile = () => join(studioHome(), 'engage.jsonl')

const pad = (n) => String(n).padStart(2, '0')

/**
 * 本地日期键。
 * @param {Date} [now]
 * @returns {string}
 */
export const dayKey = (now = new Date()) => now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())

/**
 * 白名单作者：逗号（中英文都认）/ 空白分隔，去重保序。
 * @param {any} S 归一后的设置
 * @returns {string[]}
 */
export function authorsOf(S) {
	const raw = String((S && S.engageAuthors) || '').trim()
	if (!raw) return []
	const out = []
	for (const chunk of raw.split(/[,，、;；\n\r]+/)) {
		const c = chunk.trim()
		if (!c) continue
		/* 带括号 = 一个完整昵称（抖音昵称里空格很常见：
		 * "大地矿业（CDD MINING)"）。以前按 /[,，\s]+/ 一刀切，会把它撕成
		 * "大地矿业（CDD" + "MINING)" 两片 → 白名单永远匹配不上 → 清单永远空。
		 * 不带括号的段仍按空白拆，兼容 "A B C" 这种老写法。多个作者请用逗号隔开。 */
		if (/[（）()]/.test(c)) { out.push(c); continue }
		for (const p of c.split(/\s+/)) if (p) out.push(p)
	}
	return [...new Set(out)]
}

/**
 * 读互动账本。
 * @returns {Array<Record<string, any>>}
 */
export function readEngage() {
	try {
		return readFileSync(engageFile(), 'utf8').split('\n').filter(Boolean).map((l) => {
			try { return JSON.parse(l) } catch { return null }
		}).filter(Boolean)
	} catch { return [] }
}

/**
 * 今天已经碰过几条 + 碰过谁（同一个人一天只碰一次）。
 * @param {Date} [now]
 * @returns {{count:number, authors:string[]}}
 */
export function usedToday(now = new Date()) {
	const rows = readEngage().filter((r) => r.day === dayKey(now))
	return { count: rows.length, authors: [...new Set(rows.map((r) => String(r.author || '')))] }
}

/**
 * 记一条互动。
 * @param {Record<string, unknown>} rec
 * @returns {boolean}
 */
export function recordEngage(rec) {
	try {
		const file = engageFile()
		mkdirSync(dirname(file), { recursive: true })
		appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), day: dayKey(), ...rec }) + '\n', 'utf8')
		return true
	} catch { return false }
}

/** 从一条候选里取作者名（字段名在不同来源里不统一，四个都认）。 */
const authorName = (it) => String(
	(it && (it.authorNickname || it.authorName || (it.author && (it.author.nickname || it.author.name)) || it.author)) || ''
).trim()

/**
 * 出一份今天的互动计划。不联网、不发东西，纯筛选。
 * @param {any} S 归一后的设置
 * @param {{items?:Array<any>, now?:Date}} [opts]
 * @returns {{ok:boolean, stage?:string, reason?:string, list:Array<{aweme:string, author:string, desc:string}>, scanned:number, skipped:number, used:number, perDay:number}}
 */
export function planEngage(S, opts = {}) {
	const now = opts.now || new Date()
	const perDay = Math.max(0, Number((S && S.engagePerDay) || 0))
	const used = usedToday(now)
	const base = { list: [], scanned: 0, skipped: 0, used: used.count, perDay }
	if (!S || S.engageOn !== true) return { ...base, ok: false, stage: 'engage-off', reason: '主动互动没开（默认关）' }
	const allow = authorsOf(S)
	if (!allow.length) return { ...base, ok: false, stage: 'no-whitelist', reason: '没配白名单作者，一条都不会碰' }
	const items = Array.isArray(opts.items) ? opts.items : []
	base.scanned = items.length
	const left = Math.max(0, perDay - used.count)
	if (left <= 0) return { ...base, ok: false, stage: 'quota', reason: '今天的互动额度用完了（' + used.count + '/' + perDay + '）' }
	const seen = new Set(used.authors)
	const list = []
	for (const it of items) {
		const a = authorName(it)
		if (!a || !allow.includes(a)) { base.skipped++; continue }
		if (seen.has(a)) { base.skipped++; continue }
		if (list.length >= left) { base.skipped++; continue }
		seen.add(a)
		list.push({
			aweme: String((it && (it.aweme_id || it.awemeId || it.aweme || it.id)) || ''),
			author: a,
			desc: String((it && (it.desc || it.text || '')) || '').slice(0, 60),
		})
	}
	return { ...base, ok: true, list }
}

/**
 * 两条互动之间至少隔多久，还差几秒。
 * @param {Date} [now]
 * @param {number} [gapSec]
 * @returns {number} 0 = 可以立刻做
 */
export function waitGap(now = new Date(), gapSec = 90) {
	const rows = readEngage()
	if (!rows.length) return 0
	const last = Date.parse(String(rows[rows.length - 1].at || ''))
	if (!Number.isFinite(last)) return 0
	const need = Math.max(0, Number(gapSec) || 0) * 1000
	return Math.max(0, Math.ceil((last + need - now.getTime()) / 1000))
}
