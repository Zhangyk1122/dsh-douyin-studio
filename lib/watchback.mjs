/**
 * 回评闭环：谁回了我 —— 从通知里挑出「回复了你的评论」，变成待回列表。
 *
 * 以前只巡检「我作品下的新评论」，别人在我评论下面的回复一直看不见。
 * 这里只做只读整理：给出 aweme / cid / root / 对方 / 原话，回不回由调用方决定。
 */

export const REPLY_TYPES = new Set([31, 32])

const num = (v) => Number(v) || 0

/** 纯函数：把通知列表折成待回候选。 */
export function pickReplies(items = [], { ownerUid = '', limit = 10, maxAgeHours = 72, now = Date.now() } = {}) {
	const out = []
	const seen = new Set()
	for (const it of items) {
		if (!it) continue
		const isReply = REPLY_TYPES.has(num(it.type)) || /回复了/.test(String(it.type_name || ''))
		if (!isReply) continue
		const cid = String(it.comment_id || '')
		if (!cid || seen.has(cid)) continue
		const at = num(it.create_time) * 1000
		if (at && now - at > maxAgeHours * 3600000) continue
		seen.add(cid)
		out.push({
			aweme: String(it.aweme_id || ''),
			cid,
			root: String(it.root_comment_id || ''),
			nick: String(it.nickname || ''),
			uid: String(it.uid || ''),
			text: String(it.content || ''),
			at: at ? new Date(at).toISOString() : '',
			fromOwner: ownerUid ? String(it.uid || '') === String(ownerUid) : false,
		})
	}
	out.sort((a, b) => (Number(b.fromOwner) - Number(a.fromOwner)) || String(b.at).localeCompare(String(a.at)))
	return out.slice(0, limit)
}

/** 顺手把「我自己刚回过的」标出来，避免重复回。 */
export function markAnswered(cands = [], answered = []) {
	const set = new Set(answered.map((x) => String(x && (x.cid || x))))
	return cands.map((c) => ({ ...c, answered: set.has(String(c.cid)) }))
}
