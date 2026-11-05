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
import { isQuiet, notify } from './toast.mjs'
import { atomicWriteJson, readJsonSafe } from './fsx.mjs'

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DIR = join(HOME, 'douyin-duty')
const STATE = join(DIR, 'watch-state.json')

/* seen 表丢了 = 所有旧私信都变「新来的」→ 通知炸一遍。所以这个文件必须原子写，
 * 读坏了要把现场留在 .corrupt-* 里，不能悄悄当空的。详见 lib/fsx.mjs。 */
const load = () => {
	const j = readJsonSafe(STATE, null) || {}
	/* `...j` 铺在前面：不认识的字段也要带回来。否则 save 一次就把新加的字段冲掉 ——
	 * 同 lib/autopilot.mjs 那次「一晚 13 条私信」的病根（2026-11-04）。 */
	return { ...j, seen: j.seen || {}, lastAt: j.lastAt || '' }
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

	/* 有新私信 → 叫一次「现在回」（由调用方决定要不要真回，回过什么由 autopilot 自己记账）。
	 * 这一步是「90 秒发现、30 分钟才回」的解药：发现和回复之间不再隔一个定时器。
	 * 放在通知之前：宁可先回、再弹（弹窗是给人看的，回复是给对方看的）。 */
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
/** 常驻盯梢（进程内）。返回 {stop, running}。startDelaySec：开机第一下别急着跑（浏览器还没起） */
export function start({ everySec = 90, quiet = true, startDelaySec = 0, onFresh = null } = {}) {
	stop()
	const every = Math.max(30, Number(everySec) || 90)
	/* 重入闸：tick 现在可能要等一次「回私信」（十几秒），
	 * 而 setInterval 到点还会照常再叫一次 —— 不挡就会叠着跑，两轮各读一份会话。 */
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
