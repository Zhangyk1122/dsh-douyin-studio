/**
 * lib/dm-watch.mjs —— 盯着私信，来新的就（可选）立刻回 + 弹通知
 * ============================================================================
 * 这个模块在 upstream 0.6.1（45f338f）被 lib/watch.mjs 的重写覆盖掉了：
 * watch.mjs 变成「看过这条视频的证据面」（watchOnce/watchOf），而 index.js /
 * lib/tools.mjs / tools/dy.mjs 还在调 WATCH.start / status / stop —— 于是
 * 一按「开盯私信」就报 `WATCH.status is not a function`。
 *
 * 这里把 0.6.0 的实现（6444d19:lib/watch.mjs）还原成一个独立模块，
 * 让 index.js 的 WATCH 重新指到它。底层仍是纯 HTTP 的 conversations()，
 * 不起第二个浏览器、不点页面。
 *
 * 三条规矩（沿用原实现）：
 *   1. 只认「别人发的、时间比上次更新」的消息，自己发的不弹。
 *   2. 同一个会话一次只弹一条（攒着一起说「又有 N 条」），不刷屏。
 *   3. 静音时段只记不弹（状态存盘），第二天看得到，但半夜不吵人。
 * ============================================================================
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { conversations } from './im.mjs'
import { isQuiet, notify } from './toast.mjs'
import { atomicWriteJson, readJsonSafe } from './fsx.mjs'

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DIR = join(HOME, 'douyin-duty')
const STATE = join(DIR, 'watch-state.json')

/* seen 表丢了 = 所有旧私信都变「新来的」→ 通知炸一遍。所以这个文件必须原子写，
 * 读坏了要把现场留在 .corrupt-* 里，不能悄悄当空的。详见 lib/fsx.mjs。 */
const load = () => {
	const j = readJsonSafe(STATE, null) || {}
	/* `...j` 铺在前面：不认识的字段也要带回来。否则 save 一次就把新加的字段冲掉。 */
	return { ...j, seen: j.seen || {}, lastAt: j.lastAt || '' }
}
/* 写不进去 = seen 表永远停在上一版 = 每轮都把同一条私信当新的重弹一遍。 */
let lastWriteError = null
const save = (s) => {
	const r = atomicWriteJson(STATE, s)
	lastWriteError = r.ok ? null : r.error
	return r
}

/** 跑一次：返回这次的新消息（不弹的话也返回，方便命令行看） */
export async function tick({ quiet = true, limit = 6, onFresh = null } = {}) {
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

	/* 有新私信 → 叫一次「现在回」。发现和回复之间不再隔一个定时器。 */
	if (fresh.length && typeof onFresh === 'function') {
		try { await onFresh(fresh) } catch { /* 即时回失败不影响盯梢本身 */ }
	}

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
/** 常驻盯梢（进程内）。startDelaySec：开机第一下别急着跑（浏览器还没起） */
export function start({ everySec = 90, quiet = true, startDelaySec = 0, onFresh = null } = {}) {
	stop()
	const every = Math.max(30, Number(everySec) || 90)
	/* 重入闸：tick 现在可能要等一次「回私信」（十几秒），
	 * 而 setInterval 到点还会照常再叫一次 —— 不挡就会叠着跑。 */
	let busy = false
	const beat = async () => {
		if (busy) return
		busy = true
		try { await tick({ quiet, onFresh }) } catch { /* 一轮失败不拖垮整条循环 */ }
		finally { busy = false }
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
