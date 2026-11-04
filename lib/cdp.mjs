/**
 * lib/cdp.mjs —— 这个插件里**唯一**碰浏览器的地方
 * ============================================================================
 * 从三处教训里长出来的：
 *   ① 端口写死 9334 → 一撞车整套静默失效（旧插件踩过）。这里端口可配、可探测。
 *   ② 认标签页用 `/creator\.douyin\.com/` → 会命中在线客服页
 *      （`summon.bytedance.com/?...from=https%3A%2F%2Fcreator.douyin.com`），连上去一个按钮都找不到。
 *      ⇒ 一律用**完整主机名**判断，不用「包含」。
 *   ③ SPA 切页后老连接会卡在 `DOM.enable` 上一直超时。⇒ 卡了就当断了，换标签页重连。
 *
 * 用法：`withPage('www.douyin.com', async (c) => c.evaluate('1+1'))`
 * ============================================================================
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 调试端口：环境变量优先，默认 9334（和 QQ 那边、旧插件共用同一个口） */
export const port = () => Number(process.env.DOUYIN_CDP_PORT || 9334)
const base = () => `http://127.0.0.1:${port()}`

/**
 * Chrome 的登录资料目录：优先 DOUYIN_PROFILE，其次 DSH_HOME，最后当前用户的家目录。
 * 这台机器上三条都指向 `C:\Users\admin\.dsh\douyin-duty\chrome-profile`，
 * 换用户名也一样 —— 原来写死的是 `C:\Users\admin\.dsh`，搬机器就会去
 * **别人的**家目录里建 profile（不存在就 mkdir，于是开出一个没登录的空号，
 * 表现成「明明登过却又要扫码」，日志里一个字不报）。
 */
export function profileDir() {
	return process.env.DOUYIN_PROFILE
		|| join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'douyin-duty', 'chrome-profile')
}

const BROWSERS = () => {
	const out = []
	const env = String(process.env.DOUYIN_BROWSER || '').trim()
	if (env) out.push(env)
	const roots = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA,
		'C:\\Program Files', 'C:\\Program Files (x86)', 'D:\\Program Files'].filter(Boolean)
	if (process.platform === 'win32') {
		for (const r of roots) {
			out.push(join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'))
			out.push(join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
		}
	} else if (process.platform === 'darwin') {
		out.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
		out.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')
	} else {
		out.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser')
	}
	return out
}

const j = async (url, init, ms = 4000) => {
	try {
		const r = await fetch(url, { ...(init || {}), signal: AbortSignal.timeout(ms) })
		return { ok: r.ok, status: r.status, json: await r.json().catch(() => null) }
	} catch (e) {
		return { ok: false, status: 0, error: String((e && e.message) || e) }
	}
}

/** CDP 在不在；在就返回版本信息（`{ Browser, webSocketDebuggerUrl }`） */
export async function version() {
	const r = await j(`${base()}/json/version`, undefined, 1500)
	return r.ok ? r.json : null
}

/**
 * 确保有一个带调试端口的浏览器。
 * 已经有就直接用（绝不起第二个——第二个会抢同一个 profile，把登录态搞坏）。
 */
export async function ensureBrowser({ launch = true, url = 'https://www.douyin.com/', waitMs = 30000 } = {}) {
	const v = await version()
	if (v) return { up: true, launched: false, info: v }
	if (!launch) return { up: false, launched: false, why: 'CDP 没开，且 launch=false' }

	const exe = BROWSERS().find((p) => existsSync(p))
	if (!exe) return { up: false, launched: false, why: '没找到 Chrome/Edge（可用 DOUYIN_BROWSER 指定）' }

	const dir = profileDir()
	try { mkdirSync(dir, { recursive: true }) } catch { /* 已存在 */ }

	const args = [
		`--remote-debugging-port=${port()}`,
		`--user-data-dir=${dir}`,
		'--no-first-run',
		'--no-default-browser-check',
		'--disable-features=Translate,MediaRouter',
		/* ⭐ 2026-11-01：抖音私信点开会话会 `window.open` 一个独立窗口。
		 *    默认拦截弹窗 ⇒ 点了像「什么都没发生」（列表在、点不动）。
		 *    这不是放行任意弹窗：整台机器只开这一个站，弹窗风险由站点自己承担。 */
		'--disable-popup-blocking',
		'--window-size=1440,900',
		url,
	]
	const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false })
	child.unref()

	const t0 = Date.now()
	for (;;) {
		const vv = await version()
		if (vv) return { up: true, launched: true, info: vv, exe }
		if (Date.now() - t0 > waitMs) return { up: false, launched: true, why: `${waitMs}ms 内 CDP 没上来（${exe}）` }
		await sleep(500)
	}
}

