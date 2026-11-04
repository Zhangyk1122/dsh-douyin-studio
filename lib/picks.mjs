/**
 * lib/picks.mjs —— 候选库：刷完的东西要留下来，才有得挑
 * ============================================================================
 * 为什么要有它：`feed-seen.json` 只存 id 用来去重，作品本体（作者/话题/数据）
 * 刷完即弃。于是「昨天刷到那个好看的」找不回来，也没法二次挑。
 *
 * 这里只做四件纯函数的事：归一化 → 判（挡 + 打分 + 一句为什么）→ 合并 → 排序。
 * 不碰浏览器、不发请求、不读设置 —— 那些由调用方（index.js 的 /picks 路由）组装。
 *
 * 打分**不训练模型**，用可解释的加权：关键词 / 作者重合 / 话题重合 / 互动量 / 时长 / 新鲜度。
 * 铁律：**给不出理由就不该叫人**。`why` 是函数返回值的一部分，不是界面层的装饰。
 * ============================================================================
 */
import { join } from 'node:path'
import { homeDir } from './budget.mjs'
import { atomicWriteJson, readJsonChecked } from './fsx.mjs'

export const picksFile = () => join(homeDir(), 'picks.json')

/** 上限：300 条。再多就不是「候选」是「仓库」了。 */
export const MAX = 300

/** 状态机：new → seen / liked / saved / sent / dismissed（只能往前走，不回退） */
export const STATES = ['new', 'seen', 'liked', 'saved', 'sent', 'dismissed']

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const nowIso = () => new Date().toISOString()
const clamp01 = (v) => Math.max(0, Math.min(1, v))

/** feed 的一条 → 候选。缺字段不崩；desc 截 200 字（面板一行放不下更多）。
 *  ⚠️ `lib/feed.mjs` 给的是扁平结构（author 是字符串、sec_uid 叫 author_sec_uid），
 *  而 api.mjs 的 detail 给的是嵌套 author 对象 —— 两种都要认，否则作者名永远是空的。 */
export const toCandidate = (a, source = '') => {
	const src = a || {}
	const au = (typeof src.author === 'object' && src.author) || {}
	const author = String(au.nickname || (typeof src.author === 'string' ? src.author : '') || '')
	return {
		aweme_id: String(src.aweme_id || ''),
		desc: String(src.desc || '').replace(/\s+/g, ' ').slice(0, 200),
		author,
		sec_uid: String(au.sec_uid || src.author_sec_uid || au.sec_uid || ''),
		duration_sec: num(src.duration_sec),
		digg: num(src.digg),
		comment: num(src.comment),
		share: num(src.share),
		tags: Array.isArray(src.tags) ? src.tags.slice(0, 6) : [],
		is_ad: Boolean(src.is_ad),
		create_date: String(src.create_date || ''),
		source: String(source || src.source || ''),
		state: 'new',
		first_seen: nowIso(),
	}
}

/** 权重表：加起来正好 1.00。改这里会改排序，所以它是常量不是设置项。 */
export const WEIGHTS = { keyword: 0.33, author: 0.27, tag: 0.13, engage: 0.15, duration: 0.07, fresh: 0.05 }

const hit = (hay, needles) => {
	const h = String(hay || '').toLowerCase()
	for (const n of needles) {
		const k = String(n || '').trim().toLowerCase()
		if (k && h.includes(k)) return k
	}
	return ''
}

const ageHours = (iso) => {
	const t = Date.parse(String(iso || '').replace(' ', 'T'))
	if (!Number.isFinite(t)) return 24 * 30
	return Math.max(0, (Date.now() - t) / 3600000)
}

/**
 * 判一条候选：先挡，再打分。
 * ctx = { keywords:[], blockKeywords:[], minSec, maxSec, minDigg, authors:[], tags:[] }
 * 返回 { ok, score, why, blocked? }
 */
