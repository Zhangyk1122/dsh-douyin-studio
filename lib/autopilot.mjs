/**
 * lib/autopilot.mjs —— 它自己干活的那一层
 * ============================================================================
 * 跟「面板上让人写一句话再点执行」的区别：这里没有输入框。
 * 它按设置里的开关和规矩，自己决定要不要回、要不要发、要不要报平安。
 *
 * 三件事，各自独立（一件失败不影响另一件）：
 *   ① 回私信：读会话 → 判断该不该回 → 生成一句 → 过额度 → 发 → 记账
 *   ② 发作品：扫内容库目录 → 按文件名顺序取没发过的 → 过额度 → 发布
 *   ③ 报平安：到点给主人发一条今天的账
 *
 * 🔴 硬护栏（写死，不给面板改）：
 *   - 默认全关。没在设置里点头，一条也不会发。
 *   - 每条都过 lib/budget.mjs 的额度闸；额度没了整轮停，不是"再试一次"。
 *   - 同一个人的同一条消息只回一次（状态落盘，进程重启也不会重复）。
 *   - 连续失败 2 次的人先放弃，避免对着发不出去的人死磕。
 *   - 静音时段不主动发（回私信除外？不，也一样静音）。
 * ============================================================================
 */
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { conversations } from './im.mjs'
import { sendByUi } from './im-send.mjs'
import { generate } from './duty.mjs'
import { nameOf, refresh as refreshNames } from './names.mjs'
import { readSettings, personaLine } from './settings.mjs'
import * as BUDGET from './budget.mjs'
import { atomicWriteJson, readJsonSafe } from './fsx.mjs'
import { judgeDm, atCandidates } from './inbox.mjs'
import {
	inWindow, dayKey, dueDaily, mediaKind, titleOf,
	nextFile, publishLeft,
} from './policy.mjs'

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DIR = process.env.DOUYIN_STUDIO_HOME || join(HOME, 'douyin-studio')
const STATE = join(DIR, 'autopilot-state.json')

const blank = () => ({
	dm: { replied: {}, tries: {} },
	/* 回 @我 的去重：键是 `aweme:cid`。通知会一直躺在列表里，不回记一笔就会
	 * 每 5 分钟回同一条 —— 2026-11-03 12:46 和 12:51 连着回了两遍同一句。 */
	at: { replied: {} },
	publish: { done: {}, tries: {}, day: '', count: 0 },
	/* 今天发过哪几条视频给主人 —— 少了这一行，每轮都以为「今天还没发」，
	 * 2026-11-04 22:33–23:04 连着给他私信发了 13 条视频。
	 * （定时发视频那套 runDigest 已经删了，现在只有刷完挑一条这一条路；
	 *  这个字段留着，是因为 tellOwner 的计数也写在这里。） */
	digest: { day: '', sent: [] },
	report: { day: '' },
	log: [],
})

function load() {
	const j = readJsonSafe(STATE, null, (v) => v && typeof v === 'object')
	const b = blank()
	if (!j) return b
	/* `...j` 必须铺在前面：**读到的未知字段先原样带上**，再用已知字段覆盖成归一化后的值。
	 * 以前这里是「白名单式重建」—— 只挑认识的字段往回拼，于是每次新增字段都得记得
	 * 在这里也补一行，忘一次就出一次事：2026-11-04 漏了 digest，runPublish / runReport
	 * 各自 load() 再 save()，把文件里的 digest 冲成空，一晚给主人发了 13 条视频（22:33–23:04）。
	 * 补字段是补不完的，改模式才补得完。 */
	return {
		...b,
		...j,
		dm: { replied: (j.dm && j.dm.replied) || {}, tries: (j.dm && j.dm.tries) || {} },
		at: { replied: (j.at && j.at.replied) || {} },
		publish: {
			done: (j.publish && j.publish.done) || {},
			tries: (j.publish && j.publish.tries) || {},
			day: (j.publish && j.publish.day) || '',
			count: Number(j.publish && j.publish.count) || 0,
		},
		report: { day: (j.report && j.report.day) || '' },
		digest: {
			day: (j.digest && j.digest.day) || '',
			sent: Array.isArray(j.digest && j.digest.sent) ? j.digest.sent.slice(-20) : [],
		},
		log: Array.isArray(j.log) ? j.log.slice(0, 40) : [],
	}
}
/** 只读地看一眼当前状态（诊断用，也给测试钉「未知字段不会被丢掉」）。 */
export const readState = () => load()
const save = (s) => atomicWriteJson(STATE, s)

