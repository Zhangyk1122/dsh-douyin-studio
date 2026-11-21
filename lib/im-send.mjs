/**
 * lib/im-send.mjs —— 发私信（自己写的那条路，不用旧插件那 800 行）
 * ============================================================================
 * 流程（每一步都有踩坑注释）：
 *   ① 打开 https://www.douyin.com/chat
 *   ② 按**昵称精确匹配**找到会话行（`[data-e2e="conversation-item"]`）
 *   ③ **双击**（单击在这个站上什么都不发生，实测）+ 真鼠标事件，不是 `el.click()`
 *   ④ 等输入框（`[contenteditable=true]`，placeholder = 发送消息）
 *   ⑤ 点它 → `Input.insertText` 写文字 → **回读**确认真的写进去了
 *   ⑥ dry 就停在这里；否则按 Enter 发送，再确认输入框清空 / 气泡里出现这句话
 *
 * ⚠️ 弹窗：这个站点开会话会 `window.open`，所以 Chrome 必须带
 *    `--disable-popup-blocking`（见 lib/cdp.mjs），否则点了像没反应。
 * ============================================================================
 */
import { openPage, sleep } from './chrome.mjs'
import { locate } from './im-locate.mjs'

const CHAT_URL = 'https://www.douyin.com/chat'

const listRows = `(() => {
	const rows = [...document.querySelectorAll('[data-e2e="conversation-item"]')]
	return JSON.stringify(rows.map((el) => {
		const t = el.querySelector('.conversationConversationItemtitle')
		const r = el.getBoundingClientRect()
		return { nick: (t ? t.innerText : (el.innerText || '').split('\\n')[0]).trim(), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
	}))
})()`

const editorInfo = `(() => {
	const eds = [...document.querySelectorAll('[contenteditable="true"]')].filter((e) => e.getBoundingClientRect().width > 100)
	const e = eds[eds.length - 1]
	if (!e) return ''
	const r = e.getBoundingClientRect()
	return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (e.innerText || '').trim().slice(0, 200) })
})()`

