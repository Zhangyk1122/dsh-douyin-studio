/**
 * lib/ledger.mjs —— 回评台账：额度 + 四重去重 + 「为什么回」
 * ============================================================================
 * 为什么要有：模型每一轮都会看到同一批通知，**靠自律一定会重复回**。
 * 所以额度不写在提示词里，写进账本里，回之前先查。
 *
 * 四道闸（顺序不能换，前面的便宜）：
 *   ① 这条 cid 回过没有（cid 为空时跳过，但 recordReply 会警告）
 *   ② 这个视频今天总量（含 off 时段，一天不超 perDay）
 *   ③ 这个视频这个时段（中午/晚上，off 时段跳过，但 off 时段的回复计入每日总量）
 *   ④ 这个人今天回过几次（每人每天 ≤ perAuthorPerDay）
 *   ⑤ 这栋楼今天回过没有（root 为空=顶层评论，跳过；非空=楼中楼，一栋楼只回一次）
 *
 * 历史注：原闸顺序是 ①cid ②总量 ③视频时段 ④人，现在调整为：
 *   先查最便宜的（cid 点查 O(n)）→ 再查视频额度 → 再查人 → 再查楼根
 *
 * 已知绕过（文档化，不修——行为是有意的）：
 *   · cid='' 时闸①跳过，适合「顶层评论不带 cid」场景；调用方必须确保 cid 真的有值
 *   · root='' 时闸⑤跳过，适合「顶层评论没有楼根」场景；这是正确行为
 *   · off 时段时，闸③跳过（不卡视频时段额度），但 off 时段的回复照常计入每日总量
 *
 * 账本位置：`$DSH_HOME/douyin-studio/ledger.json`（可用 DOUYIN_STUDIO_HOME 覆盖）
 * ============================================================================
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { withLock } from './lock.mjs'

// ── 常量 ─────────────────────────────────────────────────────────────────────

export const LIMITS = {
	perDay: 20,               // 一天总共（含 off 时段）
	perAwemePerWindow: 5,     // 同一条视频，一个时段（noon/night）最多 5 条
	perAuthorPerDay: 2,       // 同一个人一天最多 2 条
	perThreadPerDay: 1,       // 同一栋楼一天只回一次
	textMax: 500,
}

// ── 路径 ─────────────────────────────────────────────────────────────────────

/* 兜底用 homedir()，不写死 C:\Users\admin —— 换台机器/换个用户名，
 * 写死的那条会悄悄在**别人的**家目录里开一本空账本，额度全满。 */
export const homeDir = () =>
	process.env.DOUYIN_STUDIO_HOME ||
	join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'douyin-studio')

const ledgerPath = () => join(homeDir(), 'ledger.json')

// ── 时间工具 ──────────────────────────────────────────────────────────────────

/**
 * @param {Date} [d]
 * @returns {string} 'YYYY-MM-DD'
 */
const dayKey = (d = new Date()) =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * 时段：只有「中午」和「晚上」两段按视频额度计，其余时段不卡视频额度但计入每日总量。
 * @param {Date} [d]
 * @returns {'noon'|'night'|'off'}
 */
export function windowOf(d = new Date()) {
	const h = d.getHours()
	if (h >= 11 && h < 14) return 'noon'
	if (h >= 18 || h < 2) return 'night'
	return 'off'
}

// ── 账本 读/写 ────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} LedgerEntry
 * @property {string} at        ISO 时间戳
 * @property {string} day       'YYYY-MM-DD'
 * @property {'noon'|'night'|'off'} window
 * @property {string} aweme     视频 ID
 * @property {string} cid       被回评论 ID（空=顶层）
 * @property {string} newCid    回复后分配的 cid（空=未拿到）
 * @property {string} root      楼根 cid（空=顶层评论）
 * @property {string} author    作者 uid
 * @property {string} authorName 作者昵称
 * @property {string} text      回复正文（截至 500 字）
 * @property {string} reason    为什么回（截至 160 字）
 */

/**
 * @typedef {Object} Ledger
 * @property {1} version
 * @property {LedgerEntry[]} replies
 * @property {boolean} [broken]   JSON 解析失败标记
 */

