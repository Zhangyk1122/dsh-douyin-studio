/**
 * lib/roundstate.mjs —— 刷视频轮次的状态与台账（唯一写盘口）
 * ============================================================================
 * 之前 scan-state.json 只存 {day, done}，由 index.js 直接读写。
 * 现在退避、暂停、熔断都要状态，散在各处一定会写岔 —— 统一收在这里。
 *
 * 文件分工：
 *   scan-state.json  当前状态（day / done / failures / lastAt）
 *   rounds.jsonl     每轮一行（跑过或跳过都记），面板「今天为什么没刷」看它
 *   health.json      熔断档位，面板标黄/标红
 *   STOP             存在即暂停（空文件，手动删也行）
 * ============================================================================
 */
import { appendFileSync, existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { atomicWriteJson, readJsonSafe } from './fsx.mjs'
import { updateJson } from './store.mjs'
import { readJobs } from './jobs.mjs'

const MAX_BYTES = 1024 * 1024

/** @returns {string} 运行数据目录（可用 DOUYIN_STUDIO_HOME 覆盖） */
export const dir = () =>
	process.env.DOUYIN_STUDIO_HOME
	|| join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'douyin-studio')

/** @returns {string} 轮次状态文件 */
export const stateFile = () => join(dir(), 'scan-state.json')
/** @returns {string} 轮次台账（JSONL） */
export const roundsFile = () => join(dir(), 'rounds.jsonl')
/** @returns {string} 熔断状态文件 */
export const healthFile = () => join(dir(), 'health.json')
/** @returns {string} 暂停标记文件 */
export const stopFile = () => join(dir(), 'STOP')

const ensure = () => { try { mkdirSync(dir(), { recursive: true }) } catch { /* 已存在 */ } }
const cut = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n)

/** @param {object} fallback @returns {object} 轮次状态 */
export function readState(fallback = {}) {
	return readJsonSafe(stateFile(), { day: '', done: 0, failures: 0, lastAt: '', ...fallback })
}

/** @param {object} s @returns {boolean} 写盘是否成功 */
export function writeState(s) {
	try { ensure(); atomicWriteJson(stateFile(), s); return true } catch { return false }
}

/** 跨过 await 之后再写状态时用这个：同文件串行，不会把别人的改动覆盖掉。
 *  @param {(cur:object)=>object} fn @returns {Promise<object|null>} */
export function updateState(fn) {
	try { ensure() } catch { /* 目录建不了就交给写盘时报错 */ }
	return updateJson(stateFile(), fn, { fallback: { day: '', done: 0, failures: 0 } })
}

/** @param {(cur:object)=>object} fn @returns {Promise<object|null>} */
export function updateHealth(fn) {
	try { ensure() } catch { /* 同上 */ }
	return updateJson(healthFile(), fn, { fallback: { level: 'ok', failures: 0 } })
}

/** @returns {boolean} STOP 存在即暂停 */
export function isPaused() {
	return existsSync(stopFile())
}

/** @returns {boolean} 设置成功与否 */
export function setPaused(on) {
	try {
		ensure()
		if (on) writeFileSync(stopFile(), 'paused\n', 'utf8')
		else if (existsSync(stopFile())) unlinkSync(stopFile())
		return true
	} catch { return false }
}

/** @returns {object} 当前熔断档位 */
export function readHealth({ memoMs = HEALTH_MEMO_MS } = {}) {
	const h = readJsonSafe(healthFile(), { level: 'ok', failures: 0, reason: '', at: '' })
	return { ...h, ...healthExtra(Date.now(), memoMs) }
}

/* 派生块（last / took）的读盘缓存：一次要读 jobs 账本（最多 3 × 256 KB）+ state，
 * 而面板 5 秒轮询一次 /schedule、角标也走这条路。账本一秒内不会变两次，
 * 所以一秒内复用上一份结果；写 health / 写轮次时主动清缓存，不靠 TTL 猜。 */
export const HEALTH_MEMO_MS = 1000
let memoAt = 0
let memoVal = null

/** 清掉派生块缓存（写完 health / 轮次后调用，测试也用）。 */
export function dropHealthMemo() {
	memoAt = 0
	memoVal = null
}

