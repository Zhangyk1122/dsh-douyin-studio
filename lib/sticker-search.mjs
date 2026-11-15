/**
 * lib/sticker-search.mjs —— 表情包的「语义」检索：零依赖 BM25
 * ============================================================================
 * 为什么（2026-11-15，调研 D4 的 A 档剩余）：
 *   规则挑图（心情命中 + 标签命中 + 冷却降权）的天花板在于「标签是人写的」。
 *   「她发了一句『今天加班到两点』，库里哪张接得住」这种事，规则答不了，
 *   语义检索可以：把对方那句话当查询，去搜每张图的「名字/心情/标签/什么时候用」。
 *
 * 为什么是 BM25 不是向量：
 *   ① 仓库零依赖是验收项（check 第③条），引 embedding 库直接破功；
 *   ② 表情包库是几十张的规模，BM25 在这个量级上和向量没差；
 *   ③ 中文没有空格——按二元切分（bigram），和 aurabot 记忆库同一招，
 *      「加班」切成「加班」一个词、「加到两点」切成 加到/到两/两点，召回够用。
 *
 * 这个模块只算分，不挑决策：分数并进 rankStickers 的总分（归一化后），
 * 心情/标签/冷却的原有权重不变——语义是加成，不是取代。
 */
import { tokenize as _tok } from './tok.mjs'

/** 一张图的检索文档：名字/心情/标签/什么时候用。 */
export const docOf = (it) => [it && it.name, it && it.mood, ...((it && it.tags) || []), it && it.when]
	.filter(Boolean).join(' ')

/**
 * BM25 排序。分数只用于排序，不展示、不持久化。
 * @param {Array<object>} items 表情包库条目（至少有 id）
 * @param {string} query 想表达的意思（对方那句话 / 附言）
 * @param {{k1?:number, b?:number, limit?:number}} [o]
 * @returns {Array<{item:object, score:number}>} 只含有得分的，从高到低
 */
export function searchStickers(items, query, { k1 = 1.2, b = 0.75, limit = 20 } = {}) {
	const docs = (items || []).map((it) => _tok(docOf(it)))
	const q = [...new Set(_tok(query))]
	if (!q.length || !docs.length) return []
	const N = docs.length
	const df = new Map()
	for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1)
	const avgdl = docs.reduce((a, d) => a + d.length, 0) / N || 1
	const out = []
	for (let i = 0; i < items.length; i++) {
		const d = docs[i]
		const dl = d.length || 1
		let score = 0
		for (const t of q) {
			const n = df.get(t) || 0
			if (!n) continue
			const f = d.filter((x) => x === t).length
			if (!f) continue
			const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
			score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + (b * dl) / avgdl))
		}
		if (score > 0) out.push({ item: items[i], score: Math.round(score * 1000) / 1000 })
	}
	out.sort((a, c) => (c.score - a.score) || (a.item.used - c.item.used) || String(c.item.addedAt).localeCompare(String(a.item.addedAt)))
	return out.slice(0, Math.max(1, Number(limit) || 20))
}
