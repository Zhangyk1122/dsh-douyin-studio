/* 一天刷几轮 —— 落在哪个点上，由这里算。
 *
 * 为什么要拆出来：面板上有个「每天刷几轮」的数字，但没人真的在按它跑。
 * 之前只有「你点一下才刷」，于是"每天自动刷"其实是句空话。
 *
 * 这里只做纯计算，不碰浏览器、不碰文件：
 *   slots(rounds, from, to)  → 今天该刷的时间点（毫秒）
 *   dueAt(now, plan, done)   → 现在轮不轮到，轮到第几次
 * 状态（今天刷到第几轮了）由调用方存盘，这样这块能被单测钉死。
 */

export const SCAN_MAX_ROUNDS = 12

/** 窗口结束后还能补多久。给宽限是因为 tick 每 10 分钟一次 ——
 *  最后一轮卡在结束前几分钟时，别因为差一次 tick 就整轮丢掉。
 *  但不能无限宽限：设了「到 22 点」，就不该到 23:30 还去补刷一轮。 */
const WINDOW_GRACE_SEC = 30 * 60

/** from/to 的归一化（整点，to 不含）。slots 和 dueAt 用同一套，免得两处算岔。 */
const winOf = (from, to) => {
	const a = Math.max(0, Math.min(23, Math.floor(Number(from) || 0)))
	const b = Math.max(a + 1, Math.min(24, Math.floor(Number(to) || 24)))
	return { a, b }
}

/**
 * 一天里该刷的几个点。
 * - `everyMin > 0`：**首轮 after 开始时间，之后每 everyMin 分钟一轮**，过了结束时间就不刷了。
 *   这是「每轮结束之后隔多久下一轮」那个旋钮，最直观。
 * - `everyMin = 0`：退回均匀铺开（老行为，留着兜底）。
 * rounds=0 就是关；from/to 用整点，to 不含。
 */
export function slots(rounds, from, to, everyMin = 0) {
	const n = Math.floor(Number(rounds) || 0)
	if (n <= 0) return []
	const { a, b } = winOf(from, to)
	const span = b - a
  const count = Math.min(n, SCAN_MAX_ROUNDS)
  const gapMin = Math.max(0, Math.floor(Number(everyMin) || 0))
  const out = []
  if (gapMin > 0) {
    // 首轮错开几分钟，别在整点跟别人撞车
    const start = a * 3600 + Math.min(300, gapMin * 60 / 2)
    for (let i = 0; i < count; i++) {
      const at = start + i * gapMin * 60
      if (at >= b * 3600) break          // 撞到结束时间就收手
      out.push(Math.round(at))
    }
    return out
  }
  for (let i = 0; i < count; i++) {
    // 落在每段的中间，别卡在整点上（整点刷跟别人撞车）
    const hour = a + (span * (i + 0.5)) / Math.min(count, span * 4)
    out.push(Math.round(hour * 3600))
    if (i + 1 >= span * 4) break      // 窗口太窄就别硬塞（1 小时最多 4 轮）
  }
  return out
}

/** 每天的 day 键（本地时区）。跨零点要换天，所以统一走这里。 */
export function dayKey(now) {
  const d = new Date(now)
  if (Number.isNaN(d.getTime())) return ''
  const p = (x) => String(x).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

/**
 * 现在轮到第几轮？
 * done = 今天已经刷过几轮（跨天由调用方先清零）。
 * 返回 { due, index, next } —— index 是这次要刷的轮次下标，next 是下一轮的秒数。
 */
export function dueAt(now, plan, done) {
  const t = new Date(now)
  if (Number.isNaN(t.getTime())) return { due: false, index: -1, next: 0 }
	const secs = (t.getHours() * 60 + t.getMinutes()) * 60 + t.getSeconds()
	/* 先看窗口：结束时间之后（留 30 分钟宽限）就不再补了。
	 * 不判这一下，23:30 重启会把「9–22 点」的最后一轮补刷一遍 ——
	 * 用户设了「到 22 点结束」，插件却半夜去刷，等于设置没生效。 */
	const { b } = winOf(plan && plan.from, plan && plan.to)
	if (secs >= b * 3600 + WINDOW_GRACE_SEC) return { due: false, index: -1, next: 0 }
	const pts = slots(plan && plan.rounds, plan && plan.from, plan && plan.to, plan && plan.everyMin)
  const had = Math.max(0, Math.floor(Number(done) || 0))
  if (had >= pts.length) return { due: false, index: -1, next: 0 }
  // 已经过了的点里，最后一个还没刷的
  let idx = -1
  for (let i = had; i < pts.length; i++) {
    if (secs >= pts[i]) idx = i
    else break
  }
  const next = pts[had] > secs ? pts[had] - secs : 0
  if (idx < 0) return { due: false, index: -1, next }
  return { due: true, index: idx, next }
}
