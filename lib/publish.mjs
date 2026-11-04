/**
 * lib/publish.mjs —— 发布菜谱：**本地先挡错**，再交给 CDP 那套真流程
 * ============================================================================
 * 刻意分两层：
 *   · 这一层负责「这条内容本来就发不出去」的那些错（标题超长、定时太近、参数打架），
 *     在本地一句话拒掉，不白跑两分钟、也不在网页上留半成品。
 *   · `publish-cli.mjs` 是那段已经在真页面上跑通过的 CDP 流程（传图→切图文→填文案→
 *     选权限→声明→定时→点发布→核实），一行没改地搬进来，避免「重写一遍再踩一遍」。
 *
 * 为什么先搬而不是先重写：这段流程踩过 5 个坑（上传页默认视频 tab、--clean 后要重连、
 * Page.navigate 必超时、简介零宽字符假成功、标签页正则命中客服页），
 * 每个坑都写在文件注释里。先让它能跑，再慢慢把它拆成可测的函数。
 * ============================================================================
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { port } from './cdp.mjs'
import { checkFiles } from './check-upload.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, 'publish-cli.mjs')

export const WHO = { public: '公开', friend: '好友可见', private: '仅自己可见' }
export const DECLARE = {
	ai: '内容由AI生成',
	view: '内容为个人观点或见解',
	repost: '内容为转载信息',
	market: '内容含营销推广信息',
	fiction: '虚构演绎，仅供娱乐',
	none: '无需添加自主声明',
}
export const IMAGE_EXT = /\.(jpe?g|png|webp)$/i
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi)$/i

/** 定时：抖音只收「2 小时后 ~ 14 天内」 */
export const AT_MIN_HOURS = 2
export const AT_MAX_DAYS = 14

/**
 * 只做校验，不碰浏览器。返回 `{ ok, errors[], plan }`。
 * 工具和 CLI 都先调它 —— 这样「错在哪」永远在跑之前就说清楚。
 */
export function validate(opts = {}) {
	const errors = []
	const files = Array.isArray(opts.files) ? opts.files.filter(Boolean) : []
	if (!files.length) errors.push('没给文件（--img 或 --video）')
	for (const f of files) if (!existsSync(f)) errors.push('文件不存在: ' + f)

	const kind = files.some((f) => VIDEO_EXT.test(f)) ? 'video' : 'image'
	if (kind === 'image' && files.length > 35) errors.push('图文最多 35 张，现在是 ' + files.length)
	if (kind === 'video' && files.length > 1) errors.push('视频一次只能一条')

	const title = String(opts.title || '')
	// ⚠️ 视频也是 30，不是 55。抖音发布页的计数器就是 30（图文页是 20）。
	// 这里放 55 会让 31–55 字的标题通过本地校验，然后被 publish-cli 拒掉/截断 —— 白跑一趟。
	const titleMax = kind === 'image' ? 20 : 30
	if (title.length > titleMax) errors.push(`标题 ${title.length} 字，${kind === 'image' ? '图文' : '视频'}上限 ${titleMax} 字`)
	if (String(opts.desc || '').length > 1000) errors.push('简介超过 1000 字')

	if (opts.who && !WHO[opts.who]) errors.push('--who 只能是 public / friend / private')
	if (opts.declare && !DECLARE[opts.declare]) errors.push('--declare 只能是 ' + Object.keys(DECLARE).join(' / '))
	if (opts.draft && opts.publish) errors.push('--draft（存草稿）和 --publish（真发）只能选一个')

	let atMs = null
	if (opts.at) {
		const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(String(opts.at).trim())
		if (!m) {
			errors.push('--at 要写成 "2026-11-02 20:00"（年-月-日 时:分）')
		} else {
			atMs = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00`).getTime()
			const diffH = (atMs - Date.now()) / 3600000
			if (!Number.isFinite(atMs)) errors.push('--at 这个时间不存在')
			else if (diffH < AT_MIN_HOURS) errors.push(`--at 定得太近（${diffH.toFixed(1)} 小时），抖音要求 ${AT_MIN_HOURS} 小时以后`)
			else if (diffH > AT_MAX_DAYS * 24) errors.push(`--at 超过 ${AT_MAX_DAYS} 天，抖音不收`)
		}
	}
	// 定时发布和「存草稿」互斥（草稿是没定时间的）；和 --publish 一起是正常用法
	if (opts.draft && atMs) errors.push('存草稿（--draft）不能带定时（--at）')

	return {
		ok: errors.length === 0,
		errors,
		plan: {
			kind, files: files.length, title, titleMax, titleLen: title.length,
			who: opts.who || 'public', whoLabel: WHO[opts.who || 'public'],
			declare: opts.declare || '', declareLabel: DECLARE[opts.declare] || '',
			at: opts.at || '', action: opts.publish ? 'publish' : opts.draft ? 'draft' : 'fill',
		},
	}
}

/**
 * 真跑。返回网页那一步的 JSON（含 `ok`），并附上菜谱层的 `plan` 和 `errors`。
 * 参数：`{ files, title, desc, who, declare, at, draft, publish, cover, fresh, clean, reupload, noShot }`
 */
export async function publish(opts = {}) {
	const v = validate(opts)
	// 再把文件本身查一遍（尺寸/比例/大小），错误并进同一份 errors
	let fileCheck = null
	try {
		if ((opts.files || []).length) {
			fileCheck = checkFiles(opts.files)
			if (!fileCheck.ok) { v.errors.push(...fileCheck.errors); v.ok = false }
		}
	} catch { /* 校验器自己出错不该拦住发布 */ }
	if (!v.ok) return { ok: false, stage: 'validate', errors: v.errors, plan: v.plan, fileCheck }
	if (opts.dry) return { ok: true, stage: 'dry', plan: v.plan, fileCheck }

	const args = []
	const video = v.plan.kind === 'video'
	for (const f of opts.files) args.push(video ? '--video' : '--img', f)
	if (opts.cover) args.push('--cover', opts.cover)
	if (opts.title) args.push('--title', opts.title)
	if (opts.desc) args.push('--desc', opts.desc)
	if (opts.who) args.push('--who', opts.who)
	if (opts.declare) args.push('--declare', opts.declare)
	if (opts.at) args.push('--at', opts.at)
	if (opts.draft) args.push('--draft')
	if (opts.publish) args.push('--publish')
	if (opts.fresh) args.push('--fresh')
	if (opts.clean) args.push('--clean')
	if (opts.reupload) args.push('--reupload')
	if (opts.noShot) args.push('--no-shot')

	const env = { ...process.env, CDP_PORT: String(port()) }

	const r = await new Promise((res) => {
		const child = spawn(process.execPath, [CLI, ...args], { env, windowsHide: true })
		let out = ''
		let err = ''
		child.stdout.on('data', (d) => { out += d })
		child.stderr.on('data', (d) => { err += d })
		child.on('close', (code) => res({ code, out, err }))
		child.on('error', (e) => res({ code: -1, out, err: String(e && e.message || e) }))
	})

	let body = null
	const start = r.out.indexOf('{')
	if (start >= 0) {
		try { body = JSON.parse(r.out.slice(start)) } catch { /* 下面兜底 */ }
	}
	if (!body) {
		return {
			ok: false, stage: 'cdp', code: r.code, plan: v.plan,
			error: '发布流程没返回 JSON', stdout: r.out.slice(-600), stderr: r.err.slice(-600),
		}
	}
	body.stage = 'cdp'
	body.plan = v.plan
	body.log = r.err.split(/\r?\n/).filter((l) => /\[(info|warn|publish|draft)\]/.test(l)).slice(-8)
	return body
}
