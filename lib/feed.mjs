/**
 * lib/feed.mjs —— 刷视频（按内容限定刷，不是无尽下滑）
 * ============================================================================
 * 走的是推荐流接口 `/aweme/v1/web/tab/feed/`，**在已登录页面里 fetch**，
 * 不需要 a_bogus（2026-11-02 实测 200 + aweme_list 直接可用）。这和搜索接口是两条路：
 * 搜索 = 我想看某个主题；推荐流 = 平台现在在推什么。
 *
 * 「内容限定」落成四道筛子，顺序就是成本从低到高：
 *   ① 时长（短于 minSec 划走，长于 maxSec 不看——长视频看起来像在看电视）
 *   ② 关键词白名单（allow 命中 desc / 话题 / 作者名）——空 = 不筛
 *   ③ 关键词黑名单（block）+ 广告/直播/带货（这些占了抖音推荐流的一半）
 *   ④ 去重（feed-seen.json 里见过的直接跳过，免得每次刷到同一批）
 *
 * 只读：不点赞、不关注、不评论。要互动是另外的动作，得单独点头。
 * ============================================================================
 */
import { join } from 'node:path'
import { withPage } from './cdp.mjs'
import { homeDir } from './budget.mjs'
import { atomicWriteJson, readJsonChecked } from './fsx.mjs'
import { searchVideo } from './api.mjs'

export const seenFile = () => join(homeDir(), 'feed-seen.json')

const PAGE_JS = (count, idx) => `(async () => {
  var url = '/aweme/v1/web/tab/feed/?' + new URLSearchParams({
    device_platform: 'webapp', aid: '6383', channel: 'channel_pc_web',
    pc_client_type: '1', version_code: '170400', version_name: '17.4.0',
    cookie_enabled: 'true', screen_width: String(screen.width), screen_height: String(screen.height),
    browser_language: 'zh-CN', browser_platform: 'Win32', browser_name: 'Chrome', browser_version: '131.0.0.0',
    browser_online: 'true', engine_name: 'Blink', engine_version: '131.0.0.0', os_name: 'Windows',
    os_version: '10', cpu_core_num: String(navigator.hardwareConcurrency || 8), device_memory: '8',
    platform: 'PC', downlink: '10', effective_type: '4g', round_trip_time: '50',
    count: '${count}', refresh_index: '${idx}',
  });
  var r = await fetch(url, { credentials: 'include', headers: { accept: 'application/json' } });
  var t = await r.text();
  var j = null; try { j = JSON.parse(t) } catch (e) { return JSON.stringify({ ok:false, http:r.status, error:'不是 JSON', head:t.slice(0,200) }) }
  if (!j || !Array.isArray(j.aweme_list)) return JSON.stringify({ ok:false, http:r.status, status_code:j && j.status_code, error:'没有 aweme_list', head:t.slice(0,200) })
  function ms2sec(v){ var s = Number(v)||0; return s > 10000 ? Math.round(s/1000) : s }
  var list = j.aweme_list.map(function(a){
    var st = a.statistics || {}; var au = a.author || {}; var v = a.video || {};
    var tags = (a.text_extra || []).map(function(x){ return String((x && x.hashtag_name) || (x && x.tag_name) || '') }).filter(Boolean);
    return {
      aweme_id: String(a.aweme_id || ''),
      desc: String(a.desc || '').slice(0, 200),
      tags: tags.slice(0, 6),
      author: String(au.nickname || ''),
      author_sec_uid: String(au.sec_uid || ''),
      duration_sec: ms2sec(v.duration || v.duration_ms || a.duration),
      digg: st.digg_count || 0,
      comment: st.comment_count || 0,
      share: st.share_count || 0,
      create_date: a.create_time ? new Date(a.create_time*1000).toISOString().slice(0,19).replace('T',' ') : '',
      is_ad: Boolean(a.is_ad || (a.ad_candidates && a.ad_candidates.length) || (a.is_client_cache && a.ad_info)),
      music: String((a.music || {}).title || ''),
    }
  });
  return JSON.stringify({ ok:true, http:r.status, n:list.length, list:list })
})()`

