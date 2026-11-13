/**
 * 发送结果的三种状态 —— 以前只有 ok / 不 ok，于是「超时了，不知道发没发出去」
 * 和「明确被拒绝」被当成同一件事，队列就会在不确定的时候再发一遍。
 * 真人不会在「可能已经发出去了」的时候补一条。
 *
 *   sent    确认到了（有回执 / 页面回读到了）
 *   failed  明确没发出去（找不到会话、正文空、被拦）
 *   unknown 不知道（超时、断连、CLI 没给结果对象、进程被杀）
 *
 * 只有 failed 可以重试；unknown 一律停手，交给人看。
 */

export const UNKNOWN_RE =
	/超时|timeout|timed ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket|断连|没给出结果|没给结果|只回了 ?null|unknown|未知原因|进程退出|killed/i

/** 明确「没发出去」的那些原因：这些都是确定的失败，重试有意义。 */
export const FAILED_RE = /没打开|没有「|找不到|反查不到|正文是空|被拦|不在窗口|额度|没有要回的/i

export function classifySend(r) {
	if (!r) return 'unknown'
	if (r.ok === true || r.sent === true) return 'sent'
	const msg = String(r.error || r.why || r.stage || r.note || '')
	if (FAILED_RE.test(msg)) return 'failed'
	if (UNKNOWN_RE.test(msg)) return 'unknown'
	// 有空错误但明确 ok:false：当失败，可重试（比当 unknown 更保守？不 —— 不明原因就停手更安全）
	return msg ? 'failed' : 'unknown'
}

export const canRetry = (state) => state === 'failed'

export function sendStateLine(state) {
	if (state === 'sent') return ''
	if (state === 'unknown') return '结果不确定，先不重发'
	if (state === 'failed') return '没发出去'
	return '还没发'
}