/** @returns {Ledger} */
export function readLedger() {
	const p = ledgerPath()
	if (!existsSync(p)) return { version: 1, replies: [] }
	try {
		return JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
	} catch {
		return { version: 1, replies: [], broken: true }
	}
}

/** 原子写（.tmp-<pid> → rename），保证断电不坏账本 */
function writeLedger(data) {
	const dir = homeDir()
	mkdirSync(dir, { recursive: true })
	const p = ledgerPath()
	const tmp = `${p}.tmp-${process.pid}`
	writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8')
	renameSync(tmp, p)
}

// ── 统计 ──────────────────────────────────────────────────────────────────────

/**
 * 只读快照：今天已回多少、这条视频还剩几条。
 * `awemeLeft` 按「中午 + 晚上各 perAwemePerWindow 条」估算（不精确，中午满了不影响晚上额度）。
 * @param {string} [aweme]
 */
export function stats(aweme = '') {
	const today = dayKey()
	const led = readLedger()
	const all = led.replies.filter((r) => r.day === today)
	const mine = aweme ? all.filter((r) => String(r.aweme) === String(aweme)) : []
	const noonCount = mine.filter((r) => r.window === 'noon').length
	const nightCount = mine.filter((r) => r.window === 'night').length
	return {
		day: today,
		window: windowOf(),
		// 账本坏了：下面这些数字全是 0（不是真的 0，是读不出来），
		// 而且 checkQuota 已经拒绝回评了。面板要拿这个字段亮红灯。
		broken: Boolean(led.broken),
		today: all.length,
		todayLeft: Math.max(0, LIMITS.perDay - all.length),
		aweme: aweme ? mine.length : null,
		// 精确计算：分别算中午/晚上剩余，而不是用总数除
		awemeLeft: aweme
			? Math.max(0, LIMITS.perAwemePerWindow - noonCount) +
			  Math.max(0, LIMITS.perAwemePerWindow - nightCount)
			: null,
	}
}

// ── 四道闸 ────────────────────────────────────────────────────────────────────

/**
 * 回之前调用，检查是否允许发送。
 * 返回 `{ ok: true }` 或 `{ ok: false, why: string, retryAfter?: string }`。
 *
 * @param {{
 *   aweme?: string,
 *   cid?: string,
 *   authorUid?: string,
 *   root?: string,
 *   now?: Date
 * }} params
 */
export function checkQuota({ aweme = '', cid = '', authorUid = '', root = '', now = new Date() } = {}) {
	const today = dayKey(now)
	const win = windowOf(now)
	const led = readLedger()

	/* ⓪ 账本读不出来 ⇒ **失败关闭**，一条都不许回。
	 * 这一条比下面五道闸都重要：账本一坏，replies 就成了空数组，
	 * cid 去重、每日总量、同视频、同作者、同楼五道闸会**全部放行**，
	 * 表现是「今天额度全满、谁都能再回一遍」——正是会被风控盯上的那种行为。
	 * 所以宁可停下等人修，也不能装作没事。
	 * 注意这里故意**不**把坏文件挪走（不像 fsx 对其它状态文件那样留证改名）：
	 * 挪走就等于开了个干净账本，额度悄悄清零，正是上面要避免的事。 */
	if (led.broken) {
		return {
			ok: false,
			why: '账本读不出来（ledger.json 坏了或不是合法 JSON），已经先停手',
			hint: '打开 ' + ledgerPath() + ' 看看；修好或者确认可以重来再删掉它。删掉 = 今日额度清零，自己权衡',
			category: 'LOCAL',
		}
	}

	const all = led.replies
	const todayReplies = all.filter((r) => r.day === today)

	// ① cid 去重（cid 为空时跳过——顶层评论场景；调用方应确保 cid 真的存在）
	if (cid && all.some((r) => String(r.cid) === String(cid))) {
		return { ok: false, why: '这条评论已经回过了（同一个 cid）' }
	}

	// ② 全天总量
	if (todayReplies.length >= LIMITS.perDay) {
		return { ok: false, why: `今天回满了 ${LIMITS.perDay} 条`, retryAfter: '明天' }
	}

	// ③ 同一视频同一时段（off 时段不卡视频额度，但 off 时段的回复已经计入闸②的总量）
	if (aweme && win !== 'off') {
		const inWin = todayReplies.filter(
			(r) => String(r.aweme) === String(aweme) && r.window === win,
		)
		if (inWin.length >= LIMITS.perAwemePerWindow) {
			return {
				ok: false,
				why: `这条视频「${win === 'noon' ? '中午' : '晚上'}」时段已经回了 ${LIMITS.perAwemePerWindow} 条`,
				retryAfter: win === 'noon' ? '今晚 18:00 之后' : '明天中午 11:00 之后',
			}
		}
	}

	// ④ 同一作者每天最多 2 条
	if (authorUid) {
		const byAuthor = todayReplies.filter((r) => String(r.author || '') === String(authorUid))
		if (byAuthor.length >= LIMITS.perAuthorPerDay) {
			return {
				ok: false,
				why: `这个作者今天已经回过 ${LIMITS.perAuthorPerDay} 条了`,
				retryAfter: '明天',
			}
		}
	}

	// ⑤ 同一栋楼每天只回一次（root 为空=顶层评论，不适用此闸）
	if (root) {
		const sameThread = todayReplies.filter((r) => String(r.root || '') === String(root))
		if (sameThread.length >= LIMITS.perThreadPerDay) {
			return { ok: false, why: '这栋楼今天已经回过了（一栋楼只回一次）' }
		}
	}

	return { ok: true }
}

