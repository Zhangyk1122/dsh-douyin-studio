/**
 * lib/text-guard.mjs —— 出站正文的类型闸（2026-11-07，0.4.6）
 * ============================================================================
 * 事故：2026-11-07T12:59:45Z 有一条发给主人的私信，正文是 `[object Object]`。
 * JS 里只有"对象被 String()/模板串拼接"才会产生这串；也就是说某个调用点把对象
 * 当正文塞了进来，而链路上没人检查类型，**发出去之后**才看得见。
 *
 * 2026-11-08（0.4.7）起**默认拦截**：
 *   - `typeof v === 'string'` → 原样通过；
 *   - 其它类型 → `ok:false`，带 `rawType` 与错误文案，调用方拒发。
 * 为什么翻成默认拦：观察模式上线一天，`[object Object]` 的来源已经查清（`index.js`
 * 把 `generate()` 的 `{ok,text}` 整体 `String()` 了），闸门再不拦就只是记账。
 * 万一还有老链路靠隐式转字符串活着，设 `DOUYIN_STUDIO_TEXT_GUARD=observe` 退回记账模式。
 */

/** 开关：默认拦；设 'observe' / 'off' / '0' / 'false' 才退回观察模式。 */
export const GUARD_ENV = 'DOUYIN_STUDIO_TEXT_GUARD'

const OBSERVE = new Set(['observe', 'off', '0', 'false', 'warn'])

/**
 * 当前闸门模式。
 * @returns {'block'|'observe'} 未设或设了别的值都是 block
 */
export function guardMode() {
	return OBSERVE.has(String(process.env[GUARD_ENV] || '').toLowerCase().trim()) ? 'observe' : 'block'
}

/**
 * 从「可能被包成对象」的模型返回值里取正文。
 * `lib/duty.mjs` 的 `generate()` 返回 `{ok, text}`；早先 `String(await generate(...))`
 * 直接把它变成 `[object Object]`（2026-11-07T12:59:45Z 那条私信事故）。
 * 取不到就给空串，交给调用方兜底 —— **绝不返回 `[object Object]`**。
 * @param {unknown} v 模型返回值（string 或 {text|say|content|reply}）
 * @param {{fields?: string[]}} [opts] 依次尝试的字段名
 * @returns {string} 正文；取不到为空串
 */
export function textOfResult(v, { fields = ['text', 'say', 'content', 'reply'] } = {}) {
	if (typeof v === 'string') return v
	if (!v || typeof v !== 'object') return ''
	for (const k of fields) {
		const x = v[k]
		if (typeof x === 'string' && x.trim()) return x
	}
	return ''
}

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
	const blocking = guardMode() === 'block'
	return {
		ok: !blocking,
		text,
		rawType,
		blocked: blocking,
		mode: blocking ? 'block' : 'observe',
		where: tag,
		...(blocking ? { error: `正文不是字符串（rawType=${rawType}），已拦下不发送` } : {}),
	}
}
