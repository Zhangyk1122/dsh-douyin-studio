/**
 * lib/errors.mjs —— 分类错误模型
 * ============================================================================
 * 以前所有失败都长一个样：`{ ok:false, error:'一段话' }`，
 * 调用方分不清是「参数写错了」还是「登录态过期了」，也不知道下一步该干什么。
 *
 * 现在分五类，每类带 category + hint（下一步该做什么）：
 *   LOCAL   本地校验失败（参数不合法、文件不存在、尺寸不对）
 *   QUOTA   额度挡了（ledger 四道闸之一、一天 20 条、时段 5 条）
 *   CDP     浏览器层面挂了（连不上、标签页崩了、evaluate 超时）
 *   PAGE    页面变了（选择器找不到、布局变了、字段不匹配）
 *   REMOTE  接口层 403/429/500（被风控、被限流、服务端错误）
 *
 * 用法：
 *   import { StudioError } from './errors.mjs'
 *   throw new StudioError('LOCAL', '标题超长（35 > 30）', { hint: '缩短标题再试' })
 *
 *   catch (e) { return StudioError.wrap(e).toJSON() }
 *
 * 那些不动结构、只是加分类的旧代码可以用 `fromResult`：
 *   return fromResult({ ok:false, error:'imapi HTTP 403' }, 'REMOTE')
 * ============================================================================
 */

export const CATEGORIES = /** @type {const} */ (['LOCAL', 'QUOTA', 'CDP', 'PAGE', 'REMOTE'])

/** @typedef {'LOCAL'|'QUOTA'|'CDP'|'PAGE'|'REMOTE'} ErrCategory */

/**
 * @typedef {Object} StudioErrorJSON
 * @property {false} ok
 * @property {ErrCategory} category
 * @property {string} error
 * @property {string} [hint]
 * @property {Object} [detail]
 */

/**
 * @property {ErrCategory} category
 * @property {string} message
 * @property {string} [hint]
 * @property {Object} [detail]
 */
export class StudioError extends Error {
	/**
	 * @param {ErrCategory} category - 五类之一
	 * @param {string} message - 人能读的错误描述
	 * @param {{ hint?: string, detail?: Object }} [opts]
	 */
	constructor(category, message, opts = {}) {
		super(message)
		this.name = 'StudioError'
		this.category = category
		this.hint = opts.hint
		this.detail = opts.detail
	}

	/** 转成给工具层返回的 JSON（ok:false + category + error + hint） */
	toJSON() {
		/** @type {StudioErrorJSON} */
		const r = { ok: false, category: this.category, error: this.message }
		if (this.hint) r.hint = this.hint
		if (this.detail) r.detail = this.detail
		return r
	}

	/**
	 * 把一个普通 Error / { ok:false, error:... } 包成 StudioError。
	 * 已是 StudioError 的直接回（不降级分类）。
	 */
	static wrap(e, defaultCategory = 'CDP') {
		if (e instanceof StudioError) return e
		if (e && typeof e === 'object' && e.ok === false && e.error) {
			return new StudioError(
				/** @type {ErrCategory} */ (e.category || defaultCategory),
				String(e.error),
				{ hint: e.hint, detail: e.detail },
			)
		}
		const msg = String((e && e.message) || e || '未知错误')
		// 启发式猜分类
		const cat = guessCategory(msg, defaultCategory)
		return new StudioError(cat, msg)
	}
}

/**
 * 从一个旧式 `{ ok:false, error }` 结果转成带分类的 JSON。
 * 如果 result.ok === true 就原样返回。
 */
export function fromResult(result, category = 'CDP') {
	if (result && result.ok) return result
	if (!result || result.ok !== false) return { ok: false, category, error: '未知错误' }
	const err = StudioError.wrap(result, category)
	return err.toJSON()
}

/**
 * 启发式猜分类：看错误文本里有没有关键词。
 * 猜错不致命——调用方还能看 error 原文。
 */
function guessCategory(msg, fallback) {
	const l = msg.toLowerCase()
	if (/403|forbidden|风控|限流|429|rate.?limit|频发|retcode|ret_code/i.test(l)) return 'REMOTE'
	if (/quota|额度|回满了|回过了|楼|时段|今天.*条/i.test(msg)) return 'QUOTA'
	if (/标题|简介|文件|尺寸|不存在|超长|太短|参数|validate|校验/i.test(msg)) return 'LOCAL'
	if (/选择器|selector|找不到|页面.*变|元素|contenteditable|placeholder/i.test(msg)) return 'PAGE'
	if (/cdp|ws:|连接|timeout|超时|evaluate|spawn|enoent/i.test(l)) return 'CDP'
	return fallback
}

/**
 * 安全执行：try/catch 包一层，异常转 StudioError JSON。
 * @param {() => Promise<any>} fn
 * @param {ErrCategory} [category]
 */
export async function safe(fn, category = 'CDP') {
	try {
		const r = await fn()
		return r
	} catch (e) {
		return StudioError.wrap(e, category).toJSON()
	}
}
