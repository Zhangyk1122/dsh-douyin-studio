/**
 * 「圈地自萌」：只在被明确叫到时开口，被拒绝时闭嘴。
 *
 * 蓝本：dsh-bili-pond —— 普通观众喊话不算，否定评论（别来/别刷/别蹭）直接排除。
 * 这里只做**判断**，不做请求：调用方拿到 `{ok,why}` 自己决定要不要回。
 */

/** 明确叫你（带名字、带邀请动作）。 */
export const INVITE_RE = /(小汐|汐汐|小肥鱼|大肥鱼).{0,6}(来|回|说|唱|画|看看|过来|陪我)/

/** 拒绝/驱赶：出现这些就绝不开口。 */
export const REFUSE_WORDS = ['别来', '别刷', '别蹭', '滚', '别评论', '别回复', '烦不烦', '走开', '别打扰', '不用回', '闭嘴', '拉黑']

/** 纯围观/起哄，不值得接。 */
export const NOISE_RE = /^(6+|哈+|草+|？+|！+|\.{3,}|dd|前排|沙发|打卡)$/

export const isRefusal = (text) => REFUSE_WORDS.some((w) => String(text || '').includes(w))

export const isNoise = (text) => NOISE_RE.test(String(text || '').trim())

/** 这句算不算「邀请」。 */
export function isInvite(text) {
	const t = String(text || '')
	if (!t.trim()) return false
	if (isRefusal(t)) return false
	if (isNoise(t)) return false
	return INVITE_RE.test(t)
}

/**
 * 决定要不要在这条底下开口。
 * mode：`all`（默认，按名字/相关度）、`invite`（只认邀请）
 */
export function planSpeak({ text = '', mode = 'all', addressed = false, relevant = false } = {}) {
	const t = String(text || '')
	if (!t.trim()) return { ok: false, why: '空评论' }
	if (isRefusal(t)) return { ok: false, why: '对方明确表示别来' }
	if (isNoise(t)) return { ok: false, why: '纯起哄' }
	if (mode === 'invite') {
		return isInvite(t) ? { ok: true, why: '被点名邀请' } : { ok: false, why: '没人邀请，不插话' }
	}
	if (addressed) return { ok: true, why: '叫到我了' }
	if (isInvite(t)) return { ok: true, why: '被点名邀请' }
	if (relevant) return { ok: true, why: '话题相关' }
	return { ok: false, why: '没由头' }
}
