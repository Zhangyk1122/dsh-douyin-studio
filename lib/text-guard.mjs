/**
 * lib/text-guard.mjs —— 出站正文的类型闸（2026-11-07，0.4.6）
 * ============================================================================
 * 事故：2026-11-07T12:59:45Z 有一条发给主人的私信，正文是 `[object Object]`。
 * JS 里只有"对象被 String()/模板串拼接"才会产生这串；也就是说某个调用点把对象
 * 当正文塞了进来，而链路上没人检查类型，**发出去之后**才看得见。
 *
 * 这一版是**观察模式**，不是拦截：
 *   - `typeof v === 'string'` → 原样通过；
 *   - 其它类型 → 记下 `rawType`（object / number / array / null …），照旧转成字符串发，
 *     但返回值里带 `rawType`，`autopilot-log.jsonl` 与面板上都看得到。
 * 想真的拦，设环境变量 `DOUYIN_STUDIO_TEXT_GUARD=block`（观察够一天再开）。
 * 为什么不一步到位拒发：老链路上可能真有"靠隐式转字符串"才活着的调用点，
 * 一刀切会在半夜把日报变成失败，那比 `[object Object]` 更难查。
 */

/** 开关：'block' 才拦；其它（含未设）都是观察模式。 */
export const GUARD_ENV = 'DOUYIN_STUDIO_TEXT_GUARD'

/** 类型名（比 typeof 多分 null / array，日志里一眼能认） */
export function rawTypeOf(v) {
	if (v === null) return 'null'
	if (Array.isArray(v)) return 'array'
	return typeof v
}

/**
 * 过一遍类型闸。
 * @param {unknown} v 待发正文
 * @param {string} [where] 来源标记（写进日志，便于定位是哪条链）
 * @returns {{ok:boolean, text:string, rawType:string, blocked:boolean, where:string, error?:string}}
 */
export function guardText(v, where = '') {
	const rawType = rawTypeOf(v)
	const tag = String(where || '')
	if (typeof v === 'string') return { ok: true, text: v, rawType, blocked: false, where: tag }
	let text = ''
	try { text = v === null || v === undefined ? '' : String(v) } catch { text = '' }
	const blocking = String(process.env[GUARD_ENV] || '').toLowerCase() === 'block'
	return {
		ok: !blocking,
		text,
		rawType,
		blocked: blocking,
		where: tag,
		...(blocking ? { error: `正文不是字符串（rawType=${rawType}），已拦下不发送` } : {}),
	}
}
