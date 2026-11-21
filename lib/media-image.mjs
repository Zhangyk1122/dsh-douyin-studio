/**
 * lib/media-image.mjs —— 把图文作品的图片下载下来、缩小、交给视觉模型
 * ============================================================================
 * 实测（2026-11-21）：图文作品 aweme_type=68，detail 里 images[] 是抖音图床直链；
 * 带 Referer + UA 能直接下（偶发 connection reset，重试一次即可）；
 * 原图 2688x1792 webp 581KB → 1024 宽 jpg 56KB → 视觉模型 prompt_tokens 约 485。
 *
 * 注意：抖音图床对「无 UA」也放行，但带 UA 更稳；缩图必须做，否则 token 会翻好几倍。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { FFMPEG, UA, REFERER } from './frames.mjs'

const outRoot = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'douyin-studio', 'img-cache')

async function fetchOnce(url, timeoutMs = 20000) {
	const ctl = new AbortController()
	const t = setTimeout(() => ctl.abort(), timeoutMs)
	try {
		const r = await fetch(url, {
			signal: ctl.signal,
			headers: {
				'Referer': REFERER,
				'User-Agent': UA,
				'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
			},
		})
		if (!r.ok) return { ok: false, error: 'HTTP ' + r.status }
		const b = Buffer.from(await r.arrayBuffer())
		if (!b.length) return { ok: false, error: '空响应' }
		return { ok: true, buffer: b }
	} catch (e) {
		return { ok: false, error: String((e && e.message) || e) }
	} finally { clearTimeout(t) }
}

/** 下载一张图（失败重试一次），返回本地原始文件路径。 */
async function downloadOne(url, destBase) {
	let r = await fetchOnce(url)
	if (!r.ok) r = await fetchOnce(url) /* 图床偶发 reset，重试一次 */
	if (!r.ok) return { ok: false, error: r.error }
	const raw = destBase + '.raw'
	try {
		const fs = await import('node:fs/promises')
		await fs.writeFile(raw, r.buffer)
	} catch (e) { return { ok: false, error: '写文件失败: ' + String(e.message || e) } }
	return { ok: true, path: raw, bytes: r.buffer.length }
}

/** 用 ffmpeg 缩到指定宽度并转 jpg（视觉模型只吃得了这么大，再大是浪费 token）。 */
function shrink(rawPath, outPath, maxWidth = 1024) {
	try {
		const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', rawPath, '-vf', 'scale=' + maxWidth + ':-2', '-q:v', '5', outPath], { timeout: 30000 })
		if (r.status !== 0 || !existsSync(outPath)) return { ok: false, error: 'ffmpeg 缩图失败' }
		return { ok: true, path: outPath, bytes: statSync(outPath).size }
	} catch (e) { return { ok: false, error: String(e.message || e) } }
}

/** 目录瘦身：按修改时间保留最近 keep 个文件。 */
export function prune(dir = outRoot(), keep = 60) {
	try {
		if (!existsSync(dir)) return 0
		const files = readdirSync(dir).map((f) => join(dir, f)).filter((f) => { try { return statSync(f).isFile() } catch { return false } })
		files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
		let n = 0
		for (const f of files.slice(keep)) { try { unlinkSync(f); n++ } catch { /* 删不掉就算了 */ } }
		return n
	} catch { return 0 }
}

/**
 * 下载一组图片并缩小。
 * @param {string[]} urls 抖音图床直链
 * @param {{max?:number, maxWidth?:number, key?:string}} o
 * @returns {Promise<{ok:boolean, files:string[], errors:string[]}>}
 */
export async function prepareImages(urls, { max = 3, maxWidth = 1024, key = 'aweme' } = {}) {
	const list = (Array.isArray(urls) ? urls : []).filter((u) => typeof u === 'string' && /^https?:/i.test(u)).slice(0, Math.max(1, Number(max) || 3))
	if (!list.length) return { ok: false, files: [], errors: ['没有图片地址'] }
	const dir = outRoot()
	try { mkdirSync(dir, { recursive: true }) } catch { /* 已存在 */ }
	const safeKey = String(key || 'aweme').replace(/[^\w-]/g, '')
	const files = [], errors = []
	for (let i = 0; i < list.length; i++) {
		const base = join(dir, safeKey + '-' + i)
		const d = await downloadOne(list[i], base)
		if (!d.ok) { errors.push('第' + (i + 1) + '张下载失败: ' + d.error); continue }
		const out = base + '.jpg'
		const s = shrink(d.path, out, maxWidth)
		if (!s.ok) { errors.push('第' + (i + 1) + '张缩图失败: ' + s.error); continue }
		files.push(out)
	}
	prune(dir)
	return { ok: files.length > 0, files, errors }
}