export const judge = (c, ctx = {}) => {
	const kw = (ctx.keywords || []).filter(Boolean)
	const block = (ctx.blockKeywords || []).filter(Boolean)
	const text = [c.desc, (c.tags || []).join(' '), c.author].join(' ')
	const minSec = num(ctx.minSec)
	const maxSec = num(ctx.maxSec)
	const minDigg = num(ctx.minDigg)

	const blocked = (why) => ({ ok: false, score: 0, why, blocked: true })

	if (c.is_ad) return blocked('广告 / 带货，不挑')
	if (maxSec > 0 && c.duration_sec > maxSec) return blocked('超过 ' + maxSec + ' 秒，太长')
	if (minSec > 0 && c.duration_sec > 0 && c.duration_sec < minSec) return blocked('不到 ' + minSec + ' 秒，太短')
	if (minDigg > 0 && c.digg < minDigg) return blocked('赞数没过 ' + minDigg + ' 的门槛')
	const bad = hit(text, block)
	if (bad) return blocked('命中屏蔽词「' + bad + '」')

	const parts = []
	const kwHit = hit(text, kw)
	if (kwHit) parts.push({ w: WEIGHTS.keyword, key: 'keyword', why: '命中关键词「' + kwHit + '」' })

	const auHit = hit(c.author + ' ' + c.sec_uid, ctx.authors || [])
	if (auHit) parts.push({ w: WEIGHTS.author, key: 'author', why: '是你赞过 / 发过的人' })

	const tagHit = hit((c.tags || []).join(' '), ctx.tags || [])
	if (tagHit) parts.push({ w: WEIGHTS.tag, key: 'tag', why: '话题「' + tagHit + '」你常看' })

	/* 互动量用 log 归一，不用 digg/粉丝 —— feed 不返回粉丝数，
	 * 拿绝对点赞数比会把大号全部排在前面。 */
	const engage = clamp01(Math.log10(c.digg + 1) / 5)
	if (engage > 0.3) parts.push({ w: WEIGHTS.engage * engage, key: 'engage', why: '互动量在同类里靠前' })

	if (minSec > 0 && maxSec > minSec && c.duration_sec >= minSec && c.duration_sec <= maxSec) {
		parts.push({ w: WEIGHTS.duration, key: 'duration', why: '时长 ' + c.duration_sec + ' 秒，和你常看的一致' })
	}

	const fresh = clamp01(1 - ageHours(c.create_date) / (24 * 7))
	if (fresh > 0.8) parts.push({ w: WEIGHTS.fresh * fresh, key: 'fresh', why: '刚发不久' })

	const score = clamp01(parts.reduce((s, p) => s + p.w, 0))
	/* 一句为什么：取贡献最大的那个特征。没有任何特征命中时也要说人话 ——
	 * 「不知道你为什么该看」比「不说」更糟，所以这里坦白「这是平台在推的」。 */
	const top = parts.slice().sort((a, b) => b.w - a.w)[0]
	const why = top ? top.why : '你没设关键词，这是平台在推的'
	return { ok: true, score: Math.round(score * 100) / 100, why }
}

/**
 * 合并：同 id 不重复；**人给过的结论（state）不被刷新覆盖**；
 * 只更新客观数据，score 取历史的更高值（防止一次抽风把好货压下去）。
 */
export const mergeItems = (old, next, { max = MAX } = {}) => {
	const by = new Map()
	for (const it of Array.isArray(old) ? old : []) {
		if (it && it.aweme_id) by.set(String(it.aweme_id), it)
	}
	for (const c of Array.isArray(next) ? next : []) {
		const k = String((c && c.aweme_id) || '')
		if (!k) continue
		const prev = by.get(k)
		if (!prev) {
			by.set(k, { ...c, state: STATES.includes(c.state) ? c.state : 'new', first_seen: c.first_seen || nowIso() })
			continue
		}
		by.set(k, {
			...prev,
			...c,
			state: prev.state || 'new',
			first_seen: prev.first_seen || c.first_seen || nowIso(),
			notified_at: prev.notified_at || '',
			score: Math.max(num(prev.score), num(c.score)),
		})
	}
	const all = [...by.values()]
	if (all.length <= max) return all
	/* 淘汰顺序：忽略过的 → 看过的 → 最旧的。好货永远留着。 */
	const droppable = (x) => (x.state === 'dismissed' ? 0 : x.state === 'seen' ? 1 : 2)
	all.sort((a, b) => droppable(a) - droppable(b) || String(a.first_seen).localeCompare(String(b.first_seen)))
	return all.slice(all.length - max)
}

/** 面板要看的顺序：忽略掉的不出现，其余按分从高到低。 */
export const rank = (items) => (Array.isArray(items) ? items : [])
	.filter((x) => x && x.state !== 'dismissed')
	.sort((a, b) => num(b.score) - num(a.score) || String(b.first_seen).localeCompare(String(a.first_seen)))

/** 改一条的状态。找不到就原样返回 —— 静默失败比抛错好，面板不该因为一条 ID 崩。 */
export const setState = (items, id, state) => {
	if (!STATES.includes(state)) return Array.isArray(items) ? items : []
	const k = String(id || '')
	return (Array.isArray(items) ? items : []).map((x) => {
		if (String(x.aweme_id) !== k) return x
		return { ...x, state, ...(state === 'sent' ? { notified_at: nowIso() } : {}) }
	})
}

/** 卡头那一行数字。叫过几次按「今天 sent 的条数」算。 */
export const stats = (items) => {
	const list = Array.isArray(items) ? items : []
	const today = new Date().toISOString().slice(0, 10)
	return {
		total: list.length,
		fresh: list.filter((x) => x.state === 'new').length,
		called: list.filter((x) => x.state === 'sent' && String(x.notified_at || '').slice(0, 10) === today).length,
		keep: list.filter((x) => x.state === 'liked' || x.state === 'saved').length,
	}
}

/* ── IO：只有读写一个 json 文件，坏文件由 fsx 隔离 ─────────────────────── */
export const load = () => {
	const { value } = readJsonChecked(picksFile(), { updatedAt: '', items: [] }, (v) => v && Array.isArray(v.items))
	return { updatedAt: value.updatedAt || '', items: Array.isArray(value.items) ? value.items : [] }
}

export const save = (items) => atomicWriteJson(picksFile(), { updatedAt: nowIso(), items: Array.isArray(items) ? items : [] })
