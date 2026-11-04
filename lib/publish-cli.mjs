#!/usr/bin/env node
/**
 * lib/publish-cli.mjs —— 发布入口：参数解析 + 校验 + BGM 混流 + 步骤编排
 * ============================================================================
 * 这个文件只做三件事：
 *   1. 解析 argv，校验参数（fail() 输出 JSON 退出）
 *   2. 准备上传素材（BGM ffmpeg 混流）
 *   3. 按顺序调用 publish-steps.mjs 里的步骤，输出最终 JSON
 *
 * CDP 操作 → lib/publish-cdp.mjs
 * 各步骤逻辑 → lib/publish-steps.mjs
 *
 * ⚠️ 已知坑（别删）：
 *   - pub.abnormal=true：点了发布按钮但无成功/失败证据，绝对不能自动重试
 *   - --clean 后必须换标签重连（SPA 切页老会话 DOM.enable 超时）
 *   - 认 tab 必须从头锚定 creator.douyin.com（--fresh 也一样）
 *   - TITLE_MAX 视频=30、图文=20（发布页和 validate 统一，不要各写一套）
 * ============================================================================
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
	CdpSession,
	cdpGet,
	cdpPut,
	closeCreatorTabs,
	findCreatorTab,
	sleep,
} from './publish-cdp.mjs'
import {
	stepCover,
	stepDeclare,
	stepDesc,
	stepDraft,
	stepMusic,
	stepPublish,
	stepSchedule,
	stepTitle,
	stepWaitReady,
	stepWho,
} from './publish-steps.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
// ⚠️ 日志和混流产物都放 lib/ 下的固定目录，跟旧版一致。
// 曾把这两处都指向 `../douyin-duty/`，那个目录在插件下**不存在**：
// 日志第一次写就 ENOENT 崩、BGM 混流直接 ffmpeg 报错（2026-11-01 踩过）。
// 现在统一走 OUT_DIR + mkdirSync，路径自己建，不指望别人先建好。
const LOG = join(__dirname, 'publish-log.jsonl')
const OUT_DIR = join(__dirname, 'publish')

/**
 * 写一行日志。任何 IO 错误都吞掉 —— 记日志失败绝不该让发布流程停下。
 * 超过 2MB 就轮转一次（保留一份 .1），别让这个文件长到几百兆。
 * @param {string} msg
 */
