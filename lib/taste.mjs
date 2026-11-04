/**
 * lib/taste.mjs —— 口味画像：从你已经做过的事里反推，不训练模型
 * ============================================================================
 * 为什么要有它：`judge()` 里「作者重合」「话题重合」两项原本恒为 0（ctx 传空数组）。
 * 补上它，候选库才真的认识你。三条约束，破了就返工：
 *   ① **只读已有的东西**（赞过 / 发过 / 回过 / 存过），不新增任何采集。
 *   ② **样本不够就不许有结论**：evidence < 20 → 返回全空。宁可承认不知道。
 *   ③ **sec_uid 才是身份**，昵称会改。拿昵称当 key 的写法在这里算错。
 *
 * 衰减：半衰期 14 天。两周前赞过的作者，不该和今天赞的一样重。
 * ============================================================================
 */
import { join } from 'node:path'
import { homeDir } from './budget.mjs'
import { atomicWriteJson, readJsonChecked } from './fsx.mjs'

export const tasteFile = () => join(homeDir(), 'taste.json')

/** 半衰期：14 天掉一半。参见 PLAN-for-dsh.md §4 T1。 */
export const HALF_LIFE_DAYS = 14

/** 少于这么多条样本就不输出结论 —— 这是硬约束，不是阈值调参。 */
export const MIN_EVIDENCE = 20

/** 各种正样本的权重。「自己发的」最能说明口味，所以最高。 */
export const SOURCE_W = { likes: 1.0, saved: 1.2, liked: 1.1, publishes: 1.5, ledger: 1.0 }

const MAX_AUTHORS = 30
const MAX_TAGS = 20

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** 时间衰减：14 天前的样本只剩一半重。坏时间戳返回 0（宁可不算，也不瞎算）。 */
const decay = (iso, now) => {
	const t = Date.parse(String(iso || '').replace(' ', 'T'))
	if (!Number.isFinite(t)) return 0
	const days = Math.max(0, (now - t) / 86400000)
	return 0.5 ** (days / HALF_LIFE_DAYS)
}

/** 话题：`tags` 数组（字符串或 {tag_name}）+ 文案里的 # 话题。 */
const tagsOf = (x) => {
	const raw = x && x.tags
	const out = Array.isArray(raw)
		? raw.map((t) => (typeof t === 'string' ? t : (t && (t.tag_name || t.name)) || ''))
		: String(raw || '').split(/[,，\s]+/)
	const desc = String((x && (x.desc || x.title)) || '')
	for (const m of desc.matchAll(/#([^\s#]{1,20})/g)) out.push(m[1])
	return [...new Set(out.map((s) => String(s).trim()).filter(Boolean))].slice(0, 8)
}

/** 身份：只认 sec_uid。拿不到就返回空 —— 不允许退化成昵称。 */
const secOf = (x) => {
	const a = (typeof (x && x.author) === 'object' && x.author) || {}
	return String(a.sec_uid || (x && (x.author_sec_uid || x.sec_uid)) || '').trim()
}

/** 时长（秒）。原始数据是毫秒，feed 给的是秒，两种都认。 */
const durOf = (x) => {
	const ms = num(x && x.duration)
	return ms > 0 ? Math.round(ms / 1000) : Math.round(num(x && x.duration_sec))
}

/** 发生时间。`create_time` 是秒级时间戳，得先乘 1000。 */
const atOf = (x) => {
	if (!x) return ''
	if (x.at) return String(x.at)
	if (x.create_date) return String(x.create_date)
	if (x.first_seen) return String(x.first_seen)
	const s = num(x.create_time)
	return s > 0 ? new Date(s * 1000).toISOString() : ''
}

const pct = (arr, p) => {
	if (!arr.length) return 0
	const s = arr.slice().sort((a, b) => a - b)
	const i = Math.min(s.length - 1, Math.max(0, Math.floor((s.length - 1) * p)))
	return Math.round(s[i] * 10) / 10
}
/** 归一化到 0–1（最大值 = 1）。权重之间的**比值**才是信息。 */
const norm = (m) => {
	const keys = Object.keys(m)
	const max = Math.max(0, ...keys.map((k) => m[k]))
	const o = {}
	for (const k of keys) o[k] = max > 0 ? Math.round((m[k] / max) * 1000) / 1000 : 0
	return o
}

/** 空画像：样本不足时返回它。界面看到空就是"还不知道"，不是"没有口味"。 */
export const empty = (evidence = 0, now = Date.now()) => ({
	authors: {}, tags: {}, dur: { p50: 0, p90: 0 },
	hours: new Array(24).fill(0), evidence,
	updatedAt: new Date(now).toISOString(),
})

/**
 * 建画像。纯函数：同样的输入 + 同样的 now，输出必须一样。
 * @param {{likes?:object[], publishes?:object[], ledger?:object[], picks?:object[]}} src
 * @param {number} [now]
 */
export const buildTaste = ({ likes = [], publishes = [], ledger = [], picks = [] } = {}, now = Date.now()) => {
	const samples = [
		...likes.map((x) => ({ x, w: SOURCE_W.likes })),
		...picks.filter((p) => p && (p.state === 'saved' || p.state === 'liked'))
			.map((x) => ({ x, w: x.state === 'saved' ? SOURCE_W.saved : SOURCE_W.liked })),
		...publishes.map((x) => ({ x, w: SOURCE_W.publishes })),
		...ledger.map((x) => ({ x, w: SOURCE_W.ledger })),
	]
	const evidence = samples.length
	/* 样本不够：返回空。**不许**用 3 条数据编一个画像 —— 那比没有更糟。 */
	if (evidence < MIN_EVIDENCE) return empty(evidence, now)

	const authors = {}
	const tags = {}
	const durs = []
	const hours = new Array(24).fill(0)
	for (const { x, w } of samples) {
		const d = decay(atOf(x), now)
		if (d <= 0) continue
		const k = w * d
		const sec = secOf(x)
		if (sec) authors[sec] = (authors[sec] || 0) + k
		for (const t of tagsOf(x)) tags[t] = (tags[t] || 0) + k
		const dur = durOf(x)
		if (dur > 0) durs.push(dur)
		const at = Date.parse(String(atOf(x)).replace(' ', 'T'))
		if (Number.isFinite(at)) hours[new Date(at).getHours()] += k
	}

	return {
		authors: norm(authors), tags: norm(tags),
		dur: { p50: pct(durs, 0.5), p90: pct(durs, 0.9) },
		hours, evidence, updatedAt: new Date(now).toISOString(),
	}
}

/** 画像 → `judge()` 的 ctx 片段。只取头部，避免匹配集合无限长。 */
export const toContext = (t) => {
	const top = (m, n) => Object.entries(m || {})
		.sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k)
	return { authors: top(t && t.authors, MAX_AUTHORS), tags: top(t && t.tags, MAX_TAGS) }
}

/* ── IO：一个 json 文件，坏文件由 fsx 隔离 ───────────────────────────────── */
const v_ok = (v) => Boolean(v && typeof v === 'object' && !Array.isArray(v)
	&& v.authors && typeof v.authors === 'object' && Array.isArray(v.hours))

export const load = () => {
	const { value } = readJsonChecked(tasteFile(), empty(), v_ok)
	return v_ok(value) ? value : empty()
}

export const save = (t) => atomicWriteJson(tasteFile(), t)
