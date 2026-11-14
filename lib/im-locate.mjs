/**
 * lib/im-locate.mjs —— 私信会话定位：**按 uid / sec_uid 找，不靠昵称**
 * ============================================================================
 * 为什么单开一个文件（2026-11-07）：
 *   `lib/im-send.mjs` 在禁改区（tools/protected.json 里有哈希），而它的定位方式是
 *   「按昵称精确匹配会话行」。日报连挂 11 次的根因之一就在这里：昵称是展示字段，
 *   会改、会重名、会被「vt, 鹤瑾, oxygen, 辰辰辰chen」这种合并标题盖住。
 *
 *   这个文件只做一件事：**把「找谁」从昵称换成稳定 id**。
 *   - 会话项的 sec_uid 从 React fiber 的 `conversation.toParticipantSecUserId` 读；
 *   - 有 uid 时，把行的 sec_uid 反查成数字 uid 再比对（不猜人）；
 *   - 点开之后，用消息区的 fiber 校验「当前打开的这个人」就是目标（防点错行）。
 *
 * 不碰禁改区，也不重写点击/输入那套已经真机验证过的流程。
 * ============================================================================
 */

export const CHAT_URL = 'https://www.douyin.com/chat'

/**
 * 列出会话列表：昵称（展示用）、sec_uid（稳定 id）、点击坐标、是否在可视区。
 * sec_uid 取不到就是空字符串 —— 调用方必须把它当「这人不可定位」，别退回猜。
 */
export const listRowsJs = `(() => {
	const nodes = Array.prototype.slice.call(document.querySelectorAll('[data-e2e="conversation-item"]'))
	const out = nodes.map((n) => {
		const fk = Object.keys(n).find((k) => k.indexOf('__reactFiber$') === 0)
		let sec = ''
		if (fk) {
			let f = n[fk], d = 0
			while (f && d < 14) {
				const p = f.memoizedProps
				if (p && p.conversation && p.conversation.toParticipantSecUserId) { sec = String(p.conversation.toParticipantSecUserId); break }
				f = f.return; d++
			}
		}
		const t = (n.innerText || '').replace(/\\s+/g, ' ').trim()
		const nickEl = n.querySelector('[class*="ConversationItemTitle"], [class*="conversationItemTitle"], [class*="nickname"], [class*="Nickname"]')
		const nick = nickEl ? (nickEl.innerText || '').replace(/\\s+/g, ' ').trim() : (t.split(' ')[0] || '')
		const r = n.getBoundingClientRect()
		return {
			nick: nick.slice(0, 40), sec_uid: sec,
			x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
			left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height),
		}
	})
	return JSON.stringify(out)
})()`

/** 当前打开的会话对端 sec_uid：从消息框的 fiber 往上找，几种包法都试。 */
export const currentSecUidJs = `(() => {
	function pick(o) {
		if (!o || typeof o !== 'object') return ''
		const cands = [
			o.curConversation && o.curConversation.toParticipantSecUserId,
			o.conversation && o.conversation.toParticipantSecUserId,
			o.msgConfig && o.msgConfig.conversation && o.msgConfig.conversation.toParticipantSecUserId,
		]
		for (let i = 0; i < cands.length; i++) if (cands[i]) return String(cands[i])
		return ''
	}
	const node = document.querySelector('[class*="messageMessageBox"]') || document.querySelector('[data-e2e="msg-item-content"]')
	if (!node) return ''
	const fk = Object.keys(node).find((k) => k.indexOf('__reactFiber$') === 0)
	if (!fk) return ''
	let f = node[fk], d = 0
	while (f && d < 30) { const got = pick(f.memoizedProps); if (got) return got; f = f.return; d++ }
	return ''
})()`

/** 输入框（这个站没有发送按钮，Enter 就是发送） */
export const editorInfoJs = `(() => {
	const eds = [...document.querySelectorAll('[contenteditable="true"]')].filter((e) => e.getBoundingClientRect().width > 100)
	const e = eds[eds.length - 1]
	if (!e) return ''
	const r = e.getBoundingClientRect()
	return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (e.innerText || '').trim().slice(0, 200) })
})()`

