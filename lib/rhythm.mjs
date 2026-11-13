/**
 * lib/rhythm.mjs —— 回复前的那几秒，和偶尔的不回。
 *
 * 为什么（2026-11-13）：机器人是 0 毫秒回复；人是先看见、想一想、再打。
 * 另外真人会漏看：非 @ 场景下留 3% 不回，比每条都回更像人。
 *
 * 不引入随机源以外的依赖；测试里传 rng 就能确定性复现。
 */

/** 按字数估打字时间：基础 1.2s + 每字 0.12s，夹在 2–6s */
export function typingMs(text) {
	const n = String(text == null ? '' : text).replace(/\s+/g, '').length
	const ms = 1200 + n * 120
	return Math.max(2000, Math.min(6000, Math.round(ms)))
}

/**
 * @param {string} text
 * @param {{rng?:()=>number, skipRate?:number, important?:boolean}} [opts]
 *        important = 被 @、私信主人这类不能漏的场合，永不跳过
 * @returns {{delayMs:number, skip:boolean, reason:string}}
 */
export function humanDelay(text, opts = {}) {
	/* 测试/自检里不想真等：DOUYIN_STUDIO_FAST=1 直接 0 延迟、不跳过 */
	if (String(process.env.DOUYIN_STUDIO_FAST || '') === '1') return { delayMs: 0, skip: false, reason: 'fast' }
	const rng = typeof opts.rng === 'function' ? opts.rng : Math.random
	const skipRate = Math.max(0, Math.min(0.2, Number.isFinite(opts.skipRate) ? opts.skipRate : 0.03))
	if (!opts.important && rng() < skipRate) return { delayMs: 0, skip: true, reason: 'missed' }
	return { delayMs: typingMs(text), skip: false, reason: 'typing' }
}