const loadSeen = () => {
	const { value } = readJsonChecked(seenFile(), { ids: [], updatedAt: '' }, (v) => v && Array.isArray(v.ids))
	return Array.isArray(value.ids) ? value.ids : []
}

const saveSeen = (ids) => {
	const uniq = Array.from(new Set([...loadSeen(), ...ids])).slice(-800)
	return atomicWriteJson(seenFile(), { ids: uniq, updatedAt: new Date().toISOString() })
}

/**
 * 数据源怎么选（2026-11-03 改）：
 *   · 你设了关键词 → **按关键词搜**。这才是"按我的关键词筛"。
 *   · 没设关键词   → 退回推荐流（平台在推什么）。
 *
 * 🔴 以前不管有没有关键词都走推荐流，再用关键词去筛「别人的视频」——
 *    效果是"从别人给你的池子里挑",而不是"去找我要的"。用户看到的仍是随机内容。
 */
export const pickSource = (allow) => (Array.isArray(allow) && allow.length ? 'search' : 'recommend')

/**
 * 四道筛子（纯函数，方便单测）。顺序 = 成本从低到高。
 * @param {{list?:any[], allow?:string[], block?:string[], minSec?:number, maxSec?:number,
 *          minDigg?:number, seen?:Set<string>}} p
 */
export function applyFilters({ list = [], allow = [], block = [], minSec = 0, maxSec = 0, minDigg = 0, seen = new Set() } = {}) {
	const allowL = (allow || []).map((s) => String(s).trim()).filter(Boolean)
	const blockL = (block || []).map((s) => String(s).trim()).filter(Boolean)
	const hay = (v) => `${v.desc || ''} ${(v.tags || []).join(' ')} ${v.author || ''}`.toLowerCase()

	const kept = []
	const dropped = { seen: 0, ad: 0, short: 0, long: 0, allow: 0, block: 0, digg: 0, dup: 0 }
	const batch = new Set()

	for (const v of list) {
		if (!v || !v.aweme_id) continue
		if (batch.has(v.aweme_id)) { dropped.dup++; continue }
		batch.add(v.aweme_id)
		if (seen.has(v.aweme_id)) { dropped.seen++; continue }
		if (v.is_ad) { dropped.ad++; continue }
		const sec = Number(v.duration_sec) || 0
		// 搜索接口不给时长（sec=0）→ 不拿它当"太短"误杀
		if (minSec && sec > 0 && sec < minSec) { dropped.short++; continue }
		if (maxSec && sec > maxSec) { dropped.long++; continue }
		if (minDigg && (Number(v.digg) || 0) < minDigg) { dropped.digg++; continue }
		const h = hay(v)
		if (allowL.length && !allowL.some((k) => h.includes(k.toLowerCase()))) { dropped.allow++; continue }
		const hitBlock = blockL.find((k) => h.includes(k.toLowerCase()))
		if (hitBlock) { dropped.block++; continue }
		kept.push({ ...v, why: [v.via || '推荐流', allowL.length ? '匹配关键词' : '未设关键词'].filter(Boolean) })
	}
	return { kept, dropped }
}

/**
 * 拉一批推荐流，按内容限定过滤。
 * @param {{count?:number, allow?:string[], block?:string[], minSec?:number, maxSec?:number,
 *          minDigg?:number, skipSeen?:boolean, markSeen?:boolean, limit?:number}} p
 */
