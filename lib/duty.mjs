/**
 * lib/duty.mjs —— 值班：定时去看一眼，有该接的话就接
 * ============================================================================
 * 和「我手动回评论」的区别只有一点：**它自己会醒**。
 * 所以每一条都要能解释「为什么回它」，账本里必须留下理由——不然过两天翻账本，
 * 只看到一串时间戳，根本不知道自己当时在想什么。
 *
 * 三件事按顺序做，任何一步失败都不影响后面：
 *   ① 私信有新消息 → 弹通知（lib/watch.mjs 干这个，这里只顺带叫一声）
 *   ② 我的作品下面有新评论 → 收进来当候选
 *   ③ autoReply 开着 → 每次最多回 maxPerRun 条，走「生成一句话 → 回 → 记账」
 *
 * 🔴 自动回的硬护栏：
 *   - 只在 09:00–23:00 干活
 *   - 每条都过 lib/ledger.mjs 的四道闸（cid / 人 / 楼 / 额度）
 *   - 生成失败、回失败 → 进 lib/queue.mjs，不重试第三次就放弃
 * ============================================================================
 */
import { spawn } from 'node:child_process'
import { cleanCaption } from './caption.mjs'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { detail, self, comments, replies, reply, works } from './api.mjs'
import { checkQuota, recordReply } from './ledger.mjs'
import { remember, noteReply, summaryFor } from './contacts.mjs'
import { judgeComment, dedupeByText } from './comment-filter.mjs'
import { moodLine, moodPaceLine, note } from './mood.mjs'
import { humanDelay, learnPace } from './rhythm.mjs'
import { watchOnce, watchLine } from './watch.mjs'
import * as budget from './budget.mjs'
import { readSettings, personaLine } from './settings.mjs'
import { inWindow } from './policy.mjs'
import { guardedWrite } from './risk.mjs'
import { add as queueAdd } from './queue.mjs'
import { atomicWriteJson, readJsonSafe } from './fsx.mjs'

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DIR = join(HOME, 'douyin-duty')
/** 值班最近一次的结果。面板要的是「上一轮发生了什么」，不是「现在开着吗」。 */
const STATE_FILE = join(DIR, 'duty-state.json')

/**
 * 读上一轮值班的记录。
 * @returns {{at?:string, scanned?:number, picked?:number, autoReply?:boolean, error?:string, results?:Array<object>}|null}
 */
export function lastRun() {
	return readJsonSafe(STATE_FILE, null, (v) => v && typeof v === 'object')
}

/**
 * 记下这一轮的结果（最多留 10 条明细，别让文件无限长）。
 * 写失败绝不影响值班本身（atomicWriteJson 不抛，只回 {ok:false}）。
 * @param {object} obj
 */
function saveLastRun(obj) {
	const trimmed = { ...obj, results: (obj.results || []).slice(0, 10) }
	atomicWriteJson(STATE_FILE, trimmed)
}

const HOUR_OK = () => {
	const h = new Date().getHours()
	return h >= 9 && h < 23
}

/** 我自己的 uid（拿不到就返回 ''，调用方据此决定要不要排自己） */
let meCache = null
async function meUid() {
	if (meCache) return meCache
	try {
		const me = await self()
		meCache = String((me && me.user && me.user.uid) || '')
	} catch { meCache = '' }
	return meCache
}

/**
 * 生成一句话。
 * ⭐ 2026-11-01 改：不再 `spawn('dsh')` —— Windows 上 `dsh` 是 `.cmd`，
 *    不带 shell 直接 spawn 会 `ENOENT`（第一次就是这么炸的）。
 *    现在两条路：
 *      ① 有 DEEPSEEK_API_KEY 就直接打 API（快，1–3 秒，不启动整个 profile）
 *      ② 没有才退回 `cmd /c dsh headless …`
 *    生成失败一律返回 ok:false，绝不拿一句模板话糊上去。
 */
