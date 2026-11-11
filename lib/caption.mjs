/**
 * lib/caption.mjs —— 别人的文案，先洗干净再用
 * ============================================================================
 * 2026-11-11 真机上发出去的这条：
 *   「@辰辰辰chen 这条我觉得你会喜欢：#丁达尔之境 #Muse强大的Muse，Muse好」
 * 不是她懒，是生成失败后退回了「模板 + 原文案」，而原文案里全是话题标签和别人的句子。
 *
 * 两条规矩：
 *   1. 给她看的材料先去标签 / @ / 链接——她该理解内容，不是搬运；
 *   2. 她写出来的东西如果和原文案高度重合，就当没写（照抄比不写更像机器）。
 * ============================================================================
 */

const URL_RE = /https?:\/\/\S+/g
const TAG_RE = /#[^\s#，。！？、,.!?：:；;）)」』"']{1,30}/g
const AT_RE = /@[^\s@]{1,24}/g
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu

/** 去掉话题、@、链接、表情与零宽字符，压成一行。 */
export function cleanCaption(v, max = 160) {
	const s = String(v == null ? '' : v)
		.replace(URL_RE, ' ')
		.replace(TAG_RE, ' ')
		.replace(AT_RE, ' ')
		.replace(EMOJI_RE, ' ')
		.replace(/[\u200b-\u200f\ufeff]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
	return s.slice(0, max)
}

/** 原文案里的话题词（只给她当背景，不拼进回复）。 */
export function topicsOf(v) {
	const out = []
	for (const m of String(v == null ? '' : v).matchAll(TAG_RE)) {
		const t = m[0].slice(1).trim()
		if (t && !out.includes(t)) out.push(t)
	}
	return out.slice(0, 5)
}

const flat = (v) => String(v == null ? '' : v).replace(/[\s\p{P}\p{S}]/gu, '')

/**
 * 是不是在照抄。判据偏保守：只有「几乎逐字包含」才算，避免把正常引用误杀。
 * @param {string} text 她写的
 * @param {string} source 原文案
 */
export function looksCopied(text, source) {
	const a = flat(text)
	const b = flat(source)
	if (a.length < 8 || b.length < 8) return false
	if (b.includes(a)) return true
	// 长句里截一段比对：抄了一半也算抄
	const probe = a.slice(0, Math.min(16, a.length))
	return probe.length >= 8 && b.includes(probe)
}

/** 生成失败时的退路：都是她自己的话，一个字都不搬原文。 */
export const AT_FALLBACKS = [
	'刚刷到这条，第一反应是你也会喜欢',
	'这条我看了两遍，觉得该叫你来',
	'不知道你会不会喜欢，但我想到你了',
]

export const DM_FALLBACKS = [
	'这条我看了两遍，想给你看看',
	'刚刷到的，觉得你会喜欢',
	'看到这个就想到你了',
]

/** 轮换取一条（按天+序号，避免同一句连着出现）。 */
export function rotate(list, seed = Date.now()) {
	if (!Array.isArray(list) || !list.length) return ''
	const i = Math.abs(Math.floor(Number(seed) / 1000)) % list.length
	return list[i]
}