const pushLog = (s, item) => {
	s.log.unshift({ at: new Date().toISOString(), ...item })
	s.log = s.log.slice(0, 20)
}

let RUN = null
/** 注入「怎么跑 CLI」——插件里是异步子进程，测试里可以换成假的 */
export function configure({ runCli } = {}) {
	if (typeof runCli === 'function') RUN = runCli
}

const nowMin = (d = new Date()) => d.getHours() * 60 + d.getMinutes()

/**
 * 谷时窗口（北京时间 00:30-08:30 是 DS 的优惠时段）。哥哥的要求是：
 * 回评论、回私信、刷视频、回 @ 都在谷时做 —— 这些每一步都要过模型，白天做最贵。
 * 窗口外只读不写（dry 不受影响，dry 不调模型也不发东西）。
 */
export function inActive(s, now = new Date()) {
	/* 低峰可以配两段：activeFrom/To 和 active2From/To。两段都空 = 不限制。
	 * 一段有值一段空 = 按有值的那段算（空的那段忽略，别拿 '' 去比）。 */
	const wins = [
		[s && s.activeFrom, s && s.activeTo],
		[s && s.active2From, s && s.active2To],
	].filter(([a, b]) => a && b)
	if (!wins.length) return true
	const m = nowMin(now)
	return wins.some(([a, b]) => inWindow(m, a, b))
}

/* ── ① 回私信 ─────────────────────────────────────────────────────────── */

const DM_PROMPT = (c, style, s) => [
	personaLine(s),
	'现在你在回一条抖音私信。',
	'对方说：「' + c.text + '」',
	'语气：' + (style || '温和') + '。',
	'要求：只输出一句中文回复，30 字以内；不要引号、不要解释、不要自我介绍；',
	'不要提 AI、不要提模型；像朋友随手回一句。',
].join('\n')

/**
 * 挑「真的该回」的私信（纯函数，方便测）。
 * 以前这里是「最后一条是对方发的就回」，于是十几天前的老话、官方号的
 * 「你关注的…发布了新作品」、只有一张视频卡片的会话都会被拿来生成回复 ——
 * 生成出来的东西必然驴唇不对马嘴。现在统一过 `inbox.judgeDm` 那套判据：
 * 值得回、没被拦（系统通知/纯表情/超过 72 小时）、且不是卡片。
 */
export function pickDm(convs, { replied = {}, tries = {}, maxTries = 2, nickOf = () => '' } = {}) {
	const out = []
	for (const c of Array.isArray(convs) ? convs : []) {
		if (Number(c.type) !== 1) continue
		const ms = Array.isArray(c.messages) ? c.messages : []
		const last = ms[ms.length - 1]
		if (!last || last.from !== 'them' || !last.at) continue
		const peer = String(c.peer_uid || '')
		if (!peer) continue
		if (replied[peer] && String(last.at) <= String(replied[peer])) continue
		if ((Number(tries[peer]) || 0) >= maxTries) continue
		if (last.kind === 'card') continue                    // 卡片没正文，不猜
		const text = String(last.text || '').trim()
		if (!text) continue
		const j = judgeDm(c, { nick: nickOf(peer) })
		if (!j.worth || (Array.isArray(j.blocked) && j.blocked.length)) continue
		out.push({
			peer, at: String(last.at), kind: last.kind || 'text',
			text: text.slice(0, 160), why: j.why, score: j.score,
		})
	}
	return out
}