export async function sendByUi({ nick = '', secUid = '', uid = '', text = '', dry = false } = {}) {
	const body = String(text || '').trim()
	if (!body) return { ok: false, error: '正文是空的' }
	if (!nick && !secUid && !uid) return { ok: false, error: '发私信要给昵称 / sec_uid / uid 之一' }

	const c = await openPage({ url: CHAT_URL })
	const log = []
	try {
		await sleep(3500)
		/* ⚠️ 2026-11-02 真机踩到：标签页在后台时，CDP 派发的鼠标事件不会触发行点击，
		 *    会话永远打不开（报「等不到输入框」）。先把页面提到前台再点。 */
		try { await c.send('Page.bringToFront') } catch { /* 老浏览器没有这个方法 */ }
		await sleep(400)
		let target = nick

		/* 只给 sec_uid 时，先在页面里把昵称查出来（查不到就停，不猜） */
		if (!target && secUid) {
			const j = await c.ev(`(async () => {
				const r = await fetch('/aweme/v1/web/user/profile/other/?device_platform=webapp&aid=6383&channel=channel_pc_web&sec_user_id=' + encodeURIComponent(${JSON.stringify(String(secUid))}), { credentials: 'include', headers: { accept: 'application/json' } })
				const d = await r.json().catch(() => null)
				return JSON.stringify({ nick: (d && d.user && d.user.nickname) || '' })
			})()`)
			target = (JSON.parse(j || '{}').nick || '').trim()
			if (!target) return { ok: false, error: 'sec_uid 反查不到昵称（不猜人）', sec_uid: secUid }
		}

		/* ② 找行：**优先按 uid 认人**。昵称会被改、可能带表情/后缀，
		 *    靠昵称找会话是最脆的一环（2026-11-21 真机：设置里填「绿豆沙」，页面显示对不上 → 永远发不出）。
		 *    uid 认不出来再退回精确昵称匹配；重名一律拒发。 */
		let row = null
		let rowsSeen = []
		if (uid) {
			try {
				const L = await locate(c, { uid: String(uid), nick: target, maxLookup: 12 })
				if (L && L.ok && L.row) row = L.row
				if (L && Array.isArray(L.rows)) rowsSeen = L.rows
			} catch { /* 退回昵称路径 */ }
		}
		if (!row) {
			let rows = rowsSeen
			if (!rows.length) {
				for (let i = 0; i < 8; i++) {
					rows = JSON.parse((await c.ev(listRows)) || '[]')
					if (rows.some((r) => r.nick === target)) break
					await sleep(700)
				}
			}
			const hits = rows.filter((r) => r.nick === target)
			if (!hits.length) {
				return {
					ok: false,
					error: '会话列表里没有「' + target + '」' + (uid ? '（按 uid=' + uid + ' 也没认出来）' : ''),
					candidates: rows.slice(0, 12).map((r) => r.nick),
				}
			}
			if (hits.length > 1) return { ok: false, error: '有 ' + hits.length + ' 个同名「' + target + '」，不猜是哪一个（给 sec_uid）' }
			row = hits[0]
		}
		log.push(`找到行 ${target}`)

		/* ③ 双击（单击实测无效） */
		await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: row.x, y: row.y })
		await sleep(200)
		for (const type of ['mousePressed', 'mouseReleased']) {
			await c.send('Input.dispatchMouseEvent', { type, x: row.x, y: row.y, button: 'left', clickCount: 2 })
			await sleep(120)
		}

		/* ④ 等输入框 */
		let ed = ''
		for (let i = 0; i < 20; i++) {
			await sleep(600)
			ed = (await c.ev(editorInfo)) || ''
			if (ed) break
		}
		if (!ed) return { ok: false, error: '会话没打开（等不到输入框）', nick: target, log }
		const box = JSON.parse(ed)
		log.push('输入框出现')

		/* ⑤ 点输入框 → 写 → 回读 */
		for (const type of ['mousePressed', 'mouseReleased']) {
			await c.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 })
		}
		await sleep(300)
		await c.send('Input.insertText', { text: body })
		/* 回读比对要「拍平」再比（2026-11-15 真机踩的）：抖音的编辑器会在换行前插一个
		 * 零宽空格 U+200B，所以 `got.includes(body.slice(0,12))` 只要正文前 12 个字
		 * 里带换行就永远 false —— 多行私信一条都发不出去，报「文字没写进输入框」，
		 * 其实字早就写进去了。只比「非空白非零宽」的前 12 个字。 */
		const flat = (s) => String(s || '').replace(/[\u200b-\u200d\ufeff\s]/g, '')
		const head = flat(body).slice(0, 12)
		let got = ''
		for (let i = 0; i < 10; i++) {
			await sleep(300)
			got = (JSON.parse((await c.ev(editorInfo)) || '{"text":""}').text || '').trim()
			if (flat(got).includes(head)) break
		}
		if (!flat(got).includes(head)) {
			return { ok: false, error: '文字没写进输入框', want: body.slice(0, 40), got: got.slice(0, 40), log }
		}
		log.push('文字已写入')

		if (dry) return { ok: true, dry: true, nick: target, typed: got.slice(0, 60), note: '没按发送（--dry）', log }

		/* ⑥ 回车发送（这个站没有可见的发送按钮，Enter 就是发送） */
		for (const t of ['rawKeyDown', 'keyUp']) {
			await c.send('Input.dispatchKeyEvent', { type: t, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
		}
		/* ⚠️ 判「发出去没有」不能只看 `trim()`：这个编辑器发完会留一个零宽字符（\u200b），
		 *    `trim()` 不把它当空白 ⇒ 会误报「没清空」，其实早发出去了（2026-11-01 踩过）。 */
		const stripZw = (s) => String(s || '').replace(/[\s\u200b-\u200d\ufeff]+/g, '')
		let cleared = false
		for (let i = 0; i < 10; i++) {
			await sleep(500)
			const now = JSON.parse((await c.ev(editorInfo)) || '{"text":""}').text || ''
			if (!stripZw(now)) { cleared = true; break }
		}
		/* 再回读一次页面：气泡里出现了这句话，才算真发出去了 */
		let inPane = false
		if (cleared) {
			const tail = String((await c.ev('document.body.innerText')) || '')
			inPane = stripZw(tail).includes(stripZw(body).slice(0, 10))
		}
		return {
			ok: cleared,
			dry: false,
			nick: target,
			sent: cleared,
			verified_in_pane: inPane,
			text: body.slice(0, 80),
			...(cleared ? {} : { error: '按了回车但输入框没清空，可能没发出去（别急着重试，先去页面看一眼）' }),
			log,
		}
	} catch (e) {
		return { ok: false, error: String((e && e.message) || e), log }
	} finally {
		c.close()
	}
}