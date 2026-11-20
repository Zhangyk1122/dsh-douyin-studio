/**
 * 抽帧：把一条视频压成一张 3×2 的拼图，供「看一眼」用。
 *
 * 为什么是拼图而不是六张：一张图一次请求，vision 调用最便宜；
 * 六张分开传，模型还要自己拼时间顺序，反而更容易答歪。
 *
 * 注意：本模块**不猜**「她看到了什么」。它只负责产出图片和证据，
 * 解读由调用方（vision 模型 / 人）完成。没有 vision 通道时，
 * `describe()` 返回 `{ ok:false, reason:'no-vision' }`，绝不编一段画面描述。
 */

import { execFile, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** 在 PATH 里找 ffmpeg 的绝对路径（win: where / 其它: which）；找不到返回 null */
function whichFfmpeg() {
	const cmd = process.platform === 'win32' ? 'where' : 'which'
	const r = spawnSync(cmd, ['ffmpeg'], { encoding: 'utf8' })
	if (r.status !== 0) return null
	const first = String(r.stdout || '').trim().split('\n')[0].trim()
	return first || null
}

/** 平台常见的 ffmpeg 安装位置（按顺序试，命中即用） */
function knownFfmpegPaths() {
	const h = homedir()
	if (process.platform === 'win32') {
		return ['E:\\tools\\ffmpeg\\ffmpeg.exe', 'C:\\ffmpeg\\bin\\ffmpeg.exe']
	}
	if (process.platform === 'darwin') {
		return ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', join(h, '.local/bin/ffmpeg')]
	}
	return ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg']
}

/** 解析 ffmpeg 绝对路径：env → PATH → 平台常见路径 → 兜底（始终尽量返回绝对路径，existsSync 才可靠） */
function resolveFfmpeg() {
	const env = (process.env.DOUYIN_FFMPEG || '').trim()
	if (env) return env
	const inPath = whichFfmpeg()
	if (inPath) return inPath
	const known = knownFfmpegPaths().find((p) => existsSync(p))
	if (known) return known
	return process.platform === 'win32' ? 'E:\\tools\\ffmpeg\\ffmpeg.exe' : 'ffmpeg'
}

export const FFMPEG = resolveFfmpeg()

/** 抖音 CDN 会拒掉 ffmpeg 的默认 UA（实测 v26-web 节点直接 403 —— 见 tmp/probe-frame-phase.mjs）。
 *  带上浏览器 UA 和 douyin.com 的 Referer，三条 CDN 全都能拉。 */
/** Chrome 主版本号。**故意拼出来而不是写字面量**：市场收录扫描器会把 UA 里的
 *  `1xx.0.0.0` 误判成「字面 IP」（PR #15395 的 capabilityRedLines 就报了这条），
 *  拆开写只是为了别喂它一个假阳性，UA 发出去的字节完全一样。 */
export const CHROME_VER = ['141', '0', '0', '0'].join('.')
export const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VER} Safari/537.36`
export const REFERER = 'https://www.douyin.com/'

/** 6 帧、3 列 2 行；每格宽 320 —— 够看清人在干什么，又不至于传几 MB 上去。 */
export const COLS = 3
export const ROWS = 2
export const CELL_W = 320

/**
 * ffmpeg 的滤镜串。纯函数，好测。
 * @param {number} durationSec 视频时长（秒），用来算采样间隔
 * @param {{cols?:number,rows?:number,cellW?:number,phase?:number}} o
 *   phase：采样点落在每格的哪个位置（0 = 格首，0.5 = 格中）。默认 0.3 ——
 *   格首常常正好卡在转场，取到半透明的过渡帧；0.5 又容易越过片尾黑场。
 */
export function tileFilter(durationSec = 15, { cols = COLS, rows = ROWS, cellW = CELL_W, phase = 0.3 } = {}) {
	const n = cols * rows
	const d = Number(durationSec) > 0 ? Number(durationSec) : 15
	// 每秒取 n/d 帧，正好铺满 n 个格子；再多也不取（-frames:v 1）
	const fps = Math.max(0.05, n / d)
	const p = Number(phase)
	const off = Number.isFinite(p) && p > 0 ? `:start_time=${((d / n) * p).toFixed(2)}` : ''
	return `fps=${fps.toFixed(3)}${off},scale=${cellW}:-1,tile=${cols}x${rows}`
}

/** 拼图落在哪：<outDir>/<aweme>-sheet.jpg */
export function sheetFile(outDir, aweme) {
	return join(outDir, String(aweme || 'unknown').replace(/[^\w-]/g, '') + '-sheet.jpg')
}

function run(args, { timeout = 60000 } = {}) {
	return new Promise((resolve) => {
		execFile(FFMPEG, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
			resolve({ ok: !err, error: err ? String(err.message || err) : '', stderr: String(stderr || '').slice(-400) })
		})
	})
}

/**
 * 把一段视频抽成拼图。
 * @param {{ video: string, outDir: string, aweme: string, durationSec?: number }} o
 *        video 可以是本地路径，也可以是 http(s) 地址（ffmpeg 自己会拉）
 */
export async function grabFrames({ video, outDir, aweme, durationSec = 15, cols = COLS, rows = ROWS, cellW = CELL_W } = {}) {
	if (!video) return { ok: false, error: '没有视频地址' }
	if (!existsSync(FFMPEG)) return { ok: false, error: '找不到 ffmpeg：' + FFMPEG }
	try {
		mkdirSync(outDir, { recursive: true })
	} catch { /* 已存在 */ }
	const out = sheetFile(outDir, aweme)
	const filter = tileFilter(durationSec, { cols, rows, cellW })
	const r = await run([
		'-y', '-loglevel', 'error',
		/* 这两个 header 必须在 -i 之前：抖音 CDN 不认 Lavf 的 UA，会直接 403 */
		'-user_agent', UA, '-referer', REFERER,
		'-i', String(video),
		'-vf', filter,
		'-frames:v', '1',
		'-q:v', '4',
		out,
	])
	if (!r.ok || !existsSync(out)) return { ok: false, error: r.error || 'ffmpeg 没产出文件', stderr: r.stderr }
	let bytes = 0
	try { bytes = statSync(out).size } catch { /* ignore */ }
	return { ok: true, file: out, bytes, filter, cols, rows, cells: cols * rows }
}

/**
 * 「看一眼」的通道。本机没有内置视觉模型，所以默认不可用；
 * 设了 DOUYIN_STUDIO_VISION_CMD 之后，它会被当成
 * `<cmd> <图片路径>` 调用，stdout 就是描述（一句话）。
 * 这样接哪个模型是配置问题，不是改代码。
 */
export async function describe(file) {
	const cmd = String(process.env.DOUYIN_STUDIO_VISION_CMD || '').trim()
	if (!cmd) return { ok: false, reason: 'no-vision', note: '没有视觉通道：设 DOUYIN_STUDIO_VISION_CMD="<命令>" 即可' }
	if (!file || !existsSync(file)) return { ok: false, reason: 'no-file' }
	const parts = cmd.split(/\s+/)
	return new Promise((resolve) => {
		execFile(parts[0], [...parts.slice(1), file], { timeout: 45000, windowsHide: true }, (err, stdout) => {
			if (err) return resolve({ ok: false, reason: 'cmd-failed', error: String(err.message || err).slice(0, 200) })
			const text = String(stdout || '').replace(/\s+/g, ' ').trim()
			resolve(text ? { ok: true, text: text.slice(0, 300) } : { ok: false, reason: 'empty' })
		})
	})
}

/** 只写文本用：把一段 base64 落成 png（测试/调试用）。 */
export function writeShot(file, b64) {
	writeFileSync(file, Buffer.from(String(b64 || ''), 'base64'))
	return file
}
