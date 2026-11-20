/**
 * lib/understand.mjs —— 「看懂这条作品」：区分视频/图文，视频交给 video-watch-plus。
 * ============================================================================
 * 入口分两层判断：
 *   第一层 classifyAweme —— 媒体类型（视频/图文），看 aweme_type + images + play_url。
 *   第二层 mode —— 由模型根据用户 @ 时说的话决定视频跑多全（transcribe 只音频 / watch 全量）。
 * 路由：
 *   图文            → 返回图片地址（图片没有音频，意图无关）
 *   视频 + mode=transcribe → 只跑 audio_probe + asr（省掉结构量测与拼图）
 *   视频 + mode=watch → 全跑 probe + audio_probe + asr + grid
 *
 * 依赖（环境变量，缺省按常见位置）：
 *   VW_DIR      video-watch-plus 仓库目录（含 vendor/vw.py 与 scripts/）
 *   VW_PYTHON   带 faster-whisper+numpy+Pillow 的 python
 *   VW_FFMPEG   ffmpeg 路径（vw.py / 下载共用）
 *   VW_FFPROBE  ffprobe 路径
 *   HF_HOME     faster-whisper 模型缓存目录
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as api from './api.mjs'
import { FFMPEG } from './frames.mjs'

/** 平台常见 python 与 vw 目录的兜底（都可在环境变量覆盖）。 */
export function defaultPaths() {
	const h = homedir()
	return {
		vwDir: process.env.VW_DIR || join(h, 'video-watch-plus'),
		python: process.env.VW_PYTHON || 'python',
		ffmpeg: FFMPEG, // 复用 frames.mjs 的跨平台解析
	}
}

/** 判媒体类型（纯函数，好测）：video | image | unknown。 */
export function classifyAweme(d) {
	const a = (d && d.aweme) || d || {}
	const t = Number(a.aweme_type) || 0
	const images = Array.isArray(a.images) ? a.images.filter(Boolean) : []
	const playUrl = String((a.play_url || a.playUrl || '')).trim()
	if (images.length && t !== 0) return 'image'
	if (t === 68 || t === 2) return 'image'
	if (playUrl) return 'video'
	if (t === 0) return 'video'
	return 'unknown'
}

/** 把一段媒体跑完 video-watch-plus 三路，返回结构化结论。media 可为本地文件或 http 直链。 */
export async function understandVideoFile(media, { workDir, model = 'small', lang = 'zh', timeoutSec = 300, mode = 'watch' } = {}) {
	const { vwDir, python } = defaultPaths()
	const vw = join(vwDir, 'vendor', 'vw.py')
	const audioProbe = join(vwDir, 'scripts', 'audio_probe.py')
	const asr = join(vwDir, 'scripts', 'asr_hallucination_check.py')
	if (!existsSync(vw)) return { ok: false, error: '找不到 video-watch-plus：' + vwDir + '（用 VW_DIR 指定）' }

	const outDir = workDir || join(homedir(), '.dsh', 'douyin-duty', 'understand')
	mkdirSync(outDir, { recursive: true })

	const env = { ...process.env, VW_FFMPEG: defaultPaths().ffmpeg }
	const run = (cmd, args, extra) => new Promise((resolve) => {
		const child = spawn(cmd, args, { env, ...extra })
		let out = '', err = ''
		child.stdout.on('data', (d) => { out += d })
		child.stderr.on('data', (d) => { err += d })
		const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, (timeoutSec || 300) * 1000)
		child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }) })
	})

	const result = { ok: false, media, mode, steps: {} }
	// 1) probe：结构量测（零 token）。transcribe 模式跳过（只要音频）。
	let p = { code: -1, out: '', err: '' }
	if (mode !== 'transcribe') {
		p = await run(python, [vw, 'probe', media, '--out', outDir])
		if (p.code === 0) result.structure = p.out.slice(-1200)
	}
	result.steps.probe = p.code === 0 ? 'ok' : (mode === 'transcribe' ? 'skipped' : 'fail')

	// 2) audio_probe：声学判型
	const ap = await run(python, [audioProbe, media, '--json', join(outDir, 'audio_probe.json')])
	result.steps.audioProbe = ap.code === 0 ? 'ok' : 'fail'
	if (ap.code === 0) {
		const lines = ap.out.trim().split(/\r?\n/).filter(Boolean)
		try { result.acoustic = JSON.parse(lines[lines.length - 1]) } catch { result.acoustic = { raw: ap.out.slice(-800) } }
	}

	// 3) asr：转写 + 幻觉证伪
	const a = await run(python, [asr, media, '--model', model, '--lang', lang])
	result.steps.asr = a.code === 0 ? 'ok' : 'fail'
	if (a.code === 0) result.transcript = a.out.slice(-3000)

	// 4) grid：抽帧铺 4x4 拼图（ffmpeg tile，不依赖 magick）。transcribe 模式跳过。
	let g = { code: -1 }
	if (mode !== 'transcribe') {
		const gridOut = join(outDir, 'grid.jpg')
		g = await run(defaultPaths().ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', media, '-vf', 'fps=1/4,scale=240:-1,tile=4x4', '-frames:v', '1', gridOut])
		if (g.code === 0 && existsSync(gridOut)) result.grid = gridOut
	}
	result.steps.grid = g.code === 0 ? 'ok' : (mode === 'transcribe' ? 'skipped' : 'fail')

	result.ok = p.code === 0 || ap.code === 0 || a.code === 0
	return result
}

/** 入口：拿 id → detail → 判媒体类型 → 判意图 → 分流。 */
export async function understand(awemeId, opts = {}) {
	const id = String(awemeId || '').trim()
	if (!id) return { ok: false, error: '要 --aweme（作品 id）' }
	const d = await api.detail(id)
	if (!d || !d.ok || !d.aweme) return { ok: false, error: (d && d.error) || '详情拿不到（可能已删/私密）' }
	const kind = classifyAweme(d.aweme)
	if (kind === 'image') {
		return { ok: true, kind: 'image', images: d.aweme.images || [], desc: d.aweme.desc, hint: '把 images 里的地址交给视觉模型看图。' }
	}
	if (kind === 'video') {
		// 意图由模型决定：mode = transcribe（只要音频）| watch（全量，默认）
		const mode = opts.mode === 'transcribe' ? 'transcribe' : 'watch'
		const r = await understandVideoFile(d.aweme.play_url, { ...opts, mode })
		return { ok: r.ok, kind: 'video', mode, play_url_len: String(d.aweme.play_url || '').length, ...r }
	}
	return { ok: false, kind: 'unknown', error: '判不出是视频还是图文（aweme_type=' + d.aweme.aweme_type + '，images=' + (d.aweme.images || []).length + '，play_url=' + (!!d.aweme.play_url) + '）' }
}
