/**
 * lib/guard.mjs —— 挡住跨站请求（本地 API 的 CSRF 闸）
 * ============================================================================
 * 🔴 为什么需要它（2026-11-02 审计）：
 *   `/api/douyin-studio/*` 上没有 Authorization，也没有任何 token —— 它靠的是
 *   「服务器只监听 127.0.0.1，外面进不来」。但这不是 CSRF 防护：
 *   用户浏览器里任何一个网页，都可以往 http://127.0.0.1:3080 发一个 form POST。
 *   浏览器会照发（表单提交不算跨域限制），响应虽然读不到，**副作用已经发生了**。
 *   这套接口里有 `POST /dm/send`（带 confirm:true 就真发私信）、`/queue/retry`、
 *   `/duty`（开值班）—— 也就是说，一个恶意页面可以让插件以你的身份给客户发消息。
 *
 * ⭐ 策略（按 OWASP 与 Fetch Metadata 的通行做法）：
 *   ① **Sec-Fetch-Site 优先**：浏览器自动加的、脚本改不了（forbidden header），
 *      值为 `cross-site` 直接拒。这一条就挡住了绝大多数 CSRF。
 *   ② **Origin 兜底**：老浏览器不发 Sec-Fetch-Site，这时比 Origin 与 Host。
 *   ③ **没有任何来源信息时放行**：curl / 命令行 / 服务间调用不该被误伤
 *      —— 「看起来不像浏览器」正是我们可以信任的那一类。
 *
 * 也支持白名单（`DOUYIN_STUDIO_ALLOW_ORIGIN`），给反向代理 / 自定义域名留个口子，
 * 否则改了访问方式会把自己锁在门外。
 * ============================================================================
 */

const SAFE_SITE = new Set(['same-origin', 'same-site', 'none'])

/**
 * 判一个请求该不该放行。纯函数，方便单测（不起服务器）。
 * @param {Record<string, string|string[]|undefined>} headers Node 的 req.headers
 * @param {{allow?: string[]}} [opts]
 * @returns {{ok:boolean, why:string}}
 */
export function checkOrigin(headers, opts = {}) {
	const h = headers || {}
	const pick = (k) => {
		const v = h[k]
		return String(Array.isArray(v) ? v[0] : (v || '')).trim()
	}
	const site = pick('sec-fetch-site').toLowerCase()
	const origin = pick('origin')
	const host = pick('host') || pick('x-forwarded-host')

	const allow = Array.isArray(opts.allow)
		? opts.allow
		: (process.env.DOUYIN_STUDIO_ALLOW_ORIGIN ? [process.env.DOUYIN_STUDIO_ALLOW_ORIGIN] : [])

	// ① 浏览器明确说了「这是别的站发来的」
	if (site === 'cross-site') return { ok: false, why: 'Sec-Fetch-Site: cross-site' }

	// ② 没有 Origin：老浏览器 / curl / 服务间调用
	if (!origin) {
		if (SAFE_SITE.has(site)) return { ok: true, why: '同站请求（无 Origin 头）' }
		return { ok: true, why: '没有来源信息（curl / 老浏览器）' }
	}

	// ③ 沙箱 iframe / file:// 的 Origin 是字符串 "null"，这种最可疑
	if (origin === 'null') return { ok: false, why: 'Origin: null' }

	let u
	try { u = new URL(origin) } catch { return { ok: false, why: 'Origin 解析不了：' + origin.slice(0, 80) } }

	if (allow.includes(u.origin)) return { ok: true, why: '白名单命中' }
	if (host && u.host === host) return { ok: true, why: '同源' }

	return { ok: false, why: `Origin 与 Host 不一致（${u.host} ≠ ${host || '?'}）` }
}
