/**
 * lib/runlog.mjs —— 一次动作一行，append-only
 * ============================================================================
 * 为什么要有它：
 *   2026-11-05 一天里排查了四次"它到底做没做"，每次都只能翻 notify-state 或聊天记录，
 *   有三次是因为失败被静默吞掉（say='' / 没 await / 分支没调记账）——
 *   知道"出错了"，但不知道"错在哪一步"。
 *
 *   这一份账本回答三个问题：**什么时候、对谁、成没成**。
 *   它不替代 ledger（业务账，管去重和额度），只记"动作"（运维账，管排查）。
 *
 * 设计取舍：
 *   · append-only + 单行 JSON：崩了最多丢最后一行，不会写坏历史
 *   · 超过 2MB 轮转成 runs.jsonl.1，只留一代 —— 排查用的是最近几百条
 *   · 写失败返回 null，绝不因为记账把主流程搞挂
 * ============================================================================
 */
import { appendFileSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const MAX_BYTES = 2 * 1024 * 1024
const KEEP = 20

const dir = () =>
	process.env.DOUYIN_STUDIO_HOME
	|| join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'douyin-studio')

/** @returns {string} 动作账文件路径 */
export const runlogFile = () => join(dir(), 'runs.jsonl')

const cut = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n)

/**
 * 记一次动作。
 * @param {object} o
 * @param {string} o.kind    动作名：reply / at / comment-at / share / dm / publish / feed / tellOwner …
 * @param {string} o.target  对谁：cid / aweme / 昵称
 * @param {boolean} o.ok     成没成
 * @param {string} o.stage   卡在哪一步（api / quota / budget / page …）
 * @param {string} o.error   失败原因原文
 * @param {number} o.took    耗时毫秒
 * @returns {object|null}    写进去的那一行；写盘失败返回 null
 */
export function logRun({ kind = 'unknown', target = '', ok = true, stage = '', error = '', took = 0, now = Date.now(), extra = null } = {}) {
	const row = {
		at: new Date(Number(now) || Date.now()).toISOString(),
		kind: cut(kind, 24) || 'unknown',
		target: cut(target, 90),
		ok: !!ok,
		stage: cut(stage, 20),
		error: cut(error, 200),
		took: Math.max(0, Math.round(Number(took) || 0)),
	}
	if (extra && typeof extra === 'object') row.extra = extra
	try {
		const f = runlogFile()
		try {
			if (statSync(f).size > MAX_BYTES) renameSync(f, f + '.1')
		} catch { /* 第一次写，没有文件 */ }
		appendFileSync(f, JSON.stringify(row) + '\n', 'utf8')
		return row
	} catch {
		return null
	}
}

/** 最近 n 条（文件不存在 / 坏了都返回空数组）。 */
export function readRuns(n = KEEP, { file = '' } = {}) {
	try {
		const text = readFileSync(file || runlogFile(), 'utf8')
		const lines = text.split('\n').filter(Boolean).slice(-Math.max(1, n))
		const out = []
		for (const l of lines) {
			try { out.push(JSON.parse(l)) } catch { /* 跳过坏行，不因一行坏掉整份日志 */ }
		}
		return out
	} catch {
		return []
	}
}

/** 汇总：总数 / 成败 / 按动作分组 / 最近一次失败。 */
export function summarize(runs = []) {
	const by = {}
	let fail = 0
	let lastFail = null
	for (const r of runs) {
		if (!r || !r.kind) continue
		by[r.kind] = (by[r.kind] || 0) + 1
		if (r.ok === false) {
			fail += 1
			if (!lastFail) lastFail = r
		}
	}
	return { total: runs.length, fail, ok: runs.length - fail, byKind: by, lastFail }
}
