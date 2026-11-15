/**
 * lib/rhythm.mjs —— 回复前的那几秒，和偶尔的不回。
 *
 * 为什么（2026-11-13）：机器人是 0 毫秒回复；人是先看见、想一想、再打。
 * 另外真人会漏看：非 @ 场景下留 3% 不回，比每条都回更像人。
 *
 * 2026-11-15 起多一条路：**从自己的动作账学节奏**（调研 D7-A）。
 * 按字数估停顿（1.2s + 0.12s/字）本质是拍一个「像人的常数」——QQ 侧早就否过：
 * 「按字数等一会儿，本质是演一个打字的人」。所以学到的分布优先，字数估只做兜底。
 *
 * 不引入随机源以外的依赖；测试里传 rng 就能确定性复现。
 */
import { readRuns } from './runlog.mjs'

/** 按字数估打字时间：基础 1.2s + 每字 0.12s，夹在 2–6s（兜底，不是理想） */
export function typingMs(text) {
	const n = String(text == null ? '' : text).replace(/\s+/g, '').length
	const ms = 1200 + n * 120
	return Math.max(2000, Math.min(6000, Math.round(ms)))
}

/* ── 从自己的历史学节奏（D7-A） ───────────────────────────────────────── */

/** 算「说话节奏」的动作：发出去的话。发布/只读/巡检不算——那不是对话。 */
const SEND_KINDS = new Set(['dm', 'reply', 'comment-at', 'at', 'tellOwner', 'share', 'send:at', 'speakup'])
const MAX_GAP_MS = 4 * 3600 * 1000  // 超过 4 小时是睡觉，不是打字停顿
const MIN_GAP_MS = 3000             // 3 秒内是同一次动作记了两笔
const PACE_MIN_MS = 2000            // 停顿下限（与兜底一致）
const PACE_MAX_MS = 90000           // 停顿上限：超过一分半不是打字，是排班

/**
 * 相邻两次「发送」的间隔。剔掉睡觉跨度和重复记账，剩下的就是她真实的一句接一句。
 * @param {Array<{at:string, kind:string}>} [rows] runlog 的行
 * @returns {number[]} 毫秒数组（旧 → 新）
 */
export function gapsOf(rows = []) {
	const sends = (rows || [])
		.filter((r) => r && SEND_KINDS.has(String(r.kind)))
		.map((r) => Date.parse(r.at))
		.filter((t) => Number.isFinite(t))
		.sort((a, b) => a - b)
	const gaps = []
	for (let i = 1; i < sends.length; i++) {
		const g = sends[i] - sends[i - 1]
		if (g >= MIN_GAP_MS && g <= MAX_GAP_MS) gaps.push(g)
	}
	return gaps
}

/**
 * 从间隔里学一个「回复停顿」：取 p10–p90 的中段随机取样。
 * 样本不够就返回 null —— 认输比拍一个强。早期数据反映的是旧常数行为，分布会随真实使用漂移。
 * @param {Array<{at:string, kind:string}>} [rows]
 * @param {{min?:number, rng?:()=>number}} [o]
 * @returns {number|null}
 */
export function empiricalPace(rows = [], { min = 20, rng = Math.random } = {}) {
	const gaps = gapsOf(rows).map((g) => Math.max(PACE_MIN_MS, Math.min(PACE_MAX_MS, g))).sort((a, b) => a - b)
	if (gaps.length < Math.max(1, Number(min) || 20)) return null
	const lo = gaps[Math.floor(gaps.length * 0.1)]
	const hi = gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.9))]
	/* 全相同不是「学不到」，是「她就这个节奏」——hi===lo 时取样结果就是 lo。
	 * 只有样本乱到越界（理论上不会，sort 过）才认输。 */
	if (!(Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo)) return null
	return Math.round(lo + rng() * (hi - lo))
}

/** 缓存：一轮值勤要回好几条，不能每条都重读一遍账本。 */
let paceCache = { at: 0, val: null }

/**
 * 读自己的动作账学一拍。学不到返回 null，调用方退回按字数估。
 * @param {{max?:number, ttlMs?:number, now?:number}} [o]
 * @returns {number|null}
 */
export function learnPace({ max = 500, ttlMs = 60000, now = Date.now() } = {}) {
	if (now - paceCache.at < (Number(ttlMs) || 0)) return paceCache.val
	const val = empiricalPace(readRuns(Math.max(1, Number(max) || 500)))
	paceCache = { at: now, val }
	return val
}

/**
 * @param {string} text
 * @param {{rng?:()=>number, skipRate?:number, important?:boolean, pace?:number|null}} [opts]
 *        important = 被 @、私信主人这类不能漏的场合，永不跳过
 *        pace = 从历史学到的停顿（null/缺省 = 按字数估兜底）
 * @returns {{delayMs:number, skip:boolean, reason:string}}
 */
export function humanDelay(text, opts = {}) {
	/* 测试/自检里不想真等：DOUYIN_STUDIO_FAST=1 直接 0 延迟、不跳过 */
	if (String(process.env.DOUYIN_STUDIO_FAST || '') === '1') return { delayMs: 0, skip: false, reason: 'fast' }
	const rng = typeof opts.rng === 'function' ? opts.rng : Math.random
	const skipRate = Math.max(0, Math.min(0.2, Number.isFinite(opts.skipRate) ? opts.skipRate : 0.03))
	if (!opts.important && rng() < skipRate) return { delayMs: 0, skip: true, reason: 'missed' }
	const learned = Number.isFinite(opts.pace) && opts.pace > 0
	return {
		delayMs: learned ? Math.round(opts.pace) : typingMs(text),
		skip: false,
		reason: learned ? 'learned' : 'typing',
	}
}
