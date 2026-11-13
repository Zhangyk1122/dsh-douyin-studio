/**
 * 设置自洽校验：只报「这组数摆在一起会互相抵消」的情况，不改值。
 *
 * 典型：每天 20 条 ÷ 每轮 2 条 = 10 轮，但每天只跑 2 轮 → 日上限是空头支票；
 * 或者条数 ÷ 间隔算出来的频率已经高到像机器。
 */

const num = (v, d = 0) => {
	const n = Number(v)
	return Number.isFinite(n) ? n : d
}

export const HIGH_PER_DAY = 24

export function checkSettings(s = {}) {
	const out = []
	const perDay = num(s.perDay ?? s.commentPerDay ?? 20, 20)
	const perRun = num(s.replyMaxPerRound ?? s.maxPerRun ?? 2, 2)
	const rounds = num(s.scanRounds ?? 2, 2)
	const everyMin = num(s.dutyEveryMin ?? 30, 30)

	if (perDay > 0 && rounds > 0 && perRun > 0) {
		const canDo = perRun * rounds
		if (canDo < perDay) {
			out.push({
				level: 'warn',
				field: 'perDay',
				msg: `每天上限 ${perDay} 条，但每轮 ${perRun} 条 × ${rounds} 轮 = ${canDo} 条，上限吃不到；要么加轮次，要么把上限改成 ${canDo}。`,
			})
		}
	}
	if (perDay > HIGH_PER_DAY) {
		out.push({ level: 'warn', field: 'perDay', msg: `每天 ${perDay} 条偏多（参考：>24 条/天 ≈ 每 12 分钟一条，容易像机器）。` })
	}
	if (everyMin > 0 && perDay > 0) {
		const gapMin = (24 * 60) / perDay
		if (gapMin < everyMin) {
			out.push({
				level: 'info',
				field: 'dutyEveryMin',
				msg: `按每天 ${perDay} 条算，平均 ${Math.round(gapMin)} 分钟一条，比每轮 ${everyMin} 分钟的节拍还密，实际会被轮次限制。`,
			})
		}
	}
	if (num(s.quietFrom ?? -1) >= 0 && num(s.quietTo ?? -1) >= 0) {
		const from = num(s.quietFrom)
		const to = num(s.quietTo)
		if (from === to) out.push({ level: 'error', field: 'quiet', msg: '静音开始和结束是同一个点，等于没静音。' })
	}
	return out
}

export const hasBlocker = (list) => (list || []).some((x) => x.level === 'error')
