/**
 * lib/settings.mjs —— 面板可写的机器人设置（存在自己的文件里）
 * ============================================================================
 * 为什么不写进 DSH 的配置（schemastery）：那套是宿主管的，写它要走宿主 API，
 * 而且改错可能让插件不激活。这里的设置**只影响插件自己的行为**，所以放在
 * `$DSH_HOME/douyin-studio/settings.json`，我们自己读、自己写、自己校验。
 *
 * 关键点：这些值必须**真的作用到 CLI**。做法是 index.js 起子进程时把
 * settingsEnv() 合并进 env —— 而 CLI 本来就认 DOUYIN_STUDIO_KEYWORDS /
 * BLOCKWORDS / FEED_* 这些变量。不这么做，面板上的开关就是装饰品。
 *
 * 默认值 = 今天的实际行为（一个都不改变），这样"装了但不填"不会悄悄变样。
 * ============================================================================
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readFileSync, statSync } from 'node:fs'
import { atomicWriteJson, readJsonChecked } from './fsx.mjs'
import { personaForDy } from './persona.mjs'
import { minutesOf } from './policy.mjs'

const homeDir = () => process.env.DOUYIN_STUDIO_HOME
	|| join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'douyin-studio')

export const settingsFile = () => join(homeDir(), 'settings.json')

/** 默认值：全部等于"不改行为" */
export const DEFAULTS = {
	// —— 主人（机器人要主动找的那个号）——
	ownerNick: '',       // 抖音昵称。填了才会给你报平安
	/* 主人号 uid：填了就不受「同一人每天 2 条」的限制（2026-11-03 哥哥要的）。
	 * 只免这一条；日总量 / 每小时 / 间隔 / 同一栋楼照旧，免得「对主人不设限」变成刷屏。 */
	ownerUid: '',
	/* 主人号 sec_uid（2026-11-07 加）：有这个就完全按稳定 id 找会话，昵称彻底不参与定位。
	 * 留空也能用：第一次发出去了之后由面板/CLI 回填（uid→sec_uid 只能从会话行反查）。 */
	ownerSecUid: '',
	// —— 自主执行（默认全关：没点头就不许自己发东西）——
	autoDm: false,         // 自己回私信
	autoComment: false,    // 自己回评论（= 值班带 autoReply）
	/* 回 @我：会在**别人视频的评论区**公开回话，代价最高，默认关得更死 */
	autoAt: false,         // 自己回 @我 的通知
	autoPublish: false,    // 自己发作品
	autoReport: false,     // 到点给主人报平安
	publishDir: '',        // 内容库目录（绝对路径）
	publishPerDay: 1,
	publishMode: 'draft',  // draft = 只存草稿；now = 真发
	/* ⚠️ 默认 private：自主发布是「没人盯着」的路径，默认公开等于让一个模型
	 * 替你决定什么东西能上推荐。要公开就手动改一次，改的人知道自己在做什么。 */
	publishWho: 'private', // public / friend / private
	/* 无人值守发布（2026-11-05）：破甲之后才真正走得通的那条路 —— 没人点，它自己发。
	 * 默认关。开了也不是"想发就发"：窗口内、当天额度内、首跑 dry 过、总闸没开，四条同时成立。
	 * 与上面的 autoPublish（拟稿/自主执行）不是一个开关：那个决定"做不做"，这个决定"能不能真点"。 */
	unattendedPublish: false,
	unattendedFrom: '20:00',
	unattendedTo: '23:30',
	unattendedPerDay: 1,
	/* 主动互动灰度：只出"今天会碰谁"的清单，不自动执行。
	 * 白名单为空 = 一条都不碰（这是默认，也是最该保持的默认）。 */
	engageOn: false,
	engageAuthors: '',
	engagePerDay: 3,
	engageGapSec: 90,
	reportAt: '21:30',
	/* 两个出口分开数（2026-11-04 晚）：私信分享几条、评论区 @ 几条。0 = 那条路不走。
	 * 这就是唯一的「给主人发视频」口径 —— 老的 digestPerDay/digestAt 已经删了，
	 * 那两个是「每天定时再发一批」，跟这里的额度叠在一起就会一晚上刷屏。 */
	sharePerDay: 2,
	atPerDay: 2,
	// —— 刷视频策略 ——
	/* 只回这么多小时以内的评论。0 = 不限（不推荐：插件没有"你已经回过"的历史时，
	 * 会把几个月前的老评论一起翻出来回）。装上之后的第一轮最容易踩这个。 */
	replyFreshHours: 48,
	keywords: '',        // 逗号分隔。**非空时 feed 会按词去搜**，不是从推荐流里筛
	blockKeywords: '',
	minSec: 5,
	maxSec: 180,
	minDigg: 0,
	/* 每天自动刷几轮（0 = 关）。只刷不互动：feed 是只读的，不会自己点赞评论。
	 * 轮次的时间点由 lib/schedule.mjs 铺开（纯函数，有单测钉着）。
	 * 默认 0（2026-11-05 审计 B2-09）：新装的东西不该一上来就自己在账号里跑。
	 * 已经写进 settings.json 的显式值不受影响 —— 这条只改"没配过"的默认。 */
	scanRounds: 0,
	scanFrom: 9,
	scanTo: 22,
	/* 新调度：窗口制。空数组 = 还没切，走上面的老字段（只读映射，不回写）。
	 * 一项 = { from:'09:00', to:'12:00', times:2, enabled:true }。
	 * 为什么要换：老字段里「窗口」和「间隔」两套语义并存，改一个另一个还生效。 */
	scanWindows: [],
	/* 两轮之间隔多久（分钟）。一轮刷完到下一轮开始，就是这么久。
	 * 0 = 退回「在开始/结束之间均匀铺开」。 */
	scanEveryMin: 240,
	/* 每轮看几个 + 每看完一条歇几秒。
	 * 后者是「刷多久」的真正把手：10 条 × 6 秒 = 一轮约一分钟，不会一口气刷穿。
	 * 别用 feed 的 count / rounds 两层参数去表达（那两个已经删了）。 */
	scanPerRound: 10,
	scanGap: 6,
	scanMode: 'feed',
	/* 搜索时先走「页面内直连」（1.4–1.8 s / 10 条），失败自动退回 CLI。
	 * 留一个开关是因为接口字段说变就变；关掉就完全回到以前的行为。 */
	scanApi: true,
	scanKeywords: '',
	/* 这里的两个（值班/盯私信多久跑一次）以前只在插件 config 里，面板改不了、
	 * 改了还得重启。搬进 settings：面板保存就重新开定时器，不用重启 DSH。 */
	dutyEveryMin: 30,
	watchEverySec: 90,
	// —— 回复策略 ——
	replyStyle: '温和',   // 只影响面板给你的建议语气，不自动改写你的话
	/* 人设：喂给模型的一句话（「你是谁」）。空 = 通用助手口吻。
	 * 2026-11-04 从代码里挪出来：以前三个提示词写死了同一个角色，
	 * 别人装了这个插件，自动回私信会用别人的口吻说话。 */
	persona: '',
	/* 人设从哪来：
	 *   aurabot 读她活着的那张卡（`plugins-data/aurabot/personas/<name>.md`），抖音和 QQ 用同一个人
	 *   card    读 QQ 侧旧的 identity.md + style.md 摘要（520 字，会丢东西）
	 *   custom  只用上面那句 persona（老行为）
	 *   off     通用助手口吻
	 * 为什么默认 aurabot：2026-11-11 用户说「dy 里面的评论都要是她的人设」——
	 * 两份卡并行时，同一个人在两个平台说话不像，而且抖音这边丢了括号、留白这些习惯。 */
	personaSource: 'aurabot',
	/* 卡的路径与名字：留空就用默认位置 + 默认名 xiaoxi */
	personaFile: '',
	personaName: '',
	/* 自称：报平安的标题用「<botName>日报」。空 = 就叫「日报」。 */
	botName: '',
	replyMaxPerRound: 2,  // 一轮最多回几条（CLI 的 --max）
	quietFrom: '',        // HH:MM，空 = 不静音
	quietTo: '',
	/* 落不落到底层行为：`quietFrom/quietTo` 只说"哪段时间算安静"，
	 * 这个开关才决定"安静时要不要闭嘴"。以前面板上有它、normalize 不认它 →
	 * 每次保存被丢掉，index.js 永远读到 undefined（点了会亮、重启就关、实际照发）。
	 * 默认 false = 不额外静音，保持老行为。 */
	notifyQuiet: false,
	/* DS 的谷时（北京时间 00:30-08:30 半价）。**主动花钱的动作**（自主发布 / 自动刷视频）
	 * 只在这段做；回消息不在这段也照常回 —— 见下面的 peakReply。
	 * 一天可以配两段（active2From/active2To），比如凌晨一段、午后一段。 */
	activeFrom: '00:30',
	activeTo: '08:30',
	active2From: '',
	active2To: '',
	/* 高峰期（不在低峰窗口里）还要不要回消息。默认 true：
	 * 便宜的时候多做，贵的时候少做，但**不能装死** —— 有人找你，隔 8 小时才回更贵。 */
	peakReply: true,
	// —— 常说的话（发私信/评论时的快捷插入，不自动发送）——
	templates: ['在的，稍等我看看', '这个我整理一下发你'],
}

