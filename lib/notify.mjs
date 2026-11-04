/**
 * lib/notify.mjs —— 今天还该不该叫你
 * ============================================================================
 * 只回答一个问题：**现在弹一条消息，是帮他还是在烦他。**
 *
 * 三档，不是一个开关（NN/g 的 layered disclosure）：
 *   入库  score ≥ 0.40 —— 只进候选库，不打扰，**不占额度**
 *   @ 你  score ≥ 0.75 —— 占 1 次
 *   私信  score ≥ 0.90 且你最近 24h 主动搜过同类 —— 占 1 次，最贵
 *
 * 「沉默也是信息」：几天没东西可叫，就照实说"没有值得叫你的"，
 * 不许为了显得尽职而硬凑一条 —— 那比不发更糟。
 *
 * 这里全是纯函数：没有 IO、没有时间副作用（时间由调用方算好传进来）。
 * 真正弹窗在 lib/toast.mjs，两件事分开，测试才能只测"该不该"。
 * ============================================================================
 */

/** 入库线：只看，不叫人。 */
export const INGEST = 0.4
/** @ 线 */
export const AT = 0.75
/** 私信线（还要满足"你最近在找同类"） */
export const DM = 0.9

const RANK = { none: 0, at: 1, dm: 2 }

/**
 * 今天还该不该叫你。
 * @param {{items?:object[], calledToday?:number, perDay?:number, maxTier?:'none'|'at'|'dm',
 *          searchedRecently?:boolean, quiet?:boolean}} o
 * @returns {{ok:boolean, tier:'none'|'at'|'dm', why:string, score:number, ingested:number}}
 */
export const allowNotify = ({
	items = [], calledToday = 0, perDay = 2, maxTier = 'at',
	searchedRecently = false, quiet = false,
} = {}) => {
	const scores = (Array.isArray(items) ? items : [])
		.map((x) => Number(x && x.score))
		.filter((s) => Number.isFinite(s))
	const ingested = scores.filter((s) => s >= INGEST).length
	const score = scores.length ? Math.max(...scores) : 0
	const out = (ok, tier, why) => ({ ok, tier, why, score, ingested })

	if (quiet) return out(false, 'none', '现在是静音时段')
	if (perDay <= 0 || maxTier === 'none') return out(false, 'none', '你设成了只入库、不打扰')
	if (calledToday >= perDay) return out(false, 'none', `今天已经叫过 ${calledToday} 次`)

	/* 私信最贵，所以它要求"你最近确实在找这一类"，而不是光分数高。 */
	let want = 'none'
	if (score >= DM && searchedRecently) want = 'dm'
	else if (score >= AT) want = 'at'
	if (RANK[want] > RANK[maxTier]) want = maxTier

	if (want === 'none') {
		return out(false, 'none', ingested ? `有 ${ingested} 条进库，没到叫你的线` : '没有过线的候选')
	}
	return out(true, want, `这条 ${score.toFixed(2)}，值得看一眼`)
}

/**
 * 「沉默也是信息」：连续几天没叫你，就在「今天」卡里照实写一句。
 * @param {{silentDays?:number, fresh?:number}} o
 */
export const silentNote = ({ silentDays = 0, fresh = 0 } = {}) =>
	(silentDays >= 3 && fresh > 0 ? `这三天没有值得叫你的，刷了 ${fresh} 条` : '')
