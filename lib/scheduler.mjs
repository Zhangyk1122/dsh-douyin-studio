/**
 * lib/scheduler.mjs —— 「今天什么时候刷、现在该不该刷」的纯计算
 * ============================================================================
 * 和 lib/schedule.mjs 的分工：
 *   schedule.mjs  = 老的点位计算（固定间隔 / 均匀铺开），保持不变，旧测试继续钉着
 *   scheduler.mjs = 新的一层：窗口制、抖动、额度闸、退避熔断、下一轮文案
 *
 * 为什么再拆一层：老函数是「给一组参数算一串秒数」，新规则要吃状态
 * （今天刷了几轮、连败几次、还剩多少额度、有没有暂停），混进去会把
 * 纯函数变成半个状态机。这里全部是纯函数，状态一律由调用方传入。
 *
 * 三条硬规矩：
 *   1. 抖动必须**按天稳定**：tick 每 10 分钟跑一次，如果每次重算出来的点会飘，
 *      就会出现「这一轮永远等不到」或「同一轮刷两次」。所以随机源是 hash(day+index)。
 *   2. 额度用完 = 跳过，但**不消耗轮次**：额度明天回来时这一轮还得能刷。
 *   3. 熔断只停「刷视频」这种幂等的只读动作；发布/发送这类非幂等动作不自动重试。
 * ============================================================================
 */
import { slots, dayKey } from './schedule.mjs'

export const DAY_SEC = 86400
export const JITTER_RATIO = 0.15
export const JITTER_CAP_MIN = 45
export const MIN_GAP_MIN = 45
export const BREAK_AFTER = 6
export const MAX_WINDOWS = 6

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const int = (v, d) => (Number.isFinite(Number(v)) ? Math.floor(Number(v)) : d)

/** '09:30' / '9' / 9 / 32400 都收，统一成当天秒数。坏值退回默认。 */
export function clockSec(v, dflt = 0) {
	if (v == null || v === '') return dflt
	const s = String(v).trim()
	const m = /^(\d{1,2}):(\d{2})$/.exec(s)
	if (m) return clamp(Number(m[1]) * 3600 + Number(m[2]) * 60, 0, DAY_SEC - 1)
	const n = Number(s)
	if (!Number.isFinite(n)) return dflt
	if (n > 24) return clamp(Math.round(n), 0, DAY_SEC - 1) // 已经是秒
	return clamp(Math.round(n * 3600), 0, DAY_SEC - 1) // 小时（可带小数）
}

/** 秒数 → HH:MM（24 小时制，用于「下一轮 15:32」这类文案）。 */
export function formatClock(sec) {
	const s = clamp(Math.round(Number(sec) || 0), 0, DAY_SEC - 1)
	const p = (x) => String(x).padStart(2, '0')
	return p(Math.floor(s / 3600)) + ':' + p(Math.floor((s % 3600) / 60))
}

const secOfDay = (now) => {
	const d = new Date(now)
	if (Number.isNaN(d.getTime())) return 0
	return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()
}

/**
 * 配置归一化。新配置 scanWindows 优先；没配就由老字段映射成「一个窗口」。
 * 老配置只读映射，不回写 —— 用户什么都不改，行为和以前一致（只是多了抖动）。
 * @returns {{mode:'windows'|'legacy', windows:Array<{from:number,to:number,times:number,everyMin?:number}>}}
 */
export function normalizeWindows(settings = {}) {
	const raw = settings && settings.scanWindows
	if (Array.isArray(raw) && raw.length) {
		const out = raw.slice(0, MAX_WINDOWS).map((w) => ({
			from: clockSec(w && w.from, 9 * 3600),
			to: clockSec(w && w.to, 22 * 3600),
			times: clamp(int(w && w.times, 0), 0, 12),
			enabled: !w || w.enabled !== false,
		})).filter((w) => w.enabled && w.to > w.from && w.times > 0)
		if (out.length) return { mode: 'windows', windows: out }
	}
	const rounds = clamp(int(settings && settings.scanRounds, 3), 0, 12)
	const from = clockSec(settings && settings.scanFrom, 9 * 3600)
	const to = clamp(clockSec(settings && settings.scanTo, 22 * 3600), from + 60, DAY_SEC)
	return {
		mode: 'legacy',
		windows: [{
			from, to, times: rounds,
			everyMin: clamp(int(settings && settings.scanEveryMin, 240), 0, 1440),
		}],
	}
}

/** 未经抖动的原始点位（当天秒数，已排序）。 */
export function basePoints(settings = {}) {
	const { mode, windows } = normalizeWindows(settings)
	const out = []
	for (const w of windows) {
		if (mode === 'legacy' && w.everyMin > 0) {
			// 老语义：首轮 after 开始时间，之后每 everyMin 分钟一轮
			const pts = slots(w.times, w.from / 3600, w.to / 3600, w.everyMin)
			out.push(...pts)
			continue
		}
		// 新语义（含老配置 everyMin=0 的均匀铺开）：窗口内每段取中点
		const span = w.to - w.from
		for (let i = 0; i < w.times; i++) {
			const at = w.from + (span * (i + 0.5)) / w.times
			if (at >= w.to) break
			out.push(Math.round(at))
		}
	}
	return out.filter((x) => Number.isFinite(x) && x >= 0 && x < DAY_SEC).sort((a, b) => a - b)
}