const clampInt = (v, lo, hi, dflt) => {
	// ⚠️ 只认 number / string。`Number([])` 是 0、`Number(true)` 是 1 —— 数组和布尔
	//    会被悄悄当成合法数字，把"没填"变成"填了 0"。这种坑只靠读代码看不出来。
	if (typeof v !== 'number' && typeof v !== 'string') return dflt
	const n = Number(v)
	if (!Number.isFinite(n)) return dflt
	return Math.max(lo, Math.min(hi, Math.round(n)))
}
const str = (v, max = 200) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max)
const hhmm = (v) => {
	const s = str(v, 5)
	return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : ''
}
const list = (v, max) => (Array.isArray(v) ? v : [])
	.map((x) => str(x, 60)).filter(Boolean).slice(0, max)
/* 布尔只认 true/false 和 'true'/'1'。字符串 'false' 若用 Boolean() 会变 true —— 这种坑
 * 在"开关"上代价最大：明明关着，它自己动起来了。 */
const bool = (v, dflt = false) => {
	if (v === true || v === 'true' || v === 1 || v === '1') return true
	if (v === false || v === 'false' || v === 0 || v === '0') return false
	return dflt
}
/* 窗口表：只留结构合法的项。空数组 = 走老字段映射，绝不悄悄改写用户配置。 */
const winList = (v) => (Array.isArray(v) ? v : []).slice(0, 6).map((w) => {
	if (!w || typeof w !== 'object') return null
	const from = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(w.from || '')) ? String(w.from) : ''
	const to = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(w.to || '')) ? String(w.to) : ''
	if (!from || !to || to <= from) return null
	return { from, to, times: clampInt(w.times, 0, 12, 0), enabled: bool(w.enabled, true) }
}).filter(Boolean)

