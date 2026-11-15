/**
 * lib/tok.mjs —— 中文二元切分 + 英文数字按词（零依赖）
 * ============================================================================
 * 给需要「按意思搜一小堆本地数据」的模块用（第一个是表情包语义检索）。
 * 中文没有空格，整句当一个词等于没法搜；二元切分是这类场景最便宜的解法
 * （aurabot 的记忆库也是同一招：中文二元切词 + BM25）。
 */
/**
 * 切词。
 * - 英文/数字：按连续段整词（`deepseek` → `deepseek`）
 * - 中文：二元滑窗（`大肥鱼` → `大肥`、`肥鱼`；单字段落原样保留）
 * - 其余字符（标点/emoji/空白）丢弃
 * @param {string} text
 * @returns {string[]} 小写化后的词数组（不去重，BM25 要词频）
 */
export function tokenize(text) {
	const s = String(text == null ? '' : text).toLowerCase()
	const words = s.match(/[a-z0-9]+/g) || []
	const cjk = s.match(/[\u4e00-\u9fff]+/g) || []
	const bigrams = []
	for (const seg of cjk) {
		if (seg.length === 1) { bigrams.push(seg); continue }
		for (let i = 0; i + 1 < seg.length; i++) bigrams.push(seg.slice(i, i + 2))
	}
	return [...words, ...bigrams]
}
