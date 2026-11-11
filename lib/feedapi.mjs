/* 页内直连搜索（2026-11-11）
 *
 * 为什么有这个文件：`feed` 走的是「打开推荐流 → 滚 → 读卡片」，一轮 20 条约 26–63 秒
 * （`jobs-2026-11.jsonl` 的 phases.feed 占 99.8%）。而在已登录的页面里 `fetch`
 * `/aweme/v1/web/general/search/single/` 一次 10 条只要 1.4–1.8 秒（本机实测 3 次：
 * 1793 / 1456 / 1402 ms），字段还更全（点赞、评论、时长、封面、话题）。
 *
 * 为什么不是「自己签名 + node 直连」：`a_bogus` 签名能算（`Douyin_Spider` 的 dy_ab.js，
 * boot 84 ms / 单次 8.07 ms），但同一个接口在无 cookie 时回
 * `{"status_code":2483,"status_msg":"请先登录，再继续搜索吧"}` —— 直连这条路要拿账号
 * cookie 出浏览器，风险比省下的几百毫秒大得多。页面内 `credentials:'include'` 用的是
 * 用户本来就在用的登录态，签名也由页面自己带，这是唯一「不搬 cookie」的快路。
 *
 * 定位：只是「去哪找这一轮的候选」。挑/打分/入库/通知仍然是 `picks.mjs` 那同一套。
 * 失败一定退回 CLI 的 `search`，不让搜索接口的抖动影响整轮。
 */

import { withPage } from './cdp.mjs'

export const SEARCH_PATH = '/aweme/v1/web/general/search/single/'

/** 关键词只做最小清洗：接口自己会拒掉过短/含特殊符号的词，我们不猜它的规则。 */
export const cleanKeyword = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 50)

/** 组装 query。字段名与抖音 web 端一致，改一个就会被判成异常请求，别动默认值。 */
export function buildQuery({ keyword = '', count = 10, offset = 0, sort = 0, publishTime = 0, duration = 0, contentType = 0 } = {}) {
	const q = new URLSearchParams()
	q.set('device_platform', 'webapp')
	q.set('aid', '6383')
	q.set('channel', 'channel_pc_web')
	q.set('search_channel', 'aweme_general')
	q.set('keyword', cleanKeyword(keyword))
	q.set('count', String(Math.min(Math.max(Number(count) || 10, 1), 20)))
	q.set('offset', String(Math.max(Number(offset) || 0, 0)))
	q.set('search_source', 'normal_search')
	q.set('query_correct_type', '1')
	q.set('is_filter_search', '0')
	if (Number(sort)) q.set('sort_type', String(Number(sort)))
	if (Number(publishTime)) q.set('publish_time', String(Number(publishTime)))
	if (Number(duration)) q.set('filter_duration', String(Number(duration)))
	if (Number(contentType)) q.set('search_type', String(Number(contentType)))
	return q.toString()
}

const num = (v) => {
	const n = Number(v)
	return Number.isFinite(n) ? n : 0
}

/** 接口条目 → `toCandidate()` 认的形状。只做字段搬运，不做判断。 */
export function normalizeItem(raw) {
	const a = (raw && (raw.aweme_info || raw.aweme || raw)) || {}
	const au = a.author || {}
	const st = a.statistics || {}
	const v = a.video || {}
	const cover = (v.cover && (v.cover.url_list || [])[0]) || (a.cover && (a.cover.url_list || [])[0]) || ''
	const tags = Array.isArray(a.text_extra)
		? a.text_extra.map((t) => String((t && t.hashtag_name) || '')).filter(Boolean).slice(0, 6)
		: []
	const ct = num(a.create_time)
	return {
		aweme_id: String(a.aweme_id || ''),
		desc: String(a.desc || ''),
		author: { nickname: String(au.nickname || ''), sec_uid: String(au.sec_uid || '') },
		duration_sec: Math.round(num(v.duration) / 1000),
		digg: num(st.digg_count),
		comment: num(st.comment_count),
		share: num(st.share_count),
		tags,
		is_ad: Boolean(a.is_ads || (a.aweme_control && a.aweme_control.is_ad)),
		create_date: ct ? new Date(ct * 1000).toISOString() : '',
		cover,
	}
}

/** 只用来判断「这一页值不值得再翻」：空页、全广告、重复 id 都算到底了。 */
export function pageUsable(items, seen = new Set()) {
	const fresh = (items || []).filter((x) => x && x.aweme_id && !seen.has(x.aweme_id))
	return fresh.length > 0
}

/**
 * 在已登录页面里搜一轮。
 * @returns {Promise<{ok:boolean, items:object[], fetched:number, pages:number, ms:number, via:'api', error?:string}>}
 */
export async function searchFast({ keyword = '', count = 10, pages = 1, gapMs = 400 } = {}) {
	const kw = cleanKeyword(keyword)
	if (kw.length < 2) return { ok: false, via: 'api', error: '关键词太短（接口要求 ≥2 字）', items: [], fetched: 0, pages: 0, ms: 0 }
	const t0 = Date.now()
	const out = []
	const seen = new Set()
	let pageFetched = 0
	let lastErr = ''
	try {
		await withPage('douyin.com', async (c) => {
			for (let p = 0; p < Math.max(1, Math.min(pages, 5)); p++) {
				const q = buildQuery({ keyword: kw, count, offset: p * count })
				/* 用页面自己的 fetch：cookie、签名、UA 都是这个浏览器的，不往外搬任何凭证。 */
				const expr = `(async () => {
					const r = await fetch(${JSON.stringify(SEARCH_PATH + '?' + q)}, { credentials: 'include', headers: { accept: 'application/json' } });
					const text = await r.text();
					let j = null;
					try { j = JSON.parse(text) } catch { return { status: r.status, bad: text.slice(0, 80) } }
					return { status: r.status, code: j.status_code, msg: j.status_msg || '', n: (j.data || []).length, data: j.data || [] };
				})()`
				const res = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
				const v = (res && res.result && res.result.value) || {}
				if (v.bad) { lastErr = '接口回了非 JSON：' + v.bad; break }
				if (v.code && v.code !== 0) { lastErr = `接口 ${v.code}：${v.msg || '（无说明）'}`; break }
				pageFetched++
				for (const it of v.data || []) {
					const n = normalizeItem(it)
					if (!n.aweme_id || seen.has(n.aweme_id)) continue
					seen.add(n.aweme_id)
					out.push(n)
				}
				if (!pageUsable((v.data || []).map(normalizeItem), new Set())) break
				if (p + 1 < pages) await new Promise((r) => setTimeout(r, gapMs))
			}
		})
	} catch (e) {
		return { ok: false, via: 'api', error: String((e && e.message) || e).slice(0, 160), items: out, fetched: out.length, pages: pageFetched, ms: Date.now() - t0 }
	}
	if (!out.length && lastErr) return { ok: false, via: 'api', error: lastErr, items: [], fetched: 0, pages: pageFetched, ms: Date.now() - t0 }
	return { ok: out.length > 0, via: 'api', items: out, fetched: out.length, pages: pageFetched, ms: Date.now() - t0 }
}