function logLine(msg) {
	try {
		try {
			const st = statSync(LOG)
			if (st.size > 2 * 1024 * 1024) renameSync(LOG, LOG + '.1')
		} catch {
			/* 文件还不存在就别管 */
		}
		appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`)
	} catch {
		/* 日志写不进去就算了，别影响正事 */
	}
}

// ── argv 帮助函数 ──────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
/** 取所有 --key value 的 value（可重复） */
const many = (k) => {
	const out = []
	for (let i = 0; i < argv.length - 1; i++) if (argv[i] === `--${k}`) out.push(argv[i + 1])
	return out
}
/** 取第一个 --key value */
const one = (k) => many(k)[0] ?? ''
/** 是否有 --flag */
const flag = (k) => argv.includes(`--${k}`)

// ── 参数 ───────────────────────────────────────────────────────────────────────

// ⚠️ 必须写成 `.map((v) => resolve(v))`，不能 `.map(resolve)`：
// map 会把 (value, index, array) 三个参数一起传，path.resolve 收到数组当第 3 个参数
// 直接 ERR_INVALID_ARG_TYPE —— 任何一次发布都会在解析参数时就崩（2026-11-01 踩过）。
const VIDEOS = many('video').map((v) => resolve(v))
const IMAGES = many('img').map((v) => resolve(v))
const TITLE = one('title')
const DESC = one('desc') || ''
const COVER = one('cover')
const BGM = one('bgm')
const BGM_VOL = parseFloat(one('bgm-vol') || '0.3')
const DY_MUSIC = one('dy-music')
const DRAFT = flag('draft')
const PUBLISH = flag('publish')
const AT = one('at')
const DECLARE = one('declare')
const WHO = one('who') || 'public'
const CLEAN = flag('clean')
const FRESH = flag('fresh')
// 这两个 publish.mjs 一直在传，重写时漏掉过 —— 漏了就意味着「强制重传」变成静默跳过、
// 「跳过截图」变成无效开关（2026-11-01 补回）。
const REUPLOAD = flag('reupload')
const NO_SHOT = flag('no-shot')
// 封面没设成时默认**中止发布**（不许再出现「封面失败但 done ok=true」）；
// 确知情愿带着默认封面发，才加这个开关（2026-11-02 补）。
const ALLOW_COVER_FAIL = flag('allow-cover-fail')
const PORT = parseInt(process.env.CDP_PORT || '9334', 10)

// ── 校验 ───────────────────────────────────────────────────────────────────────

/** 输出 JSON 错误并退出 1 */
const fail = (why, detail = {}) => {
	process.stdout.write(JSON.stringify({ ok: false, why, ...detail }) + '\n')
	process.exit(1)
}

const kind = VIDEOS.length ? 'video' : 'image'
const TITLE_MAX = kind === 'image' ? 20 : 30

if (!TITLE) fail('缺少 --title')
if (TITLE.length > TITLE_MAX) fail(`标题超出 ${TITLE_MAX} 字`, { len: TITLE.length })
if (DESC.length > 1000) fail('简介超 1000 字', { len: DESC.length })
if (!VIDEOS.length && !IMAGES.length) fail('缺少 --video 或 --img')
if (VIDEOS.length && IMAGES.length) fail('--video 和 --img 不能同时使用')
if (DRAFT && PUBLISH) fail('--draft 和 --publish 不能同时使用')
if (DRAFT && AT) fail('草稿不支持定时发布')

for (const f of [...VIDEOS, ...IMAGES]) {
	if (!existsSync(f)) fail(`文件不存在: ${f}`)
}

for (const f of IMAGES) {
	const size = readFileSync(f).length
	if (size > 1.2 * 1024 * 1024) fail(`图片超 1.2MB: ${f}`, { size })
}

if (AT) {
	if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(AT)) fail('--at 格式错误，需 "YYYY-MM-DD HH:MM"')
	const t = new Date(AT).getTime()
	const now = Date.now()
	if (t < now + 2 * 3600e3) fail('--at 必须比现在至少晚 2 小时')
	if (t > now + 14 * 86400e3) fail('--at 不能超过 14 天后')
}

// WHO_MAP: 接受简写或页面原话
// ⚠️ 页面上的字是「仅自己可见」，不是「仅自己」。pickRadio 是**去空白后精确比较** innerText，
// 少两个字就永远选不中（2026-11-01 重写时改错成「仅自己」，会把私密发布静默降级成公开）。
const WHO_MAP = { public: '公开', friend: '好友可见', private: '仅自己可见' }
const whoText = WHO_MAP[WHO] || WHO
if (!Object.values(WHO_MAP).includes(whoText)) fail(`--who 无效: ${WHO}`, { valid: Object.keys(WHO_MAP) })

// DECLARE_MAP: key → 抖音页面上的**原话**
// ⚠️ 这些字符串必须跟页面上一字不差（pickRadio/findExact 是精确匹配）。
// 曾经被「改写得更像人话」——「内容由AI生成」改成「该内容为人工智能生成的虚拟内容」——
// 结果六个选项在页面上一个都找不到，自主声明必然失败，而且不报错只回 ok:false。
// 别名：旧版用 opinion / ad，工具层用 view / market，两套都认。
const DECLARE_MAP = {
	ai: '内容由AI生成',
	view: '内容为个人观点或见解',
	opinion: '内容为个人观点或见解',
	repost: '内容为转载信息',
	market: '内容含营销推广信息',
	ad: '内容含营销推广信息',
	fiction: '虚构演绎，仅供娱乐',
	none: '无需添加自主声明',
}
const declareText = DECLARE ? (DECLARE_MAP[DECLARE] ?? DECLARE) : ''

// ── BGM 混流（ffmpeg） ────────────────────────────────────────────────────────

let UPLOAD_VIDEOS = VIDEOS.slice()

if (BGM && VIDEOS.length) {
	if (!existsSync(BGM)) fail(`BGM 文件不存在: ${BGM}`)
	mkdirSync(OUT_DIR, { recursive: true })
	const out = join(OUT_DIR, `bgm-mix-${Date.now()}.mp4`)
	try {
		execFileSync('ffmpeg', [
			'-y',
			'-i', VIDEOS[0],
			'-stream_loop', '-1',
			'-i', BGM,
			'-map', '0:v:0',
			'-map', '1:a:0',
			'-shortest',
			'-c:v', 'copy',
			'-c:a', 'aac',
			'-filter:a', `volume=${BGM_VOL}`,
			out,
		], { stdio: 'pipe' })
	} catch (e) {
		fail('BGM 混流失败', { ffmpeg: String(e.message || e) })
	}
	UPLOAD_VIDEOS = [out]
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

const stamp = () => new Date().toISOString()

// ── 主流程 ────────────────────────────────────────────────────────────────────

const CREATOR_RE = /^https:\/\/creator\.douyin\.com\//
const PUBLISH_PAGE_RE = /\/creator-micro\/content\/(upload|post)/

async function main() {
	const log = (msg) => logLine(msg)
	log(`publish-cli start kind=${kind} title=${TITLE} draft=${DRAFT} publish=${PUBLISH}`)

	// ── 建立 CDP 连接 ──────────────────────────────────────────────────────────

	let s = new CdpSession(PORT)

	// --fresh：关掉所有创作者标签，重开一个上传页
	if (FRESH) {
		await closeCreatorTabs(PORT)
		await sleep(1200)
		// ⚠️ Chrome 的 /json/new 只认 **query string** 里的 url，不认 JSON body；
		//    而且要用 encodeURIComponent 一次编码。写成 cdpPut(port,'/json/new',{url})
		//    第三个参数会被丢掉 → 开出来的是 about:blank，然后找不到 creator 标签（2026-11-02 踩过）。
		const newUrl = 'https://creator.douyin.com/creator-micro/content/upload'
		await cdpPut(PORT, `/json/new?${encodeURIComponent(newUrl)}`)
		await sleep(7000)
	}

	// --clean：在现有标签执行清空后重连
	// （具体交互在后面 stepWaitReady 之后处理）

	let tab = await findCreatorTab(PORT, CREATOR_RE, PUBLISH_PAGE_RE)
	// 没有创作者标签就自己开一个（以前直接 fail，等于「你要先手动开好」——
	// 2026-11-03 用户让跑全流程时踩到：autoOpen 只影响面板，CLI 这条路没人开）。
	if (!tab) {
		log('没找到创作者标签，自己开一个上传页')
		await cdpPut(PORT, `/json/new?${encodeURIComponent('https://creator.douyin.com/creator-micro/content/upload')}`)
		await sleep(8000)
		tab = await findCreatorTab(PORT, CREATOR_RE, PUBLISH_PAGE_RE)
	}
	if (!tab) fail('打不开 creator.douyin.com（浏览器没登录，或 CDP 连不上）')

	await s.connect(tab.webSocketDebuggerUrl)
	log(`connected to tab: ${tab.url}`)

	// ── 登录检测 ───────────────────────────────────────────────────────────────

	const cookies = (await s.send('Network.getCookies', { urls: ['https://creator.douyin.com'] })).cookies || []
	const hasSession = cookies.some((c) => ['passport_assist_user', 'sessionid', 'sid_guard'].includes(c.name))
	if (!hasSession) {
		const bodyText = await s.evalJs('document.body.innerText')
		if (/扫码登录|手机号登录|登录后查看|请先登录/.test(bodyText)) {
			fail('检测到未登录，请先在浏览器中登录抖音创作者中心')
		}
	}

	// ── --clean 重连 ──────────────────────────────────────────────────────────

	if (CLEAN) {
		// 点「清空并重新上传」
		await s.evalJs(
			`(()=>{const el=Array.from(document.querySelectorAll('button,span')).find(el=>/清空并重新上传/.test(el.textContent));if(el)el.click();})()`,
		)
		await sleep(800)
		// 确认弹窗
		await s.evalJs(
			`(()=>{const el=Array.from(document.querySelectorAll('button')).find(el=>/确认|清空/.test(el.textContent)&&!/取消/.test(el.textContent));if(el)el.click();})()`,
		)
		await sleep(600)
		// 关掉旧标签，开新上传页
		await s.disconnect()
		await closeCreatorTabs(PORT)
		const nt = await cdpPut(PORT, '/json/new', { url: 'https://creator.douyin.com/creator-micro/content/upload' })
		await sleep(3500)
		// 重新找标签并连接
		const freshTab = await findCreatorTab(PORT, CREATOR_RE, PUBLISH_PAGE_RE)
		if (!freshTab) fail('--clean 后找不到新上传标签')
		s = new CdpSession(PORT)
		await s.connect(freshTab.webSocketDebuggerUrl)
		log('--clean: reconnected to fresh tab')
	}

	// ── 上传文件 ───────────────────────────────────────────────────────────────

	// 图文先点「发布图文」
	// ⚠️ 只能查 `span` 是错的：页面上那个 tab 实际是 **div**（实测 tabSpans=0 / tabDivs=1），
	//    点不到就永远停在「发布视频」页，那个 input[type=file] 的 accept 只收视频 →
	//    等 12 秒超时，报「找不到上传框」（2026-11-02 踩过）。所以 span/div 都找，取最后一个。
	if (kind === 'image') {
		const switched = await s.evalJs(`(()=>{
			const els=[...document.querySelectorAll('span,div')].filter(e=>(e.textContent||'').trim()==='发布图文');
			const el=els[els.length-1];
			if(!el)return 'not-found';
			el.click();
			return 'clicked';
		})()`)
		log(`switch to 图文 tab: ${switched}`)
		await sleep(1200)
	}

	// 幂等：编辑器里已经有内容了（上次跑到一半，或页面本来就开着）就别再塞一遍
	// —— 重复塞图文会让张数翻倍。要重传得显式 --reupload / --fresh / --clean。
	const already = await s.evalJs(
		`(()=>{const t=Array.from(document.querySelectorAll('input')).find(el=>el.placeholder&&el.placeholder.includes('标题'));` +
			`const d=Array.from(document.querySelectorAll('[contenteditable]')).find(el=>(el.getAttribute('data-placeholder')||'').match(/简介|描述/));` +
			`return !!(t||d);})()`,
	)
	let skippedUpload = false
	if (already && !FRESH && !REUPLOAD && !CLEAN) {
		skippedUpload = true
		log('编辑器已就绪，跳过塞文件（要重传加 --reupload）')
	}

	// 等 file input 出现
	const acceptPattern = kind === 'video' ? 'video' : 'image'
	let fileNodeId = null
	if (!skippedUpload) {
		for (let i = 0; i < 24; i++) {
			await sleep(500)
			const doc = await s.send('DOM.getDocument', { depth: -1, pierce: true })
			const inputs = await s.send('DOM.querySelectorAll', {
				nodeId: doc.root.nodeId,
				selector: 'input[type=file]',
			})
			for (const nodeId of inputs.nodeIds) {
				const desc = await s.send('DOM.describeNode', { nodeId, depth: 1 })
				const attrs = desc.node?.attributes || []
				const acceptIdx = attrs.indexOf('accept')
				if (acceptIdx >= 0 && new RegExp(acceptPattern, 'i').test(attrs[acceptIdx + 1])) {
					fileNodeId = nodeId
					break
				}
			}
			if (fileNodeId) break
		}
		if (!fileNodeId && !CLEAN) fail(`等待上传 input[type=file][accept*=${acceptPattern}] 超时（12s）`)

		if (fileNodeId) {
			const files = kind === 'video' ? UPLOAD_VIDEOS : IMAGES
			await s.send('DOM.setFileInputFiles', { nodeId: fileNodeId, files })
			log(`uploaded ${files.length} file(s)`)
		}
	}

	// ── 步骤执行 ───────────────────────────────────────────────────────────────

	const results = {}

	// 等编辑器就绪
	const ready = await stepWaitReady(s, { kind })
	if (!ready.ok) fail(ready.why)

	// 标题
	results.title = await stepTitle(s, { title: TITLE, titleMax: TITLE_MAX })
	log(`title: ok=${results.title.ok} already=${results.title.already}`)

	// 简介
	results.desc = await stepDesc(s, { desc: DESC })
	log(`desc: ok=${results.desc.ok}`)

	// 背景音乐
	if (DY_MUSIC) {
		results.music = await stepMusic(s, { dyMusic: DY_MUSIC })
		log(`music: ok=${results.music.ok} chip=${results.music.chip}`)
	}

	// 谁可以看
	results.who = await stepWho(s, { who: whoText })
	log(`who: ok=${results.who.ok}`)

	// 定时发布
	if (AT) {
		results.schedule = await stepSchedule(s, { at: AT })
		log(`schedule: ok=${results.schedule.ok} got=${results.schedule.got}`)
	}

	// 自主声明
	if (declareText) {
		results.declare = await stepDeclare(s, { declare: declareText })
		log(`declare: ok=${results.declare.ok}`)
	}

	// 封面 —— **排在最后**。
	// ⚠️ 2026-11-02 实测：点开封面会拉起一个**跨域 iframe**
	//    （`summon.bytedance.com/web/...`），它盖住整页、而且 Runtime.evaluate 进不去。
	//    上一版把它排在 who/declare 前面，结果封面一卡，后面两个 step 全红（看着像它们坏了，
	//    其实只是被一层挡住）。所以：只影响自己，失败了只写 note，绝不让别人背锅。
	if (COVER) {
		results.cover = await stepCover(s, { coverPath: resolve(COVER) })
		log(`cover: ok=${results.cover.ok} attempt=1 srcChanged=${results.cover.srcChanged} why=${results.cover.why}`)
		// ⚠️ 2026-11-02 01:24 那次：srcChanged=false、双封面缺失还在，说明图根本没塞进去。
		//    这种失败重试一次很便宜（弹层会被 _clearModals 清干净），能救回一大半。
		if (!results.cover.ok) {
			const firstWhy = results.cover.why
			await sleep(1500)
			const again = await stepCover(s, { coverPath: resolve(COVER) })
			log(`cover: ok=${again.ok} attempt=2 srcChanged=${again.srcChanged} why=${again.why}`)
			results.cover = { ...again, attempt: 2, firstWhy }
		}
	}

	// ── 发布或存草稿 ──────────────────────────────────────────────────────────

	// 封面没设成 → 默认**不点发布**。上传的东西还停在页面上，人工看一眼再决定；
	// 真要带着默认封面发，加 --allow-cover-fail 明确表示知情。
	// （2026-11-02 01:24 的假 ok=true 就是「封面失败了也照样发、还报成功」出来的。）
	const coverBlocked = !!COVER && !results.cover?.ok && !ALLOW_COVER_FAIL && !DRAFT

	let pub = { ok: true }

	if (coverBlocked) {
		logLine(`ABORT 封面没设成，未点发布（加 --allow-cover-fail 可强行发）: ${results.cover?.why}`)
		pub = { ok: false, aborted: 'cover', why: '封面没设成，已中止发布（没点发布按钮）' }
	} else if (DRAFT) {
		pub = await stepDraft(s)
		log(`draft: ok=${pub.ok} why=${pub.why}`)
	} else if (PUBLISH) {
		pub = await stepPublish(s)
		log(`publish: ok=${pub.ok} published=${pub.published} abnormal=${pub.abnormal}`)
		if (pub.captcha) {
			logLine('CAPTCHA detected — human intervention required')
		}
	}

	// ── 截图留证（--no-shot 可跳）────────────────────────────────────────────

	let shot = ''
	if (!NO_SHOT) {
		try {
			mkdirSync(OUT_DIR, { recursive: true })
			shot = join(OUT_DIR, `shot-${Date.now()}.png`)
			const cap = await s.send('Page.captureScreenshot', { format: 'png' })
			if (cap?.data) writeFileSync(shot, Buffer.from(cap.data, 'base64'))
		} catch {
			shot = '' // 截图失败不该把发布结果改坏
		}
	}

	// ── 输出 ───────────────────────────────────────────────────────────────────

	const ok =
		(results.title?.ok ?? true) &&
		(results.desc?.ok ?? true) &&
		(results.who?.ok ?? true) &&
		// ⚠️ 封面必须在 ok 里。漏了它就会出现「cover: ok=false / done ok=true」（2026-11-02 修）
		(!COVER || results.cover?.ok) &&
		(!DY_MUSIC || results.music?.ok) &&
		(!AT || results.schedule?.ok) &&
		(!declareText || results.declare?.ok) &&
		pub.ok

	const notes = []
	if (results.cover && !results.cover.ok) {
		const tail = pub.aborted === 'cover'
			? '已中止发布，页面还停在发布前那一屏'
			: DRAFT
				? '草稿已存下，只是封面没进去'
				: '作品已按默认封面发出去，去创作者中心核对一眼'
		notes.push(`封面没设成（${results.cover.why || '原因未知'}，试了 ${results.cover.attempt ?? 1} 次）—— ${tail}`)
	} else if (results.cover && !results.cover.srcChanged) {
		notes.push('封面设成了，但预览图 src 没变（判据差异，去页面确认一眼）')
	}
	if (DY_MUSIC && results.music && !results.music.ok) notes.push('背景音乐没换上（chip 仍是原声）')
	if (pub.abnormal) notes.push('点了发布但无确认证据，请去创作者中心看一眼，别重发')
	if (pub.captcha) notes.push('遇到验证码，需要人工在浏览器里完成')

	const out = {
		ok,
		kind,
		title: TITLE,
		results,
		pub,
		skippedUpload,
		shot: shot || undefined,
		note: notes.join(' | ') || undefined,
		ts: stamp(),
	}

	process.stdout.write(JSON.stringify(out) + '\n')
	log(`done ok=${ok}`)
	/* 面板要一张「最近发布」的账：日志是给人看的散文，这一行是给程序看的结构。
	 * 只写一行 JSON，字段少而稳，别塞整个 results（那会越长越难读）。 */
	logLine('RESULT ' + JSON.stringify({
		at: out.ts,
		kind,
		title: TITLE,
		ok,
		who: WHO || '',
		declare: DECLARE || '',
		at_plan: AT || '',
		draft: DRAFT,
		published: Boolean(PUBLISH),
		cover: results.cover ? { ok: results.cover.ok, changed: Boolean(results.cover.srcChanged) } : null,
		music: results.music ? String(results.music.chip || '').slice(0, 40) : null,
		abnormal: Boolean(pub.abnormal),
	}))

	await s.disconnect()
}

main().catch((e) => {
	logLine(`UNCAUGHT ${e?.stack || e}`)
	process.stdout.write(JSON.stringify({ ok: false, why: String(e?.message || e), stack: e?.stack }) + '\n')
	process.exit(1)
})

