/**
 * lib/sendlog.mjs —— 发出去之后唯一该走的记账口
 * ============================================================================
 * 为什么需要它（2026-11-05 实弹两天内踩了三次同一个坑）：
 *   · `dy.mjs reply`    recordReply 是 async，没 await 就被 process.exit 掐掉 → 账本一条没有
 *   · `dy.mjs at-reply` 同样的写法，同样的结果
 *   · `dy.mjs comment-at` 压根没调 recordReply，只记了额度
 *
 * 三次表现不同，病因一样：**记账是每个分支自己"顺手"做的**，谁忘了谁就漏。
 * 对照成熟系统的做法（幂等键 + outbox + 对账），正确的形状是：
 *   出口只有一个，记账在出口里，调用方想漏也漏不掉。
 *
 * 所以这里把「写账本 + 记额度」合成一次调用，并且：
 *   ① 先查账本里有没有这个幂等键（cid / newCid），有就不重复记；
 *   ② 两个写入都 await，调用方必须 await 本函数（返回 Promise）。
 * ============================================================================
 */
import { readLedger, recordReply } from './ledger.mjs'
import * as budget from './budget.mjs'
import { logRun } from './runlog.mjs'

/** 幂等键：有 cid 用 cid（回评论），没有就用 newCid（新发的顶层评论）。 */
const keyOf = (cid, newCid) => String(cid || newCid || '')

/** 账本里已经有这条了吗？坏了当"没有"——宁可重复记一次，也不要静默丢账。 */
export function alreadyLogged(cid, newCid = '') {
	const k = keyOf(cid, newCid)
	if (!k) return false
	try {
		const rows = (readLedger() || {}).replies || []
		return rows.some((r) => String(r.cid) === k || String(r.newCid) === k)
	} catch {
		return false
	}
}

/**
 * 记一笔"发出去了"。
 *
 * @param {object} o
 * @param {string} o.aweme      作品 id
 * @param {string} o.cid        被回的评论 id（新发顶层评论时留空）
 * @param {string} o.root       楼根（顶层留空）
 * @param {string} o.authorUid  对方 uid（账本闸④靠它）
 * @param {string} o.text       实际发出去的文案
 * @param {string} o.newCid     抖音返回的新评论 id
 * @param {string} o.ch         额度通道：comment / at / dm / own / publish
 * @param {boolean} o.bill      是否计入额度。补历史账时传 false —— 昨天的发送不该占今天的额度。
 * @returns {Promise<{logged:boolean, skipped:boolean}>}
 */
export async function recordOutbound({
	aweme = '',
	cid = '',
	root = '',
	authorUid = '',
	authorName = '',
	text = '',
	reason = '',
	newCid = '',
	ch = 'comment',
	peer = '',
	thread = '',
	note = '',
	bill = true,
} = {}) {
	if (alreadyLogged(cid, newCid)) return { logged: false, skipped: true }

	await recordReply({ aweme, cid, root, authorUid, authorName, text, reason, newCid })
	if (bill) {
		budget.record({
			ch,
			peer: peer || authorUid,
			thread: thread || root || cid,
			note: note || ch + ' ' + (cid || newCid),
		})
	}
	/* 动作账：和业务账分开记。业务账管去重，动作账管"当时到底发生什么"。 */
	logRun({ kind: 'send:' + ch, target: cid || newCid, ok: true, stage: bill ? 'sent' : 'reconciled' })
	return { logged: true, skipped: false }
}
