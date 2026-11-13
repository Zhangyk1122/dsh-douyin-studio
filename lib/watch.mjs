/**
 * 「这条视频我看过」的证据面。
 *
 * 2026-11-13 之前，回评论只喂了作品文案前 160 字和对方那句话 ——
 * 说不清她到底有没有看这条，也说不清这条多长、多少人在看。
 *
 * 现在能拿到的真材料有两样，都不花钱、不调模型：
 *   ① `/aweme/v1/web/aweme/detail/` 的投影：时长、赞/评/藏/转、发布时间；
 *   ② 这条下面点赞最高的三条评论（别人在说什么）。
 *
 * 抽帧（把画面真的看一眼）要 vision 模型，本机没有 key，所以这里**不做**，
 * 也不假装做过：`frames: false` 明写在返回值里。
 */

import { detail, comments } from './api.mjs'

const CACHE = new Map()
export const TTL_MS = 30 * 60 * 1000

const num = (v) => {
	const n = Number(v)
	return Number.isFinite(n) ? n : 0
}

/** 只看缓存，不发请求（面板/日报用）。 */
export function cachedWatch(id) {
	return CACHE.get(String(id || '')) || null
}

export function resetWatchCache() {
	CACHE.clear()
}

/** 把 detail + comments 两份原始返回折成「我看过」的事实。纯函数，好测。 */
export function watchOf(id, d, cs) {
	const a = (d && d.aweme) || null
	const list = cs && Array.isArray(cs.list) ? cs.list : []
	const hot = list
		.filter((x) => x && String(x.text || '').trim())
		.map((x) => ({ cid: String(x.cid || ''), text: String(x.text).slice(0, 80), digg: num(x.digg) }))
		.sort((x, y) => y.digg - x.digg)
		.slice(0, 3)
	return {
		ok: Boolean(a),
		id: String(id || ''),
		durationSec: a ? Math.round(num(a.duration_ms) / 1000) : 0,
		desc: a ? String(a.desc || '').slice(0, 200) : '',
		digg: a ? num(a.digg) : 0,
		comment: a ? num(a.comment) : 0,
		collect: a ? num(a.collect) : 0,
		createdAt: a ? String(a.create_date || '') : '',
		hot,
		frames: false,
		at: Date.now(),
	}
}

/**
 * 真去「看」一条：详情 + 热评，30 分钟内同一条只请求一次。
 * 失败不抛 —— 看不到就当没看到，回复照发（材料少一条，不是新 bug）。
 */
export async function watchOnce(id, { ttlMs = TTL_MS } = {}) {
	const key = String(id || '')
	if (!key) return { ok: false, id: '', hot: [], frames: false, at: Date.now() }
	const hit = CACHE.get(key)
	if (hit && Date.now() - hit.at < ttlMs) return hit
	const [d, cs] = await Promise.all([
		detail(key).catch((e) => ({ ok: false, error: String((e && e.message) || e) })),
		comments(key, { count: 20 }).catch(() => ({ ok: false, list: [] })),
	])
	const w = watchOf(key, d, cs)
	CACHE.set(key, w)
	return w
}

/**
 * 一句话交代「我看过什么」。只给事实，不给形容词 ——
 * 「23 秒、1.2 万赞、评论里在说…」比「很好看」有用。
 * 拿不到详情就返回空串，调用方自然少一行提示。
 */
export function watchLine(w) {
	if (!w || !w.ok) return ''
	const parts = []
	if (w.durationSec > 0) parts.push(w.durationSec + ' 秒')
	if (w.digg > 0) parts.push(fmt(w.digg) + ' 赞')
	if (w.comment > 0) parts.push(fmt(w.comment) + ' 条评论')
	const head = parts.length ? '这条视频 ' + parts.join('、') + '。' : ''
	const tail = w.hot && w.hot.length
		? '评论里在说：' + w.hot.slice(0, 3).map((h) => '「' + h.text + '」').join('；') + '。'
		: ''
	return (head + tail).trim()
}

function fmt(n) {
	if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万'
	return String(n)
}
