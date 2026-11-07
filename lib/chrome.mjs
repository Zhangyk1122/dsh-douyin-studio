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

async function pickTab(host) {
	const tabs = await listTabs()
	return tabs.find((t) => t.type === 'page' && String(t.url || '').includes(host)) || null
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
 *   —— 2026-11-05 实弹：`pickTab` 只按**域名**挑，抖音任何页面都能命中。
 *   于是发私信前调它，拿到的可能是上一个动作留下的**视频页**；而视频页的分享面板里
 *   好友行也带 `[data-e2e="conversation-item"]`，于是"找得到行、打不开会话"。
 *   要落到具体路径的调用方必须传 navigate:true。
 */
export async function openPage({ url = 'https://www.douyin.com/', requireExisting = false, navigate = false } = {}) {
	const host = (() => { try { return new URL(url).host } catch { return CHAT_HOSTS[0] } })()
	await ensureBrowser({ launch: !requireExisting, url, waitMs: 30000 })
	let tab = await pickTab(host)
	if (!tab) tab = await pickTab('douyin.com')
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