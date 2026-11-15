/**
 * lib/comment-filter.mjs —— 哪些评论值得回，哪些回了只是给自己添堵。
 *
 * 抄的是 aurabot 的 `chat/group-policy.js`：那边「什么时候必回、什么时候插话、
 * 什么时候闭嘴」是**先判后说**；dy 这边以前是「抓到就生成、生成就发」，
 * 于是抽奖号、互关号、纯表情都会认真回一句 —— 既烧额度，也像机器人。
 *
 * 这里只做减法：能不能不回。判断依据全是**文本本身**，不猜人、不看粉丝数。
 * 拿不准的一律放行（宁可多回一句，也别把真人当广告）。
 */

/** 广告 / 拉人 / 引流：出现就跳过。 */
const SPAM = [
	/互关/, /互粉/, /求关注/, /回关/, /点我主页/, /主页有惊喜/, /看我简介/,
	/加\s*(微|v|V|威信|微信|qq|QQ)/, /私信我/, /代刷/, /刷赞/, /刷粉/,
	/兼职/, /日赚/, /躺赚/, /带赚/, /收徒/, /招代理/, /一手货源/,
	/https?:\/\//i, /www\./i, /\.(com|cn|net|top|xyz)\b/i,
	/优惠券/, /领券/, /红包群/, /进群/,
]

/** 纯凑热闹：只有这些词、没有信息量。 */
const EMPTY = [/^(6+|666+|888+|1+|0+)$/, /^(第一|沙发|板凳|前排|打卡|路过|来了|dd|DD)$/]

/**
 * 「别来 / 别刷 / 别蹭 / 不用回」—— 他在明说不要回应。
 * 回了就是没听懂，而且是当着所有人的面没听懂。
 * 宁可误判一条（少回一句），也不要在这种句子下面接话。
 */
const DECLINE = [
	/别(来|刷|蹭|回|评论|at|At|AT|@)/, /不用回/, /不要回/, /别回复/, /勿回/, /无需回/, /不必回/,
	/少来/, /闭嘴/, /滚(开|远|粗)/,
]

/** 纯表情 / 纯标点 / 纯表情文字符 */
const NOISE_ONLY = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s\p{P}\p{S}\p{M}]+$/u

const short = (v, n = 24) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n)

/**
 * 判断一条评论要不要回。
 * @param {{text?:string}} c
 * @returns {{reply:boolean, why:string}}
 */
export function judgeComment(c = {}) {
	const raw = String(c.text || '').trim()
	if (!raw) return { reply: false, why: '空评论' }
	if (NOISE_ONLY.test(raw)) return { reply: false, why: '只有表情/符号' }
	/* 去掉表情和空白后还剩几个字：只剩一两个字的多半是「打卡」「来了」 */
	const bare = raw.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\s\p{P}\p{S}\p{M}]/gu, '')
	if (!bare) return { reply: false, why: '只有表情/符号' }
	for (const re of DECLINE) if (re.test(raw)) return { reply: false, why: '他说了别回：' + short(raw) }
	for (const re of SPAM) if (re.test(raw)) return { reply: false, why: '广告/引流：' + short(raw) }
	for (const re of EMPTY) if (re.test(bare)) return { reply: false, why: '凑热闹：' + short(raw) }
	if (bare.length < 2) return { reply: false, why: '太短，没话可接：' + short(raw) }
	return { reply: true, why: '' }
}

/** 同一句话被刷了很多遍（「好看」「好看」「好看」）——只留第一条。 */
export function dedupeByText(list = []) {
	const seen = new Set()
	const out = []
	for (const c of list) {
		const key = String((c && c.text) || '').replace(/\s+/g, '').slice(0, 40)
		if (key && seen.has(key)) continue
		if (key) seen.add(key)
		out.push(c)
	}
	return out
}