/** 跨天时把「今天发了几条」归零（原来的写法先写 day 再比较，永远相等 → 计数会累加到每天）。 */
export function nextPublishCount({ day, today, count }) {
	const n = Number(count) || 0
	return day === today ? n + 1 : 1
}

export async function runDm({ dry = false, manual = false } = {}) {
	const s = readSettings()
	if (!dry && !s.autoDm) return { ok: true, skipped: '回私信没开' }
	const st = load()
	if (!dry && !manual && inWindow(nowMin(), s.quietFrom, s.quietTo)) return { ok: true, skipped: '静音时段' }
	/* 回私信不再被低峰窗口拦死：便宜的时候多做，贵的时候少做，但不能装死。
	 * 只有把 peakReply 关掉（明确要求"只在低峰回"）才按窗口拦。 */
	if (!dry && !manual && s.peakReply === false && !inActive(s)) return { ok: true, skipped: '不在低峰窗口，且设了高峰不回' }

	const r = await conversations({ limit: 12 })
	if (!r || r.ok === false) return { ok: false, error: (r && r.error) || '读不到私信列表' }

	/* 昵称接口给不了，得靠缓存。**先抄名字再判**：判「是不是系统通知」要用到昵称
	 * （官方号发的「你关注的…发布了新作品」文案和真人的很像），名字缺了就会漏判。
	 * 只抄一次；抄不到的那几个，这一轮跳过（绝不按 uid 猜名字发给人）。 */
	if (!dry && (r.conversations || []).some((c) => Number(c.type) === 1 && !nameOf(c.peer_uid))) {
		try { await refreshNames() } catch { /* 抄不到就算了，下面会跳过 */ }
	}

	const cand = pickDm(r.conversations || [], {
		replied: st.dm.replied, tries: st.dm.tries,
		nickOf: (uid) => nameOf(uid),
	})
	if (!cand.length) return { ok: true, results: [], note: '没有要回的' }

	const take = cand.slice(0, dry ? 3 : Math.max(1, Math.min(5, Number(s.replyMaxPerRound) || 2)))
	const results = []
	for (const c of take) {
		const nick = nameOf(c.peer)
		if (!nick) { results.push({ peer: c.peer, skip: '还不知道昵称（怕发错人）' }); continue }
		if (dry) { results.push({ peer: c.peer, nick, text: c.text, would: '回一句' }); continue }

		const g = await generate(DM_PROMPT(c, s.replyStyle, s))
		if (!g.ok) {
			st.dm.tries[c.peer] = (Number(st.dm.tries[c.peer]) || 0) + 1
			results.push({ peer: c.peer, nick, error: '生成失败', detail: g.error })
			save(st)
			continue
		}
		const bq = BUDGET.check({ ch: 'dm', peer: c.peer, text: g.text })
		if (!bq.ok) { results.push({ peer: c.peer, nick, skip: bq.why || '额度不够' }); break }

		const sent = await sendByUi({ nick, text: g.text })
		if (sent && sent.ok) {
			BUDGET.record({ ch: 'dm', peer: c.peer, note: 'auto' })
			st.dm.replied[c.peer] = c.at
			delete st.dm.tries[c.peer]
			pushLog(st, { kind: 'dm', ok: true, who: nick, text: g.text })
			results.push({ peer: c.peer, nick, text: g.text, ok: true })
		} else {
			st.dm.tries[c.peer] = (Number(st.dm.tries[c.peer]) || 0) + 1
			pushLog(st, { kind: 'dm', ok: false, who: nick, error: (sent && sent.error) || '发送失败' })
			results.push({ peer: c.peer, nick, error: (sent && sent.error) || '发送失败' })
		}
		save(st)   // 每发一条就落盘：宁可多写一次盘，也不要重复发给同一个人
	}
	save(st)
	return { ok: true, results, sent: results.filter((x) => x.ok).length }
}

/* ── ② 发作品 ─────────────────────────────────────────────────────────── */