/**
 * 校验 + 归一。任何脏数据都不该让面板或 CLI 崩，所以这里一律"兜成默认值"。
 * @param {any} raw
 */
export function normalize(raw) {
	const r = raw && typeof raw === 'object' ? raw : {}
	const tpl = Array.isArray(r.templates) ? list(r.templates, 8) : DEFAULTS.templates
	return {
		ownerNick: str(r.ownerNick, 40),
		ownerUid: str(r.ownerUid, 30),
		ownerSecUid: str(r.ownerSecUid, 120),
		autoDm: bool(r.autoDm, DEFAULTS.autoDm),
		autoComment: bool(r.autoComment, DEFAULTS.autoComment),
		autoAt: bool(r.autoAt, DEFAULTS.autoAt),
		autoPublish: bool(r.autoPublish, DEFAULTS.autoPublish),
		autoReport: bool(r.autoReport, DEFAULTS.autoReport),
		publishDir: str(r.publishDir, 260),
		publishPerDay: clampInt(r.publishPerDay, 0, 5, DEFAULTS.publishPerDay),
		publishMode: r.publishMode === 'now' ? 'now' : 'draft',
		publishWho: ['public', 'friend', 'private'].includes(r.publishWho) ? r.publishWho : DEFAULTS.publishWho,
		unattendedPublish: bool(r.unattendedPublish, DEFAULTS.unattendedPublish),
		unattendedFrom: hhmm(r.unattendedFrom) || DEFAULTS.unattendedFrom,
		unattendedTo: hhmm(r.unattendedTo) || DEFAULTS.unattendedTo,
		unattendedPerDay: clampInt(r.unattendedPerDay, 0, 5, DEFAULTS.unattendedPerDay),
		engageOn: bool(r.engageOn, DEFAULTS.engageOn),
		engageAuthors: str(r.engageAuthors, 300),
		engagePerDay: clampInt(r.engagePerDay, 0, 10, DEFAULTS.engagePerDay),
		engageGapSec: clampInt(r.engageGapSec, 30, 3600, DEFAULTS.engageGapSec),
		reportAt: hhmm(r.reportAt) || DEFAULTS.reportAt,
		sharePerDay: clampInt(r.sharePerDay, 0, 10, DEFAULTS.sharePerDay),
		atPerDay: clampInt(r.atPerDay, 0, 10, DEFAULTS.atPerDay),
		replyFreshHours: clampInt(r.replyFreshHours, 0, 24 * 30, DEFAULTS.replyFreshHours),
		keywords: str(r.keywords, 200),
		blockKeywords: str(r.blockKeywords, 200),
		minSec: clampInt(r.minSec, 0, 600, DEFAULTS.minSec),
		maxSec: clampInt(r.maxSec, 0, 3600, DEFAULTS.maxSec),
		minDigg: clampInt(r.minDigg, 0, 1_000_000, DEFAULTS.minDigg),
		scanRounds: clampInt(r.scanRounds, 0, 12, DEFAULTS.scanRounds),
		scanFrom: clampInt(r.scanFrom, 0, 23, DEFAULTS.scanFrom),
		scanTo: clampInt(r.scanTo, 1, 24, DEFAULTS.scanTo),
		scanWindows: winList(r.scanWindows),
		scanEveryMin: clampInt(r.scanEveryMin, 0, 1440, DEFAULTS.scanEveryMin),
		scanPerRound: clampInt(r.scanPerRound, 1, 50, DEFAULTS.scanPerRound),
		scanGap: clampInt(r.scanGap, 0, 60, DEFAULTS.scanGap),
	scanMode: r.scanMode === 'search' ? 'search' : 'feed',
	scanApi: r.scanApi !== false,
	scanKeywords: str(r.scanKeywords, 400),
		dutyEveryMin: clampInt(r.dutyEveryMin, 5, 720, DEFAULTS.dutyEveryMin),
		watchEverySec: clampInt(r.watchEverySec, 30, 3600, DEFAULTS.watchEverySec),
		replyStyle: ['温和', '简短', '专业', '幽默'].includes(r.replyStyle) ? r.replyStyle : DEFAULTS.replyStyle,
		persona: str(r.persona, 200),
		personaSource: ['aurabot', 'card', 'custom', 'off'].includes(r.personaSource) ? r.personaSource : DEFAULTS.personaSource,
	personaFile: str(r.personaFile, 400),
	personaName: str(r.personaName, 60),
		botName: str(r.botName, 20),
		replyMaxPerRound: clampInt(r.replyMaxPerRound, 1, 5, DEFAULTS.replyMaxPerRound),
		quietFrom: hhmm(r.quietFrom),
		quietTo: hhmm(r.quietTo),
		notifyQuiet: bool(r.notifyQuiet, DEFAULTS.notifyQuiet),
		activeFrom: hhmm(r.activeFrom) || (r.activeFrom === '' ? '' : DEFAULTS.activeFrom),
		activeTo: hhmm(r.activeTo) || (r.activeTo === '' ? '' : DEFAULTS.activeTo),
		active2From: hhmm(r.active2From),
		active2To: hhmm(r.active2To),
		peakReply: bool(r.peakReply, DEFAULTS.peakReply),
		templates: tpl.length ? tpl : DEFAULTS.templates,
	}
}

