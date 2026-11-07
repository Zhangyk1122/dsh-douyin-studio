/**
 * lib/viewmodel.mjs —— 界面要显示什么，先在这里算成纯数据
 * ============================================================================
 * 为什么拆这一层：
 *   `client.js` 现在是 1937/1940 行，顶到上限 —— 每加一张卡都要先删别的东西。
 *   根因不是"行数多"，是**展示逻辑不可测**：想改"这条怎么显示"，只能改 h() 调用，
 *   改完靠肉眼验收；同一套规则也没法在 CLI / 日报里复用。
 *
 *   这里把「一条收件箱记录 → 界面上那几个字」变成纯函数：
 *   前端只负责画，规则可以单测，也可以在别的地方复用。
 *
 * 约定：
 *   · 不读盘、不联网、不看时钟（now 由调用方传）
 *   · 只做形状转换，不做判断门外的事（该不该回由 inbox.judge 决定）
 * ============================================================================
 */
import { relTime } from './reltime.mjs'

const clip = (s, n) => {
	const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
	return t.length > n ? t.slice(0, n - 1) + '…' : t
}

const EMPTY_PREVIEW = '（没有文字内容）'

/** 三种条目的原始字段不一样，先归一。 */
export function rawOf(kind, it) {
	const o = it || {}
	if (kind === 'dm') return { at: o.last_at || '', text: o.last_text || '', from: o.last_from || '' }
	if (kind === 'at') return { at: o.at || '', text: o.content || '', from: '' }
	return { at: o.at || '', text: o.text || '', from: '' }
}

/**
 * 一条收件箱记录在界面上要显示的东西。
 *
 * @param {'dm'|'at'|'own'} kind
 * @param {object} it   inbox 里的原始条目
 * @param {object} [opts]
 * @param {number} [opts.now]
 * @param {number} [opts.previewLen=120]
 * @returns {{at:string, when:string, preview:string, notes:string[], blocked:string[], tone:'todo'|'skip'}}
 */
export function inboxItemView(kind, it, { now = Date.now(), previewLen = 120 } = {}) {
	const { at, text } = rawOf(kind, it)
	const o = it || {}
	const notes = (Array.isArray(o.why) ? o.why : []).slice(0, 2).map((x) => clip(x, 40))
	const blocked = (Array.isArray(o.blocked) ? o.blocked : []).slice(0, 1).map((x) => clip(x, 40))
	return {
		at: String(at || ''),
		when: relTime(at, now),
		preview: clip(text, previewLen) || EMPTY_PREVIEW,
		notes,
		blocked,
		tone: o.status === 'skip' || o.worth === false ? 'skip' : 'todo',
	}
}

/**
 * 列表头那句「N 条值得回 · 刚刚」。
 * @param {{items:Array}} inbox   /inbox 的返回
 * @param {number} [now]
 */
export function inboxHeadline(inbox, now = Date.now()) {
	const items = (inbox && inbox.items) || []
	const worth = items.filter((x) => x && x.worth !== false && x.status !== 'skip').length
	const stamp = inbox && inbox.at ? relTime(inbox.at, now) : ''
	return { worth, text: (worth ? worth + ' 条值得回' : '暂时没有该回的') + (stamp ? ' · ' + stamp : '') }
}

/**
 * 看板三个数。以前是「粉丝 / 作品 / 获赞」——那是给人看的虚荣指标，
 * 回答不了「现在要不要动手」。换成待回 / 额度剩 / 上一条回评成败。
 * 拿不到数据一律 null，前端画成「—」；**绝不画成 0**，0 会被当成"确实没有"。
 * @param {object} o
 * @param {object} o.budget  budget.stats() 的返回
 * @param {object} o.inbox   /inbox 的返回（dm / at / own 三捆）
 * @param {Array}  o.runs    runlog 最近若干条
 * @param {number} o.now
 */
export function heroView({ budget = {}, inbox = {}, runs = [], replies = [], now = Date.now() } = {}) {
	const msgs = budget.messages || {}
	const max = Number(msgs.max) || 0
	const used = Number(msgs.day) || 0
	const left = Number.isFinite(Number(msgs.left)) && msgs.left !== '' ? Number(msgs.left) : null
	const packs = [inbox.dm, inbox.at, inbox.own].filter(Boolean)
	const items = packs.length
		? packs.flatMap((p) => (Array.isArray(p.items) ? p.items : []))
		: (Array.isArray(inbox.items) ? inbox.items : [])
	const pending = items.length
		? items.filter((x) => x && x.worth !== false && x.status !== 'skip').length
		: null
	const outbound = (Array.isArray(runs) ? runs : []).filter((r) => r && /^(send:|reply|at$|comment-at|dm-send)/.test(String(r.kind || '')))
	/* 动作账是 11-05 才加的，之前的历史发送只在业务账里；拿它兜底，别显示「—」。 */
	const last = outbound[0] || (Array.isArray(replies) ? replies[0] : null) || null
	return {
		pending,
		quotaLeft: left,
		quotaUsed: used,
		quotaMax: max,
		quotaPct: max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0,
		lastReply: last ? { ok: Boolean(last.ok), when: relTime(last.at, now), error: clip(last.error, 60) } : null,
	}
}

