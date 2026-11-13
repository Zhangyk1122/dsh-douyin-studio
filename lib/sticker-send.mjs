/**
 * 发一张本地表情：私信带图 / 评论带图。
 *
 * 两件事分开做：
 *   ① `planStickerMessage()` 纯判断：图在不在、多大、文案多长 —— 不碰浏览器
 *   ② `stageStickerDm()` 把图塞进聊天页的文件输入框，并可顺手把文案打进去
 *
 * 为什么先塞文件不直接点发送：发送按钮的 DOM 每次改版都变，
 * 而 `input[type=file]` + 回车是两年没变过的路径。
 * 塞完由调用方决定是回车还是人工看一眼 —— 未知结果宁可停，不发第二遍。
 */

import { existsSync, statSync } from 'node:fs'
import { MAX_BYTES, markStickerUsed } from './stickers.mjs'

export const CHAT_URL = 'https://www.douyin.com/chat'
export const FILE_INPUT = 'input[type="file"]'

/** 图片按钮常见的几种锚点（点一下才会出现 input 的情况）。 */
export const IMAGE_BUTTON_HINTS = ['图片', '发送图片', '表情', 'image', 'upload']

/**
 * 纯函数：把「要发哪张、配什么字」定下来。
 * 返回 `{ ok, file, text, why }`；不 ok 时 why 说明为什么。
 */
export function planStickerMessage({ sticker, caption = '', maxText = 300 } = {}) {
	if (!sticker || !sticker.file) return { ok: false, why: '没有挑到表情（先用 sticker pick）' }
	const file = String(sticker.file)
	if (!existsSync(file)) return { ok: false, why: '图不在磁盘上了：' + file }
	const size = statSync(file).size
	if (size > MAX_BYTES) return { ok: false, why: `图太大（${Math.round(size / 1024)}KB）` }
	const text = String(caption || '').replace(/\s+/g, ' ').trim().slice(0, Math.max(20, Number(maxText) || 300))
	return { ok: true, file, text, bytes: size, id: sticker.id || '' }
}

/**
 * 在页面里找文件输入框并把图塞进去。
 * 找不到就尝试点一下「图片」按钮再找一次 —— 有些版本 input 是点了才渲染的。
 */
export async function stageFile(c, file, { selector = FILE_INPUT, hints = IMAGE_BUTTON_HINTS, tries = 2 } = {}) {
	for (let i = 0; i < tries; i++) {
		try {
			const doc = await c.send('DOM.getDocument', { depth: -1 })
			const q = await c.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector })
			if (q && q.nodeId) {
				await c.send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [file] })
				return { ok: true, via: 'input', tries: i + 1 }
			}
		} catch (e) {
			/* 没 DOM 权限或页面在跳，继续试下一轮 */
		}
		if (i === 0) {
			const clicked = await c.evaluate(`(() => {
				const words = ${JSON.stringify(hints)}
				const el = [...document.querySelectorAll('button,div[role="button"],span')]
					.find(x => words.some(w => (x.getAttribute('aria-label') || x.innerText || '').includes(w)))
				if (!el) return 'no-button'
				el.click()
				return 'clicked'
			})()`)
			if (clicked !== 'clicked') return { ok: false, error: '页面上既没有文件输入框，也没找到图片按钮' }
			await new Promise((r) => setTimeout(r, 1200))
		}
	}
	return { ok: false, error: '找到按钮但 input 一直没出现（可能版本改了）' }
}

/**
 * 私信发图：打开聊天页 → 认人 → 塞图 → 打文案（不自动回车）。
 * 认人交给调用方给好的 `openChat(c)`（复用 im.mjs 里的会话打开逻辑）。
 */
export async function stageStickerDm({ c, plan, openChat, typeText } = {}) {
	if (!plan || !plan.ok) return { ok: false, error: (plan && plan.why) || '没有可发的图' }
	if (!c) return { ok: false, error: '没有页面连接' }
	if (typeof openChat === 'function') {
		const opened = await openChat(c)
		if (!opened || opened.ok === false) {
			return { ok: false, error: '会话没打开：' + ((opened && opened.error) || '未知') }
		}
	}
	const staged = await stageFile(c, plan.file)
	if (!staged.ok) return staged

	let typed = null
	if (plan.text && typeof typeText === 'function') {
		typed = await typeText(c, plan.text)
	}
	if (plan.id) markStickerUsed(plan.id)
	return { ok: true, staged: true, typed, file: plan.file, text: plan.text }
}

/** 回车提交（和 im-report 里同一套 keyEvent，避免各写一份）。 */
export async function pressEnter(c) {
	try {
		await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
		await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
		return { ok: true }
	} catch (e) {
		return { ok: false, error: String((e && e.message) || e) }
	}
}

/**
 * 私信发一张图（走和 im-report 同一条路：落到 /chat → 按 uid 找人 → 点开校验 → 塞图 → 打字 → 回车）。
 * `dry` 只塞不按回车，用来确认「图真进了输入框」。
 */
export async function sendStickerDirect({ uid = '', secUid = '', nick = '', file = '', text = '', dry = false } = {}) {
	if (!file || !existsSync(file)) return { ok: false, error: '图不在磁盘上' }
	if (!uid && !secUid && !nick) return { ok: false, error: '要给 uid（稳）、sec_uid 或昵称' }
	const { openPage, sleep } = await import('./chrome.mjs')
	const { CHAT_URL: CHAT, locate, openRow, editorInfoJs } = await import('./im-locate.mjs')
	const log = []
	let c = null
	try {
		c = await openPage({ url: CHAT, navigate: true, want: '/chat' })
		await sleep(1500)
		const found = await locate(c, { uid, secUid, nick })
		if (!found.ok) return { ok: false, error: found.error, to: nick || uid, log }
		const opened = await openRow(c, found.row, { wantSec: found.row.sec_uid })
		if (!opened.ok) return { ok: false, error: opened.error, to: found.row.nick, log }
		log.push('会话已打开')
		let ed = ''
		for (let i = 0; i < 20; i++) {
			await sleep(600)
			ed = (await c.ev(editorInfoJs)) || ''
			if (ed) break
		}
		if (!ed) return { ok: false, error: '会话没打开（等不到输入框）', to: found.row.nick, log }
		const staged = await stageFile(c, file)
		if (!staged.ok) return { ok: false, error: staged.error, log }
		log.push('图已塞进输入框')
		if (text) {
			const box = JSON.parse(ed)
			for (const type of ['mousePressed', 'mouseReleased']) {
				await c.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 })
			}
			await sleep(200)
			await c.send('Input.insertText', { text })
			log.push('文字已写入')
		}
		if (dry) return { ok: true, dry: true, to: found.row.nick, file, note: '没按回车（dry）', log }
		const sent = await pressEnter(c)
		if (!sent.ok) return { ok: false, error: '回车没发出去：' + sent.error, log }
		await sleep(1500)
		return { ok: true, to: found.row.nick, file, text, log }
	} catch (e) {
		return { ok: false, error: String((e && e.message) || e), log }
	} finally {
		try { c && c.close && c.close() } catch { /* 已断 */ }
	}
}