/**
 * 静音段和低峰窗口重叠时说一句（纯函数）。
 * 只提示、不改数据：有人就是要「低峰时段里留一段彻底安静」。
 * 语义上静音优先 —— 重叠那段时间不会自动回评，这是安全的那一侧。
 */
export function windowWarnings(s) {
	const out = []
	if (!s || !s.quietFrom || !s.quietTo) return out
	const hit = (m, a, b) => {
		const x = minutesOf(a)
		const y = minutesOf(b)
		if (x == null || y == null || x === y) return false
		return x < y ? (m >= x && m < y) : (m >= x || m < y)
	}
	for (const [a, b] of [[s.activeFrom, s.activeTo], [s.active2From, s.active2To]]) {
		if (!a || !b) continue
		let overlap = false
		for (let m = 0; m < 1440 && !overlap; m += 1) overlap = hit(m, s.quietFrom, s.quietTo) && hit(m, a, b)
		if (overlap) out.push(`静音段 ${s.quietFrom}–${s.quietTo} 和低峰窗口 ${a}–${b} 重叠：静音优先，重叠那段不会自动回评`)
	}
	return out
}

export function readSettings() {
	const { value } = readJsonChecked(settingsFile(), {}, (v) => Boolean(v && typeof v === 'object'))
	const s = normalize(value)
	/* warnings 是算出来的，不落盘：writeSettings 走 normalize 会把它们丢掉。 */
	const w = windowWarnings(s)
	if (w.length) s.warnings = w
	return s
}

