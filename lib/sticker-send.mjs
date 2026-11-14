/**
 * lib/sticker-send.mjs —— 把一张本地图真的发进私信。
 *
 * 2026-11-14 真机把整条链路打通了，结论先记在这里，省得以后再踩：
 *
 *   ① **开会话**：坐标双击只有一两次能中，改用 `openRowBySec()`（行内合成指针事件）。
 *   ② **塞图**：`DOM.setFileInputFiles` 在这台 Chrome 上从来没成功过
 *      （`DOM.getDocument {depth:-1}` 返回空壳、`DOM.querySelector` 恒为 0）。
 *      正确做法是把 File 交给 Semi Upload 的 React handler：
 *      `input.semi-upload-hidden-input` 往上找 `memoizedProps.onFileChange`，传 **File 数组**。
 *   ③ **发送**：塞完会弹出 `MsgInputSendFileModal`（发送给 X | 文件名 | 大小 | 取消 | 发送(1)）。
 *      按钮只吃**原生 `el.click()`** —— CDP 的 Input.dispatchMouseEvent 打不进 Semi 模态层。
 *   ④ **回读**：图片消息 body 是 `aweType:2702` + `resource_url.data_size`，
 *      以前 `im.read()` 用 `if (!text) continue` 把它们全丢了，才会误判成「没发出去」。
 *      现在 read 会返回 `{ kind:'image', text:'[图片]', bytes, url }`。
 */

import { existsSync, statSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { MAX_BYTES, markStickerUsed } from './stickers.mjs'

export const CHAT_URL = 'https://www.douyin.com/chat'

/** 老接口：上传区真正的 file input（Semi Upload 的隐藏 input）。 */
export const UPLOAD_INPUT = 'input.semi-upload-hidden-input[type=file]'
export const FILE_INPUT = 'input[type="file"]'

export const SEND_MODAL_SURE = '[class*="MsgInputSendFileModalbtnSure"]'
export const SEND_MODAL_CANCEL = '[class*="MsgInputSendFileModalbtnCancle"]'
export const SEND_MODAL_TEXT = '[class*="MsgInputSendFileModalim-saas-input"]'

/** 真机上确认框里的附言框是 `TEXTAREA.semi-input-textarea`（343x42），
 * `SEND_MODAL_TEXT` 那个 class 只是外层 wrapper，读它的 `value` 永远空 ——
 * 2026-11-14 真机 dump 得到：【只有 1 个可输入元素，就是它】。 */
export const SEND_MODAL_CAPTION = 'textarea.semi-input-textarea'

/** 图片消息（私信 body 里的 aweType）。 */
export const AWE_TYPE_IMAGE = 2702

/** 图片按钮常见的几种锚点（点一下才会出现 input 的情况）。 */
export const IMAGE_BUTTON_HINTS = ['图片', '发送图片', '表情', 'image', 'upload']

const MIME = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	bmp: 'image/bmp',
}

/**
 * 页面求值。`openPage()` 给的是 `{ send, ev, close }`（没有 evaluate），
 * `withPage()` 下的连接才有 `evaluate` —— 两个都认，别再踩一次。
 */
const evalIn = (c, expr, opts) => (typeof c.evaluate === 'function' ? c.evaluate(expr, opts) : c.ev(expr))

/** 按扩展名给 MIME（抖音靠 content-type + 扩展名判是不是图）。 */
export function mimeOf(file) {
	const m = String(file || '').toLowerCase().match(/\.([a-z0-9]+)$/)
	return (m && MIME[m[1]]) || 'application/octet-stream'
}

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
 * 把图交给 Semi Upload 的 React handler。
 * 传的必须是 **File 数组**（handler 里 `e.length` / `e.filter` / `e.size`），不是 `{files:[]}`。
 */
export async function stageFileByReact(c, file, { name = '', mime = '', timeoutMs = 20000 } = {}) {
	if (!file || !existsSync(file)) return { ok: false, error: '图不在磁盘上：' + file }
	const buf = readFileSync(file)
	if (buf.length > MAX_BYTES) return { ok: false, error: `图太大（${Math.round(buf.length / 1024)}KB）` }
	const b64 = buf.toString('base64')
	const nm = name || basename(file)
	const mt = mime || mimeOf(file)
	let r = null
	try {
		r = await evalIn(c, 
			`(async () => {
	const input = document.querySelector(${JSON.stringify(UPLOAD_INPUT)})
	if (!input) return 'no-input'
	const fk = Object.keys(input).find((k) => k.indexOf('__reactFiber$') === 0)
	if (!fk) return 'no-fiber'
	let f = input[fk], d = 0
	while (f && d < 20 && !(f.memoizedProps && typeof f.memoizedProps.onFileChange === 'function')) { f = f.return; d++ }
	if (!f) return 'no-handler'
	const bin = atob(${JSON.stringify(b64)})
	const u8 = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
	const fo = new File([u8], ${JSON.stringify(nm)}, { type: ${JSON.stringify(mt)} })
	try { await f.memoizedProps.onFileChange([fo]) } catch (e) { return 'threw:' + String((e && e.message) || e).slice(0, 160) }
	return 'ok'
})()`,
			{ timeout: timeoutMs },
		)
	} catch (e) {
		return { ok: false, error: '塞图时页面报错：' + String((e && e.message) || e) }
	}
	if (r === 'ok') return { ok: true, via: 'react-onFileChange', file, name: nm, mime: mt, bytes: buf.length }
	if (r === 'no-input') return { ok: false, error: '会话没打开（页面里没有上传用的 file input）' }
	if (r === 'no-handler') return { ok: false, error: '找到 input 但上层没有 onFileChange（Semi Upload 结构变了）' }
	return { ok: false, error: '塞图失败：' + String(r) }
}