export async function listTabs() {
	const r = await j(`${base()}/json/list`)
	return (r.json || []).filter((t) => t.type === 'page')
}

export async function newTab(url) {
	const r = await fetch(`${base()}/json/new?` + encodeURIComponent(url), { method: 'PUT', signal: AbortSignal.timeout(8000) })
	return r.json().catch(() => null)
}

export async function closeTab(id) {
	try { await fetch(`${base()}/json/close/${id}`, { signal: AbortSignal.timeout(4000) }) } catch { /* 已经关了 */ }
}

/** `https://www.douyin.com/xxx` → `www.douyin.com`（认页面的唯一正确方式） */
export const hostOf = (u) => { try { return new URL(u).host } catch { return '' } }

/**
 * 连上一个标签页，返回一个小客户端。
 * `send(method, params)` 超时会 reject —— 调用方要能接住（SPA 切页时这是常态，不是坏消息）。
 */
export async function connect(tab, { dom = true } = {}) {
	const ws = new WebSocket(tab.webSocketDebuggerUrl)
	let id = 0
	const pend = new Map()
	const send = (method, params = {}, timeout = 30000) => new Promise((res, rej) => {
		const i = ++id
		const tm = setTimeout(() => { pend.delete(i); rej(new Error(method + ' 超时')) }, timeout)
		pend.set(i, { res: (v) => { clearTimeout(tm); res(v) }, rej: (e) => { clearTimeout(tm); rej(e) } })
		ws.send(JSON.stringify({ id: i, method, params }))
	})
	ws.onmessage = (ev) => {
		let m = null
		try { m = JSON.parse(String(ev.data)) } catch { return }
		if (m.id && pend.has(m.id)) {
			const q = pend.get(m.id)
			pend.delete(m.id)
			m.error ? q.rej(new Error(m.error.message)) : q.res(m.result)
		}
	}
	await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('连不上页面')) })
	await send('Runtime.enable')
	if (dom) await send('DOM.enable')
	try { await send('Page.enable') } catch { /* 无头老版本 */ }

	/** 在页面里求值：出错不抛，返回 null（一次 evaluate 失败不该炸掉整条链路） */
	const evaluate = async (expression, { awaitPromise = true, timeout = 30000 } = {}) => {
		try {
			const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }, timeout)
			if (r && r.exceptionDetails) return null
			return r ? r.result.value : null
		} catch {
			return null
		}
	}
	const close = () => { try { ws.close() } catch { /* 已断 */ } }
	return { tab, send, evaluate, close }
}

/**
 * 在指定主机的页面上跑一段代码。没有这样的页就自己开一张，跑完关掉。
 * **绝不动哥哥正开着的别的页面**（只在 host 完全相等时复用）。
 */
export async function withPage(host, fn, { reuse = true, url } = {}) {
	const up = await ensureBrowser({ url: url || `https://${host}/` })
	if (!up.up) throw new Error('浏览器起不来：' + (up.why || '未知'))

	let tab = reuse ? (await listTabs()).find((t) => hostOf(t.url) === host) : null
	let created = null
	if (!tab) {
		created = await newTab(url || `https://${host}/`)
		tab = created
		await sleep(1500)
	}
	if (!tab || !tab.webSocketDebuggerUrl) throw new Error('开不出 ' + host + ' 的页面')

	const c = await connect(tab)
	try {
		return await fn(c, tab)
	} finally {
		c.close()
		if (created && created.id) closeTab(created.id).catch(() => {})
	}
}
