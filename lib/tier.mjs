/**
 * 「叫一下主人」走哪条路：私信卡片（dm）还是评论区 @（at）。
 *
 * 以前是「私信优先」：`shareLeft > 0 ? 'dm' : 'at'`。因为每天只扫两轮、
 * 而私信额度是 2，`shareLeft` 每一轮都 > 0 —— @ 那条分支永远轮不到，
 * 设置里的 `autoAt` / `atPerDay` 等于摆设（notify-state 里 at 长期是 0）。
 *
 * 现在改成「每天第一轮走 @，之后走私信」：
 *   - 两个出口各自还有额度时才计数，不超额；
 *   - 一天至少有一次 @，私信也不会被 @ 挤干净；
 *   - 不引入新的配额概念，只是把两条路的先后顺序换一下。
 *
 * @param {{shareLeft:number, atLeft:number, usedAt:number}} v
 * @returns {'at'|'dm'|''}
 */
export function pickTier(v) {
	const shareLeft = Math.max(0, Number(v && v.shareLeft) || 0)
	const atLeft = Math.max(0, Number(v && v.atLeft) || 0)
	const usedAt = Math.max(0, Number(v && v.usedAt) || 0)
	/* 欠账优先（抄 aurabot 的 purpose 思路：今天该做没做的，晚一点也得补）：
	 * 20 点以后还没 @ 过，就别再拿私信把这一天糊过去了——
	 * 以前第一轮若被窗口/失败挡掉，`usedAt` 一直是 0、但 shareLeft 还有，于是永远走 dm。 */
	const hour = Number(v && v.hour)
	if (atLeft > 0 && usedAt === 0 && Number.isFinite(hour) && hour >= 20) return 'at'
	if (atLeft > 0 && usedAt === 0) return 'at'
	if (shareLeft > 0) return 'dm'
	if (atLeft > 0) return 'at'
	return ''
}
