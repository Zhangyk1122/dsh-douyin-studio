/**
 * 本地表情包库。
 *
 * 平台没有「把这张图加进我的表情」的公开接口，能做的只有本地这一半：
 *   ① 别人发来的图，下载进 `$DOUYIN_STUDIO_HOME/stickers/`
 *   ② 要发的时候，把本地图当**图片评论 / 图片消息**发出去
 *
 * 所以这个模块只管：收、查重、按心情挑、限大小、记用过几次。
 * 真正的发送在 api 层，这里不碰网络。
 *
 * 为什么按「用过几次」挑而不是随机：同一张图连发三次就像复读机，
 * 真人会换着用，但也不会把最爱的那个永远压箱底 —— 用热度做反比权重刚刚好。
 */

import { createHash } from 'node:crypto'
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	unlinkSync
} from 'node:fs'
import { basename, extname, join } from 'node:path'
import { atomicWriteJson, readJsonSafe } from './fsx.mjs'
import { studioHome } from './killswitch.mjs'

/** 单张上限：抖音评论带图/私信图片都给不了太大，4MB 是保守值。 */
export const MAX_BYTES = 4 * 1024 * 1024
export const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])
/** 库容量上限，超了丢「最久没用过」的。 */
export const MAX_ITEMS = 300

export const stickersDir = () => join(studioHome(), 'stickers')
export const indexFile = () => join(stickersDir(), 'index.json')

function ensureDir() {
	const d = stickersDir()
	if (!existsSync(d)) mkdirSync(d, { recursive: true })
	return d
}

export function hashFile(file) {
	return createHash('sha1').update(readFileSync(file)).digest('hex')
}

export function readIndex() {
	const raw = readJsonSafe(indexFile(), { items: [] })
	const items = Array.isArray(raw && raw.items) ? raw.items : []
	return {
		version: 1,
		items: items
			.filter((x) => x && typeof x.id === 'string' && typeof x.file === 'string')
			.map((x) => ({
				id: x.id,
				file: x.file,
				name: String(x.name || ''),
				bytes: Number(x.bytes) || 0,
				hash: String(x.hash || ''),
				tags: Array.isArray(x.tags) ? x.tags.map(String).slice(0, 8) : [],
				mood: String(x.mood || ''),
				addedAt: String(x.addedAt || ''),
				used: Number(x.used) || 0,
				lastUsedAt: String(x.lastUsedAt || '')
			}))
	}
}

export function writeIndex(idx) {
	ensureDir()
	atomicWriteJson(indexFile(), { version: 1, items: (idx && idx.items) || [] })
}

/** 收一张图进库。重复（同 hash）不重复存，只补标签。 */
export function addSticker(file, { tags = [], mood = '', name = '', now = new Date() } = {}) {
	const src = String(file || '')
	if (!src) return { ok: false, error: '没有给文件路径' }
	if (!existsSync(src)) return { ok: false, error: '文件不存在：' + src }
	const ext = extname(src).toLowerCase()
	if (!ALLOWED_EXT.has(ext)) {
		return { ok: false, error: '只收 jpg / png / gif / webp，这个是 ' + (ext || '无扩展名') }
	}
	const size = statSync(src).size
	if (size > MAX_BYTES) {
		return { ok: false, error: `图太大（${Math.round(size / 1024)}KB > ${MAX_BYTES / 1024}KB）` }
	}

	const hash = hashFile(src)
	const idx = readIndex()
	const dupe = idx.items.find((x) => x.hash === hash)
	if (dupe) {
		const merged = Array.from(new Set([...(dupe.tags || []), ...tags.map(String)]))
		dupe.tags = merged.slice(0, 8)
		if (mood && !dupe.mood) dupe.mood = String(mood)
		writeIndex(idx)
		return { ok: true, dupe: true, id: dupe.id, tags: dupe.tags }
	}

	const id = 'st_' + hash.slice(0, 10)
	const target = join(ensureDir(), id + ext)
	try {
		copyFileSync(src, target)
	} catch (e) {
		return { ok: false, error: '拷进库失败：' + String((e && e.message) || e) }
	}

	idx.items.push({
		id,
		file: target,
		name: String(name || basename(src)),
		bytes: size,
		hash,
		tags: tags.map(String).slice(0, 8),
		mood: String(mood || ''),
		addedAt: now.toISOString(),
		used: 0,
		lastUsedAt: ''
	})

	// 超容量：先丢「从没用过 + 加得最早」的
	while (idx.items.length > MAX_ITEMS) {
		const victim = idx.items
			.slice()
			.sort((a, b) => (a.used - b.used) || String(a.addedAt).localeCompare(String(b.addedAt)))[0]
		idx.items = idx.items.filter((x) => x.id !== victim.id)
		try {
			if (existsSync(victim.file)) unlinkSync(victim.file)
		} catch {
			/* 文件被占用就留着，索引里已经没有它了 */
		}
	}

	writeIndex(idx)
	return { ok: true, dupe: false, id, bytes: size, tags: idx.items[idx.items.length - 1].tags }
}

