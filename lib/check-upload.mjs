/**
 * lib/check-upload.mjs —— 上传前本地校验：不合格的东西别白传一次
 * ============================================================================
 * 灵感来自 `WJZ-P/douyin-upload-mcp-skill`：它在本地就把尺寸/时长/大小拦掉，
 * 省的是「传了 3 分钟才发现比例不对」那种浪费。
 *
 * 一次能查的（全部本地读文件头，不联网）：
 *   · 存在、可读、大小
 *   · 图片真实像素（PNG / JPEG / WebP，自己解文件头，不装库）
 *   · 比例（抖音不建议超过 1:2，推荐 3:4 或 4:3）
 *   · 数量（图文最多 35 张）
 *   · 视频时长（有 ffprobe 才查，没有就只报大小）
 * ============================================================================
 */
import { openSync, readSync, closeSync, statSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

export const LIMITS = {
	imageMaxBytes: 50 * 1024 * 1024,
	imageMaxCount: 35,
	videoMaxBytes: 16 * 1024 * 1024 * 1024, // 16G
	ratioWarn: 2,     // 宽/高 或 高/宽 超过 2 → 劝一句
	// ⚠️ 视频标题也是 30（2026-11-03 对齐 lib/publish.mjs:58 与 publish-cli.mjs:125）。
	// 之前这里写 55，31–55 字的标题会过预检、到发布页才被拒 —— 白传一趟。
	titleMax: { image: 20, video: 30 },
}

const readHead = (file, bytes = 64 * 1024) => {
	const fd = openSync(file, 'r')
	try {
		const buf = Buffer.alloc(bytes)
		const n = readSync(fd, buf, 0, bytes, 0)
		return buf.subarray(0, n)
	} finally { closeSync(fd) }
}

/** PNG：IHDR 里第 16..24 字节是宽高 */
function pngSize(b) {
	if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null
	return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

/** JPEG：一路扫 SOFn 段 */
function jpegSize(b) {
	if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
	let i = 2
	while (i + 9 < b.length) {
		if (b[i] !== 0xff) { i++; continue }
		const m = b[i + 1]
		if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
			return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }
		}
		const len = b.readUInt16BE(i + 2)
		if (len <= 0) break
		i += 2 + len
	}
	return null
}

/** WebP：VP8 / VP8L / VP8X 三种头 */
function webpSize(b) {
	if (b.length < 30 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null
	const kind = b.toString('ascii', 12, 16)
	if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff }
	if (kind === 'VP8L') {
		const bits = b.readUInt32LE(21)
		return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 }
	}
	if (kind === 'VP8X') return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 }
	return null
}

export function imageSize(file) {
	const b = readHead(file)
	return pngSize(b) || jpegSize(b) || webpSize(b) || null
}

const ffprobe = () => {
	const r = spawnSync('ffprobe', ['-version'], { encoding: 'utf8', windowsHide: true })
	return r.status === 0
}

export function videoInfo(file) {
	const out = { duration_s: null, w: null, h: null, hasAudio: null }
	if (!ffprobe()) return out
	const r = spawnSync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', file],
		{ encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
	if (r.status !== 0) return out
	try {
		const j = JSON.parse(r.stdout)
		const v = (j.streams || []).find((s) => s.codec_type === 'video')
		if (v) { out.w = v.width || null; out.h = v.height || null }
		out.hasAudio = (j.streams || []).some((s) => s.codec_type === 'audio')
		out.duration_s = j.format && j.format.duration ? Math.round(Number(j.format.duration)) : null
	} catch { /* 坏文件就返回空 */ }
	return out
}

/**
 * 一次查完。返回 `{ ok, kind, items, errors, warnings }`。
 * `ok` 只看 errors；warnings 是「能发但不理想」，别拦人。
 */
export function checkFiles(files = []) {
	const errors = []
	const warnings = []
	const items = []
	const list = (Array.isArray(files) ? files : [files]).filter(Boolean)
	if (!list.length) return { ok: false, kind: null, items, errors: ['没给文件'], warnings }

	const video = list.some((f) => /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(f))
	const kind = video ? 'video' : 'image'

	if (kind === 'image' && list.length > LIMITS.imageMaxCount) {
		errors.push(`图文最多 ${LIMITS.imageMaxCount} 张，现在 ${list.length} 张`)
	}
	if (kind === 'video' && list.length > 1) errors.push('视频一次只能一条')

	for (const f of list) {
		if (!existsSync(f)) { errors.push('文件不存在: ' + f); continue }
		const st = statSync(f)
		const item = { file: f, bytes: st.size, mb: +(st.size / 1048576).toFixed(2), w: null, h: null, ratio: null }

		if (kind === 'image') {
			if (!/\.(jpe?g|png|webp)$/i.test(f)) errors.push('不支持的图片格式（只要 jpg/png/webp，gif 不收）: ' + f)
			if (st.size > LIMITS.imageMaxBytes) errors.push(`图片超过 50MB（${item.mb}MB）: ${f}`)
			const size = imageSize(f)
			if (!size) warnings.push('读不出像素尺寸（文件可能损坏或格式怪）: ' + f)
			else {
				item.w = size.w; item.h = size.h
				item.ratio = +(size.w / size.h).toFixed(3)
				const r = size.w >= size.h ? size.w / size.h : size.h / size.w
				if (r > LIMITS.ratioWarn) warnings.push(`比例 ${size.w}×${size.h} 超过 1:2，抖音会裁得很难看: ${f}`)
				if (size.w < 400 || size.h < 400) warnings.push(`图太小（${size.w}×${size.h}），发出来会糊: ${f}`)
			}
		} else {
			if (st.size > LIMITS.videoMaxBytes) errors.push(`视频超过 16G（${item.mb}MB）: ${f}`)
			const v = videoInfo(f)
			item.w = v.w; item.h = v.h
			item.duration_s = v.duration_s
			item.ratio = v.w && v.h ? +(v.w / v.h).toFixed(3) : null
			if (v.duration_s && v.duration_s > 3600) errors.push(`视频 ${v.duration_s}s 超过 1 小时: ${f}`)
			if (v.duration_s && v.duration_s < 3) warnings.push(`视频只有 ${v.duration_s}s，可能发不出去: ${f}`)
			if (!v.hasAudio && v.duration_s) warnings.push('这条视频没有音轨（抖音允许，但少了点什么）: ' + f)
			if (!ffprobe()) warnings.push('没装 ffprobe，时长/分辨率没查（只查了大小）')
		}
		items.push(item)
	}

	return { ok: errors.length === 0, kind, items, errors, warnings, limits: LIMITS }
}
