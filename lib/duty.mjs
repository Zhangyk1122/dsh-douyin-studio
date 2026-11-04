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
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { detail, self, comments, reply, works } from './api.mjs'
import { checkQuota, recordReply } from './ledger.mjs'
import * as budget from './budget.mjs'
import { readSettings } from './settings.mjs'
import { inWindow } from './policy.mjs'
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
		const m = txt.match(/DEEPSEEK_API_KEY\s*:\s*["']?([A-Za-z0-9_\-]{16,})/)
		return m ? m[1] : ''
	} catch { return '' }
}

export async function generate(prompt, { timeout = 60000 } = {}) {
	const key = readKey()
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
					messages: [{ role: 'user', content: prompt }],
					max_tokens: 80,
					temperature: 1.2,
				}),
			})
			clearTimeout(t)
			const j = await r.json()
			const txt = String((j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim()
			if (!txt) return { ok: false, error: 'API 返回空（' + r.status + '）' }
			return { ok: true, via: 'api', text: txt.replace(/^["'「『]|["'」』]$/g, '').trim().slice(0, 60) }
		} catch (e) {
			return { ok: false, error: 'API 失败: ' + String((e && e.message) || e) }
		}
	}
	return new Promise((resolve) => {
		const p = spawn('cmd.exe', ['/c', 'dsh', 'headless', prompt], { windowsHide: true })
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
export async function collect({ worksN = 3, perWork = 20 } = {}) {
	const me = await meUid()
	const ws = await works({ count: worksN })
	if (ws.ok === false) return { ok: false, error: ws.error }
	const out = []
	for (const w of (ws.list || []).slice(0, worksN)) {
		const aweme = String(w.aweme_id || '')
		if (!aweme) continue
		const c = await comments(aweme, { count: perWork })
		if (c.ok === false) continue
		for (const cm of c.list || []) {
			const cid = String(cm.cid || '')
			if (!cid) continue
			const u = cm.user || {}
			const uid = String(u.uid || '')
			if (me && uid && uid === me) continue          // 自己回自己的，不算候选
			const root = String(cm.root_comment_id || '')
			out.push({
				aweme,
				aweme_title: String(w.desc || '').slice(0, 40),
				cid,
				root: root && root !== '0' ? root : '',
				text: String(cm.text || '').slice(0, 120),
				author: String(u.nickname || ''),
				author_id: uid,
				digg: Number(cm.digg || 0),
			})
		}
	}
	return { ok: true, candidates: out, works: (ws.list || []).length, me }
}

const PROMPT = (c) => [
	'你是小汐，一只住在哥哥电脑里的鲸鱼娘，正在抖音评论区回一句话。',
	'对方在「' + (c.aweme_title || '我的作品') + '」下面说：',
	'「' + c.text + '」',
	'要求：只输出一句中文回复，30 字以内；不要引号、不要解释、不要自我介绍；',
	'不要提 AI、不要提模型；像朋友随口接一句，可以带一点软的语气。',
].join('\n')

/** 跑一轮值班（内部实现，外面用 run() 包一层好记账） */
async function _run({ autoReply = false, maxPerRun = 2, dry = false, manual = false } = {}) {
	/* 回评论也要进「谷时」窗口：这些回复每一条都要先过一次模型，
	 * 白天跑等于按原价买一套没人看的流程（哥哥 2026-11-03 提的）。
	 * 自动跑才看窗口；面板上手动点「开值班 / 现在跑一轮」不受时间限制。
	 * 谷时两个字段都空着 = 不限制，此时退回原来的 09:00–23:00 礼貌时段。 */
	if (!dry && !manual && autoReply) {
		const s = readSettings()
		if (s.activeFrom && s.activeTo) {
			const d = new Date()
			if (!inWindow(d.getHours() * 60 + d.getMinutes(), s.activeFrom, s.activeTo)) {
				return { ok: true, skipped: '不在谷时窗口（' + s.activeFrom + '–' + s.activeTo + '）' }
			}
		} else if (!HOUR_OK()) {
			return { ok: true, skipped: '不在 09:00–23:00，先不打扰' }
		}
	}
	const col = await collect()
	if (col.ok === false) return col
	const picked = []
	const out = []
	for (const c of col.candidates) {
		if (picked.length >= maxPerRun) break
		const q = checkQuota({ aweme: c.aweme, cid: c.cid, authorId: c.author_id, root: c.root })
		if (!q.ok) { out.push({ cid: c.cid, skip: q.why || q.error }); continue }
		/* 值班以前只走 ledger，绕过了五通道预算：面板上「回评 2/20」和「回评论 0/20」对不上，
		 * 总闸也不会把它们算进去（2026-11-03 发现）。这里补上同一张表的检查 + 记账。 */
		const bq = budget.check({ ch: 'comment', peer: c.author_id, thread: c.root || c.cid })
		if (!bq.ok) { out.push({ cid: c.cid, skip: bq.why || '额度不够' }); continue }
		const g = dry ? { ok: true, text: '（dry：只看不生成）' } : await generate(PROMPT(c))
		if (!g.ok) { out.push({ cid: c.cid, error: '生成失败', detail: g.error }); continue }
		if (dry) { out.push({ cid: c.cid, dry: true, text: g.text, why: 'dry' }); picked.push(c); continue }
		if (!autoReply) { out.push({ cid: c.cid, candidate: true, text: g.text }); picked.push(c); continue }
		/* ⚠️ 2026-11-03 真机：外面那些「作者」评论全是顶层——因为这里只传了 root，
		 * 没有楼根（对方就是顶层评论）时就变成「新发一条」，不是「回他这条」。
		 * 和 at-reply 一个道理：没有楼根，就把被回的那条当父评论（reply_id=cid）。 */
		const thread = c.root || c.cid
		const replyTo = c.root ? c.cid : ''
		const r = await reply({ aweme: c.aweme, text: g.text, root: thread, replyTo })
		if (r.ok) {
			recordReply({
				aweme: c.aweme, cid: c.cid, root: c.root, author: c.author, author_id: c.author_id,
				text: g.text, reason: '值班自动回：' + String(c.text).slice(0, 24), via: 'duty',
			})
			budget.record({ ch: 'comment', peer: c.author_id, thread: c.root || c.cid, note: 'duty ' + c.cid })
			picked.push(c)
			out.push({ cid: c.cid, ok: true, text: g.text })
		} else {
			queueAdd({ kind: 'reply', payload: { aweme: c.aweme, cid: c.cid, root: c.root, text: g.text, author_id: c.author_id, author: c.author }, error: r.error })
			out.push({ cid: c.cid, ok: false, error: r.error, queued: true })
		}
	}
	return { ok: true, scanned: col.candidates.length, picked: picked.length, autoReply, results: out }
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