const readKey = () => {
	try {
		const p = join(process.env.DSH_HOME || join(homedir(), '.dsh'), '.credentials.yaml')
		const txt = readFileSync(p, 'utf8')
		/* 允许点号：平台签发的 key 形如 ak_xxx.yyy，旧正则 [A-Za-z0-9_-] 会在点号处截断（<16 位）→ 静默返回空。
		 * 但只有 sk- 开头才是 api.deepseek.com 认的 key，其它一律交给 CLI 分支。 */
		const m = txt.match(/DEEPSEEK_API_KEY\s*:\s*["']?([^"'\s]+)/)
		const v = m ? m[1] : ''
		return /^sk-/.test(v) ? v : ''
	} catch { return '' }
}

/**
 * 跑一次模型。默认值按「评论区接一句话」调过，也可以由调用方覆盖。
 *
 * 2026-11-11 之前写死：单条 user 消息、max_tokens 80、temperature 1.2。
 * 结果就是每条回复都从同一片空白里长出来 —— 一句话、30 字、没有场景。
 * 现在留出 `system`（人设放 system，正文放场景）与两个可调参数。
 *
 * @param {string} prompt
 * @param {{timeout?:number, system?:string, maxTokens?:number, temperature?:number}} [opts]
 */
/**
 * 起一个 headless 会话，把 prompt 交给 DSH 自己的模型。
 * 原来写死 `spawn('cmd.exe', ['/c', 'dsh', ...])` —— **只有 Windows 能跑**，
 * macOS/Linux 上直接 ENOENT，于是自动回复在 Mac 上「一条都发不出来」。
 * 现在按平台选 shell，并给 dsh 一个候选列表（PATH 里没有时也能找到）。
 */
/** 从 $DSH_HOME/.credentials.yaml 的 refs 里取一个键值（允许点号/斜杠）。 */
function credRef(name) {
	try {
		const p = join(process.env.DSH_HOME || join(homedir(), '.dsh'), '.credentials.yaml')
		const txt = readFileSync(p, 'utf8')
		const m = txt.match(new RegExp(name + '\\s*:\\s*["\']?([^"\'\\s]+)'))
		return m ? m[1] : ''
	} catch { return '' }
}

function spawnHeadless(task) {
	/* headless 会话要自己解析模型凭据：宿主那边是从 credentials 服务取的，
	 * 子进程拿不到，所以显式把 DEEPSEEK_API_KEY 传下去（否则 MISSING_CREDENTIAL）。 */
	const env = { ...process.env }
	if (!env.DEEPSEEK_API_KEY) {
		const k = credRef('DEEPSEEK_API_KEY')
		if (k) env.DEEPSEEK_API_KEY = k
	}
	if (process.platform === 'win32') return spawn('cmd.exe', ['/c', 'dsh', 'headless', task], { windowsHide: true, env })
	const cands = [
		process.env.DSH_BIN,
		'dsh',
		join(homedir(), '.local', 'bin', 'dsh'),
		'/opt/homebrew/bin/dsh',
		'/usr/local/bin/dsh',
	].filter(Boolean)
	const bin = cands.find((c) => c === 'dsh' || existsSync(c)) || 'dsh'
	return spawn(bin, ['headless', task], { windowsHide: true, env })
}

export async function generate(prompt, { timeout = 60000, system = '', maxTokens = 160, temperature = 0.9 } = {}) {
	const key = readKey()
	const msgs = system ? [{ role: 'system', content: system }, { role: 'user', content: prompt }] : [{ role: 'user', content: prompt }]
	if (key) {
		try {
			const ctl = new AbortController()
			const t = setTimeout(() => ctl.abort(), timeout)
			const r = await fetch('https://api.deepseek.com/chat/completions', {
				method: 'POST',
				signal: ctl.signal,
				headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
				body: JSON.stringify({
					model: 'deepseek-chat',
					messages: msgs,
					max_tokens: Math.max(32, Math.min(400, Number(maxTokens) || 160)),
					temperature: Math.max(0, Math.min(2, Number(temperature) || 0.9)),
				}),
			})
			clearTimeout(t)
			const j = await r.json()
			const txt = String((j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim()
			if (!txt) return { ok: false, error: 'API 返回空（' + r.status + '）' }
			return { ok: true, via: 'api', text: txt.replace(/^["'「『]|["'」』]$/g, '').trim().slice(0, 120) }
		} catch (e) {
			return { ok: false, error: 'API 失败: ' + String((e && e.message) || e) }
		}
	}
	return new Promise((resolve) => {
		const full = system ? system + '\n\n' + prompt : prompt
		const p = spawnHeadless(full)
		let out = ''
		let err = ''
		const t = setTimeout(() => { try { p.kill() } catch { /* 没了 */ } }, timeout)
		p.stdout.on('data', (b) => { out += b })
		p.stderr.on('data', (b) => { err += b })
		p.on('close', (code) => {
			clearTimeout(t)
			const txt = String(out || '').trim().split(/\r?\n/).filter(Boolean).pop() || ''
			if (!txt) return resolve({ ok: false, error: String(err || ('exit ' + code)).slice(0, 200) })
			resolve({ ok: true, via: 'cli', text: txt.replace(/^["'「『]|["'」』]$/g, '').trim().slice(0, 60) })
		})
		p.on('error', (e) => { clearTimeout(t); resolve({ ok: false, error: String(e.message || e) }) })
	})
}

/**
 * 收集候选：我自己最近几条作品下的评论，挑「别人发的、没回过的」。
 * 只取每条作品前 20 条（按热度），够用了——评论区几百条翻不动，也不需要翻。
 *
 * ⚠️ 踩过的坑：一开始写 `cm.author_uid === w.author_uid` 想排掉自己，结果两个字段
 *    都不存在 → `'' === ''` 恒真 → 所有评论被当成「我发的」全跳过，收集永远是空的。
 *    现在只在我**确实知道自己 uid** 的时候才排自己。
 */
/* 评论的 create_date 和 feed 一样：`toISOString()` 截出来的 UTC，**没有时区标记**。
 * 直接 Date.parse 会按本地时间解释，东八区差 8 小时 —— 时效筛子就永远筛错。 */
const ageHoursOf = (v, now = Date.now()) => {
	let s = String(v || '').trim()
	if (!s) return null
	if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(s)) s = s.replace(' ', 'T') + 'Z'
	const t = Date.parse(s)
	return Number.isFinite(t) ? Math.max(0, (now - t) / 3600000) : null
}

/**
 * 时效判定（纯函数，测试直接钉）。
 * ============================================================================
 * 2026-11-09：值班和收件箱以前是两套标准 —— 这边按 `replyFreshHours`（默认 48h）丢，
 * 那边按 7 天算 worth，于是面板 `pending: 3`、值班 `scanned: 0`，看起来像「没评论」。
 * 现在两边都调这一个函数：`freshHours<=0` = 不设时效（老行为），日期读不出来 = 放行。
 * @param {string} createDate 抖音的 create_date（无时区标记的 UTC）
 * @param {number} freshHours 时效小时数，0 = 不限
 * @param {number} [now] 现在（ms），测试用
 * @returns {{stale:boolean, hours:number|null}}
 */
export function withinFresh(createDate, freshHours, now = Date.now()) {
	const h = Number(freshHours)
	const hours = ageHoursOf(createDate, now)
	if (!(h > 0) || hours == null) return { stale: false, hours }
	return { stale: hours > h, hours: Math.round(hours * 10) / 10 }
}

export async function collect({ worksN = 3, perWork = 20, freshHours = 0, pages = 2 } = {}) {
	const me = await meUid()
	const ws = await works({ count: worksN })
	if (ws.ok === false) return { ok: false, error: ws.error }
	const nowMs = Date.now()
	const out = []
	/* 时效：0 = 不限。默认走设置里的 48 小时 ——
	 * 没有这一层，装上第一轮会把几个月前的老评论翻出来回一遍（作者踩过）。 */
	const maxAge = Number(freshHours) > 0 ? Number(freshHours) : 0
	let skippedOld = 0
	let seen = 0
	let worksFailed = 0
	let pageFetched = 0
	const pageN = Math.min(Math.max(Number(pages) || 1, 1), 4)
	for (const w of (ws.list || []).slice(0, worksN)) {
		const aweme = String(w.aweme_id || '')
		if (!aweme) continue
		/* 翻页：api.comments 本来就收 cursor / has_more（lib/api.mjs:148），
	 * 这里只是把「只看第一页」换成顺着 cursor 走 pageN 页。
	 * 页与页之间停一下 —— 评论区不是接口，压不出更多信息，只会更像脚本。 */
		const merged = []
	let cursor = 0
	let okAny = false
	for (let i = 0; i < pageN; i += 1) {
		const c = await comments(aweme, { count: perWork, cursor })
		if (c.ok === false) break
		okAny = true
		pageFetched += 1
		merged.push(...(c.list || []))
		if (!c.has_more || !c.cursor || c.cursor === cursor) break
		cursor = c.cursor
		await new Promise((r) => setTimeout(r, 350 + Math.round(Math.random() * 500)))
	}
	if (!okAny) { worksFailed += 1; continue }
	const byCid = new Map()
	for (const cm of merged) {
		const cid0 = String(cm.cid || '')
		if (cid0) byCid.set(cid0, cm)
	}
	/* 热评：这条作品下点赞最高的三条（排掉自己发的）。
	 * 回复时一起喂进去 —— 以前只喂被回的那一句，
	 * 她当然不知道评论区在聊什么，「没看评论」不是错觉。 */
	const hot = [...byCid.values()]
		.filter((cm) => String((cm.user && cm.user.uid) || '') !== String(me || ''))
		.sort((x, y) => Number(y.digg || 0) - Number(x.digg || 0))
		.slice(0, 3)
		.map((cm) => ({ text: String(cm.text || '').replace(/\s+/g, ' ').slice(0, 60), digg: Number(cm.digg || 0) }))
		.filter((x) => x.text)
	for (const cm of byCid.values()) {
			const cid = String(cm.cid || '')
			if (!cid) continue
			seen += 1
			const u = cm.user || {}
			const uid = String(u.uid || '')
			if (me && uid && uid === me) continue          // 自己回自己的，不算候选
			const root = String(cm.root_comment_id || '')
			if (maxAge > 0) {
				const fr = withinFresh(cm.create_date, maxAge, nowMs)
				if (fr.stale) { skippedOld += 1; continue }
			}
			out.push({
				aweme,
				aweme_title: cleanCaption(w.desc, 160),
				cid,
				root: root && root !== '0' ? root : '',
				text: String(cm.text || '').slice(0, 120),
				author: String(u.nickname || ''),
				author_id: uid,
				digg: Number(cm.digg || 0),
				hot,
			})
		}
	}
	return { ok: true, candidates: out, works: (ws.list || []).length, me, skippedOld, seen, worksFailed, pages: pageN, pageFetched }
}

/**
 * 回复提示。2026-11-11 之前只有四行：人设 + 「你在评论区回一句」+ 作品标题 + 对方那句话，
 * 然后要求「一句、30 字以内」。没有场景、没有上文、没有这条视频在讲什么 ——
 * 每条回复都从同一片空白里长出来，所以看着一模一样。
 *
 * 现在把能拿到的真材料都摆进去：这篇作品的文案、留言的人是谁、他是在楼里接话还是新开一楼、
 * 他那句话有多长（回话长度是跟着它走的，不是按字数配额）。
 * 仍然只要求一件事：像她自己接一句。
 */
export const PROMPT = (c, s) => {
	const who = String(c.author || '').trim()
	const tail = String(c.root || '').trim()
	const len = String(c.text || '').length
	const lines = [
		'你在抖音，自己的作品下面有人留言了。',
		'作品文案：' + String(c.aweme_title || '（这条没写文案）'),
		'留言的人：' + (who || '一个观众') + (tail ? '（他在楼里接着别人的话）' : '（他自己起的话头）'),
		'他说：「' + String(c.text || '') + '」',
		'',
		'回他一句。',
		'长度跟着他那句走：他说一句短的，你就短；他说得多，你可以多给半句，不用凑够几句。',
		'别用「谢谢支持」「感谢关注」「欢迎常来」这类客套话；别自我介绍，别提 AI 或模型。',
		'不要提问收尾，不要加「有什么想说的随时找我」。',
		'如果那句话里有具体的东西（人名、天气、他做的事），就接那个东西，别绕回你自己。',
	]
	const seen = watchLine(c.watch)
	if (seen) lines.splice(2, 0, '我看过这条：' + seen)
	if (Array.isArray(c.hot) && c.hot.length) {
		lines.push('', '这条下面别人在说：')
		for (const h of c.hot.slice(0, 3)) lines.push('- ' + h.text + (h.digg ? '（' + h.digg + ' 赞）' : ''))
		lines.push('这些是别人的话，不是要你逐条回；接不接、接哪一句，你自己看。')
	}
	if (len >= 40) lines.push('他这句话挺长，说明他想聊，可以多接一层。')
	/* 认识的人：不是「更熟」，是**别又从零开始**。
	 * 只给事实（来过几次 / 回过几次 / 他说过的原话），不给结论，
	 * 更不要求她「表现得亲近」——那是表演，不是认识。 */
	if (c.history) {
		lines.push('', '这个人你以前见过：' + String(c.history))
		lines.push('接得上就接一句，接不上就当没看见，别硬攀关系。')
	}
	/* 今天的心情：只改语气，不许写进正文（写进去就像在汇报自己） */
	try {
		const mood = moodLine()
		if (mood) {
			const pace = moodPaceLine()
			lines.push('', mood + '。这只影响语气和长度，别把状态说出来。' + (pace ? ' ' + pace + '。' : ''))
		}
	} catch {
		/* 心情读不出来就当没有 */
	}
	return lines.join('\n')
}

/** 人设进 system，场景进 user —— 分开之后人设不会被「回一句」的指令冲淡。 */
export const SYSTEM = (s) => personaLine(s)

/** 跑一轮值班（内部实现，外面用 run() 包一层好记账） */
async function _run({ autoReply = false, maxPerRun = 2, dry = false, manual = false, ownerOnly = false } = {}) {
	/* 回评论也要进「谷时」窗口：这些回复每一条都要先过一次模型，
	 * 白天跑等于按原价买一套没人看的流程（哥哥 2026-11-03 提的）。
	 * 自动跑才看窗口；面板上手动点「开值班 / 现在跑一轮」不受时间限制。
	 * 谷时两个字段都空着 = 不限制，此时退回原来的 09:00–23:00 礼貌时段。 */
	/* 时间这件事分两层，以前混成一层了：
	 *   ① 睡眠段（09:00–23:00 之外）—— **永远**不主动打扰，这是礼貌，不是省钱；
	 *   ② 低峰窗口（可配两段）—— 只决定「贵的动作」（自主发布 / 自动刷视频）什么时候跑。
	 * 回评论默认**高峰期也回**（peakReply），便宜时多做，贵时少做，但不能装死。 */
	if (!dry && !manual && autoReply) {
		const s = readSettings()
		/* 静音段先挡：这是「别打扰主人」的承诺，比省不省钱硬。
		 * 2026-11-13 实证过一条 12:00 的自动回评正好落在 quietFrom 12:00–18:00 里 ——
		 * 设置页存了 quietFrom/quietTo，这里却一次都没读过（grep `quiet` = 0）。 */
		const dq = new Date()
		if (inWindow(dq.getHours() * 60 + dq.getMinutes(), s.quietFrom, s.quietTo)) {
			return { ok: true, skipped: '静音时段（' + s.quietFrom + '–' + s.quietTo + '），先不打扰' }
		}
		const wins = [[s.activeFrom, s.activeTo], [s.active2From, s.active2To]].filter(([a, b]) => a && b)
		if (s.peakReply === false && wins.length) {
			const d = new Date()
			const m = d.getHours() * 60 + d.getMinutes()
			if (!wins.some(([a, b]) => inWindow(m, a, b))) {
				return { ok: true, skipped: '不在低峰窗口，且设了高峰不回' }
			}
		}
		if (!HOUR_OK()) return { ok: true, skipped: '不在 09:00–23:00，先不打扰' }
	}
	const st0 = readSettings()
	const col = await collect({ freshHours: st0.replyFreshHours })
	if (col.ok === false) return col
	const picked = []
	const out = []
	let filtered = 0
	/* 先做减法：广告号、纯表情、「666」这类不值得回。
	 * aurabot 那边叫 group-policy（先判后说），这里只借「判」这一半。 */
	const ownerUid = String(st0.ownerUid || '')
	for (const c of dedupeByText(col.candidates)) {
		/* ownerOnly：这一轮只回主人自己的评论（验收用，别扫到别人） */
		if (ownerOnly && ownerUid && String(c.author_id) !== ownerUid) { filtered += 1; continue }
		if (picked.length >= maxPerRun) break
		const verdict = judgeComment(c)
		if (!verdict.reply) { filtered++; out.push({ cid: c.cid, skip: verdict.why }); continue }
		/* ⚠️ 参数名写错过一次：ledger 收的是 authorUid，这里传的是 authorId，
		 * 于是「同一个人一天最多 2 条」这道闸从来没生效过（作者字段一直是空的）。 */
		const q = checkQuota({ aweme: c.aweme, cid: c.cid, authorUid: c.author_id, root: c.root })
		if (!q.ok) { out.push({ cid: c.cid, skip: q.why || q.error }); continue }
		/* 账本只是**本地**记忆：装上之前的、或账本被清过的，它一概不知道。
		 * 所以真去问一次「这条底下我回过没有」——一次请求，换掉"把以前回过的又回一遍"。
		 * （作者说昨天就是这样：一堆早就回过的评论又被回了一遍。） */
		if (!dry) {
			const rr = await replies(c.aweme, c.cid, { count: 20 }).catch(() => null)
			const mine = rr && rr.ok && (rr.list || []).some(
				(x) => String((x.user && x.user.uid) || '') === String(col.me || ''),
			)
			if (mine) { out.push({ cid: c.cid, skip: '这条底下我已经回过' }); continue }
		}
		/* 值班以前只走 ledger，绕过了五通道预算：面板上「回评 2/20」和「回评论 0/20」对不上，
		 * 总闸也不会把它们算进去（2026-11-03 发现）。这里补上同一张表的检查 + 记账。 */
		const bq = budget.check({ ch: 'comment', peer: c.author_id, thread: c.root || c.cid })
		if (!bq.ok) { out.push({ cid: c.cid, skip: bq.why || '额度不够' }); continue }
		/* 他以前说过什么，先查一眼再生成（没有就空着，绝不编） */
		c.history = summaryFor(c.author_id)
		/* 先看一眼这条视频：多长、多少赞、评论里在说什么。
		 * 拿不到就少一行材料 —— 看不到不等于要停下来。 */
		if (!c.watch && !dry) c.watch = await watchOnce(c.aweme).catch(() => null)
		const g = dry ? { ok: true, text: '（dry：只看不生成）' } : await generate(PROMPT(c, s), { system: SYSTEM(s) })
		if (!g.ok) { out.push({ cid: c.cid, error: '生成失败', detail: g.error }); continue }
		if (dry) { out.push({ cid: c.cid, dry: true, text: g.text, why: 'dry' }); picked.push(c); continue }
		if (!autoReply) { out.push({ cid: c.cid, candidate: true, text: g.text }); picked.push(c); continue }
		/* ⚠️ 2026-11-03 真机：外面那些「作者」评论全是顶层——因为这里只传了 root，
		 * 没有楼根（对方就是顶层评论）时就变成「新发一条」，不是「回他这条」。
		 * 和 at-reply 一个道理：没有楼根，就把被回的那条当父评论（reply_id=cid）。 */
		const thread = c.root || c.cid
		const replyTo = c.root ? c.cid : ''
		/* 像人一样有停顿，也像人一样偶尔漏看（只有非 @ 的普通评论才允许漏）。
		 * 停顿优先用从自己动作账学到的分布（D7-A）；学不到才按字数估——
		 * 按字数等一会儿本质是「演」一个打字的人，QQ 侧早就否过。 */
		const pace = humanDelay(g.text, { important: false, pace: learnPace() })
		if (pace.skip) { out.push({ cid: c.cid, skip: '这次没回（漏看了）' }); continue }
		if (pace.delayMs) await new Promise((r) => setTimeout(r, pace.delayMs))
		/* 风控包装（调研 D1）：冷却中直接拒，失败像风控就记账。
		 * 以前这里直连 api.reply —— 值班是最高频的自动写出口，却绕过所有护栏，
		 * 撞了风控也不落盘，冷却文件永远是空的。 */
		const r = await guardedWrite(() => reply({ aweme: c.aweme, text: g.text, root: thread, replyTo }))
		if (r.cooling) { out.push({ cid: c.cid, skip: '风控冷却：' + r.error }); break }
		if (r.ok) {
			try { note('reply') } catch { /* 心情推不动不影响回评 */ }
			recordReply({
				aweme: c.aweme, cid: c.cid, root: c.root,
				/* 字段名必须跟 ledger 对齐：authorUid / authorName。写错就是记了个空名，
				 * 下次「同一个人」的闸照样认不出来。 */
				authorUid: c.author_id, authorName: c.author,
				text: g.text, reason: '值班自动回：' + String(c.text).slice(0, 24), newCid: r.cid, via: 'duty',
			})
			budget.record({ ch: 'comment', peer: c.author_id, thread: c.root || c.cid, note: 'duty ' + c.cid })
			/* 记一笔「我回过他」，也把他的原话留下——下次这句就是「上次你说…」的来源。
			 * 顺序：先 remember（他这句话），再 noteReply（我的动作），
			 * 否则新人在表里不存在，noteReply 会静默丢掉。 */
			remember({ uid: c.author_id, nick: c.author, text: c.text })
			noteReply(c.author_id)
			picked.push(c)
			out.push({ cid: c.cid, ok: true, text: g.text })
		} else {
			queueAdd({ kind: 'reply', payload: { aweme: c.aweme, cid: c.cid, root: c.root, text: g.text, author_id: c.author_id, author: c.author }, error: r.error })
			out.push({ cid: c.cid, ok: false, error: r.error, queued: true })
		}
	}
	return {
		ok: true,
		/* scanned = 实际看到多少条评论（含时效筛掉的），fresh = 过关的候选数。
		 * 以前 scanned 直接等于候选数，`scanned: 0` 既可能是「没评论」也可能是
		 * 「全被 48 小时挡了」，面板上分不清。 */
		scanned: col.seen == null ? col.candidates.length : col.seen,
		fresh: col.candidates.length,
		skippedOld: Number(col.skippedOld) || 0,
		filtered,
		worksFailed: Number(col.worksFailed) || 0,
		picked: picked.length,
		autoReply,
		results: out,
	}
}

/**
 * 跑一轮值班，并把这一轮的结果记下来（面板要显示「最近一次怎么样了」）。
 * @param {{autoReply?:boolean, maxPerRun?:number, dry?:boolean}} [opts]
 * @returns {Promise<object>}
 */
export async function run(opts = {}) {
	const startedAt = new Date().toISOString()
	let r
	try {
		r = await _run(opts)
	} catch (e) {
		r = { ok: false, error: String((e && e.message) || e) }
	}
	saveLastRun({
		at: startedAt,
		scanned: Number(r?.scanned) || 0,
		/* 只增字段：老面板读不到 fresh/skippedOld 也不会坏。 */
		fresh: Number(r?.fresh) || 0,
		skippedOld: Number(r?.skippedOld) || 0,
		worksFailed: Number(r?.worksFailed) || 0,
		picked: Number(r?.picked) || 0,
		autoReply: Boolean(opts.autoReply),
		ok: r?.ok !== false,
		skipped: r?.skipped || '',
		error: r?.error || (r?.results || []).find((x) => x && x.error)?.error || '',
		results: r?.results || [],
	})
	return r
}

let timer = null
export function start({ everyMin = 30, autoReply = false, maxPerRun = 2, manual = false } = {}) {
	stop()
	const every = Math.max(10, Number(everyMin) || 30)
	const beat = async (m) => { try { await run({ autoReply, maxPerRun, manual: m }) } catch { /* 一轮失败不拖垮循环 */ } }
	/* 第一轮是人按的（开值班），不受谷时窗口限制；之后的定时轮才算「自动」。 */
	beat(manual)
	timer = setInterval(() => beat(false), every * 60 * 1000)
	if (timer && typeof timer.unref === 'function') timer.unref()
	return { ok: true, running: true, everyMin: every, autoReply }
}
export function stop() {
	if (timer) { clearInterval(timer); timer = null }
	return { ok: true, running: false }
}
export const status = () => ({ ok: true, running: Boolean(timer), hourOk: HOUR_OK(), last: lastRun() })