export async function runPublish({ dry = false, manual = false } = {}) {
	const s = readSettings()
	if (!dry && !s.autoPublish) return { ok: true, skipped: '自主发布没开' }
	if (!dry && !manual && !inActive(s)) return { ok: true, skipped: '不在谷时窗口（' + s.activeFrom + '–' + s.activeTo + '）' }
	if (!s.publishDir) return { ok: false, error: '还没设内容库目录' }
	if (typeof RUN !== 'function' && !dry) return { ok: false, error: '内部错误：没有可用的 CLI 运行器' }

	let entries = []
	try {
		entries = await readdir(s.publishDir, { withFileTypes: true })
	} catch (e) {
		return { ok: false, error: '内容库读不到：' + String((e && e.message) || e) }
	}
	const files = entries.filter((e) => e.isFile()).map((e) => e.name).filter(mediaKind).sort()
	const st = load()
	const next = nextFile(files, st.publish.done)
	if (!next) return { ok: true, done: true, note: files.length ? '内容库都发过了' : '内容库是空的' }

	const kind = mediaKind(next)
	const title = titleOf(next)
	const today = dayKey()
	const left = publishLeft({ day: st.publish.day, today, count: st.publish.count, perDay: s.publishPerDay })

	if (dry) return { ok: true, would: { file: next, kind, title, left, mode: s.publishMode } }
	if (left <= 0) return { ok: true, skipped: '今天已经发够 ' + s.publishPerDay + ' 条' }
	if ((Number(st.publish.tries[next]) || 0) >= 2) return { ok: true, skipped: '这条失败两次了，先跳过' }

	const bq = BUDGET.check({ ch: 'publish' })
	if (!bq.ok) return { ok: false, stage: 'budget', error: bq.why || '额度不够' }

	const args = [
		'publish', kind === 'video' ? '--video' : '--img', join(s.publishDir, next),
		'--title', title, '--who', s.publishWho || 'private',
		s.publishMode === 'now' ? '--publish' : '--draft',
	]
	const r = await RUN(args, { timeout: 600000 })
	if (r && r.ok) {
		BUDGET.record({ ch: 'publish', note: next })
		st.publish.done[next] = new Date().toISOString()
		st.publish.count = nextPublishCount({ day: st.publish.day, today, count: st.publish.count })
		st.publish.day = today
		delete st.publish.tries[next]
		pushLog(st, { kind: 'publish', ok: true, who: next, text: title })
	} else {
		st.publish.tries[next] = (Number(st.publish.tries[next]) || 0) + 1
		pushLog(st, { kind: 'publish', ok: false, who: next, error: (r && r.error) || '发布失败' })
	}
	save(st)
	return { ok: Boolean(r && r.ok), file: next, title, mode: s.publishMode, error: r && r.error, hint: r && r.hint }
}

/* ── ② 回 @我 ─────────────────────────────────────────────────────────── */

const AT_PROMPT = (c, style, s) => [
	personaLine(s),
	'有人在抖音 @ 了你，现在你要回一句。',
	(c.nick ? '对方是「' + c.nick + '」。' : ''),
	(c.content ? '对方说：「' + String(c.content).slice(0, 200) + '」' : ''),
	(c.aweme_desc ? '那条视频是：「' + String(c.aweme_desc).slice(0, 120) + '」' : ''),
	'语气：' + (style || '温和') + '。',
	'要求：只输出一句中文回复，40 字以内；不要引号、不要解释；不要提 AI、不要提模型；',
	'这是公开评论区，不要写私密称呼，不要承诺任何事。',
].join('\n')

/**
 * 从「@我」的候选里挑该回的（纯函数）。
 * 判定沿用 inbox 那套：worth 真、没被拦（超过 7 天就 worth=false）、
 * 并且**必须有可以落的 id**（aweme + 评论 id）——没有 id 就发不进去，
 * 硬发只会变成一条挂错地方的顶层评论（2026-11-02 真机踩过）。
 */
