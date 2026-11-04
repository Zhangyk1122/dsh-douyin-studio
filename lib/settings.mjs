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
import { atomicWriteJson, readJsonChecked } from './fsx.mjs'

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
	reportAt: '21:30',
	/* 两个出口分开数（2026-11-04 晚）：私信分享几条、评论区 @ 几条。0 = 那条路不走。
	 * 这就是唯一的「给主人发视频」口径 —— 老的 digestPerDay/digestAt 已经删了，
	 * 那两个是「每天定时再发一批」，跟这里的额度叠在一起就会一晚上刷屏。 */
	sharePerDay: 2,
	atPerDay: 2,
	// —— 刷视频策略 ——
	keywords: '',        // 逗号分隔。**非空时 feed 会按词去搜**，不是从推荐流里筛
	blockKeywords: '',
	minSec: 5,
	maxSec: 180,
	minDigg: 0,
	/* 每天自动刷几轮（0 = 关）。只刷不互动：feed 是只读的，不会自己点赞评论。
	 * 轮次的时间点由 lib/schedule.mjs 铺开（纯函数，有单测钉着）。 */
	scanRounds: 3,
	scanFrom: 9,
	scanTo: 22,
	/* 两轮之间隔多久（分钟）。一轮刷完到下一轮开始，就是这么久。
	 * 0 = 退回「在开始/结束之间均匀铺开」。 */
	scanEveryMin: 240,
	/* 每轮看几个 + 每看完一条歇几秒。
	 * 后者是「刷多久」的真正把手：10 条 × 6 秒 = 一轮约一分钟，不会一口气刷穿。
	 * 别用 feed 的 count / rounds 两层参数去表达（那两个已经删了）。 */
	scanPerRound: 10,
	scanGap: 6,
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
	/* 自称：报平安的标题用「<botName>日报」。空 = 就叫「日报」。 */
	botName: '',
	replyMaxPerRound: 2,  // 一轮最多回几条（CLI 的 --max）
	quietFrom: '',        // HH:MM，空 = 不静音
	quietTo: '',
	/* DS 的谷时（北京时间 00:30-08:30 半价）。回评/回私信/回 @/自主发布都只在这段做，
	 * 因为这些动作每一步都要过模型 —— 白天跑等于按原价买一套没人看的流程。 */
	activeFrom: '00:30',
	activeTo: '08:30',
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
		autoDm: bool(r.autoDm, DEFAULTS.autoDm),
		autoComment: bool(r.autoComment, DEFAULTS.autoComment),
		autoAt: bool(r.autoAt, DEFAULTS.autoAt),
		autoPublish: bool(r.autoPublish, DEFAULTS.autoPublish),
		autoReport: bool(r.autoReport, DEFAULTS.autoReport),
		publishDir: str(r.publishDir, 260),
		publishPerDay: clampInt(r.publishPerDay, 0, 5, DEFAULTS.publishPerDay),
		publishMode: r.publishMode === 'now' ? 'now' : 'draft',
		publishWho: ['public', 'friend', 'private'].includes(r.publishWho) ? r.publishWho : DEFAULTS.publishWho,
		reportAt: hhmm(r.reportAt) || DEFAULTS.reportAt,
		sharePerDay: clampInt(r.sharePerDay, 0, 10, DEFAULTS.sharePerDay),
		atPerDay: clampInt(r.atPerDay, 0, 10, DEFAULTS.atPerDay),
		keywords: str(r.keywords, 200),
		blockKeywords: str(r.blockKeywords, 200),
		minSec: clampInt(r.minSec, 0, 600, DEFAULTS.minSec),
		maxSec: clampInt(r.maxSec, 0, 3600, DEFAULTS.maxSec),
		minDigg: clampInt(r.minDigg, 0, 1_000_000, DEFAULTS.minDigg),
		scanRounds: clampInt(r.scanRounds, 0, 12, DEFAULTS.scanRounds),
		scanFrom: clampInt(r.scanFrom, 0, 23, DEFAULTS.scanFrom),
		scanTo: clampInt(r.scanTo, 1, 24, DEFAULTS.scanTo),
		scanEveryMin: clampInt(r.scanEveryMin, 0, 1440, DEFAULTS.scanEveryMin),
		scanPerRound: clampInt(r.scanPerRound, 1, 50, DEFAULTS.scanPerRound),
		scanGap: clampInt(r.scanGap, 0, 60, DEFAULTS.scanGap),
		dutyEveryMin: clampInt(r.dutyEveryMin, 5, 720, DEFAULTS.dutyEveryMin),
		watchEverySec: clampInt(r.watchEverySec, 30, 3600, DEFAULTS.watchEverySec),
		replyStyle: ['温和', '简短', '专业', '幽默'].includes(r.replyStyle) ? r.replyStyle : DEFAULTS.replyStyle,
		persona: str(r.persona, 200),
		botName: str(r.botName, 20),
		replyMaxPerRound: clampInt(r.replyMaxPerRound, 1, 5, DEFAULTS.replyMaxPerRound),
		quietFrom: hhmm(r.quietFrom),
		quietTo: hhmm(r.quietTo),
		activeFrom: hhmm(r.activeFrom) || (r.activeFrom === '' ? '' : DEFAULTS.activeFrom),
		activeTo: hhmm(r.activeTo) || (r.activeTo === '' ? '' : DEFAULTS.activeTo),
		templates: tpl.length ? tpl : DEFAULTS.templates,
	}
}

export function readSettings() {
	const { value } = readJsonChecked(settingsFile(), {}, (v) => Boolean(v && typeof v === 'object'))
	return normalize(value)
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
export function personaLine(s) {
	const p = str((s && s.persona) || '', 200)
	return p || '你是这个抖音账号的主人，正在抖音上跟人说话。'
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
