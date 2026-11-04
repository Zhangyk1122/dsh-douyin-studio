/**
 * lib/unread.mjs —— 谁还有我没看的新消息
 * ============================================================================
 * 私信接口只给「最后一条是谁发的、什么时候」，**不给已读状态**。
 * 所以自己记：每打开一次会话，就把「我看到哪儿了」写成时间戳；
 * 下次列表里某人的 last_at 比这个戳新、而且最后一条不是你发的 → 算一条未读。
 *
 * 这是**近似**，别吹成精确：
 *   - 只看最后一条，同一段时间里他连发三条也只算「有新消息」；
 *   - 用时间戳比大小，两台机器时钟差太多会漂。
 * 但对「面板上要不要点一个红点」这件事，够准。
 * ============================================================================
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteJson, readJsonSafe } from './fsx.mjs'

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DIR = join(HOME, 'douyin-duty')
/** { "<peer_uid>": "<我读到的时间戳 ISO>" } */
const FILE = join(DIR, 'dm-read.json')

/**
 * 读已读标记。文件坏了会被挪到 `.corrupt-*` 留现场（见 lib/fsx.mjs），
 * 这里照样返回 {} —— 代价是全部私信又变未读，但至少查得出来是什么时候坏的。
 * @returns {Record<string,string>}
 */
export function marks() {
	const j = readJsonSafe(FILE, null, (v) => v && typeof v === 'object' && !Array.isArray(v))
	return j || {}
}

/**
 * 记下「这个人的会话我看到这里了」。
 * @param {string} uid
 * @param {string} [at] 默认现在
 * @returns {{ok:boolean, uid:string, at:string}}
 */
export function markRead(uid, at) {
	const key = String(uid || '').trim()
	const when = String(at || new Date().toISOString())
	if (!key) return { ok: false, uid: '', at: when }
	const m = marks()
	// 只往前走，不许被旧时间戳倒推（补读历史时容易踩）
	if (!m[key] || when > m[key]) m[key] = when
	const r = atomicWriteJson(FILE, m)
	if (!r.ok) return { ok: false, uid: key, at: when, error: r.error }
	return { ok: true, uid: key, at: m[key] }
}

/**
 * 这条会话有几条没看（0 或 1）。
 *
 * 为什么是 0/1 而不是真实条数：接口只给最后一条的时间，数不出「他连发了几条」。
 * 给个 1 表示「有新东西」，给假数字才是骗人。
 *
 * @param {{peer_uid?:string, last_at?:string, from?:string}} row
 * @returns {number}
 */
export function unreadOf(row) {
	const last = String(row?.last_at || '')
	if (!last) return 0
	if (row?.from === 'me') return 0
	const m = marks()
	const seen = String(m[String(row.peer_uid || '')] || '')
	return last > seen ? 1 : 0
}

/**
 * 给整个列表打上 unread 字段，并给出总数。
 * @param {Array<object>} list
 * @returns {{list:Array<object>, unread:number}}
 */
export function decorate(list) {
	const rows = Array.isArray(list) ? list : []
	let total = 0
	const out = rows.map((r) => {
		const u = unreadOf(r)
		total += u
		return { ...r, unread: u }
	})
	return { list: out, unread: total }
}

export { FILE as UNREAD_FILE }