export async function browse({
	count = 20, allow = [], block = [], minSec = 0, maxSec = 0,
	minDigg = 0, skipSeen = true, markSeen = false, limit = 20, rounds = 3,
} = {}) {
	const n = Math.max(1, Math.min(Number(count) || 20, 50))
	const loops = Math.max(1, Math.min(Number(rounds) || 1, 6))
	const allowL = (allow || []).map((s) => String(s).trim()).filter(Boolean)
	const blockL = (block || []).map((s) => String(s).trim()).filter(Boolean)
	const source = pickSource(allowL)

	const list = []
	let lastErr = null

	if (source === 'search') {
		/* 按关键词搜。每个词各搜一批再合起来 —— 一个词的结果太单薄，
		 * 而且用户设多个词本来就是要覆盖几个方向。 */
		for (const kw of allowL.slice(0, 4)) {
			try {
				const r = await searchVideo({ keyword: kw, count: n })
				if (r && r.ok && Array.isArray(r.list)) {
					for (const it of r.list) {
						if (it.kind !== 'aweme' || !it.aweme_id) continue
						// 搜索接口没有 tags / 时长 / 广告标记 —— 归一成推荐流那套字段，
						// 后面的筛子才能一套代码跑两种源
						list.push({
							aweme_id: String(it.aweme_id),
							desc: String(it.desc || ''),
							tags: [],
							author: String(it.author || ''),
							author_sec_uid: String(it.sec_uid || ''),
							duration_sec: 0,
							digg: Number(it.digg) || 0,
							comment: Number(it.comment) || 0,
							share: 0,
							create_date: String(it.create_date || ''),
							is_ad: false,
							music: '',
							via: '关键词:' + kw,
						})
					}
				} else lastErr = (r && (r.error || r.status_msg)) || '这个词没搜到'
			} catch (e) { lastErr = String((e && e.message) || e) }
			await new Promise((r) => setTimeout(r, 600))
		}
	} else {
		/* 推荐流一次只回 2-3 条（PC 端就是这样），所以多刷几轮拼起来。
		 * refresh_index 每次 +1，拿到的不是同一批；去重留给 applyFilters。 */
		for (let i = 1; i <= loops; i++) {
			let raw = null
			try {
				raw = await withPage('www.douyin.com', async (c) => c.evaluate(PAGE_JS(n, i), { timeout: 45000 }))
			} catch (e) {
				lastErr = String((e && e.message) || e)
				continue
			}
			let page = null
			try { page = JSON.parse(raw) } catch {
				lastErr = '页面没返回 JSON: ' + String(raw || '').slice(0, 120)
				continue
			}
			if (!page.ok) { lastErr = page.error || '推荐流没拿到'; continue }
			list.push(...(page.list || []).map((v) => ({ ...v, via: '推荐流' })))
			if (i < loops) await new Promise((r) => setTimeout(r, 700))
		}
	}

	if (!list.length) {
		return { ok: false, source, error: lastErr || (source === 'search' ? '关键词一条都没搜到' : '推荐流一条都没拿到') }
	}

	const seen = skipSeen ? new Set(loadSeen()) : new Set()
	const { kept, dropped } = applyFilters({ list, allow: allowL, block: blockL, minSec, maxSec, minDigg, seen })

	if (markSeen) saveSeen(kept.map((v) => v.aweme_id))
	return {
		ok: true,
		source,
		fetched: list.length,
		kept: kept.length,
		dropped,
		allow: allowL, block: blockL, minSec, maxSec, minDigg,
		items: kept.slice(0, Math.max(1, Math.min(Number(limit) || 20, 50))),
	}
}

/** 看过的记下来（单独调也行） */
export function markSeen(ids = []) {
	const r = saveSeen(ids.map(String))
	return { ok: r.ok, n: ids.length, file: seenFile() }
}

/** 清空去重表（想重新看到同一批时用） */
export function resetSeen() {
	const r = atomicWriteJson(seenFile(), { ids: [], updatedAt: new Date().toISOString() })
	return { ok: r.ok, file: seenFile() }
}

/** 去重表规模 */
export function seenStats() {
	const ids = loadSeen()
	return { n: ids.length, file: seenFile() }
}