/** 稳定的 [-1,1] 伪随机，输入是字符串。不用 Math.random：tick 重算必须得同一个数。 */
const hash01 = (s) => {
	let h = 2166136261
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i)
		h = Math.imul(h, 16777619)
	}
	return ((h >>> 0) / 4294967295) * 2 - 1
}

const medianGap = (pts) => {
	if (pts.length < 2) return 240 * 60
	const g = []
	for (let i = 1; i < pts.length; i++) g.push(pts[i] - pts[i - 1])
	g.sort((a, b) => a - b)
	return g[Math.floor(g.length / 2)] || 240 * 60
}

/**
 * 给点位加抖动并强制最小间隔。
 * @returns {{points:number[], spreadMin:number, gapSec:number}}
 */
export function jitterPoints(points = [], day = '') {
	const base = [...points].filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
	if (!base.length) return { points: [], spreadMin: 0, gapSec: 240 * 60 }
	const gapSec = medianGap(base)
	const amp = Math.min(Math.round(gapSec * JITTER_RATIO), JITTER_CAP_MIN * 60)
	const moved = base.map((x, i) => clamp(x + Math.round(hash01(day + ':' + i) * amp), 0, DAY_SEC - 1))
		.sort((a, b) => a - b)
	// 两个窗口相邻时可能挤到一起：至少隔开 MIN_GAP_MIN，否则等于连着刷两轮
	const minGap = MIN_GAP_MIN * 60
	for (let i = 1; i < moved.length; i++) {
		if (moved[i] - moved[i - 1] < minGap) moved[i] = Math.min(DAY_SEC - 1, moved[i - 1] + minGap)
	}
	return { points: moved, spreadMin: Math.round(amp / 60), gapSec }
}

/** 今天完整的点位计划。同一天、同一份配置，永远得到同一个结果。 */
export function planDay(settings = {}, now = Date.now()) {
	const day = dayKey(now)
	const base = basePoints(settings)
	const j = jitterPoints(base, day)
	return {
		day,
		mode: normalizeWindows(settings).mode,
		windows: normalizeWindows(settings).windows,
		base,
		points: j.points,
		spreadMin: j.spreadMin,
		gapSec: j.gapSec,
	}
}

/** 连续失败 → 退避档位。只读，不落盘。 */
export function backoff(failures = 0, gapSec = 240 * 60) {
	const n = Math.max(0, int(failures, 0))
	if (n >= BREAK_AFTER) {
		return { level: 'stop', factor: 1, delaySec: 0, label: '连续失败 ' + n + ' 次，停到明天' }
	}
	if (n >= 3) return { level: 'warn', factor: 4, delaySec: 3 * gapSec, label: '连续失败 ' + n + ' 次，延后 4 倍' }
	if (n >= 1) return { level: 'slow', factor: 2, delaySec: gapSec, label: '连续失败 ' + n + ' 次，延后 2 倍' }
	return { level: 'ok', factor: 1, delaySec: 0, label: '' }
}

/**
 * 现在该做什么。
 * @param {object}   o
 * @param {number}   o.now        当前毫秒（测试可注入）
 * @param {object}   o.plan       planDay() 的结果
 * @param {number}   o.done       今天已完成的轮次
 * @param {number}   o.failures   连续失败次数
 * @param {number|null} o.quotaLeft 今日剩余消息额度；null = 不检查
 * @param {boolean}  o.paused     暂停开关（STOP 文件）
 * @returns {{action:string, reason:string, index:number, nextIn:number, nextAt:number, label:string, level:string}}
 */
export function decide({ now = Date.now(), plan = null, done = 0, failures = 0, quotaLeft = null, paused = false } = {}) {
	const secs = secOfDay(now)
	const p = plan || { points: [], spreadMin: 0, gapSec: 240 * 60 }
	const pts = Array.isArray(p.points) ? p.points : []
	const b = backoff(failures, p.gapSec)
	const mk = (action, reason, extra = {}) => ({
		action, reason, index: -1, nextIn: 0, nextAt: 0,
		label: '', level: b.level, spreadMin: p.spreadMin || 0, ...extra,
	})

	if (paused) return mk('pause', '已暂停（STOP）', { level: 'warn' })
	if (b.level === 'stop') return mk('stop', b.label, { level: 'stop' })
	if (quotaLeft != null && Number(quotaLeft) <= 0) {
		return mk('skip-quota', '今日消息额度已用完，跳过这一轮（不消耗轮次）', { level: 'warn' })
	}
	if (!pts.length) return mk('idle', '今天没有安排刷视频', { level: 'ok' })

	const i = clamp(int(done, 0), 0, pts.length)
	if (i >= pts.length) return mk('done', '今天的轮次都刷完了')

	const at = clamp(pts[i] + b.delaySec, 0, DAY_SEC - 1)
	const nextIn = Math.max(0, at - secs)
	const label = '下一轮 ' + formatClock(at) + (p.spreadMin ? '（±' + p.spreadMin + ' 分钟）' : '')
	if (nextIn > 0) return mk('wait', '', { index: i, nextIn, nextAt: at, label })
	return mk('run', b.label || '', { index: i, nextIn: 0, nextAt: at, label })
}