export function listStickers({ mood = '', tag = '', limit = 50 } = {}) {
	const idx = readIndex()
	let items = idx.items.slice()
	if (mood) items = items.filter((x) => x.mood === mood)
	if (tag) items = items.filter((x) => (x.tags || []).includes(tag))
	items.sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)))
	return items.slice(0, Math.max(1, Math.min(200, Number(limit) || 50)))
}

/**
 * 挑一张。纯函数部分单独拆出来，方便测试（不读盘）。
 * 排序：心情匹配 +2，标签命中 +1，用得越少越靠前，同等情况下加得越晚越靠前。
 */
export function rankStickers(items, { mood = '', tags = [], now = Date.now(), cooldownH = 6 } = {}) {
	const want = new Set(tags.map(String))
	return (items || [])
		.map((x) => {
			let score = 0
			if (mood && x.mood === mood) score += 2
			/* 刚发过的那张降权：防复读。冷却期按小时算，过期自然恢复。 */
			const last = Date.parse(x.lastUsedAt || '') || 0
			if (last && now - last < cooldownH * 3600000) score -= 3
			for (const t of x.tags || []) if (want.has(t)) score += 1
			return { item: x, score }
		})
		.sort((a, b) => (b.score - a.score) || (a.item.used - b.item.used) || String(b.item.addedAt).localeCompare(String(a.item.addedAt)))
		.map((x) => x.item)
}

export function pickSticker({ mood = '', tags = [], now = Date.now(), cooldownH = 6 } = {}) {
	const ranked = rankStickers(readIndex().items, { mood, tags, now, cooldownH })
	return ranked[0] || null
}

/** 按场景挑一张：@ 用「分享」那类，私信用「软」的，回评用「回话」那类。 */
export const CONTEXT_MOOD = { at: 'share', share: 'share', dm: 'soft', reply: 'reply', comment: 'reply', publish: 'happy' }

export function pickForContext({ kind = '', text = '', tags = [], now = Date.now(), cooldownH = 6 } = {}) {
	const mood = CONTEXT_MOOD[kind] || ''
	const want = [...new Set([...(tags || []), ...String(text || '').split(/[\s,，]+/).filter((w) => w.length >= 2)])]
	return pickSticker({ mood, tags: want, now, cooldownH })
}

/** 发出去之后记一笔，下次挑的时候会往后排。 */
export function markStickerUsed(id, now = new Date()) {
	const idx = readIndex()
	const it = idx.items.find((x) => x.id === id)
	if (!it) return { ok: false, error: '库里没有这张' }
	it.used = (Number(it.used) || 0) + 1
	it.lastUsedAt = now.toISOString()
	writeIndex(idx)
	return { ok: true, id, used: it.used }
}

export function removeSticker(id) {
	const idx = readIndex()
	const it = idx.items.find((x) => x.id === id)
	if (!it) return { ok: false, error: '库里没有这张' }
	idx.items = idx.items.filter((x) => x.id !== id)
	writeIndex(idx)
	try {
		if (existsSync(it.file)) unlinkSync(it.file)
	} catch {
		/* 删不掉文件不影响索引 */
	}
	return { ok: true, id }
}

export function stickerStats() {
	const idx = readIndex()
	const bytes = idx.items.reduce((n, x) => n + (Number(x.bytes) || 0), 0)
	const moods = {}
	for (const x of idx.items) if (x.mood) moods[x.mood] = (moods[x.mood] || 0) + 1
	return { count: idx.items.length, bytes, moods, dir: stickersDir() }
}
