/**
 * 无人值守发布的「窗口 + 额度」（2026-11-05）
 * ============================================================================
 * 破甲之后真正多出来的能力不是"能发"，而是"没人盯着也能发"。所以这里只解决
 * 一个问题的两面：**什么时候允许它自己发，以及凭什么是这一次**。
 *
 * 四条同时成立才放行（少一条都退回人工）：
 *   1. 设置里显式开了 `unattendedPublish`（默认关）；
 *   2. 现在在 `unattendedFrom`–`unattendedTo` 这段窗口里（跨零点也认）；
 *   3. 今天自动发的条数还没到 `unattendedPerDay`；
 *   4. 首跑已经 dry 过、且总闸没开。
 *
 * 这一层不碰发布实现（禁改区），只在**调用之前**回答 yes/no；发了什么记在
 * `autopublish.jsonl`，面板和 `dy.mjs unattended status` 读的是同一份。
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isKilled, studioHome } from './killswitch.mjs'
import { needsFirstRunDry } from './firstrun.mjs'

/** 自动发账本：`$DOUYIN_STUDIO_HOME/autopublish.jsonl` */
export const autoFile = () => join(studioHome(), 'autopublish.jsonl')

const pad = (n) => String(n).padStart(2, '0')

/**
 * 本地日期键 `YYYY-MM-DD`（按机器时区，不是 UTC —— 额度是人按天数的）。
 * @param {Date} [now]
 * @returns {string}
 */
export const dayKey = (now = new Date()) => now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())

/**
 * 本地时刻 `HH:MM`。
 * @param {Date} [now]
 * @returns {string}
 */
export const clockOf = (now = new Date()) => pad(now.getHours()) + ':' + pad(now.getMinutes())

/**
 * 在不在窗口里。`to <= from` 视为跨零点（20:00–02:00 这种）。
 * @param {string} from `HH:MM`
 * @param {string} to `HH:MM`
 * @param {Date} [now]
 * @returns {boolean}
 */
export function inWindow(from, to, now = new Date()) {
	const a = String(from || '')
	const b = String(to || '')
	if (!/^\d{2}:\d{2}$/.test(a) || !/^\d{2}:\d{2}$/.test(b) || a === b) return false
	const t = clockOf(now)
	return b > a ? (t >= a && t < b) : (t >= a || t < b)
}

/**
 * 读自动发账本（坏行跳过，不让一行脏数据把整份读挂）。
 * @returns {Array<Record<string, any>>}
 */
export function readAuto() {
	try {
		return readFileSync(autoFile(), 'utf8').split('\n').filter(Boolean).map((l) => {
			try { return JSON.parse(l) } catch { return null }
		}).filter(Boolean)
	} catch { return [] }
}

/**
 * 今天自动发了几条。
 * @param {Date} [now]
 * @returns {number}
 */
export const countToday = (now = new Date()) => readAuto().filter((r) => r.day === dayKey(now)).length

/**
 * 记一条自动发（无论成败都记，失败的也要能对上）。
 * @param {Record<string, unknown>} rec
 * @returns {boolean}
 */
export function recordAuto(rec) {
	try {
		const file = autoFile()
		mkdirSync(dirname(file), { recursive: true })
		appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), day: dayKey(), ...rec }) + '\n', 'utf8')
		return true
	} catch { return false }
}

/**
 * 面板 / CLI 看的那份状态。
 * @param {any} S 归一后的设置
 * @param {Date} [now]
 * @returns {{on:boolean, open:boolean, from:string, to:string, used:number, perDay:number, left:number}}
 */
export function windowState(S, now = new Date()) {
	const on = Boolean(S && S.unattendedPublish)
	const from = String((S && S.unattendedFrom) || '')
	const to = String((S && S.unattendedTo) || '')
	const perDay = Math.max(0, Number((S && S.unattendedPerDay) || 0))
	const used = countToday(now)
	return { on, open: on && inWindow(from, to, now), from, to, used, perDay, left: Math.max(0, perDay - used) }
}

/**
 * 这一次自动发，允不允许。
 * @param {any} S 归一后的设置
 * @param {Date} [now]
 * @returns {{ok:true} | {ok:false, stage:string, reason:string}}
 */
export function checkAuto(S, now = new Date()) {
	if (isKilled()) return { ok: false, stage: 'killswitch', reason: '停损开着' }
	if (!S || S.unattendedPublish !== true) return { ok: false, stage: 'unattended-off', reason: '无人值守发布没开' }
	const from = String(S.unattendedFrom || '')
	const to = String(S.unattendedTo || '')
	if (!inWindow(from, to, now)) {
		return { ok: false, stage: 'window', reason: '不在窗口内（' + (from || '?') + '–' + (to || '?') + '，现在 ' + clockOf(now) + '）' }
	}
	if (countToday(now) >= Math.max(0, Number(S.unattendedPerDay) || 0)) {
		return { ok: false, stage: 'quota', reason: '今天自动发的额度用完了（' + countToday(now) + '/' + S.unattendedPerDay + '）' }
	}
	if (needsFirstRunDry()) return { ok: false, stage: 'first-run', reason: '还没跑过一次成功的 dry 发布' }
	return { ok: true }
}