/**
 * 派生给面板的两块（0.4.5，只读取、不写盘、不改任何行为）：
 *   - `last`：report / scan / publish 各自**最近一次成功**的时间；
 *   - `took`：最近作业耗时的 p50 / p95（样本 < 5 时整个字段不出现，免得看一个假分布）。
 * 为什么放在读的时候算：这些是"从别的账本推出来的"，写进 health.json 会变成第二份真源，
 * 一旦某次没写就永久过期。读时算，永远跟账本一致。
 */
function healthExtra(now = Date.now(), memoMs = HEALTH_MEMO_MS) {
	if (memoMs > 0 && memoVal && now - memoAt < memoMs) return memoVal
	const last = {}
	const took = []
	try {
		const jobs = readJobs(40)
		for (const j of jobs) {
			if (!j || j.ok !== true) continue
			/* readJobs 是"旧的在前"，所以直接覆盖就是取最新一条成功 */
			if (j.name === 'scan-round' && j.at) last.scan = j.at
			if (Number(j.took) > 0) took.push(Number(j.took))
		}
	} catch { /* 账本读不出来就不给这两块，不影响 health 本身 */ }
	try {
		const st = readJsonSafe(join(dir(), 'autopilot-state.json'), null, (v) => v && typeof v === 'object')
		for (const item of (st && Array.isArray(st.log) ? st.log : [])) {
			if (!item || item.ok !== true) continue
			if (item.kind === 'report' && !last.report) last.report = item.at
			if (item.kind === 'publish' && !last.publish) last.publish = item.at
		}
	} catch { /* 同上 */ }
	const out = { last }
	if (took.length >= 5) {
		const s = took.slice().sort((a, b) => a - b)
		const at = (p) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]
		out.took = { n: s.length, p50: at(0.5), p95: at(0.95) }
	}
	memoAt = now
	memoVal = out
	return out
}

/** @param {object} h @returns {boolean} 写盘是否成功 */
export function writeHealth(h) {
	try { ensure(); atomicWriteJson(healthFile(), { at: new Date().toISOString(), ...h }); dropHealthMemo(); return true } catch { return false }
}

/** 一行一轮。写失败返回 null，绝不影响主流程。 */
export function appendRound({ round = -1, ok = true, took = 0, seen = 0, kept = 0, skipped = '', error = '', now = Date.now() } = {}) {
	const row = {
		at: new Date(now).toISOString(),
		round, ok: Boolean(ok), took: Math.max(0, Math.round(took)),
		seen: Math.max(0, Math.round(seen)), kept: Math.max(0, Math.round(kept)),
		skipped: cut(skipped, 60), error: cut(error, 160),
	}
	try {
		ensure()
		const f = roundsFile()
		if (existsSync(f) && statSync(f).size > MAX_BYTES) {
			try { renameSync(f, f + '.1') } catch { /* 轮转失败就继续追加 */ }
		}
		appendFileSync(f, JSON.stringify(row) + '\n', 'utf8')
		dropHealthMemo()
		return row
	} catch { return null }
}

/** 本地日历日。rounds.jsonl 里 at 是 UTC ISO，直接 slice(0,10) 会在东八区凌晨错一天。 */
const localDay = (iso) => {
	const d = new Date(iso)
	if (Number.isNaN(d.getTime())) return ''
	const p = (x) => String(x).padStart(2, '0')
	return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

/** 读最近 n 行；day 给 'YYYY-MM-DD' 时只留本地当天。 */
export function readRounds(n = 20, day = '') {
	try {
		const txt = readFileSync(roundsFile(), 'utf8')
		const rows = txt.split('\n').filter(Boolean).slice(-Math.max(1, n) * 4).map((line) => {
			try { return JSON.parse(line) } catch { return null }
		}).filter(Boolean)
		return (day ? rows.filter((r) => localDay(r.at) === day) : rows).slice(-Math.max(1, n))
	} catch { return [] }
}

/** 面板要的一行字：今天刷了几轮、跳过几次、下一次几点。 */
export function summarizeRounds(rows = []) {
	let ran = 0, skipped = 0, failed = 0
	for (const r of rows) {
		if (r.skipped) skipped++
		else if (r.ok) ran++
		else failed++
	}
	return { ran, skipped, failed, total: rows.length }
}