/** 兼容老签名：`stageFile(c, file)` 现在走 React 通道。 */
export const stageFile = stageFileByReact

/** 等「发送文件」确认框弹出来，返回框里的文案（发送给 X | 文件名 | 801 B | …）。 */
export async function waitSendModal(c, { timeoutMs = 15000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
	const t0 = Date.now()
	while (Date.now() - t0 < timeoutMs) {
		const txt = await evalIn(c, `(() => {
	const b = document.querySelector(${JSON.stringify(SEND_MODAL_SURE)})
	if (!b) return ''
	const box = b.closest('[role="dialog"]') || b.parentElement
	return (box && box.innerText ? box.innerText : '').replace(/\\s+/g, ' ').trim().slice(0, 200)
})()`)
		if (txt) return { ok: true, text: String(txt) }
		await sleep(400)
	}
	return { ok: false, error: '塞了图但没弹出「发送文件」确认框（可能上传失败或被拦）' }
}

/** 关掉确认框（什么都不发）。 */
export async function cancelSendModal(c) {
	const r = await evalIn(c, `(() => { const b = document.querySelector(${JSON.stringify(SEND_MODAL_CANCEL)}); if (!b) return 'gone'; b.click(); return 'clicked' })()`)
	return r === 'clicked' ? { ok: true } : { ok: false, error: '取消按钮不在了' }
}

/**
 * 点「发送(1)」。附言写不进去不算失败（图照样发），但会记在 note 里。
 * 必须用原生 `el.click()`：CDP 鼠标事件打不进 Semi 的模态层（实测点击命中但不生效）。
 */
export async function confirmSendModal(c, { text = '', dry = false, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
	/* 附言先写：dry 也要写一遍再读回，否则「--dry 能不能验附言」永远是未知数。
	 * 读回拿到正文才算 verified，写完没读到算 written，框根本不在算 no-box。 */
	let captioned = ''
	if (text) {
		try {
			/* 定位顺序：确认框里的 textarea → 确认框里的任意 input → 任何 textarea。
			 * 别用 SEND_MODAL_TEXT（那是 wrapper，focus 它没用）。 */
			const pickJs = `(() => {
	const dlg = document.querySelector(${JSON.stringify(SEND_MODAL_SURE)})
	const modal = (dlg && dlg.closest('[role="dialog"]')) || document.querySelector('[class*="MsgInputSendFileModal"]') || document.body
	const t = modal.querySelector(${JSON.stringify(SEND_MODAL_CAPTION)}) || modal.querySelector('textarea, input[type="text"]') || modal.querySelector('input')
	if (!t) return ''
	t.focus()
	const r = t.getBoundingClientRect()
	return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), tag: t.tagName })
})()`
			const box = await evalIn(c, pickJs)
			if (box) {
				const p = JSON.parse(box)
				for (const type of ['mousePressed', 'mouseReleased']) {
					await c.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 })
				}
				await sleep(150)
				await c.send('Input.insertText', { text })
				captioned = 'written'
				await sleep(120)
				const back = await evalIn(c, `(() => {
	const dlg = document.querySelector(${JSON.stringify(SEND_MODAL_SURE)})
	const modal = (dlg && dlg.closest('[role="dialog"]')) || document.querySelector('[class*="MsgInputSendFileModal"]') || document.body
	const t = modal.querySelector(${JSON.stringify(SEND_MODAL_CAPTION)}) || modal.querySelector('textarea, input')
	if (!t) return ''
	return String(t.value ?? t.innerText ?? t.textContent ?? '')
})()`)
				if (back && String(back).includes(text)) captioned = 'verified'
			} else captioned = 'no-box'
		} catch (e) {
			captioned = 'error:' + String((e && e.message) || e).slice(0, 80)
		}
	}
	if (dry) {
		const r = await cancelSendModal(c)
		return r.ok ? { ok: true, dry: true, captioned } : r
	}
	const r = await evalIn(c, `(() => { const b = document.querySelector(${JSON.stringify(SEND_MODAL_SURE)}); if (!b) return 'gone'; b.click(); return 'clicked' })()`)
	if (r !== 'clicked') return { ok: false, error: '发送按钮不在了（模态自己关了？）' }
	return { ok: true, captioned }
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
 * 私信发图：打开聊天页 → 认人 → 打开会话 → onFileChange 塞图 → 确认框点发送 → 接口回读。
 *
 * `dry` 走到「确认框弹出来」就取消 —— 这个 dry 是真的能证明「图进了待发队列」，
 * 不像老版本只是把文件塞进一个没人监听的 input。
 */
export async function sendStickerDirect({ uid = '', secUid = '', nick = '', file = '', text = '', dry = false } = {}) {
	if (!file || !existsSync(file)) return { ok: false, error: '图不在磁盘上' }
	if (!uid && !secUid && !nick) return { ok: false, error: '要给 uid（稳）、sec_uid 或昵称' }
	const { openPage, sleep } = await import('./chrome.mjs')
	const { locate, openRowBySec, editorInfoJs } = await import('./im-locate.mjs')
	const log = []
	/* 回读基准：发之前 5 秒（留余量，避免和同一条时间戳比）。 */
	const sinceIso = new Date(Date.now() - 5000).toISOString()
	let c = null
	try {
		c = await openPage({ url: CHAT_URL, navigate: true, want: '/chat' })
		await sleep(1500)

		const found = await locate(c, { uid, secUid, nick })
		if (!found.ok) return { ok: false, error: found.error, to: nick || uid, log }
		const row = found.row
		log.push('找到会话：' + row.nick + (row.sec_uid ? '（sec_uid 已核）' : '（没有 sec_uid）'))

		const opened = await openRowBySec(c, row.sec_uid)
		if (!opened.ok) return { ok: false, error: opened.error, to: row.nick, log }
		log.push(opened.verified ? '会话已打开（sec_uid 校验通过）' : '会话已打开（输入框在，sec_uid 没读到）')

		let ed = ''
		for (let i = 0; i < 20; i++) {
			ed = (await c.ev(editorInfoJs)) || ''
			if (ed) break
			await sleep(500)
		}
		if (!ed) return { ok: false, error: '会话没打开（等不到输入框）', to: row.nick, log }

		const staged = await stageFileByReact(c, file)
		if (!staged.ok) return { ok: false, error: staged.error, to: row.nick, log }
		log.push(`图已交给上传（${staged.name}，${staged.bytes} B）`)

		const modal = await waitSendModal(c)
		if (!modal.ok) return { ok: false, error: modal.error, to: row.nick, log }
		log.push('确认框：' + modal.text)

		const conf = await confirmSendModal(c, { text, dry })
		if (!conf.ok) return { ok: false, error: conf.error, to: row.nick, log }
		if (dry) {
			log.push('dry：已取消，没真发' + (conf.captioned ? '（附言 ' + conf.captioned + '）' : ''))
			return { ok: true, dry: true, to: row.nick, file, note: '确认框出现过 = 图进了待发队列', modal: modal.text, captioned: conf.captioned || '', log }
		}
		log.push('已点发送' + (conf.captioned ? '（附言 ' + conf.captioned + '）' : ''))

		/* 回读：接口里出现新的 aweType:2702 才算真发出去。 */
		const { read } = await import('./im.mjs')
		for (let i = 0; i < 10; i++) {
			await sleep(1200)
			let got = null
			try {
				got = await read({ secUid: row.sec_uid || secUid, uid: row.sec_uid ? '' : uid, limit: 8 })
			} catch { continue }
			if (!got || !got.ok) continue
			const hit = (got.messages || []).find((m) => m.kind === 'image' && String(m.at || '') >= sinceIso)
			if (hit) {
				log.push('回读确认：' + hit.at + (hit.bytes ? '（' + hit.bytes + ' B）' : ''))
				return { ok: true, verified: 'http-image', to: row.nick, file, text, at: hit.at, bytes: hit.bytes || 0, url: hit.url || '', log }
			}
		}
		return { ok: false, error: '点了发送，但接口回读没看到新的图片消息（可能被吞）', to: row.nick, file, text, log }
	} catch (e) {
		return { ok: false, error: String((e && e.message) || e), log }
	} finally {
		try { c && c.close && c.close() } catch { /* 已断 */ }
	}
}

/**
 * 私信发图（分步版，供测试与面板复用）：打开会话 → 塞图 → 等确认框，**不点发送**。
 * 认人交给调用方给好的 `openChat(c)`。
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
	const staged = await stageFileByReact(c, plan.file)
	if (!staged.ok) return staged
	if (plan.id) markStickerUsed(plan.id)
	return { ok: true, staged: true, file: plan.file, text: plan.text }
}