/**
 * 合并式保存：只覆盖传进来的字段，别的保持不动（避免面板只改一个开关就把别的清空）。
 * @param {any} patch
 * @returns {{ok:boolean, settings?:any, error?:string}}
 */
export function writeSettings(patch) {
	try {
		const cur = readSettings()
		const next = normalize({ ...cur, ...(patch && typeof patch === 'object' ? patch : {}) })
		const w = atomicWriteJson(settingsFile(), next)
		if (!w.ok) return { ok: false, error: w.error }
		return { ok: true, settings: next }
	} catch (e) {
		return { ok: false, error: String((e && e.message) || e) }
	}
}

/**
 * 提示词的第一行：「你是谁」。
 * 以前这行写死在三个提示词里（同一个角色），别人装了插件会自动用别人的口吻回话。
 * 现在由设置里的 `persona` 决定；没填就给一句中性的。
 * @param {any} s
 */
const GENERIC_PERSONA = '你是这个抖音账号的主人，正在抖音上跟人说话。'

/** 人设卡目录：和 QQ 侧共用同一份 identity.md / style.md。 */
const petDir = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', 'desktop', 'qq-pet')

/** 取某节下的 `- ` 条目（纯函数，方便单测）。 */
export function bulletsOf(md, headingRe, max = 3) {
	const lines = String(md || '').split(/\r?\n/)
	const start = lines.findIndex((l) => headingRe.test(l.trim()))
	if (start < 0) return []
	const out = []
	for (let i = start + 1; i < lines.length; i++) {
		const t = lines[i].trim()
		if (/^##\s/.test(t)) break
		if (!t.startsWith('- ')) continue
		const clean = t.slice(2).replace(/[`*_]/g, '').trim()
		if (clean) out.push(clean)
		if (out.length >= max) break
	}
	return out
}

/** 取某节下的第一段正文（不是 `- ` 那种）。 */
export function paragraphOf(md, headingRe) {
	const lines = String(md || '').split(/\r?\n/)
	const start = lines.findIndex((l) => headingRe.test(l.trim()))
	if (start < 0) return ''
	for (let i = start + 1; i < lines.length; i++) {
		const t = lines[i].trim()
		if (/^##\s/.test(t)) break
		if (t && !t.startsWith('- ')) return t
	}
	return ''
}

/**
 * 把两张卡折成一句人设（纯函数）。
 * 只要"我是谁"和"底线"，不要全文 —— 每轮都在付费，420 字是预算不是客套。
 */
export function personaFromCard(identity = '', style = '') {
	const me = bulletsOf(identity, /^##\s*我这个人/, 3)
	if (!me.length) return ''
	const bottom = paragraphOf(style, /^##\s*.{0,16}底线/)
	/* 开头别写「你是这个抖音账号的主人」——那句话把语气往客服/官方号上带，
	 * 2026-11-05 用户反馈"机器味重"，一半来自这里。先给身份，再给规矩。 */
	const head = '你是下面这个人。说话像她本人，不像客服，也不像在运营一个账号：'
	const body = me.map((x) => '- ' + x).join('\n')
	/* 说话方式：这两条是 style.md 里最影响"像不像她"的，且极稳定，直接写死，
	 * 免得为了两句话去解析 7KB 的卡（解析出来的半句话反而更怪）。 */
	const how = '说话方式：括号里写小动作（歪头、戳戳、缩起来），不解释、不展开；他短我短，他长我长；' +
		'不用「感谢支持 / 很高兴为你 / 希望能帮到你」这类客服句，不总结、不反问一串问题。'
	const tail = bottom ? '\n底线：' + bottom : ''
	return (head + '\n' + body + '\n' + how + tail).slice(0, 520)
}

/* 读盘 + 按 mtime 缓存：每轮都要用，但没必要每轮 stat 两次。 */
let cardCache = { key: '', text: '' }
function readCardPersona() {
	try {
		const dir = petDir()
		const a = join(dir, 'identity.md')
		const b = join(dir, 'style.md')
		const key = String(statSync(a).mtimeMs) + ':' + String(statSync(b).mtimeMs)
		if (cardCache.key === key) return cardCache.text
		const text = personaFromCard(readFileSync(a, 'utf8'), readFileSync(b, 'utf8'))
		cardCache = { key, text }
		return text
	} catch {
		return ''
	}
}

export function personaLine(s) {
	const mode = (s && s.personaSource) || DEFAULTS.personaSource
	if (mode === 'off') return GENERIC_PERSONA
	const custom = str((s && s.persona) || '', 200)
	if (custom) return custom // 手写的优先，显式覆盖
	/* aurabot：读她活着的卡（QQ 那份人格卡），dy 与 QQ 用同一个人。
	 * 读不到再退回 qq-pet 的 520 字摘要，不要一句空话。 */
	if (mode === 'aurabot') {
		const live = personaForDy(s, { fallback: readCardPersona })
		if (live) return live
	}
	if (mode === 'card') {
		const card = readCardPersona()
		if (card) return card
	}
	return GENERIC_PERSONA
}

/**
 * 给子进程用的环境变量。**这是设置真正生效的地方** —— 不接这一段，
 * 面板上的关键词/时长/条数就只是存了个 JSON。
 */
export function settingsEnv(settings) {
	const s = settings || readSettings()
	const e = {
		DOUYIN_STUDIO_KEYWORDS: s.keywords,
		DOUYIN_STUDIO_BLOCKWORDS: s.blockKeywords,
		DOUYIN_STUDIO_FEED_MIN_SEC: String(s.minSec),
		DOUYIN_STUDIO_FEED_MAX_SEC: String(s.maxSec),
		DOUYIN_STUDIO_FEED_MIN_DIGG: String(s.minDigg),
		DOUYIN_STUDIO_FEED_COUNT: String(s.scanPerRound),
		DOUYIN_STUDIO_FEED_GAP: String(s.scanGap),
		DOUYIN_STUDIO_REPLY_MAX: String(s.replyMaxPerRound),
	}
	// 静音时段：两个都填了才算数（只填一个等于没填）
	if (s.quietFrom && s.quietTo) {
		e.DOUYIN_STUDIO_QUIET_FROM = s.quietFrom
		e.DOUYIN_STUDIO_QUIET_TO = s.quietTo
	}
	// 主人号：只免「同一人每天 2 条」，别的闸不动
	if (s.ownerUid) e.DOUYIN_STUDIO_OWNER_UID = s.ownerUid
	return e
}
