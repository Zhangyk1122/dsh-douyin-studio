/**
 * lib/tabs.mjs —— 标签页的「够用就好」
 * ============================================================================
 * 2026-11-12 现场：机器人那个 Chrome 里开着 **17 张** 抖音标签（15 张 /jingxuan、
 * 2 张 /chat）。每点一次面板里的视频就 `newTab()` 一张，几天下来堆成这样。
 *
 * 堆页面的代价不是内存，是**风控**：同一个账号短时间内在十几个页面里来回跳、
 * 每个页面都在请求，最像人的操作也不会长这样。所以这里提供两件事：
 *   1. `openReuse(url)` —— 有能用的页就导航它，不新开；
 *   2. `dedupeDouyin()` —— 把多余的页面收掉，只留「一个聊天页 + 一个看视频的页」。
 *
 * 只关 `douyin.com` 的页面；别的站（如果有）一律不碰。
 * ============================================================================
 */
import { closeTab, listTabs, newTab, sleep } from './cdp.mjs'

const isDouyin = (t) => /(^|\.)douyin\.com$/.test((() => { try { return new URL(String(t && t.url)).hostname } catch { return '' } })())
const pathOf = (u) => { try { return new URL(String(u)).pathname } catch { return '' } }
const isChat = (t) => pathOf(t && t.url).startsWith('/chat')

/**
 * 纯函数：从抖音页面里挑一张可复用的（不碰聊天页，聊天页有会话状态）。
 * @param {Array<object>} tabs
 * @param {(t:object)=>boolean} [prefer] 优先条件
 */
export function reusableViewer(tabs, prefer) {
	const pages = (Array.isArray(tabs) ? tabs : []).filter((t) => t && t.type === 'page' && isDouyin(t) && !isChat(t))
	if (prefer) {
		const hit = pages.find(prefer)
		if (hit) return hit
	}
	return pages[0] || null
}

/**
 * 在机器人浏览器里打开一个链接：**能复用就复用**。
 * @param {string} url
 * @param {{prefer?: (t:object)=>boolean, navigateWaitMs?: number}} [opts]
 * @returns {Promise<{tab: object|null, reused: boolean}>}
 */
export async function openReuse(url, { prefer, navigateWaitMs = 1200 } = {}) {
	const tab = reusableViewer(await listTabs(), prefer)
	if (!tab) return { tab: await newTab(url), reused: false }
	if (String(tab.url) === String(url)) return { tab, reused: true }
	try {
		const ws = new WebSocket(tab.webSocketDebuggerUrl)
		await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('连不上页面')) })
		ws.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url } }))
		await sleep(navigateWaitMs)
		try { ws.close() } catch { /* 已经断了 */ }
		return { tab: { ...tab, url }, reused: true }
	} catch {
		return { tab: await newTab(url), reused: false }
	}
}

/**
 * 收掉多余的抖音页面：留一个聊天页 + `keepViewer` 个看视频的页。
 * @param {{keepChat?: number, keepViewer?: number, dry?: boolean}} [opts]
 * @returns {Promise<{closed: string[], kept: number}>}
 */
export async function dedupeDouyin({ keepChat = 1, keepViewer = 1, dry = false } = {}) {
	const pages = (await listTabs()).filter((t) => t && t.type === 'page' && isDouyin(t))
	const chats = pages.filter(isChat)
	const viewers = pages.filter((t) => !isChat(t))
	const keep = new Set([...chats.slice(0, Math.max(0, keepChat)), ...viewers.slice(0, Math.max(0, keepViewer))].map((t) => t.id))
	const closed = []
	for (const t of pages) {
		if (keep.has(t.id)) continue
		closed.push(String(t.url))
		if (!dry) await closeTab(t.id)
	}
	return { closed, kept: keep.size }
}
/**
 * 面板「诊断」里那行「开着的页面」要的数据。
 * @returns {Promise<{ok: boolean, count: number, urls?: string[], error?: string}>}
 */
export async function tabsStatus() {
	try {
		const pages = (await listTabs()).filter((t) => t && t.type === 'page' && isDouyin(t))
		return { ok: true, count: pages.length, urls: pages.map((t) => String(t.url)) }
	} catch (e) {
		return { ok: false, count: 0, error: String((e && e.message) || e) }
	}
}

/**
 * 一键收页（面板按钮 / 命令行都走这儿）。
 * @param {{keepChat?: number, keepViewer?: number}} [o]
 * @returns {Promise<{ok: boolean, closed?: number, kept?: number, error?: string}>}
 */
export async function sweep(o = {}) {
	try {
		const r = await dedupeDouyin(o)
		return { ok: true, closed: r.closed.length, kept: r.kept }
	} catch (e) {
		return { ok: false, error: String((e && e.message) || e) }
	}
}

/**
 * 面板点一条视频时走这儿：复用页面、顺手收掉多余的。
 * @param {string} url
 * @returns {Promise<{ok: boolean, opened: string, reused: boolean, tab: string|null, closed: number}>}
 */
export async function openInRobot(url) {
	const { tab, reused } = await openReuse(url)
	const swept = await sweep({ keepChat: 1, keepViewer: 2 }).catch(() => ({ closed: 0 }))
	return { ok: true, opened: url, reused, tab: tab && (tab.id || tab) || null, closed: swept.closed || 0 }
}
