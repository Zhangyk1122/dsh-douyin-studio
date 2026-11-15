/**
 * 「这条视频我看过」的证据面。
 *
 * 2026-11-13 之前，回评论只喂了作品文案前 160 字和对方那句话 ——
 * 说不清她到底有没有看这条，也说不清这条多长、多少人在看。
 *
 * 现在能拿到的真材料有三样：
 *   ① `/aweme/v1/web/aweme/detail/` 的投影：时长、赞/评/藏/转、发布时间；
 *   ② 这条下面点赞最高的三条评论（别人在说什么）；
 *   ③ **画面**（2026-11-15 接上）：详情里就带播放直链，ffmpeg 直接抽成一张拼图，
 *      不用先下载整片。抽了才说抽了 —— 没抽就是 `frames: false`，绝不假装看过。
 *
 * 抽帧只是把证据摆出来；「看到了什么」要由真的看过那张图的调用方写（agent 的
 * read_image / vision 通道）。这里不生成任何画面描述。
 */

import { join } from 'node:path'
import { detail, comments } from './api.mjs'
import { grabFrames } from './frames.mjs'
import { homeDir } from './budget.mjs'

const CACHE = new Map()
export const TTL_MS = 30 * 60 * 1000

/** 拼图落盘目录：跟着数据走，不塞进仓库 */
export const framesDir = () => join(homeDir(), 'frames')

/**
 * 格数 → 网格。短片 6 格就够（每格 2.5 秒），一分钟以上的要更多格才不漏镜头。
 * 纯函数，好测。
 */
export function gridOf(cells = 6) {
	const n = Math.round(Number(cells) || 6)
	if (n <= 6) return { cols: 3, rows: 2, cells: 6 }
	if (n <= 9) return { cols: 3, rows: 3, cells: 9 }
	if (n <= 12) return { cols: 4, rows: 3, cells: 12 }
	if (n <= 16) return { cols: 4, rows: 4, cells: 16 }
	return { cols: 5, rows: 4, cells: 20 }
}

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
		/* 播放直链只在内存里过一道，不写任何账本：它带签名会过期，存下来只会变成坏链接 */
		playUrl: a ? String(a.play_url || '') : '',
		size: a && a.width && a.height ? a.width + 'x' + a.height : '',
		hot,
		frames: false,
		sheet: '',
		at: Date.now(),
	}
}

/**
 * 真去「看」一条：详情 + 热评，30 分钟内同一条只请求一次。
 * 失败不抛 —— 看不到就当没看到，回复照发（材料少一条，不是新 bug）。
 *
 * `frames: true` 才会去拉 ffmpeg 抽拼图。默认不抽：
 * 刷推荐一轮可能要看十几条，每条都解码一遍纯属浪费。
 * 抽过的那条会带 `sheet`（图片绝对路径）和 `cells`，调用方拿去 `read_image` 就是「真的看了」。
 */
export async function watchOnce(id, { ttlMs = TTL_MS, frames = false, cells = 6, outDir = '' } = {}) {
	const base = String(id || '')
	if (!base) return { ok: false, id: '', hot: [], frames: false, sheet: '', at: Date.now() }
	/* 抽过帧的和没抽的不能共用一条缓存 —— 否则第一次不抽、第二次要抽时拿到的是 frames:false 的旧账 */
	const key = frames ? base + '#frames' : base
	const hit = CACHE.get(key)
	if (hit && Date.now() - hit.at < ttlMs) return hit

	const [d, cs] = await Promise.all([
		detail(base).catch((e) => ({ ok: false, error: String((e && e.message) || e) })),
		comments(base, { count: 20 }).catch(() => ({ ok: false, list: [] })),
	])
	const w = watchOf(base, d, cs)

	if (frames && w.ok && w.playUrl) {
		const g = gridOf(cells)
		const fr = await grabFrames({
			video: w.playUrl,
			outDir: outDir || framesDir(),
			aweme: base,
			durationSec: w.durationSec || 15,
			cols: g.cols,
			rows: g.rows,
		}).catch((e) => ({ ok: false, error: String((e && e.message) || e) }))
		w.frames = Boolean(fr.ok)
		w.sheet = fr.ok ? String(fr.file || '') : ''
		w.sheetBytes = fr.ok ? num(fr.bytes) : 0
		w.cells = fr.ok ? num(fr.cells) : 0
		w.grid = fr.ok ? fr.cols + 'x' + fr.rows : ''
		w.secPerCell = fr.ok && fr.cells ? Number(((w.durationSec || 15) / fr.cells).toFixed(2)) : 0
		w.frameError = fr.ok ? '' : String(fr.error || '抽帧失败').slice(0, 160)
	} else if (frames && w.ok && !w.playUrl) {
		w.frameError = '这条没有播放直链（多半是图文/图集）'
	}

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
