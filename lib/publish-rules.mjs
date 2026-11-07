/**
 * lib/publish-rules.mjs —— 发布规则的唯一真源
 * ============================================================================
 * 两套发布链并存（面板/CLI 走 lib/publish-*.mjs，小汐自己走 qq-pet/publish.mjs），
 * 各自把「视频标题 30 字、图文 20 字」抄了一份。抄两份就会分叉：
 * 面板这边修了上限，她自己发的时候拿不到。
 *
 * 这个文件提供一份常数；`tools/rules-drift.mjs` 会拿它去核两条链的实际写法，
 * 分叉了就在 check.mjs 里报红。**先做检测、不改禁改区**：
 * lib/publish.mjs 在 protected.json 里，动它要同步更新基线并写理由，
 * 等下次真要改发布行为时再一起切过来。
 * ============================================================================
 */

/** 抖音发布页计数器：视频 30 字，图文 20 字。不是一律 30。 */
export const TITLE_MAX = Object.freeze({ video: 30, image: 20 })

/** 定时发布窗口：2 小时后 ~ 14 天内。 */
export const AT_MIN_HOURS = 2
export const AT_MAX_DAYS = 14

export const IMAGE_EXT = /\.(jpe?g|png|webp)$/i
export const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi)$/i

/**
 * @param {'image'|'video'} kind
 * @returns {number} 该类型的标题字数上限
 */
export function titleLimitFor(kind) {
	return kind === 'image' ? TITLE_MAX.image : TITLE_MAX.video
}

/** 自主声明的合法取值（抖音发布页那一栏）。审计里 A2-06：声明是发布必经环节，不许空着蒙过去。 */
export const DECLARE_VALUES = Object.freeze(['ai', 'view', 'repost', 'market', 'fiction', 'none'])

/**
 * 生成工具描述里那句标题上限，别再手写「≤55」。
 * @returns {string} 例：图文 ≤20 字，视频 ≤30 字
 */
export function titleHint() {
	return '图文 ≤' + TITLE_MAX.image + ' 字，视频 ≤' + TITLE_MAX.video + ' 字'
}

/** 两条链各自实际的写法；检测脚本靠它们判断有没有分叉。 */
export const DRIFT_PATTERNS = Object.freeze({
	plugin: /kind === 'image' \? 20 : 30|titleLimitFor\(kind\)/,
	qqpet: /IMAGES\.length \? 20 : 30/,
})
