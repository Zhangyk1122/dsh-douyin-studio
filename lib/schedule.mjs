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

/** 一天里均匀铺开的几个点。rounds=0 就是关；from/to 用整点，to 不含。 */
export function slots(rounds, from, to) {
  const n = Math.floor(Number(rounds) || 0)
  if (n <= 0) return []
  const a = Math.max(0, Math.min(23, Math.floor(Number(from) || 0)))
  const b = Math.max(a + 1, Math.min(24, Math.floor(Number(to) || 24)))
  const span = b - a
  const count = Math.min(n, SCAN_MAX_ROUNDS, span * 4)
  const out = []
  for (let i = 0; i < count; i++) {
    // 落在每段的中间，别卡在整点上（整点刷跟别人撞车）
    const hour = a + (span * (i + 0.5)) / count
    out.push(Math.round(hour * 3600))
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
  const pts = slots(plan && plan.rounds, plan && plan.from, plan && plan.to)
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
