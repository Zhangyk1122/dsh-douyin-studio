/**
 * lib/inbox.mjs —— 收件箱：把「谁在等我」整理成一张可行动的清单
 * ============================================================================
 * 问题不是「能不能读到」，而是**读到了不知道哪条该回**。
 * 私信列表里混着真人提问、系统通知、纯表情、卡片；评论区里混着广告、
 * 已回过的、还在等回复的。全都倒给模型，它只会挑最新那条。
 *
 * 所以这里做三件事：
 *   ① 判「这条值不值得回」（规则可解释，不是打分玄学）
 *   ② 排优先级（谁在问、问得急、还没凉）
 *   ③ 带上行动需要的全部 id（uid / cid / root / aweme），一步就能回
 *
 * 三个来源：私信(dm) / @我(at) / 我作品下的新评论(own)。
 * 每个候选都带 `why`（为什么值得回）和 `blocked`（为什么不该回），
 * 让模型和人都能复核，而不是信一个黑盒分数。
 * ============================================================================
 */
import * as api from './api.mjs'
import * as im from './im.mjs'
import { nameOf } from './names.mjs'
import { recent as ledgerRecent } from './ledger.mjs'
import { parseDouyinTime, toIsoZ, relTime } from './reltime.mjs'
import { inboxItemView } from './viewmodel.mjs'

const AGE_MIN = (iso, now = Date.now()) => {
	/* 抖音的 create_date 是**无时区标记的 UTC**，直接 Date.parse 会按本地时间算，
	 * 在东八区整整差 8 小时 —— 1 小时前会被说成 9 小时前。口径统一收在 reltime.mjs。 */
	const t = parseDouyinTime(iso)
	return Number.isFinite(t) ? Math.round((now - t) / 60000) : -1
}

/**
 * 通知列表会把旧的一起翻出来（实测有 3 天前、56 天前的 @）。
 * 定一条统一口径：6 小时内 high、3 天内 worth、7 天内 stale（还值得回但别急）、
 * 超过 7 天就不是「该回」了。抽成纯函数，测试直接钉它。
 */
export function ageRank(ageMin) {
	const m = Number(ageMin)
	if (!Number.isFinite(m) || m < 0) return { status: 'todo', worth: true, why: [], blocked: [] }
	if (m > 7 * 1440) return { status: 'stale', worth: false, why: [], blocked: ['已经 ' + Math.round(m / 1440) + ' 天前的事了'] }
	if (m >= 72 * 60) return { status: 'stale', worth: true, why: ['已经过了 ' + Math.round(m / 1440) + ' 天'], blocked: [] }
	if (m > 360) return { status: 'worth', worth: true, why: [], blocked: [] }
	return { status: 'high', worth: true, why: [], blocked: [] }
}

/** 纯表情 / 空 / 纯卡片 / 系统话术 */
const EMOJI_ONLY = /^[\s\p{Emoji}\p{Emoji_Component}[\]【】\u200b-\u200d\ufe0f~～。.!！?？]+$/u
/** 抖音的表情是 [送心] 这种方括号写法 —— 先剥掉再判，否则一串「[送心][赞]」会被当成有内容 */
const stripFaces = (s) => String(s || '').replace(/\[[^[\]]{1,8}\]/g, '').replace(/【[^【】]{1,8}】/g, '').trim()
const SYSTEM_LINE = /^(你关注的|.*关注了你$|.*赞了你的作品$|.*评论了你的作品$|.*发布了新作品|.*分享了.*视频$|.*@了你)/
const ASK_WORDS = /(？|\?|吗|么|怎么|如何|为什么|为啥|多少|哪|能不能|可不可以|帮(我|忙)|求|问一|请问|在吗|有人吗|有没有|求推荐|推荐)/

/**
 * 判一条私信值不值得回。纯函数，方便测。
 * @param {{messages:Array<{from:'me'|'them',text:string,at:string}>, peer_uid?:string}} conv
 * @returns {{status:string, score:number, worth:boolean, why:string[], blocked:string[], last:object|null, ageMin:number}}
 */