/**
 * 三段漏斗：收件箱看到 → 判该回 → 今天真回了多少。
 * 用数字而不是「0」表示「没数据」：缺数据的日期画成 0，会污染下游所有判断。
 * @param {object} o
 * @param {object} o.inbox   /inbox 的返回
 * @param {Array}  o.replies 业务账最近若干条（带 at）
 * @param {number} o.now
 */
export function funnelView({ inbox = {}, replies = [], now = Date.now() } = {}) {
	const packs = [inbox.dm, inbox.at, inbox.own].filter(Boolean)
	const items = packs.length
		? packs.flatMap((p) => (Array.isArray(p.items) ? p.items : []))
		: (Array.isArray(inbox.items) ? inbox.items : [])
	const d = new Date(now)
	const p2 = (x) => String(x).padStart(2, '0')
	const today = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
	const sent = (Array.isArray(replies) ? replies : []).filter((r) => {
		if (!r || !r.at) return false
		const t = new Date(r.at)
		if (Number.isNaN(t.getTime())) return false
		return t.getFullYear() + '-' + p2(t.getMonth() + 1) + '-' + p2(t.getDate()) === today
	}).length
	const seen = items.length
	const worth = items.filter((x) => x && x.worth !== false && x.status !== 'skip').length
	return { seen, worth, sent, hasData: seen > 0 || sent > 0 }
}

const SKIP_CN = { quota: '额度用完', 'skip-quota': '额度用完', pause: '已暂停', stop: '连续失败，今天停' }
const KIND_CN = {
	'send:comment': '回评', 'send:at': '回 @', 'send:dm': '私信', 'send:own': '自己评论区',
	reply: '回评', at: '回 @', 'comment-at': '评论区 @', tellOwner: '安利给你', inbox: '看收件箱',
	feed: '刷视频', publish: '发布', share: '分享视频', dm: '私信',
}

/**
 * 值班日志：把「动作账」和「轮次账」合成一条能审计的时间线。
 * 之前面板只有成功记录，看不到「为什么没干」——跳过的原因才是排查时最想要的。
 */
export function dutyLogView({ runs = [], rounds = [], replies = [], now = Date.now(), limit = 14 } = {}) {
	const items = []
	for (const r of Array.isArray(rounds) ? rounds : []) {
		if (!r) continue
		items.push({
			at: r.at || '', kind: '刷视频',
			tone: r.skipped ? 'warn' : (r.ok ? 'ok' : 'bad'),
			title: r.skipped ? '跳过一轮 · ' + (SKIP_CN[r.skipped] || clip(r.skipped, 20)) : (r.ok ? '刷完一轮' : '这一轮失败'),
			detail: [r.seen ? '看了 ' + r.seen + ' 条' : '', r.kept ? '留下 ' + r.kept + ' 条' : '', clip(r.error, 70)].filter(Boolean).join(' · '),
		})
	}
	/* 纯读命令（看收件箱 / 查状态 / 看调度）不是「值班动作」，别把审计日志冲淡。 */
	const READ_KINDS = new Set(['inbox', 'status', 'schedule', 'doctor', 'snapshots', 'ledger', 'budget', 'comments', 'replies'])
	/* 业务账里的历史回评：动作账存在之前，它是唯一的「她真的说过什么」的记录。 */
	for (const r of Array.isArray(replies) ? replies : []) {
		if (!r || !r.at) continue
		items.push({
			at: String(r.at), kind: '回评', tone: 'ok', title: '发出去了',
			detail: clip([r.who || r.target, r.detail].filter(Boolean).join(' · '), 70),
		})
	}
	for (const r of Array.isArray(runs) ? runs : []) {
		if (!r || READ_KINDS.has(String(r.kind || ''))) continue
		items.push({
			at: r.at || '', kind: KIND_CN[String(r.kind || '')] || clip(r.kind, 16),
			tone: r.ok ? 'ok' : 'bad',
			title: r.ok ? '成功' : '没成',
			detail: [clip(r.target, 30), clip(r.stage || r.error, 70)].filter(Boolean).join(' · '),
		})
	}
	items.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
	return { total: items.length, items: items.slice(0, Math.max(1, limit)).map((x) => ({ ...x, when: relTime(x.at, now) })) }
}
