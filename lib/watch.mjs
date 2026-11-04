/**
 * lib/watch.mjs —— 盯着私信，来新的就弹通知
 * ============================================================================
 * 为什么单独一个文件：它要**常驻**（每 N 秒跑一次），跟一次性的命令不是一回事。
 * 但底层还是那条纯 HTTP 的 conversations()——不起第二个浏览器、不点页面。
 *
 * 三条规矩：
 *   1. 只认「别人发的、时间比上次更新」的消息，自己发的不弹。
 *   2. 同一个会话一次只弹一条（攒着一起说「又有 3 条」），不刷屏。
 *   3. 静音时段只记不弹（状态存盘），第二天看得到，但半夜不吵人。
 * ============================================================================
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { conversations } from './im.mjs'
import { isQuiet, notify } from './notify.mjs'
import { atomicWriteJson, readJsonSafe } from './fsx.mjs'

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DIR = join(HOME, 'douyin-duty')
const STATE = join(DIR, 'watch-state.json')

/* seen 表丢了 = 所有旧私信都变「新来的」→ 通知炸一遍。所以这个文件必须原子写，
 * 读坏了要把现场留在 .corrupt-* 里，不能悄悄当空的。详见 lib/fsx.mjs。 */
const load = () => {
	const j = readJsonSafe(STATE, null)
	return { seen: (j && j.seen) || {}, lastAt: (j && j.lastAt) || '' }
}
/* 写不进去 = seen 表永远停在上一版 = 每轮都把同一条私信当新的重弹一遍。
 * 这种失败以前是完全静默的，现在记下来，status() 里能看到。 */
let lastWriteError = null
const save = (s) => {
	const r = atomicWriteJson(STATE, s)
	lastWriteError = r.ok ? null : r.error
	return r
}

/** 跑一次：返回这次的新消息（不弹的话也返回，方便命令行看） */
export async function tick({ quiet = true, limit = 6 } = {}) {
	const st = load()
	const r = await conversations({ limit })
	if (r.ok === false) return { ok: false, error: r.error }
	const fresh = []
	for (const c of r.conversations || []) {
		const ms = Array.isArray(c.messages) ? c.messages : []
		const last = ms[ms.length - 1]
		if (!last || last.from !== 'them') continue
		const key = String(c.peer_uid || '')
		if (!key) continue
		const prev = String(st.seen[key] || '')
		if (last.at && last.at > prev) {
			fresh.push({
				peer_uid: key,
				at: last.at,
				text: String(last.text || '').replace(/\s+/g, ' ').slice(0, 80),
				kind: last.kind || 'text',
				count: ms.filter((m) => m.from === 'them' && (!prev || String(m.at) > prev)).length,
			})
			st.seen[key] = last.at
		}
	}
	st.lastAt = new Date().toISOString()
	save(st)

	let notified = 0
	if (fresh.length && quiet && isQuiet()) return { ok: true, fresh, notified: 0, quiet: true }

	for (const f of fresh.slice(0, 3)) {
		const title = f.count > 1 ? '抖音 · 有 ' + f.count + ' 条新私信' : '抖音 · 新私信'
		const res = await notify(title, f.text || '（' + f.kind + '）')
		if (res.ok) notified += 1
	}
	return { ok: true, fresh, notified }
}

let timer = null
/** 常驻盯梢（进程内）。返回 {stop, running}。startDelaySec：开机第一下别急着跑（浏览器还没起） */
export function start({ everySec = 90, quiet = true, startDelaySec = 0 } = {}) {
	stop()
	const every = Math.max(30, Number(everySec) || 90)
	const beat = async () => {
		try { await tick({ quiet }) } catch { /* 一轮失败不拖垮整条循环 */ }
	}
	if (startDelaySec > 0) {
		const d = setTimeout(beat, Number(startDelaySec) * 1000)
		if (d && typeof d.unref === 'function') d.unref()
	} else beat()
	timer = setInterval(beat, every * 1000)
	if (timer && typeof timer.unref === 'function') timer.unref()
	return { ok: true, running: true, everySec: every }
}

export function stop() {
	if (timer) { clearInterval(timer); timer = null }
	return { ok: true, running: false }
}

export const status = () => ({ ok: true, running: Boolean(timer), writeError: lastWriteError, state: load() })

export { STATE as WATCH_STATE }