export function pickAt(items, { max = 1, replied = {}, freshMin = 72 * 60 } = {}) {
	const seen = replied && typeof replied === 'object' ? replied : {}
	const ok = (Array.isArray(items) ? items : []).filter((x) => x
		&& x.worth
		&& !(Array.isArray(x.blocked) && x.blocked.length)
		&& x.aweme_id
		&& (x.comment_id || x.root_comment_id)
		/* 只回新鲜的：4 天前那条 @ 就是被一遍遍捡起来回的（状态早就 stale 了）。
		 * 自动回复回一句四天前的话，比不回更怪。 */
		&& x.status !== 'stale'
		&& !(Number(x.age_min) > freshMin)
		&& !seen[String(x.aweme_id) + ':' + String(x.comment_id || x.root_comment_id || '')])
	ok.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
	return ok.slice(0, Math.max(1, Math.min(Number(max) || 1, 3)))
}

export async function runAt({ dry = false, manual = false } = {}) {
	const s = readSettings()
	if (!dry && !s.autoAt) return { ok: true, skipped: '回 @ 没开' }
	if (!dry && !manual && inWindow(nowMin(), s.quietFrom, s.quietTo)) return { ok: true, skipped: '静音时段' }
	/* 回 @ 同理：默认高峰也回，只有明确关掉 peakReply 才按窗口拦。 */
	if (!dry && !manual && s.peakReply === false && !inActive(s)) return { ok: true, skipped: '不在低峰窗口，且设了高峰不回' }

	const st0 = load()
	const r = await atCandidates({ limit: 8, enrich: dry ? 0 : 1 })
	if (!r || r.ok === false) return { ok: false, error: (r && r.error) || '@我 读不到' }
	const cand = pickAt(r.items || [], { max: 1, replied: st0.at.replied })
	if (!cand.length) return { ok: true, results: [], note: '没有要回的 @' }
	const c = cand[0]
	const where = { aweme: c.aweme_id, cid: c.comment_id || '', root: c.root_comment_id || '', nick: c.nick, said: String(c.content || '').slice(0, 120) }

	if (dry) return { ok: true, results: [{ ...where, would: '回一句' }] }

	const g = await generate(AT_PROMPT(c, s.replyStyle, s))
	if (!g.ok) return { ok: false, stage: 'generate', error: g.error, ...where }

	const args = ['at-reply', '--aweme', c.aweme_id, '--cid', c.comment_id || c.root_comment_id, '--text', g.text]
	if (c.root_comment_id) args.push('--root', c.root_comment_id)
	const out = await RUN(args, { timeout: 180000 })
	const st = load()
	if (out && out.ok) {
		st.at.replied[String(c.aweme_id) + ':' + String(c.comment_id || c.root_comment_id || '')] = new Date().toISOString()
		pushLog(st, { kind: 'at', ok: true, who: c.nick, text: g.text })
	} else pushLog(st, { kind: 'at', ok: false, who: c.nick, error: (out && out.error) || '回复失败' })
	save(st)
	/* sent 给面板计数用：以前只回 ok/text，面板数不到「回了几条 @」，
	 * 真回了 3 条也显示「做了 0 件」（2026-11-03 哥哥截图戳穿）。 */
	return { ok: Boolean(out && out.ok), sent: out && out.ok ? 1 : 0, ...where, text: g.text, error: out && out.error }
}

/* ── ③ 刷视频 ─────────────────────────────────────────────────────────── */

/** 今天的账：只报数字，不编故事。数字来自额度账本（每个出口都记过一笔）。 */
export function reportText(now = new Date(), s = null) {
	const cfg = s || readSettings()
	const st = BUDGET.stats(now.getTime())
	const per = (st && st.per) || {}
	const n = (k) => Number((per[k] && per[k].day) || 0)
	const d = now.getMonth() + 1
	const day = now.getDate()
	const lines = [
		/* 标题默认中性（「日报」）；设置里填了 botName 才叫「<名字>日报」。
		 * 以前写死「小汐日报」，别人装了这个插件报平安也是这个名字。 */
		(cfg.botName ? cfg.botName + '日报' : '日报') + ' · ' + d + '/' + day,
		'回评论 ' + n('comment') + ' · 回私信 ' + n('dm') + ' · 发布 ' + n('publish'),
	]
	const msg = st && st.messages
	if (msg && msg.max) lines.push('今天还能发 ' + Number(msg.left || 0) + ' 条')
	return lines.join('\n')
}

