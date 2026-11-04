/**
 * lib/publish-cdp.mjs —— 面向抖音创作者中心的 CDP 会话封装
 * ============================================================================
 * 为什么要单独拆出来：
 *   原来 publish-cli.mjs 里所有 CDP 操作（evalJs/waitFor/fillField/clickAt）都定义在
 *   main() 内部，引用外层的 `ws` 和 `send` 变量，没法单独测试，也没法在别的脚本里复用。
 *   这个文件把它们封进 CdpSession，session 对象完全自持状态，可以并发起多个。
 *
 * 使用示例：
 *   import { CdpSession, findCreatorTab } from './publish-cdp.mjs'
 *   const tab = await findCreatorTab(9334)
 *   const s = new CdpSession(9334)
 *   await s.connect(tab)
 *   const title = await s.evalJs('document.title')
 *   await s.disconnect()
 *
 * ⚠️ 注意事项（踩过的坑，别删这些注释）：
 *   1. SPA 切页后老会话的 DOM.enable 会超时 —— 用 --clean 等一切切页完成后必须 reconnect()。
 *   2. 认「哪个标签页是创作者中心」必须从头锚定（^https://creator.douyin.com/），
 *      因为客服弹窗的 URL 也含有 creator.douyin.com，用 includes 会命中它。
 *   3. fillField 里的空编辑器有 \u200b（len=1,counter=0），clear 时必须 Ctrl+A+Backspace。
 * ============================================================================
 */
import http from 'node:http'

// ⚠️ WebSocket 用 Node 24 的全局实现，**不要** `import { WebSocket } from 'ws'`。
// 这个插件目录解析不到 `ws`（它装在 profiles/desktop/node_modules，不在这条路径上），
// 一旦 import 就 ERR_MODULE_NOT_FOUND，发布流程连启动都做不到（2026-11-01 踩过）。
// lib/cdp.mjs 一直用的是全局 WebSocket，这里保持一致。

// ── CDP HTTP ──────────────────────────────────────────────────────────────────

/**
 * 向 Chrome DevTools HTTP 端点发 GET。
 * @param {number} port
 * @param {string} path  e.g. '/json'
 * @returns {Promise<string>}
 */
export function cdpGet(port, path) {
	return new Promise((resolve, reject) => {
		const r = http.request(
			{ host: '127.0.0.1', port, path, method: 'GET', timeout: 8000 },
			(res) => {
				let b = ''
				res.on('data', (c) => (b += c))
				res.on('end', () => resolve(b))
			},
		)
		r.on('error', reject)
		r.end()
	})
}

/**
 * 向 Chrome DevTools HTTP 端点发 PUT（打开新标签页等）。
 * @param {number} port
 * @param {string} path
 * @returns {Promise<string>}
 */
export function cdpPut(port, path) {
	return new Promise((resolve, reject) => {
		const r = http.request(
			{ host: '127.0.0.1', port, path, method: 'PUT', timeout: 8000 },
			(res) => {
				let b = ''
				res.on('data', (c) => (b += c))
				res.on('end', () => resolve(b))
			},
		)
		r.on('error', reject)
		r.end()
	})
}

// ── 标签页发现 ────────────────────────────────────────────────────────────────

const CREATOR = /^https:\/\/creator\.douyin\.com\//
const PUBLISH_PAGE = /\/creator-micro\/content\/(upload|post)/

/**
 * 在 Chrome 里找抖音创作者中心的标签页。
 * 优先找上传/发布页，退而求其次找任意创作者中心页。
 *
 * ⚠️ 必须从头锚定（^https://creator.douyin.com/），不能用 includes：
 *    客服弹窗 URL 也含 creator.douyin.com，会被误选中。
 *
 * @param {number} port  CDP 端口（默认 9334）
 * @returns {Promise<object|null>}  CDP tab 对象，找不到返回 null
 */
export async function findCreatorTab(port = 9334) {
	const tabs = JSON.parse(await cdpGet(port, '/json'))
	const pages = tabs.filter((t) => t.type === 'page')
	return (
		pages.find((t) => CREATOR.test(t.url) && PUBLISH_PAGE.test(t.url)) ||
		pages.find((t) => CREATOR.test(t.url)) ||
		null
	)
}

/**
 * 关闭所有创作者中心标签页（--fresh 用）。
 * @param {number} port
 */
export async function closeCreatorTabs(port = 9334) {
	const tabs = JSON.parse(await cdpGet(port, '/json'))
	for (const t of tabs.filter((x) => x.type === 'page' && CREATOR.test(x.url))) {
		await cdpGet(port, `/json/close/${t.id}`).catch(() => null)
	}
}

// ── CdpSession ────────────────────────────────────────────────────────────────

