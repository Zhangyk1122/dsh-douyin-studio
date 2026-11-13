/**
 * @ 人这件事，只有一半是文案，一半是身份。
 *
 * 文案那半：`@辰辰辰chen 这条你会喜欢` —— 谁都会写，但纯文本在抖音里**不算 @**，
 * 对方收不到提醒，看着还像在自言自语。
 * 身份那半：平台要的是一个真实的候选人条目（数字 uid + sec_uid），
 * 写进 `text_extra` 才会变成可点的蓝色 @。
 *
 * 所以这里只做「判断能不能 @、把 @ 拼进去、产出 text_extra」，
 * 真正发出去仍然走 `lib/api.mjs` 的 `reply()`。拿不到 uid 就老实不发 @，
 * 而不是拿昵称碰运气 —— 昵称可以重名，uid 不会。
 */

/** 从各种来源（settings / 接口返回 / 手填）里捞出三个字段，缺一不可。 */
export function normalizeOwner(src = {}) {
	const s = src && typeof src === 'object' ? src : {}
	const nick = String(s.nick || s.nickname || s.ownerNick || '').trim()
	const uid = String(s.uid || s.user_id || s.userId || s.ownerUid || '').trim()
	const secUid = String(s.secUid || s.sec_uid || s.secUid || s.ownerSecUid || '').trim()
	return { nick, uid, secUid }
}

/** 数字 uid 才认。抖音的 user_id 是纯数字串，`ms4wljab...` 那种是 sec_uid。 */
export function isRealUid(v) {
	const s = String(v || '').trim()
	return /^\d{5,25}$/.test(s)
}

/** 能不能发一个**真的** @：必须同时有展示名和数字 uid。 */
export function canMention(owner) {
	const o = normalizeOwner(owner)
	return Boolean(o.nick) && isRealUid(o.uid)
}

/** 文案里已经带了同一个 @ 就别再叠一层。 */
export function hasMention(text, nick) {
	const t = String(text || '')
	const n = String(nick || '').trim()
	if (!n) return false
	return t.includes('@' + n)
}

/**
 * 把 `@昵称` 放到正文最前面。
 * 返回 `{ text, added }`：added=false 表示原来就有，调用方据此决定要不要再拼 text_extra。
 */
export function withMention(text, owner) {
	const o = normalizeOwner(owner)
	const body = String(text || '').trim()
	if (!o.nick) return { text: body, added: false }
	if (hasMention(body, o.nick)) return { text: body, added: false }
	return { text: ('@' + o.nick + ' ' + body).trim(), added: true }
}

/** 去掉正文里所有 `@xxx`（空格/标点前的那一段），用于「@ 单独由 text_extra 承担」的写法。 */
export function stripMentions(text) {
	return String(text || '')
		.replace(/@[^\s@，。！？、,.!?：:；;）)」』"'']{1,30}/g, '')
		.replace(/\s{2,}/g, ' ')
		.trim()
}

/**
 * `text_extra` 里的一项。
 *
 * 形状照 2026-11-03 抓到的真 @ 抄：`type:0` + `start/end` 指向正文里 `@昵称` 的位置，
 * 再多带 `nickname` 之类的字段反而会被服务端忽略（发出去变纯文本）。
 * ⚠️ 真机只验证过「接口回 status_code 0」，**对方是否真的收到提醒要在手机上确认一次**。
 */
export function mentionExtra(owner, text = '') {
	const o = normalizeOwner(owner)
	if (!canMention(o)) return []
	const body = String(text || '')
	const at = '@' + o.nick
	const start = body.indexOf(at)
	return [{
		start: start < 0 ? 0 : start,
		end: (start < 0 ? 0 : start) + at.length,
		type: 0,
		user_id: o.uid,
		sec_uid: o.secUid || '',
		hashtag_name: '',
		hashtag_id: ''
	}]
}

/** 把「要不要 @」的决策收成一个函数，省得每个调用点各写一遍。 */
export function planMention({ text, owner, want = true } = {}) {
	const o = normalizeOwner(owner)
	const body = String(text || '').trim()
	if (!want) return { text: body, extra: [], why: 'off' }
	if (!canMention(o)) {
		return { text: body, extra: [], why: o.nick ? 'no-uid' : 'no-owner' }
	}
	if (hasMention(body, o.nick)) {
		return { text: body, extra: mentionExtra(o, body), why: 'already-in-text' }
	}
	const withAt = ('@' + o.nick + ' ' + body).trim()
	return { text: withAt, extra: mentionExtra(o, withAt), why: 'prefixed' }
}
