/**
 * 收藏表情包：从评论 / 私信里把别人发的图收进本地库。
 *
 * 为什么不能直接「点一下收藏」：平台侧没有「把这张图加进我的表情」的接口，
 * 唯一稳的做法是把图**下载下来**存本地，发的时候当图片发出去。
 * 下载走页面内的 `fetch`（带着登录态，不额外造请求头），
 * 拿 blob → FileReader → base64 → 落盘 → 进库。
 */

import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addSticker } from './stickers.mjs'

/** 一条评论/私信里可能带图的所有位置，能捞多少捞多少。 */
export function imageUrlsOf(item = {}) {
	const out = []
	const push = (u) => {
		const s = String(u || '').trim()
		if (!s) return
		if (!/^https?:\/\//i.test(s)) return
		if (!out.includes(s)) out.push(s)
	}
	const lists = [item.image_list, item.images, item.image_urls]
	for (const l of lists) {
		if (!Array.isArray(l)) continue
		for (const it of l) {
			if (typeof it === 'string') push(it)
			else if (it && typeof it === 'object') {
				if (Array.isArray(it.url_list)) it.url_list.forEach(push)
				else push(it.url || it.uri || '')
			}
		}
	}
	if (item.sticker && typeof item.sticker === 'object') {
		if (Array.isArray(item.sticker.url_list)) item.sticker.url_list.forEach(push)
		else push(item.sticker.url || '')
	}
	return out
}

/**
 * 决定这一批要下哪几张：去掉重复、限制张数、跳过明显的小图标。
 * 纯函数，方便测。
 */
export function planCollect(items = [], { max = 8, minBytes = 0, seen = [] } = {}) {
	const seenSet = new Set(seen.map(String))
	const picked = []
	const skipped = []
	for (const it of items) {
		for (const url of imageUrlsOf(it)) {
			if (seenSet.has(url)) {
				skipped.push({ url, why: 'already-had' })
				continue
			}
			if (picked.length >= max) break
			seenSet.add(url)
			picked.push({
				url,
				nick: String(it.nick || it.author_nick || ''),
				uid: String(it.uid || it.author_id || ''),
				aweme: String(it.aweme_id || ''),
				cid: String(it.cid || it.comment_id || '')
			})
		}
	}
	if (minBytes > 0) {
		/* 只有下载完才知道大小，这里保留参数位置给调用方过滤 */
	}
	return { picked, skipped }
}

/** 在页面里把图读成 base64（带登录态，CORS 也照拿）。 */
export function fetchAsBase64Js(url) {
	return `(async () => {
  const r = await fetch(${JSON.stringify(url)}, { credentials: 'include' })
  if (!r.ok) return JSON.stringify({ ok:false, http:r.status })
  const b = await r.blob()
  const buf = await new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(String(fr.result).split(',')[1] || '')
    fr.onerror = () => rej(new Error('read failed'))
    fr.readAsDataURL(b)
  })
  return JSON.stringify({ ok:true, type: b.type || '', size: b.size, b64: buf })
})()`
}

/** 把 base64 落成临时文件，交给 stickers.add 去查重与入库。 */
export function saveBase64(b64, { ext = '.jpg', dir = '' } = {}) {
	const base = dir || mkdtempSync(join(tmpdir(), 'dy-sticker-'))
	const file = join(base, 'pick_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + ext)
	writeFileSync(file, Buffer.from(String(b64 || ''), 'base64'))
	return file
}

/**
 * 真正收：items → 逐张下载 → 入库。
 * `evaluate` 由调用方给（通常是 lib/cdp.mjs 的 evaluate），测试里可以换成假函数。
 */
export async function collectStickers(items, { evaluate, max = 8, mood = '', tags = [], dir = '', seen = [] } = {}) {
	if (typeof evaluate !== 'function') return { ok: false, error: '没有可用的 evaluate（拿不到页面）' }
	const { picked } = planCollect(items, { max, seen })
	const added = []
	const failed = []
	for (const p of picked) {
		try {
			const raw = await evaluate(fetchAsBase64Js(p.url))
			const j = typeof raw === 'string' ? JSON.parse(raw) : raw
			if (!j || !j.ok || !j.b64) {
				failed.push({ url: p.url, why: (j && j.http) ? 'http ' + j.http : '没拿到内容' })
				continue
			}
			const ext = /png/i.test(j.type) ? '.png' : /gif/i.test(j.type) ? '.gif' : /webp/i.test(j.type) ? '.webp' : '.jpg'
			const file = saveBase64(j.b64, { ext, dir })
			const r = addSticker(file, {
				tags: [...tags, ...(p.nick ? [p.nick] : [])],
				mood,
				name: 'from ' + (p.nick || 'comment')
			})
			if (r.ok) added.push({ url: p.url, id: r.id, dupe: r.dupe, bytes: j.size })
			else failed.push({ url: p.url, why: r.error })
		} catch (e) {
			failed.push({ url: p.url, why: String((e && e.message) || e) })
		}
	}
	return { ok: true, added, failed, picked: picked.length }
}