/**
 * 面向抖音创作者中心页面的 CDP 会话。
 * 一个 tab 对应一个 session；--clean 切页后必须调 reconnect()。
 *
 * @example
 * const s = new CdpSession(9334)
 * await s.connect(tab)
 * const ok = await s.evalJs('document.readyState === "complete"')
 * await s.disconnect()
 */
export class CdpSession {
	/**
	 * @param {number} [port=9334]  Chrome 远程调试端口
	 */
	constructor(port = 9334) {
		this.port = port
		/** @type {WebSocket|null} */
		this.ws = null
		/** @type {Map<number, {resolve: Function, reject: Function}>} */
		this._pend = new Map()
		this._seq = 0
	}

	// ── 连接管理 ──────────────────────────────────────────────────────────────

	/**
	 * 连接到一个 tab，启用必要的 CDP 域。
	 * 必须在任何其他调用之前执行；--clean 切页后需再次调用（老会话 DOM.enable 会超时）。
	 *
	 * @param {object|string} tabOrUrl  `/json` 返回的 tab 对象，或直接给 webSocketDebuggerUrl 字符串。
	 *   两种都收——publish-cli 传的是字符串，别指望它一定是对象。
	 *   （2026-11-02 踩过：参数名写成 `tab`，里面当对象取 `.webSocketDebuggerUrl`，
	 *    实际收到的是字符串 → 取出来是 undefined → `new WebSocket(undefined)` → Invalid URL。）
	 */
	async connect(tabOrUrl) {
		const url = typeof tabOrUrl === 'string' ? tabOrUrl : tabOrUrl?.webSocketDebuggerUrl
		if (!url || !/^wss?:\/\//.test(url)) {
			throw new Error('connect 需要 webSocketDebuggerUrl（收到的是 ' + typeof tabOrUrl + '）')
		}
		await this.disconnect()
		this._pend.clear()
		const socket = new WebSocket(url)
		// ⚠️ 全局 WebSocket 是 WHATWG 风格：用 onopen/onmessage/onclose + ev.data，
		// **不是** ws 包的 socket.on('message', raw)。混着写会在第一次 connect 就炸。
		await new Promise((resolve, reject) => {
			socket.onopen = () => resolve()
			socket.onerror = () => reject(new Error('连不上页面：' + url))
			socket.onmessage = (ev) => {
				let msg = null
				try {
					msg = JSON.parse(String(ev.data))
				} catch {
					return
				}
				if (msg.id == null) return
				const cb = this._pend.get(msg.id)
				if (!cb) return
				this._pend.delete(msg.id)
				if (msg.error) cb.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
				else cb.resolve(msg.result)
			}
			socket.onclose = () => {
				for (const [, cb] of this._pend) cb.reject(new Error('WebSocket closed'))
				this._pend.clear()
			}
			this.ws = socket
		})
		await Promise.all([
			this.send('DOM.enable'),
			this.send('Runtime.enable'),
			this.send('Page.enable'),
			this.send('Page.setInterceptFileChooserDialog', { enabled: true }),
		])
	}

	/** 断开连接，清空待回调队列。 */
	async disconnect() {
		if (this.ws) {
			this.ws.close()
			this.ws = null
		}
		this._pend.clear()
	}

	// ── 底层 CDP ──────────────────────────────────────────────────────────────