/**
 * 等会话列表真的渲染出来。
 * ⚠️ 不能拿「URL 已经是 /chat」当加载完成：冷启动时 URL 早就是 /chat，列表还是空的。
 * @param {any} c chrome.mjs 的页面句柄
 * @param {{timeoutMs?:number, min?:number, sleep?:Function}} o
 * @returns {Promise<Array<any>>} 行数组（超时返回最后一次读到的，可能为空）
 */
export async function waitRows(c, { timeoutMs = 20000, min = 1, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
	const deadline = Date.now() + timeoutMs
	let rows = []
	do {
		rows = JSON.parse((await c.ev(listRowsJs)) || '[]')
		if (rows.length >= min) return rows
		await sleep(600)
	} while (Date.now() < deadline)
	return rows
}

/**
 * 把 sec_uid 反查成数字 uid（页面里带 cookie 请求，不额外开浏览器）。
 * @returns {Promise<string>} 查不到返回空串（不猜）
 */
export async function uidOfSec(c, secUid) {
	const j = await c.ev(`(async () => {
		const r = await fetch('/aweme/v1/web/user/profile/other/?device_platform=webapp&aid=6383&channel=channel_pc_web&sec_user_id=' + encodeURIComponent(${JSON.stringify(String(secUid))}), { credentials: 'include', headers: { accept: 'application/json' } })
		const d = await r.json().catch(() => null)
		return JSON.stringify({ uid: String((d && d.user && d.user.uid) || ''), nick: (d && d.user && d.user.nickname) || '' })
	})()`)
	try { return JSON.parse(j || '{}') } catch { return { uid: '', nick: '' } }
}

/**
 * 找会话行：**先 uid，再 sec_uid，最后才昵称**。
 * - uid 路径：把行的 sec_uid 反查成 uid 比对（最多看 maxLookup 行，避免一屏 20 次请求）
 * - 昵称路径只作为兜底，且命中后仍返回它的 sec_uid 供调用方二次校验
 * @param {any} c
 * @param {{uid?:string, secUid?:string, nick?:string, maxLookup?:number}} want
 * @returns {Promise<{ok:boolean, row?:any, how?:string, error?:string, rows?:Array<any>, tried?:number}>}
 */
export async function locate(c, { uid = '', secUid = '', nick = '', maxLookup = 12 } = {}) {
	const rows = await waitRows(c)
	if (!rows.length) return { ok: false, error: '会话列表没渲染出来（20 秒内 0 行）', rows }

	const onScreen = rows.filter((r) => r.left >= 0 && r.w > 0)
	const pool = onScreen.length ? onScreen : rows

	if (secUid) {
		const hit = pool.find((r) => r.sec_uid && r.sec_uid === secUid)
		if (hit) return { ok: true, row: hit, how: 'sec_uid', rows }
	}

	if (uid) {
		let tried = 0
		for (const r of pool) {
			if (!r.sec_uid) continue
			if (tried >= maxLookup) break
			tried++
			const u = await uidOfSec(c, r.sec_uid)
			if (u && u.uid === String(uid)) return { ok: true, row: r, how: 'uid', rows, tried }
		}
		/* uid 没命中，但昵称唯一且反查出来的 uid 对得上 —— 也算数（只在昵称唯一时） */
		if (nick) {
			const same = pool.filter((r) => r.nick === nick)
			if (same.length === 1 && same[0].sec_uid) {
				const u = await uidOfSec(c, same[0].sec_uid)
				if (u && u.uid === String(uid)) return { ok: true, row: same[0], how: 'nick+uid', rows, tried }
				return { ok: false, error: `昵称「${nick}」那一行的 uid 是 ${u && u.uid ? u.uid : '(空)'}，不是 ${uid}`, rows, tried }
			}
		}
		return { ok: false, error: `会话列表里没有 uid=${uid} 的人（看了 ${tried} 行）`, rows, tried }
	}

	if (nick) {
		const same = pool.filter((r) => r.nick === nick)
		if (same.length === 1) return { ok: true, row: same[0], how: 'nick', rows }
		if (same.length > 1) return { ok: false, error: `有 ${same.length} 个同名「${nick}」，不猜是哪一个（给 uid 或 sec_uid）`, rows }
	}
	return { ok: false, error: '定位失败：要 uid / sec_uid / 昵称 三个里的一个', rows }
}

/**
 * 在页面里按 sec_uid 找到会话行，并在**行内子元素**上派发一整套合成指针事件。
 *
 * 为什么不是坐标双击（openRow）：2026-11-14 实测，同一坐标双击十二次里只有一两次能打开，
 * 剩下的时候输入框压根不渲染 —— 表情图「塞进输入框却没图」一半的原因在这。
 * 会话行自己的 fiber props 只有 onMouseDown / onContextMenu（**没有 onClick**），
 * 所以要打在内层节点上，让事件冒泡上去把 onMouseDown 也带上。
 */
export const clickRowBySecJs = (secUid) => `(() => {
	const want = ${JSON.stringify(String(secUid || ''))}
	if (!want) return 'no-sec'
	const nodes = Array.prototype.slice.call(document.querySelectorAll('[data-e2e="conversation-item"]'))
	for (let i = 0; i < nodes.length; i++) {
		const n = nodes[i]
		const fk = Object.keys(n).find((k) => k.indexOf('__reactFiber$') === 0)
		let sec = ''
		if (fk) {
			let f = n[fk], d = 0
			while (f && d < 14) {
				const p = f.memoizedProps
				if (p && p.conversation && p.conversation.toParticipantSecUserId) { sec = String(p.conversation.toParticipantSecUserId); break }
				f = f.return; d++
			}
		}
		if (sec !== want) continue
		const t = n.querySelector('[class*="ConversationItemDesc"]') || n
		const r = t.getBoundingClientRect()
		const x = Math.round(r.x + 10), y = Math.round(r.y + 10)
		const seq = ['pointerover', 'pointerenter', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']
		for (let s = 0; s < seq.length; s++) {
			const type = seq[s]
			const Ev = type.indexOf('pointer') === 0 ? (window.PointerEvent || window.MouseEvent) : window.MouseEvent
			t.dispatchEvent(new Ev(type, {
				bubbles: true, cancelable: true, view: window,
				clientX: x, clientY: y, button: 0, buttons: type.indexOf('down') >= 0 ? 1 : 0,
			}))
		}
		return 'clicked'
	}
	return 'no-row'
})()`

/**
 * 按 sec_uid 打开会话，并等输入框出现 + sec_uid 校验通过。
 * 校验不到就不算打开 —— 发错人的代价不可逆。
 */
export async function openRowBySec(c, secUid, { timeoutMs = 12000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
	if (!secUid) return { ok: false, error: '这一行没有 sec_uid，不按坐标猜人' }
	const r = await c.ev(clickRowBySecJs(secUid))
	if (r !== 'clicked') return { ok: false, error: '会话列表里找不到 sec_uid=' + secUid + '（' + r + '）' }
	const t0 = Date.now()
	let verified = false
	let hasEditor = false
	while (Date.now() - t0 < timeoutMs) {
		await sleep(400)
		const now = String((await c.ev(currentSecUidJs)) || '')
		if (now && now === secUid) verified = true
		if (verified && String((await c.ev(editorInfoJs)) || '')) { hasEditor = true; break }
		if (!verified && String((await c.ev(editorInfoJs)) || '')) hasEditor = true
		if (hasEditor && Date.now() - t0 > 4000) break
	}
	if (!verified && !hasEditor) return { ok: false, error: '点了会话但没打开（输入框没出现、sec_uid 也没校验上）', want: secUid }
	return { ok: true, verified: verified, editor: hasEditor, how: 'click-sequence' }
}

/**
 * 点开一行（双击；这个站单击无反应），再校验当前会话是不是目标。
 * @param {any} c
 * @param {any} row locate() 返回的行
 * @param {{wantSec?:string, sleep?:Function}} o
 */
export async function openRow(c, row, { wantSec = '', sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
	await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: row.x, y: row.y })
	await sleep(180)
	for (const type of ['mousePressed', 'mouseReleased']) {
		await c.send('Input.dispatchMouseEvent', { type, x: row.x, y: row.y, button: 'left', clickCount: 2 })
		await sleep(140)
	}
	if (!wantSec) return { ok: true, verified: false }
	for (let i = 0; i < 12; i++) {
		await sleep(500)
		const now = String((await c.ev(currentSecUidJs)) || '')
		if (now && now === wantSec) return { ok: true, verified: true }
	}
	/* 校验不到就只有一条结论：别发。发错人的代价不可逆。 */
	return { ok: false, error: '点开后校验不到目标 sec_uid（可能点错行 / 面板在陌生人列表）', want: wantSec }
}
