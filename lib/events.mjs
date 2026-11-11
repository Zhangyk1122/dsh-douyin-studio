/**
 * lib/events.mjs —— 事件账：一个动作 = 一条事件
 * ============================================================================
 * 为什么重新开一份账，而不是继续加字段：
 *   到 2026-11-11 为止，同一个动作要写三四个地方 —— runs.jsonl（动作）、
 *   notify-state.json（今日计数）、ledger.json（去重与额度）、jobs（作业耗时），
 *   查一句「昨天到底给她回了没有」得对四个文件的时间戳。
 *   它们各自的格式还都不一样，谁都不是"事实"。
 *
 * 这一份是**事实**：动作名、对谁、成没成、失败原文、花了多久。
 * 别的文件都可以从这里重建，反过来不行。
 *
 * 与 aurabot 的桥（单写者）：
 *   dy 只往 dy-spool.ndjson 追加；aurobot 自己带游标读，写完 memories.json 再挪标。
 *   dy **永远不碰 memories.json** —— 两个进程写同一份记忆，冲突是必然的。
 *
 * 取舍：
 *   · append-only 单行 JSON，按月分文件（events-YYYY-MM.jsonl）
 *   · 写失败返回 null，绝不因为记账把主流程搞挂
 *   · 尾部读，最多 256KB —— 账本会一直长，不能整份读进内存
 * ============================================================================
 */
import { appendFileSync, closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** @returns {string} 数据目录（与 runlog 同一套规则） */
const dir = () =>
	process.env.DOUYIN_STUDIO_HOME
	|| join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'douyin-studio')

const cut = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n)

/** 年月键，本地时区（账是给人看的，不按 UTC 切）。 */
export const monthKey = (d = new Date()) =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

/** @param {Date} [d] @returns {string} 当月事件账路径 */
export const eventsFile = (d = new Date()) => join(dir(), `events-${monthKey(d)}.jsonl`)

/** 给 aurabot 的 spool（只追加，不带游标；游标在 aurabot 侧）。 */
export const spoolFile = () =>
	process.env.DOUYIN_STUDIO_SPOOL || join(dir(), 'dy-spool.ndjson')

/**
 * 事件 id：`dy:<kind>:<target>:<cid|10 分钟桶>`
 * 桶的意义：同一动作在 10 分钟内重复（重试）算同一条，避免账本被重试刷屏。
 */
export function eventId({ kind = 'act', target = '', cid = '', at = Date.now() } = {}) {
	const k = cut(kind, 20) || 'act'
	const t = cut(target, 40) || '-'
	const tail = cut(cid, 40) || 'b' + Math.floor(Number(at) / 600000)
	return `dy:${k}:${t}:${tail}`
}

/**
 * 归一化一条事件（纯函数，测试直接钉）。
 * @param {object} ev
 * @returns {object}
 */
export function normalizeEvent(ev = {}, now = Date.now()) {
	const at = Number(ev.at) || now
	const kind = cut(ev.kind, 20) || 'act'
	const t = ev.target && typeof ev.target === 'object' ? ev.target : { aweme: ev.target || '' }
	const target = {
		aweme: cut(t.aweme, 30),
		cid: cut(t.cid, 40),
		root: cut(t.root, 40),
		uid: cut(t.uid, 30),
		nick: cut(t.nick, 40),
	}
	const r = ev.result && typeof ev.result === 'object' ? ev.result : { ok: ev.ok !== false }
	const d = new Date(at)
	return {
		id: ev.id ? cut(ev.id, 140) : eventId({ kind, target: target.aweme || target.nick, cid: target.cid, at }),
		at: d.toISOString(),
		day: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
		kind,
		target,
		text: cut(ev.text, 300),
		result: {
			ok: r.ok !== false,
			stage: cut(r.stage, 20),
			error: cut(r.error, 200),
			took: Math.max(0, Math.round(Number(r.took) || 0)),
			verified: r.verified === true,
		},
		ref: ev.ref && typeof ev.ref === 'object' ? ev.ref : null,
	}
}

/**
 * 追加一条事件：主账 + spool。
 * @param {object} ev
 * @returns {object|null} 写进主账的那条；写盘失败返回 null
 */
export function appendEvent(ev, { now = Date.now() } = {}) {
	const row = normalizeEvent(ev, now)
	const line = JSON.stringify(row) + '\n'
	try {
		appendFileSync(eventsFile(new Date(Number(now) || Date.now())), line, 'utf8')
	} catch {
		return null
	}
	/* spool 失败不算失败：主账已经落盘，桥晚一轮接上就行。 */
	try {
		appendFileSync(spoolFile(), line, 'utf8')
	} catch { /* 桥断了不影响 dy 自己记账 */ }
	return row
}

/** 从文件尾读最多 cap 字节，返回行（可能截断首行，调用方丢掉半行）。 */
function tailLines(file, n, cap = 256 * 1024) {
	let fd = -1
	try {
		if (!existsSync(file)) return []
		fd = openSync(file, 'r')
		const size = fstatSync(fd).size
		const start = Math.max(0, size - cap)
		const buf = Buffer.alloc(size - start)
		readSync(fd, buf, 0, buf.length, start)
		let text = buf.toString('utf8')
		if (start > 0) {
			const nl = text.indexOf('\n')
			text = nl >= 0 ? text.slice(nl + 1) : ''
		}
		return text.split('\n').filter(Boolean).slice(-Math.max(1, n))
	} catch {
		return []
	} finally {
		if (fd >= 0) { try { closeSync(fd) } catch { /* 关不掉也没辙 */ } }
	}
}

/**
 * 最近 n 条事件（新的在后）。
 * @param {number} [n]
 * @param {{file?:string}} [opts]
 */
export function readEvents(n = 50, { file = '' } = {}) {
	const out = []
	for (const l of tailLines(file || eventsFile(), n)) {
		try { out.push(JSON.parse(l)) } catch { /* 跳过坏行 */ }
	}
	return out
}