	/**
	 * 发一条 CDP 命令，等待回复（Promise）。
	 * @param {string} method
	 * @param {object} [params]
	 * @param {number} [timeoutMs=30000]
	 * @returns {Promise<object>}
	 */
	send(method, params = {}, timeoutMs = 30000) {
		return new Promise((resolve, reject) => {
			if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
				return reject(new Error(`CDP send ${method}: WebSocket not open`))
			}
			const id = ++this._seq
			const timer = setTimeout(() => {
				this._pend.delete(id)
				reject(new Error(`CDP timeout: ${method}`))
			}, timeoutMs)
			this._pend.set(id, {
				resolve: (v) => { clearTimeout(timer); resolve(v) },
				reject: (e) => { clearTimeout(timer); reject(e) },
			})
			this.ws.send(JSON.stringify({ id, method, params }))
		})
	}

	// ── 常用操作 ──────────────────────────────────────────────────────────────

	/**
	 * 在页面上下文里执行 JS，返回值（通过 returnByValue）。
	 * 出错时返回 null（不抛出），调用方判 null 即可。
	 * @param {string} expr  任意 JS 表达式
	 * @returns {Promise<any>}
	 */
	async evalJs(expr) {
		try {
			const r = await this.send('Runtime.evaluate', {
				expression: `(()=>{try{return JSON.stringify(${expr})}catch(e){return null}})()`,
				returnByValue: true,
				awaitPromise: false,
			})
			const v = r?.result?.value
			if (v == null) return null
			try { return JSON.parse(v) } catch { return v }
		} catch {
			return null
		}
	}

	/**
	 * 轮询直到表达式返回 truthy，或超时返回 false。
	 * @param {string} expr
	 * @param {{ timeout?: number, interval?: number }} [opts]
	 * @returns {Promise<boolean>}
	 */
	async waitFor(expr, { timeout = 15000, interval = 250 } = {}) {
		const deadline = Date.now() + timeout
		while (Date.now() < deadline) {
			const v = await this.evalJs(expr)
			// ⚠️ 返回**表达式自己的值**，不是布尔 true。
			//    以前写成 `if (v) return true`，于是 `const pt = await waitFor('...{x,y}...')`
			//    拿到的是 `true`，再读 `pt.x` 就是 undefined —— 调用方全都以为「没找到」。
			//    stepDeclare 的「弹层里没有这个选项」就是这么来的：弹层开着、选项在、
			//    表达式也返回了坐标，却被这一行吃成 true（2026-11-02 踩过）。
			if (v) return v
			await sleep(interval)
		}
		return false
	}

	/**
	 * 用键盘在已聚焦的元素里输入文本（CDP Input.insertText）。
	 * @param {string} text
	 */
	async insertText(text) {
		await this.send('Input.insertText', { text })
	}

	/**
	 * 在 (x, y) 处模拟一次鼠标点击（mouseMoved → mousePressed → mouseReleased）。
	 * @param {number} x
	 * @param {number} y
	 */
	async clickAt(x, y) {
		const base = { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }
		await this.send('Input.dispatchMouseEvent', base)
		await this.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed', button: 'left', clickCount: 1 })
		await this.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', button: 'left', clickCount: 1 })
	}

	/**
	 * 发一个键盘按键（keyDown + keyUp）。
	 * @param {string} key  e.g. 'Enter', 'Escape', 'a'
	 * @param {string} [code]
	 */
	async pressKey(key, code) {
		const base = { type: 'keyDown', key, code: code || key, windowsVirtualKeyCode: 0 }
		await this.send('Input.dispatchKeyEvent', base)
		await this.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' })
	}

	/**
	 * 发 Ctrl+A 然后 Backspace，清空当前聚焦的编辑器。
	 * 用于 fillField 里清掉已有内容（包括零宽字符 \u200b）。
	 */
	async clearFocused() {
		await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
		await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
		await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
		await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
	}

	// ── 表单填写 ──────────────────────────────────────────────────────────────

	/**
	 * 填写一个字段，带重试和回读验证。
	 *
	 * 流程：聚焦 → Ctrl+A+Backspace 清空 → insertText → 等 3s 读回 → 如不对，重试一次。
	 *
	 * ⚠️ 空编辑器有 \u200b（len=1, counter=0），clearFocused 必须用 Ctrl+A+Backspace。
	 * ⚠️ 如果当前内容已经等于 text（idempotent），直接返回 {ok:true, already:true}。
	 *
	 * @param {{
	 *   label: string,
	 *   selectorExpr: string,     JS 表达式，返回要聚焦的 DOM 元素
	 *   text: string,
	 *   readExpr: string,         JS 表达式，返回填完后能读到的内容
	 *   verify?: (got: string) => boolean
	 * }} opts
	 * @returns {Promise<{ok: boolean, already?: boolean, got?: string, why?: string}>}
	 */
	async fillField({ label, selectorExpr, text, readExpr, verify }) {
		const norm = (s) => String(s || '').replace(/\s/g, '').replace(/\u200b/g, '')
		const want = norm(text)

		// 幂等：已经是这个值就不改
		const cur = norm(await this.evalJs(readExpr))
		if (cur === want) return { ok: true, already: true }

		for (let attempt = 0; attempt < 2; attempt++) {
			// 聚焦
			const focused = await this.evalJs(`(()=>{const el=${selectorExpr};if(!el)return false;el.focus();el.click();return true})()`)
			if (!focused) return { ok: false, why: `${label}: 找不到元素` }

			await this.clearFocused()
			await sleep(80)
			await this.insertText(text)

			// 等回读
			const deadline = Date.now() + 3000
			let got = ''
			while (Date.now() < deadline) {
				got = norm(await this.evalJs(readExpr) || '')
				const ok = verify ? verify(got) : got === want
				if (ok) return { ok: true }
				await sleep(200)
			}
			if (attempt === 0) await sleep(300) // 给 React 一点时间
		}

		const got = norm(await this.evalJs(readExpr) || '')
		return { ok: false, got, why: `${label}: 写入后读回「${got}」，期望「${want}」` }
	}
}

// ── 工具函数（模块级，供 steps 调用）────────────────────────────────────────

/** @param {number} ms */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
