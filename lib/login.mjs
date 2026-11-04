/**
 * lib/login.mjs —— 扫码登录（出二维码 / 查扫没扫）
 * ============================================================================
 * 现实情况：登录态**平时就是好的**，只有当它过期了才需要扫。
 * 所以这里不搞「另起一个干净浏览器」那套（那还得把 cookie 搬来搬去），
 * 而是：**打开抖音首页 → 看有没有登录 → 没登录它自己会弹二维码 → 截那块图**。
 *
 * 为什么截屏而不是扒二维码链接：
 *   - 二维码是个 canvas/img，里面的内容就是一段短时 token；直接给图最省事，
 *     手机扫屏幕上这张图和你扫浏览器里的那张，等价。
 *   - 扒链接再自己画二维码要多一个依赖（qrcode），不值当。
 *
 * ⚠️ 二维码 2–3 分钟就过期，所以每次「出二维码」都现截，不缓存。
 * ============================================================================
 */
import { openPage, sleep } from './chrome.mjs'

const SELF_API = '/aweme/v1/web/user/profile/self/?device_platform=webapp&aid=6383&channel=channel_pc_web'

/** 现在登录没登录（轻量：只问一次接口） */
export async function whoami() {
	const c = await openPage({ url: 'https://www.douyin.com/' })
	try {
		const j = await c.ev(`fetch(${JSON.stringify(SELF_API)}, { credentials: 'include' }).then(r => r.json())`)
		const u = (j && j.user) || null
		return u && u.uid
			? { ok: true, loggedIn: true, uid: String(u.uid), nick: u.nickname || '' }
			: { ok: true, loggedIn: false }
	} catch (e) {
		return { ok: false, error: String((e && e.message) || e) }
	} finally { c.close() }
}

/**
 * 出二维码。已经登录就直接说「不用扫」。
 * 返回 { ok, already?, image? }，image 是 data:image/png;base64,… 直接能放 <img src>。
 *
 * ⚠️ 2026-11-01 实测（用干净 profile 打开抖音首页试的）：
 *   - 首页**不会自己弹登录框**，先得点导航栏那个「登录」（DOM click 就够）。
 *   - 弹层里二维码不是 canvas，是 `#douyin_login_comp_scan_code` 里面的一个 `<img>`
 *     （实测 179×179）。一开始按「找 120–340 的方形 canvas/img」去猜，一个也找不到 →
 *     报「页面上没找到二维码」，看着像登录成功，其实是我没找到。
 */
const QR_BOX = '#douyin_login_comp_scan_code'

const openModal = `(() => {
	const b = [...document.querySelectorAll('div,span,button,a')]
		.find((e) => (e.innerText || '').trim() === '登录' && e.getBoundingClientRect().width > 10);
	if (!b) return false;
	b.click();
	return true;
})()`

const findQr = `(() => {
	const box = document.querySelector(${JSON.stringify(QR_BOX)});
	if (!box) return null;
	const img = box.querySelector('img');
	const cv = box.querySelector('canvas');
	const el = img || cv;
	if (!el) return null;
	const r = el.getBoundingClientRect();
	if (r.width < 80) return null;
	return JSON.stringify({
		src: img && img.src ? String(img.src) : '',
		x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
	});
})()`

export async function qrShot() {
	const c = await openPage({ url: 'https://www.douyin.com/' })
	try {
		const logged = await c.ev(`fetch(${JSON.stringify(SELF_API)}, { credentials: 'include' }).then(r => r.json())`)
		const u = (logged && logged.user) || null
		if (u && u.uid) return { ok: true, already: true, uid: String(u.uid), nick: u.nickname || '' }

		let hit = null
		for (let i = 0; i < 24 && !hit; i++) {
			const raw = await c.ev(findQr)
			if (raw) { try { hit = JSON.parse(raw) } catch { hit = null } }
			if (hit) break
			if (i === 2) await c.ev(openModal)   // 头两次没找到 = 弹层还没开，点一下「登录」
			await sleep(500)
		}
		if (!hit) return { ok: false, error: '没等到二维码（弹层没弹出，或它换了结构）' }

		/* 图片本身就是 data:image/png;base64 的话，直接给它，比截屏更准（不会带上背景） */
		if (hit.src.startsWith('data:image')) return { ok: true, already: false, rect: hit, image: hit.src }

		const shot = await c.send('Page.captureScreenshot', {
			format: 'png',
			clip: { x: hit.x, y: hit.y, width: hit.w, height: hit.h, scale: 2 },
			captureBeyondViewport: true,
		})
		const b64 = shot && shot.data
		if (!b64) return { ok: false, error: '截图为空' }
		return { ok: true, already: false, rect: hit, image: 'data:image/png;base64,' + b64 }
	} catch (e) {
		return { ok: false, error: String((e && e.message) || e) }
	} finally { c.close() }
}
