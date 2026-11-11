/**
 * lib/at-text.mjs —— 评论区 @ 的那半句话
 * ============================================================================
 * 2026-11-11 真机发出去的是：「@辰辰辰chen 这条我觉得你会喜欢：#丁达尔之境 #Muse…」
 * —— 生成失败后退回了「模板 + 原文案」，标签一起带上去了。
 *
 * 现在：材料先洗（去标签/@/链接），要求她用自己的话说，
 * 写完再查一遍是不是照抄；抄了就当没写，退回她自己的话（不搬原文一个字）。
 * ============================================================================
 */
import { AT_FALLBACKS, cleanCaption, looksCopied, rotate, topicsOf } from './caption.mjs'

/**
 * @param {{desc?: string, st?: object, timeoutMs?: number, now?: number}} opts
 * @returns {Promise<{text: string, why: string, caption: string, topics: string[]}>}
 */
export async function composeAtText({ desc = '', st = {}, timeoutMs = 45000, now = Date.now() } = {}) {
	const caption = cleanCaption(desc, 200)
	const topics = topicsOf(desc)
	let text = ''
	let why = ''
	try {
		const { generate } = await import('./duty.mjs')
		const { personaLine } = await import('./settings.mjs')
		const { textOfResult } = await import('./text-guard.mjs')
		const scene = [
			'你在抖音刷到这条，想 @ 主人来看。',
			'视频文案：' + (caption || '（这条没写文案）'),
			...(topics.length ? ['它挂着的话题（只当背景，一个字都别照搬）：' + topics.join('、')] : []),
			'写一句给他看的话：说清为什么想让他看，别用问号收尾，别提 AI，别用「快来看」这种吆喝。',
			'用你自己的话说这条里你看到了什么；不要照抄文案原句，不要写话题标签，不要复述标题。',
			'不要自己写 @ 昵称 —— 系统会在最前面加 @，你只写后面那半句。',
		].join('\n')
		const g = await generate(scene, { system: personaLine(st), timeout: timeoutMs, maxTokens: 90 })
		text = textOfResult(g)
			.replace(/^\s*@\S+\s*/, '')
			.replace(/#[^\s#]+/g, '')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 60)
		if (text && looksCopied(text, caption)) {
			why = 'copied'
			text = ''
		}
	} catch {
		text = ''
	}
	if (!text) {
		why = why || 'gen-failed'
		text = rotate(AT_FALLBACKS, now)
	}
	return { text, why, caption, topics }
}