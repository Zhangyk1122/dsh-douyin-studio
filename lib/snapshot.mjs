/**
 * lib/snapshot.mjs —— 一账号一份登录态快照（存 / 列 / 还原）
 * ============================================================================
 * 灵感来自 `dreammis/social-auto-upload` 的 `storage_state`：它把「谁登录着」存成一份文件，
 * 一个账号一份，坏了能换回去。
 *
 * 我们这里没有 playwright 那种 storage_state，所以直接**拷 Chrome 资料目录里真正管登录的那几个文件**：
 *   Cookies、Login Data、Local State、Preferences（都在 User Data 根下或 Default/ 下）
 * 存到 `$DSH_HOME/douyin-studio/snapshots/<时间戳>/`，只留最近 5 份。
 *
 * ⚠️ 还原之前必须**先关浏览器**：Chrome 开着的时候写 Cookies 文件会被它盖回去，
 *    甚至直接把 SQLite 写坏。所以 restore 前一律先查 CDP，活着就拒绝。
 * ============================================================================
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homeDir } from './ledger.mjs'
import { profileDir, version, listTabs, connect, sleep } from './cdp.mjs'

const KEEP = 5
const snapRoot = () => join(homeDir(), 'snapshots')

/**
 * 真正决定「谁登录着」的文件（相对 profile 根）。
 * ⚠️ Chrome 96+ 把 Cookies 挪到了 `Default/Network/` 下；老版本在 `Default/` 根。
 *    两处都试，别只认一个（踩过：只拷 Default/Cookies → 快照里根本没 cookie）。
 */
const FILES = [
	'Local State',
	join('Default', 'Network', 'Cookies'),
	join('Default', 'Network', 'Cookies-journal'),
	join('Default', 'Cookies'),
	join('Default', 'Cookies-journal'),
	join('Default', 'Login Data'),
	join('Default', 'Preferences'),
	join('Default', 'Web Data'),
]