export function judgeDm(conv, { now = Date.now(), nick = '' } = {}) {
	const msgs = Array.isArray(conv && conv.messages) ? conv.messages : []
	const why = []
	const blocked = []
	const last = msgs.length ? msgs[msgs.length - 1] : null
	if (!last) return { status: 'empty', score: 0, worth: false, why, blocked: ['会话是空的'], last: null, ageMin: -1 }

	const ageMin = AGE_MIN(last.at, now)
	const text = String(last.text || '').trim()
	/* 卡片和图片在接口里只剩个占位文字（[视频卡片] / 空），
	 * 按「纯表情」判会把它当垃圾 —— 但人家是专门发来给我看的。 */
	const isCard = (last && last.kind === 'card') || /^\[(视频|卡片|分享|评论|图片)/.test(text)
	if (last.from === 'me') {
		return { status: 'waiting', score: 0, worth: false, why, blocked: ['最后一条是我发的，对方还没回'], last, ageMin }
	}
	if (!isCard) {
		if (EMOJI_ONLY.test(text) || !stripFaces(text)) blocked.push('只有表情/空白，没什么可接的')
		if (!text) blocked.push('正文是空的（可能是卡片或图片）')
	}
	if (SYSTEM_LINE.test(text) && /(助手|通知|官方|小助手|系统)/.test(String(nick || ''))) blocked.push('看着是系统通知，不是人在说话')
	if (ageMin >= 0 && ageMin >= 72 * 60) blocked.push(`已经 ${Math.round(ageMin / 60)} 小时没动了`)

	let score = 0
	if (isCard) { score += 10; why.push('发来一个视频卡片') }
	if (ASK_WORDS.test(text)) { score += 30; why.push('在提问/求助') }
	if (text.length >= 8) { score += 10; why.push('有实际内容') }
	if (ageMin >= 0 && ageMin <= 360) { score += 30; why.push('6 小时内') } else if (ageMin >= 0 && ageMin <= 1440) { score += 15; why.push('今天') }
	const hadMe = msgs.some((m) => m.from === 'me')
	if (!hadMe) { score += 10; why.push('第一次私信，还没聊过') }
	if (msgs.some((m) => m.from === 'them' && ASK_WORDS.test(String(m.text || '')))) { score += 5; why.push('之前也问过问题') }

	const worth = blocked.length === 0 && score >= 20
	const status = worth ? (score >= 50 ? 'high' : score >= 30 ? 'mid' : 'low') : (blocked.length ? 'skip' : 'low')
	return { status, score, worth, why, blocked, last, ageMin }
}

/**
 * 私信候选。只读接口，不发。
 * @param {{limit?:number, now?:number}} p
 */
export async function dmCandidates({ limit = 20, now = Date.now() } = {}) {
	const r = await im.conversations({ limit: 6 })
	if (!r.ok) return { ok: false, error: r.error || '私信读不到' }
	const out = []
	for (const c of r.conversations || []) {
		if (Number(c.type) !== 1) continue
		/* 接口会给一批「会话列表里有、但一条消息都没带回来」的空壳（常见于
		 * 很久没聊过、或索引还没回填的老会话）。它们既不该回、也没东西可看，
		 * 列出来只会把真该回的挤下去。 */
		if (!(Array.isArray(c.messages) && c.messages.length)) continue
		const nick = nameOf(c.peer_uid) || ''
		const j = judgeDm(c, { now, nick })
		const last = j.last || {}
		out.push({
			source: 'dm',
			uid: String(c.peer_uid || ''),
			conv_id: String(c.conv_id || ''),
			nick: nick || '(未知昵称)',
			last_text: String(last.text || '').slice(0, 160),
			last_at: String(last.at || ''),
			last_from: last.from || '',
			age_min: j.ageMin,
			status: j.status,
			score: j.score,
			worth: j.worth,
			why: j.why,
			blocked: j.blocked,
			history: (c.messages || []).slice(-4).map((m) => ({ from: m.from, text: String(m.text || '').slice(0, 80), at: m.at })),
		})
	}
	out.sort((a, b) => (b.worth - a.worth) || (b.score - a.score) || String(a.age_min).localeCompare(String(b.age_min)))
	const dmTop = out.slice(0, Math.max(1, Math.min(Number(limit) || 20, 60)))
	for (const it of dmTop) it.view = inboxItemView('dm', it, { now })
	return { ok: true, my_uid: r.my_uid, n: out.length, items: dmTop }
}

/**
 * @我 的候选：通知里 type 45/46，补上视频本身是什么（不回也得先知道在 @ 什么）。
 * @param {{limit?:number, enrich?:number, now?:number}} p
 */
export async function atCandidates({ limit = 20, enrich = 3, now = Date.now() } = {}) {
	/* ⚠️ 实测（2026-11-02）：@我 的通知在 **group 601**，不在 700/960 里
	 *    （700/960 只有 31/33/41 这些关注/点赞/回复）。先只查 601，省两次请求；
	 *    601 空的话再回头扫 700+960 兜底（以前版本把它们混着查过）。 */
	let r = await api.notices({ groups: [601], perGroup: 20, limit: 60 })
	let items = ((r && r.items) || []).filter((x) => x.type === 45 || x.type === 46)
	if (!items.length) {
		const r2 = await api.notices({ groups: [700, 960], perGroup: 20, limit: 60 })
		items = ((r2 && r2.items) || []).filter((x) => x.type === 45 || x.type === 46)
		if (!r.ok && r2.ok) r = r2
	}
	if (!r || !r.ok) return { ok: false, error: (r && r.error) || '通知读不到' }
	const uniq = []
	const seen = new Set()
	for (const it of items) {
		const key = `${it.aweme_id || ''}|${it.nid || ''}`
		if (seen.has(key)) continue
		seen.add(key)
		uniq.push({
			source: 'at',
			type: it.type,
			type_name: it.type_name,
			nid: it.nid,
			nick: it.nickname || '(未知)',
			uid: it.uid || '',
			aweme_id: it.aweme_id || '',
			comment_id: it.comment_id || '',
			root_comment_id: it.root_comment_id || '',
			content: it.content || '',
			aweme_desc: it.aweme_desc || '',
			at: toIsoZ(it.create_date) || String(it.create_date || ''),
			when: relTime(it.create_date, now),
			age_min: AGE_MIN(it.create_date, now),
			status: 'todo',
			why: ['@了我，等一个回应'],
			blocked: [],
			worth: true,
		})
	}
	/* 通知列表是把旧的一起翻出来的（实测有 3 天前、56 天前的），
	 * 全标成「值得回」就是在骗自己。按时间定身价，超过 7 天的就别再打扰了。 */
	for (const it of uniq) {
		const r = ageRank(it.age_min)
		it.status = r.status
		it.worth = r.worth
		if (r.why.length) it.why = ['@了我'].concat(r.why)
		if (r.blocked.length) it.blocked = r.blocked
	}
	uniq.sort((a, c) => String(a.at || '').localeCompare(String(c.at || '')) * -1)
	// 补前几条的视频信息（标题/作者/时长），别让「@我」只有一个 id
	for (const it of uniq.slice(0, Math.max(0, Math.min(Number(enrich) || 0, 5)))) {
		if (!it.aweme_id) continue
		try {
			const d = await api.detail(it.aweme_id)
			if (d.ok && d.aweme) {
				it.aweme_desc = it.aweme_desc || String(d.aweme.desc || '').slice(0, 120)
				it.aweme_author = d.aweme.author && d.aweme.author.nickname ? d.aweme.author.nickname : ''
				it.aweme_stats = { digg: d.aweme.digg, comment: d.aweme.comment, collect: d.aweme.collect }
				it.aweme_duration = d.aweme.duration_ms || 0
			} else {
				it.blocked.push('视频详情拿不到（可能已删/私密）')
			}
		} catch { it.blocked.push('视频详情拿不到') }
	}
	const atTop = uniq.slice(0, Math.max(1, Math.min(Number(limit) || 20, 60)))
	for (const it of atTop) it.view = inboxItemView('at', it, { now })
	return { ok: true, n: uniq.length, items: atTop }
}

/**
 * 我作品下的新评论：谁评了、我回没回。
 * @param {{worksN?:number, perWork?:number, limit?:number}} p
 */
export async function ownComments({ worksN = 3, perWork = 20, limit = 30, maxAgeDays = 7 } = {}) {
	const w = await api.works({ count: Math.max(1, Math.min(Number(worksN) || 3, 10)), cursor: 0 })
	if (!w.ok) return { ok: false, error: w.error || '作品列表读不到' }
	const me = await api.self()
	// ⚠️ api.self() 返回的是 { ok, http, user:{ uid, nickname, … } }，uid 在 user 里。
	//    2026-11-03 之前写成 me.uid → 永远是空 → 自己发的评论没被过滤，
	//    「我作品下的新评论」把自己 6 条回复全列成 worth:true 待回（自己回不了自己）。
	const myUid = String(
		(me && (me.uid || (me.user && me.user.uid))) || '',
	)
	const replied = new Set((ledgerRecent(200) || []).map((x) => String(x.cid || '')))
	const out = []
	for (const work of w.list || []) {
		const c = await api.comments(work.aweme_id, { count: perWork })
		if (!c.ok) continue
		for (const cm of c.list || []) {
			if (!cm.user || !cm.user.uid) continue
			const mine = Boolean(myUid) && String(cm.user.uid) === myUid
			if (mine) continue
			if (Number(cm.level || 1) !== 1) continue
			if (replied.has(String(cm.cid))) continue
			const ageMin = AGE_MIN(cm.create_date)
			/* 一周前的评论就别翻了：回得太晚像在补作业，而且更容易被当成刷屏 */
			if (maxAgeDays > 0 && ageMin > maxAgeDays * 1440) continue
			const txt = String(cm.text || '').trim()
			const blocked = []
			if (!txt) blocked.push('正文是空的（纯图评论）')
			out.push({
				source: 'own',
				aweme_id: work.aweme_id,
				aweme_desc: String(work.desc || '').slice(0, 80),
				cid: cm.cid,
				uid: cm.user.uid,
				nick: cm.user.nickname,
				text: txt.slice(0, 200),
				digg: cm.digg,
				sub_count: cm.sub_count,
				at: toIsoZ(cm.create_date) || String(cm.create_date || ''),
				when: relTime(cm.create_date),
				age_min: ageMin,
				status: blocked.length ? 'skip' : 'todo',
				worth: blocked.length === 0,
				why: blocked.length ? [] : ['在我作品下留了话，还没回过'],
				blocked,
			})
		}
	}
	out.sort((a, b) => String(b.at).localeCompare(String(a.at)))
	const ownTop = out.slice(0, Math.max(1, Math.min(Number(limit) || 30, 60)))
	const nowMs = Date.now()
	for (const it of ownTop) it.view = inboxItemView('own', it, { now: nowMs })
	return { ok: true, n: out.length, items: ownTop }
}

/** 三合一收件箱（每块自己失败不影响别的块） */
export async function inbox({ limit = 10 } = {}) {
	const jobs = await Promise.allSettled([
		dmCandidates({ limit }),
		atCandidates({ limit }),
		ownComments({ limit }),
	])
	const pick = (i) => (jobs[i].status === 'fulfilled' ? jobs[i].value : { ok: false, error: String((jobs[i].reason && jobs[i].reason.message) || jobs[i].reason) })
	const dm = pick(0); const at = pick(1); const own = pick(2)
	const count = (x) => (x && x.ok && Array.isArray(x.items)) ? x.items.filter((i) => i.worth).length : 0
	return {
		ok: Boolean(dm.ok || at.ok || own.ok),
		counts: { dm: count(dm), at: count(at), own: count(own) },
		dm, at, own,
	}
}
