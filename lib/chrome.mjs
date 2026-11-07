/**
 * lib/chrome.mjs —— 兼容层
 * ============================================================================
 * 为什么有这个东西：`tools/im-send.mjs`（发私信，从旧插件搬过来的、被真发验证过的
 * 那套 UI 流程）原本 import 的是旧插件的 `../lib/chrome.mjs`，要 `openPage()` /
 * `sleep` / `c.ev()` / `c.send()` / `c.close()`。
 *
 * 这边不重写那 800 行点击逻辑，只把**我们自己的 CDP 层**包成它要的形状：
 * 一个方法名适配器，不是第二套实现。哪天发私信改走接口了，这个文件就可以删。
 * ============================================================================
 */
import { connect, ensureBrowser, listTabs, newTab, sleep } from './cdp.mjs'

export { sleep }

const CHAT_HOSTS = ['www.douyin.com']

const pathOf = (u) => { try { return new URL(String(u)).pathname } catch { return '' } }

/**
 * 纯函数：从标签页列表里挑一张（抽出来是为了能单测，不用起 Chrome）。
 * @param {Array<{type?:string,url?:string}>} tabs
 * @param {string} host
 * @param {string} [want] 期望的 pathname
 * @returns {object|null}
 */
export function matchTab(tabs, host, want = '') {
	const pages = (Array.isArray(tabs) ? tabs : []).filter((t) => t && t.type === 'page' && String(t.url || '').includes(host))
	if (!want) return pages[0] || null
	const w = String(want)
	const exact = pages.find((t) => pathOf(t.url) === w)
	if (exact) return exact
	return pages.find((t) => pathOf(t.url).startsWith(w.endsWith('/') ? w : w + '/')) || null
}

/**
 * 挑一张标签页。
 * - 不传 `want`：老行为，同域第一张（默认不变）。
 * - 传 `want`（例如 `'/chat'`）：**先按 pathname 精确命中**，再按前缀命中；
 *   都不中就是 null —— 让调用方去开新页，绝不退回"同域随便一张"。
 *   2026-11-07 的 `[object Object]` / "找得到行点不开会话" 就是退回那一步造成的：
 *   页面上同时开着 4 个 douyin.com（1 个 /chat、3 个 /jingxuan）。
 */
async function pickTab(host, want = '') {
	const tabs = await listTabs()
	return matchTab(tabs, host, want)
}

/**
 * 打开（或复用）一张页面，返回 `{ ev, send, close, url }`。
 * - 已有同域的标签页就复用，不重复开（开多了 Chrome 会卡）
 * - `ev` = 在页面里跑表达式拿值（字符串直返，别塞 Buffer）
 */
/**
 * @param {object} o
 * @param {string} o.url
 * @param {boolean} o.requireExisting 不新开浏览器，只连已有的
 * @param {boolean} o.navigate 把选中的标签页真正导航到这个 url
 * @param {string} [o.want] 期望的 pathname（如 `'/chat'`）。传了它，就**只**认这个路径的标签页，
 *   命中不到宁可新开一张 —— 不再退回"同域随便一张"。老调用方不传，行为完全不变。
 *   —— 2026-11-05 实弹：`pickTab` 只按**域名**挑，抖音任何页面都能命中。
 *   于是发私信前调它，拿到的可能是上一个动作留下的**视频页**；而视频页的分享面板里
 *   好友行也带 `[data-e2e="conversation-item"]`，于是"找得到行、打不开会话"。
 *   要落到具体路径的调用方必须传 navigate:true。
 */
export async function openPage({ url = 'https://www.douyin.com/', requireExisting = false, navigate = false, want = '' } = {}) {
	const host = (() => { try { return new URL(url).host } catch { return CHAT_HOSTS[0] } })()
	await ensureBrowser({ launch: !requireExisting, url, waitMs: 30000 })
	const wantPath = String(want || '')
	let tab = await pickTab(host, wantPath)
	/* 老行为（不传 want）保留同域兜底；传了 want 就不兜底，否则等于没校验。 */
	if (!tab && !wantPath) tab = await pickTab('douyin.com')
	if (!tab) tab = await newTab(url)
	if (!tab) throw new Error('开不出抖音页面（Chrome 没起来？）')

	const c = await connect(tab, { dom: false })
	if (navigate && tab.url !== url) {
		try {
			await c.send('Page.navigate', { url })
			await sleep(1800)
		} catch { /* 导航失败就让调用方按自己的超时去判，别在这里吞掉整个流程 */ }
	}
	return {
		url: tab.url,
		send: (method, params) => c.send(method, params),
		ev: async (expr) => {
			const r = await c.send('Runtime.evaluate', {
				expression: `(() => { try { return (${expr}) } catch (e) { return '__ERR__' + e.message } })()`,
				returnByValue: true,
				awaitPromise: true,
			})
			const v = r && r.result && r.result.value
			if (typeof v === 'string' && v.startsWith('__ERR__')) throw new Error(v.slice(7))
			return v
		},
		close: () => { try { c.close() } catch { /* 关不上不算错 */ } },
	}
}