export async function runReport({ dry = false } = {}) {
	const s = readSettings()
	if (!dry && !s.autoReport) return { ok: true, skipped: '报平安没开' }
	if (!s.ownerNick) return { ok: false, error: '还没填主人昵称' }
	const st = load()
	const today = dayKey()
	if (!dry && !dueDaily({ lastDay: st.report.day, today, nowMin: nowMin(), at: s.reportAt })) {
		return { ok: true, skipped: '还没到点（' + s.reportAt + '）' }
	}
	const text = reportText(new Date(), s)
	if (dry) return { ok: true, would: { to: s.ownerNick, text } }
	const r = await sendByUi({ nick: s.ownerNick, text })
	if (r && r.ok) {
		BUDGET.record({ ch: 'dm', peer: s.ownerNick, note: 'report' })
		st.report.day = today
		pushLog(st, { kind: 'report', ok: true, who: s.ownerNick, text })
	} else {
		pushLog(st, { kind: 'report', ok: false, who: s.ownerNick, error: (r && r.error) || '发送失败' })
	}
	save(st)
	return { ok: Boolean(r && r.ok), to: s.ownerNick, error: r && r.error }
}

/* ── 一轮总调度 ───────────────────────────────────────────────────────── */

const safe = async (fn) => {
	try { return await fn() } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
}

export async function runAll({ dry = false, manual = false } = {}) {
	if (!dry && busy) return { ok: true, skipped: '上一轮还没跑完' }
	busy = true
	try {
		const dm = await safe(() => runDm({ dry, manual }))
		const at = await safe(() => runAt({ dry, manual }))
		const publish = await safe(() => runPublish({ dry, manual }))
		const report = await safe(() => runReport({ dry }))
		return { ok: true, dry, dm, at, publish, report }
	} finally {
		busy = false
	}
}

let busy = false
let timer = null

export function start({ everyMin = 5, runCli } = {}) {
	configure({ runCli })
	stop()
	const every = Math.max(2, Number(everyMin) || 5)
	/* 开机先等 2 分钟：浏览器和登录态都还没稳，抢跑只会白失败一次 */
	const d = setTimeout(() => { runAll().catch(() => {}) }, 120000)
	if (d && typeof d.unref === 'function') d.unref()
	timer = setInterval(() => { runAll().catch(() => {}) }, every * 60 * 1000)
	if (timer && typeof timer.unref === 'function') timer.unref()
	return { ok: true, running: true, everyMin: every }
}

export function stop() {
	if (timer) { clearInterval(timer); timer = null }
	return { ok: true, running: false }
}

export function status() {
	const s = readSettings()
	const st = load()
	const today = dayKey()
	return {
		ok: true,
		running: Boolean(timer),
		settings: {
			/* 面板那张卡的开关和输入框全从这份「投影」里取；漏一个键就读成 undefined。
			 * 2026-11-03 真机事故：新加的「回 @我」那行没有 knobs，客户端直接读
			 * `row.knobs.length` → 白屏「这一页崩了」。两处都补上：
			 * 这里给齐字段，客户端那边也做兜底。 */
			autoDm: s.autoDm, autoComment: s.autoComment, autoAt: s.autoAt,
			autoPublish: s.autoPublish, autoReport: s.autoReport,
			ownerNick: s.ownerNick, publishDir: s.publishDir,
			publishPerDay: s.publishPerDay, publishMode: s.publishMode, reportAt: s.reportAt,
			replyMaxPerRound: s.replyMaxPerRound,
		},
		today: {
			publishLeft: publishLeft({ day: st.publish.day, today, count: st.publish.count, perDay: s.publishPerDay }),
			repliedPeers: Object.keys(st.dm.replied).length,
			reported: st.report.day === today,
		},
		log: st.log.slice(0, 8),
	}
}

export { STATE as AUTOPILOT_STATE }