// ── 记录 ──────────────────────────────────────────────────────────────────────

/**
 * 发成功后记一条，通过 withLock('ledger') 串行写，避免并发踩坏账本。
 *
 * @param {{
 *   aweme: string,
 *   cid?: string,
 *   authorUid?: string,
 *   authorName?: string,
 *   root?: string,
 *   text?: string,
 *   reason?: string,
 *   newCid?: string,
 *   now?: Date
 * }} params
 * @returns {Promise<{ok: true, total: number} | {ok: false, category: string, error: string}>}
 */
export async function recordReply({
	aweme,
	cid = '',
	authorUid = '',
	authorName = '',
	root = '',
	text = '',
	reason = '',
	newCid = '',
	now = new Date(),
}) {
	// cid 为空时发出警告（不阻断，但应该引起注意）
	if (!cid) {
		console.error('[ledger] warning: recordReply called with empty cid — gate① will not deduplicate this entry')
	}

	return withLock('ledger', () => {
		const data = readLedger()

		/* 账本坏了 ⇒ 拒绝写。
		 * 这时候 writeLedger(data) 会拿一份「只含这一条」的新账本**盖掉坏文件**：
		 * 既毁了现场（不知道原来记了什么），又把今日额度悄悄清零、把 cid 去重记录全抹了。
		 * 宁可这条没记上（checkQuota 本来也已经拦着不发），也不能盖。 */
		if (data.broken) {
			return {
				ok: false,
				category: 'LOCAL',
				error:
					'账本坏了，不敢覆盖（一覆盖 = 今日额度清零 + 去重记录全没）。先修 ' +
					ledgerPath() +
					'，或者确认可以重来再把它删掉',
			}
		}

		data.replies.push({
			at: now.toISOString(),
			day: dayKey(now),
			window: windowOf(now),
			aweme: String(aweme || ''),
			cid: String(cid || ''),
			newCid: String(newCid || ''),
			root: String(root || ''),
			author: String(authorUid || ''),
			authorName: String(authorName || ''),
			text: String(text || '').slice(0, LIMITS.textMax),
			reason: String(reason || '').slice(0, 160),
		})
		// 只留最近 2000 条，别让账本长成一座山
		if (data.replies.length > 2000) data.replies = data.replies.slice(-2000)
		writeLedger(data)
		return { ok: true, total: data.replies.length }
	})
}

// ── 最近 n 条 ─────────────────────────────────────────────────────────────────

/**
 * 最近 n 条（倒序，最新在前），用于面板展示和人工复盘。
 * @param {number} [n]
 */
export function recent(n = 8) {
	return readLedger()
		.replies.slice(-n)
		.reverse()
		.map((r) => ({
			at: r.at,
			aweme: r.aweme,
			cid: r.cid,
			newCid: r.newCid,
			root: r.root,
			author: r.authorName || r.author,
			text: (r.text || '').slice(0, 60),
			reason: r.reason,
		}))
}