const stamp = () => {
	const d = new Date()
	const p = (n) => String(n).padStart(2, '0')
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function listSnapshots() {
	const root = snapRoot()
	if (!existsSync(root)) return []
	return readdirSync(root)
		.filter((n) => /^\d{8}-\d{6}$/.test(n))
		.sort()
		.reverse()
		.map((n) => {
			const dir = join(root, n)
			let bytes = 0
			let files = 0
			try {
				for (const f of readdirSync(dir, { recursive: true })) {
					const p = join(dir, String(f))
					try { const st = statSync(p); if (st.isFile()) { bytes += st.size; files++ } } catch { /* 跳过 */ }
				}
			} catch { /* 目录坏了 */ }
			return { name: n, dir, files, mb: +(bytes / 1048576).toFixed(2) }
		})
}

/**
 * 存一份。
 * 两条路一起走：
 *   ① **CDP 导出 cookies**（浏览器开着也能存，这才是真·storage_state）→ `cookies.json`
 *   ② 顺便拷那几个文件（浏览器关着时，文件更完整）
 * Chrome 开着时 Cookies 是 EBUSY 锁着的，所以 ① 才是主路，② 只是补。
 */
export async function saveSnapshot({ note = '' } = {}) {
	const src = profileDir()
	if (!existsSync(src)) return { ok: false, error: '没找到 Chrome 资料目录: ' + src }

	const name = stamp()
	const dir = join(snapRoot(), name)
	mkdirSync(dir, { recursive: true })

	// ① 导出 cookies（有浏览器就走这条，最准）
	let cookies = []
	let cookieError = ''
	const v = await version()
	if (v) {
		try {
			const tabs = await listTabs()
			const tab = tabs.find((t) => /douyin\.com/.test(t.url || '')) || tabs[0]
			if (tab) {
				const c = await connect(tab, { dom: false })
				try {
					const r = await c.send('Network.getAllCookies', {}, 15000)
					cookies = (r?.cookies || []).filter((x) => /douyin\.com$/.test(String(x.domain || '').replace(/^\./, '')))
					writeFileSync(join(dir, 'cookies.json'), JSON.stringify(cookies, null, 1), 'utf8')
				} finally { c.close() }
			}
		} catch (e) {
			cookieError = String((e && e.message) || e).slice(0, 120)
		}
	} else {
		cookieError = '浏览器没开，只拷了文件'
	}

	// ② 文件：被独占的（Chrome 开着时 Cookies 就是）用「读一遍再写」兜一下
	const copied = []
	const missing = []
	for (const rel of FILES) {
		const from = join(src, rel)
		if (!existsSync(from)) { missing.push(rel); continue }
		const to = join(dir, rel)
		try {
			mkdirSync(join(to, '..'), { recursive: true })
			try {
				copyFileSync(from, to)
			} catch (e) {
				// EBUSY：SQLite 锁着不让拷，但通常能读 —— 读出来再写一遍
				writeFileSync(to, readFileSync(from))
			}
			copied.push(rel)
		} catch (e) {
			missing.push(rel + '（拷失败: ' + String((e && e.message) || e).slice(0, 60) + '）')
		}
	}

	writeFileSync(join(dir, 'meta.json'), JSON.stringify({
		name, at: new Date().toISOString(), note,
		profile: src, copied, missing,
		cookies: cookies.length, cookieError,
	}, null, 1), 'utf8')

	const all = listSnapshots()
	for (const old of all.slice(KEEP)) {
		try { rmSync(old.dir, { recursive: true, force: true }) } catch { /* 删不掉就算了 */ }
	}

	return {
		ok: copied.length > 0 || cookies.length > 0,
		name, dir, cookies: cookies.length, cookieError: cookieError || undefined,
		copied, missing, kept: KEEP,
	}
}

/**
 * 还原一份。
 *   浏览器开着 → 用 CDP 把 `cookies.json` 一条条 `Network.setCookie` 塞回去（不用关浏览器）
 *   浏览器关着 → 直接拷文件（更彻底，连 Local State 一起回去）
 */
export async function restoreSnapshot(name) {
	const dir = join(snapRoot(), String(name || ''))
	if (!existsSync(dir)) return { ok: false, error: '没有这份快照: ' + name }

	const cookieFile = join(dir, 'cookies.json')
	const v = await version()

	if (v) {
		if (!existsSync(cookieFile)) return { ok: false, error: '这份快照里没有 cookies.json，只能关掉浏览器后按文件还原' }
		const cookies = JSON.parse(readFileSync(cookieFile, 'utf8').replace(/^\uFEFF/, ''))
		const tabs = await listTabs()
		const tab = tabs.find((t) => /douyin\.com/.test(t.url || '')) || tabs[0]
		if (!tab) return { ok: false, error: '没有可用的标签页' }
		const c = await connect(tab, { dom: false })
		let okCount = 0
		const failed = []
		try {
			for (const x of cookies) {
				try {
					await c.send('Network.setCookie', {
						name: x.name, value: x.value, domain: x.domain, path: x.path || '/',
						secure: Boolean(x.secure), httpOnly: Boolean(x.httpOnly),
						sameSite: x.sameSite, expires: x.expires,
					}, 8000)
					okCount++
				} catch (e) {
					failed.push(x.name + ': ' + String((e && e.message) || e).slice(0, 40))
				}
			}
		} finally { c.close() }
		return { ok: okCount > 0, via: 'cdp', name, total: cookies.length, restored: okCount, failed: failed.slice(0, 8), hint: '刷新一下页面就是还原后的登录态' }
	}

	const dst = profileDir()
	mkdirSync(dst, { recursive: true })
	const copied = []
	const missing = []
	for (const rel of FILES) {
		const from = join(dir, rel)
		if (!existsSync(from)) { missing.push(rel); continue }
		const to = join(dst, rel)
		try {
			mkdirSync(join(to, '..'), { recursive: true })
			copyFileSync(from, to)
			copied.push(rel)
		} catch (e) {
			missing.push(rel + '（写失败: ' + String((e && e.message) || e).slice(0, 60) + '）')
		}
	}
	return { ok: copied.length > 0, via: 'files', name, copied, missing, hint: '还原完重新打开浏览器，登录态就回来了' }
}
