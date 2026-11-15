#!/usr/bin/env node
/**
 * tools/dy.mjs —— 一条命令行用完整套
 * ============================================================================
 *   node tools/dy.mjs status
 *   node tools/dy.mjs works  [--count 20] [--cursor 0] [--secuid <sec_uid>]
 *   node tools/dy.mjs comments --aweme <id> [--count 20]
 *   node tools/dy.mjs reply  --aweme <id> --cid <评论id> --text "..." [--root <楼根>] [--author <uid>] [--reason "..."] [--dry]
 *   node tools/dy.mjs publish --img a.jpg [--img b.jpg] --title "..." --desc "..." [--who private] [--declare ai] [--at "2026-11-05 20:00"] [--publish|--draft] [--dry]
 *   node tools/dy.mjs delete --title "标题"          （只删标题完全匹配且只有一条时）
 *   node tools/dy.mjs ledger [--recent 8]
 *   node tools/dy.mjs doctor
 *   node tools/dy.mjs schedule [--pause on|off]   （只读快照；和面板 /schedule 同一份数据）
 *
 * 输出：**一行 JSON 到 stdout**（`ok` 字段永远有）；失败也输出 JSON，退出码 1。
 * 这么设计是为了让插件、脚本、人看的是同一份东西。
 * ============================================================================
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as api from '../lib/api.mjs'
import * as im from '../lib/im.mjs'
import { share as shareCard } from '../lib/share.mjs'
import { ensureBrowser, listTabs, hostOf, port, profileDir, version, withPage } from '../lib/cdp.mjs'
import { checkQuota, recordReply, recent, stats, LIMITS } from '../lib/ledger.mjs'
/* 出口记账统一走 sendlog：它内部 await，并按 cid/newCid 幂等。
 * 2026-11-05 之前三个发送分支各写各的，结果一个没 await、一个压根没调 —— 账全丢了。 */
import { recordOutbound } from '../lib/sendlog.mjs'
import * as budget from '../lib/budget.mjs'
import * as inbox from '../lib/inbox.mjs'
import * as feed from '../lib/feed.mjs'
import { publish as publishRun, validate, WHO, DECLARE } from '../lib/publish.mjs'
import { checkFiles } from '../lib/check-upload.mjs'
import { listSnapshots, saveSnapshot, restoreSnapshot } from '../lib/snapshot.mjs'
import { markDryRun, markPublished, needsFirstRunDry } from '../lib/firstrun.mjs'
import { planAtReply } from '../lib/policy.mjs'
import { logRun } from '../lib/runlog.mjs'

const argv = process.argv.slice(2)
const CMD = String(argv[0] || '').trim()
const has = (k) => argv.includes(k)
/* `--text --dry` 这种写法：下一个是 flag 就当没给值，别把 --dry 当正文发出去。 */
const argOf = (k, d = '') => {
	const i = argv.indexOf(k)
	if (i < 0) return d
	const v = argv[i + 1]
	if (v === undefined || String(v).startsWith('--')) return d
	return v
}
const numOf = (k, d) => { const v = Number(argOf(k, d)); return Number.isFinite(v) ? v : d }
/* 面板设置 → 环境变量 → 这里是「环境变量」那一跳。
 * 优先级：显式 --flag > 环境变量 > 内置默认。没有这一层，设置页存的数就是死的。 */
const envNum = (k, d) => {
	const raw = process.env[k]
	if (raw === undefined || raw === '') return d
	const n = Number(raw)
	return Number.isFinite(n) ? n : d
}
const allOf = (k) => argv.reduce((acc, a, i) => (a === k && argv[i + 1] ? (acc.push(argv[i + 1]), acc) : acc), [])

const T0 = Date.now()
/* 每条 CLI 的最终输出都从这里走 —— 顺手记一行「动作账」。
 * 只记结果不记过程：排查时要的是「什么时候、对谁、成没成、卡在哪」。 */
const out = (o) => {
	try {
		logRun({
			kind: CMD || 'cli',
			target: (o && (o.aweme || o.cid || o.nick || o.to || o.n || '')) || '',
			ok: !(o && (o.ok === false || o.error)),
			stage: (o && o.stage) || '',
			error: (o && (o.error || o.why)) || '',
			took: Date.now() - T0,
		})
	} catch { /* 记账失败不影响输出 */ }
	process.stdout.write(JSON.stringify(o, null, 1) + '\n')
}
const die = (o, code = 1) => { process.stdout.write(JSON.stringify({ ok: false, ...o }, null, 1) + '\n'); process.exit(code) }

/* 总闸在 CLI 这一层也要过一遍：DSH 工具那层挡住的只是"模型调工具"，
 * 而人在终端里跑 `dy.mjs reply` 是另一条路。同一个 KILL 文件，两条路都得认。
 * 只挡会写出去的动作；--dry 和只读命令照常（出事时更需要看现场）。 */
{
	const WRITE = new Set(['reply', 'dm-send', 'share', 'at-reply', 'comment-self', 'comment-at', 'comment-image', 'delete', 'delcomment'])
	const writeNow = CMD === 'publish' ? (has('--publish') || has('--draft'))
		: CMD === 'dm' ? Boolean(argOf('--text'))
			: CMD === 'queue' ? (String(argv[1] || argOf('--action', 'list')) === 'retry')
				: WRITE.has(CMD)
	if (CMD !== 'kill' && writeNow && !has('--dry')) {
		const { isKilled, killedReply } = await import('../lib/killswitch.mjs')
		if (isKilled()) die({ ...killedReply(CMD), via: 'cli' })
		const { coolingGate } = await import('../lib/risk.mjs')
		const gate = coolingGate()
		if (gate) die({ stage: 'risk', error: gate, via: 'cli' })
	}
}

const HELP = {
	commands: ['status', 'sticker', 'works', 'detail', 'likes', 'notices', 'search', 'comments', 'replies', 'reply', 'delcomment', 'publish', 'quick', 'latest', 'check', 'snapshot', 'delete', 'ledger', 'cost', 'doctor', 'trend', 'queue', 'watch', 'login', 'duty', 'dm', 'share', 'names', 'inbox', 'budget', 'dm-send', 'at-reply', 'feed', 'comment-self', 'comment-at', 'comment-image', 'risk', 'see', 'watchback', 'digest', 'kill', 'schedule', 'unattended', 'engage'],
	limits: LIMITS,
	who: WHO,
	declare: DECLARE,
	home: process.env.DOUYIN_STUDIO_HOME || '(默认 $DSH_HOME/douyin-studio)',
}

if (!CMD || CMD === 'help' || has('--help')) {
	out({ ok: true, ...HELP })
	process.exit(0)
}

try {
	if (CMD === 'doctor') {
		const v = await version()
		const tabs = v ? await listTabs() : []
		const { isKilled, killInfo } = await import('../lib/killswitch.mjs')
		out({
			ok: Boolean(v),
			/* 停损开着的时候，doctor 必须第一眼就看出来 —— 否则"为什么发不出去"要查半天。 */
			kill: { on: isKilled(), info: killInfo() },
			cdp: v ? { up: true, browser: v.Browser, port: port() } : { up: false, port: port(), hint: '会自己起一个；起不来就手动开' },
			profile: profileDir(),
			profileExists: existsSync(profileDir()),
			tabs: tabs.map((t) => hostOf(t.url)).filter(Boolean).slice(0, 10),
			limits: LIMITS,
			stats: stats(),
		})
		process.exit(v ? 0 : 1)
	}

	if (CMD === 'kill') {
		const { isKilled, killInfo, killFile, setKill } = await import('../lib/killswitch.mjs')
		const action = String(argv[1] || 'status').trim()
		if (action === 'on') out(setKill(true, argOf('--reason', '命令行手动停损')))
		else if (action === 'off') out(setKill(false))
		else out({ ok: true, killed: isKilled(), info: killInfo(), file: killFile() })
		process.exit(0)
	}

	if (CMD === 'unattended') {
		const { readSettings, writeSettings } = await import('../lib/settings.mjs')
		const { windowState } = await import('../lib/unattended.mjs')
		const sub = String(argv[1] || 'status')
		const patch = {}
		if (sub === 'on' || sub === 'off') {
			const { isKilled } = await import('../lib/killswitch.mjs')
			if (sub === 'on' && isKilled()) die({ stage: 'killswitch', error: '停损开着，先把 KILL 解了再开无人值守' })
			patch.unattendedPublish = sub === 'on'
		}
		if (argOf('--from')) patch.unattendedFrom = argOf('--from')
		if (argOf('--to')) patch.unattendedTo = argOf('--to')
		if (argOf('--per')) patch.unattendedPerDay = numOf('--per', 1)
		if (Object.keys(patch).length) {
			const w = writeSettings(patch)
			if (!w.ok) die({ stage: 'settings', error: w.error })
		}
		out({ ok: true, ...windowState(readSettings()) })
		process.exit(0)
	}

	if (CMD === 'engage') {
		const { readSettings, writeSettings } = await import('../lib/settings.mjs')
		const { planEngage, authorsOf, usedToday, waitGap } = await import('../lib/engage.mjs')
		const sub = String(argv[1] || 'status')
		const patch = {}
		if (argOf('--authors')) patch.engageAuthors = argOf('--authors')
		if (sub === 'on' || sub === 'off') {
			const { isKilled } = await import('../lib/killswitch.mjs')
			if (sub === 'on' && isKilled()) die({ stage: 'killswitch', error: '停损开着，先把 KILL 解了' })
			patch.engageOn = sub === 'on'
		}
		if (Object.keys(patch).length) {
			const w = writeSettings(patch)
			if (!w.ok) die({ stage: 'settings', error: w.error })
		}
		const S = readSettings()
		if (sub === 'plan') {
			const { load } = await import('../lib/picks.mjs')
			out(planEngage(S, { items: load() }))
		} else {
			out({ ok: true, on: S.engageOn, authors: authorsOf(S), perDay: S.engagePerDay, used: usedToday().count, waitSec: waitGap(new Date(), S.engageGapSec) })
		}
		process.exit(0)
	}

	if (CMD === 'schedule') {
		const { readSnapshot } = await import('../lib/dashboard.mjs')
		const { setPaused } = await import('../lib/roundstate.mjs')
		const p = argOf('--pause')
		if (p === 'on' || p === 'off') setPaused(p === 'on')
		out(readSnapshot())
		process.exit(0)
	}

	if (CMD === 'status') {
		const [me, st] = await Promise.all([api.self(), Promise.resolve(stats())])
		out({ ok: Boolean(me && me.ok), self: me, quota: st })
		process.exit(me && me.ok ? 0 : 1)
	}

	if (CMD === 'sticker') {
		/* 本地表情包库。只碰磁盘：收图 / 查 / 挑 / 记账 / 删。
		 * 真正把图发出去是 dm / reply 那边的事，这里不做网络。 */
		const { addSticker, listStickers, pickSticker, markStickerUsed, removeSticker, stickerStats } = await import('../lib/stickers.mjs')
		const sub = String(argv[1] || 'list')
		const tags = String(argOf('--tags') || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean)
		if (sub === 'add') {
			const r = addSticker(argOf('--file'), { tags, mood: argOf('--mood'), name: argOf('--name') })
			out(r)
			process.exit(r.ok ? 0 : 1)
		}
		if (sub === 'pick') {
			const it = pickSticker({ mood: argOf('--mood'), tags })
			out(it ? { ok: true, sticker: it } : { ok: false, error: '库里没有合适的（先用 sticker add 收几张）' })
			process.exit(it ? 0 : 1)
		}
		if (sub === 'add' && has('--vision')) {
			/* 入库时顺手让外部看图命令打标（名字/情绪/什么时候用）。没配命令就明说。 */
			const file = String(argOf('--file') || argOf('--img') || '')
			if (!file) die({ error: '缺 --file（要入库的图）' })
			const { labelSticker } = await import('../lib/vision-label.mjs')
			const lab = labelSticker(file, { fallbackName: file.split(/[\\/]/).pop() })
			if (!lab.ok) {
				const r = addSticker(file, { mood: argOf('--mood'), tags })
				out({ ...r, label: lab })
				process.exit(r.ok ? 0 : 1)
			}
			const r = addSticker(file, { mood: lab.mood || argOf('--mood'), tags: [...new Set([...(tags || []), ...lab.tags])], name: lab.name })
			out({ ...r, label: lab })
			process.exit(r.ok ? 0 : 1)
		}
		if (sub === 'use') {
			const r = markStickerUsed(argOf('--id'))
			out(r)
			process.exit(r.ok ? 0 : 1)
		}
		if (sub === 'rm') {
			const r = removeSticker(argOf('--id'))
			out(r)
			process.exit(r.ok ? 0 : 1)
		}
		if (sub === 'collect') {
			/* 从一条作品的评论里把别人发的图收进库（只读页面 + 下载，不发任何东西） */
			const aweme = String(argOf('--aweme') || '')
			if (!aweme) die({ error: '缺 --aweme' })
			const cs = await api.comments(aweme, { count: Math.min(numOf('--count', 40), 50) })
			if (!cs || !cs.ok) die({ stage: 'comments', error: (cs && cs.error) || '读不到评论' })
			const { collectStickers } = await import('../lib/sticker-collect.mjs')
			const r = await collectStickers(cs.items || [], {
				max: Math.min(numOf('--max', 8), 20),
				mood: argOf('--mood'),
				tags,
				evaluate: (js) => withPage('www.douyin.com', (c) => c.evaluate(js, { timeout: 30000 })),
			})
			out(r)
			process.exit(r.ok ? 0 : 1)
		}
		if (sub === 'send') {
			/* 私信发一张本地表情图。--dry 只塞不回车（确认图进没进输入框）。 */
			const { sendStickerDirect, planStickerMessage } = await import('../lib/sticker-send.mjs')
			const { pickSticker } = await import('../lib/stickers.mjs')
			const idArg = String(argOf('--id') || '')
			const it = idArg ? listStickers({ limit: 200 }).find((x) => x.id === idArg) : pickSticker({ mood: argOf('--mood'), tags })
			const plan = planStickerMessage({ sticker: it, caption: argOf('--text') || '' })
			if (!plan.ok) die({ stage: 'plan', error: plan.why })
			const r = await sendStickerDirect({
				uid: argOf('--uid') || '', secUid: argOf('--sec') || '', nick: argOf('--to') || '',
				file: plan.file, text: plan.text, dry: has('--dry'),
			})
			out(r)
			process.exit(r.ok ? 0 : 1)
		}
		if (sub === 'stats') {
			out({ ok: true, ...stickerStats() })
			process.exit(0)
		}
		out({ ok: true, stickers: listStickers({ mood: argOf('--mood'), tag: argOf('--tag'), limit: numOf('--limit', 50) }) })
		process.exit(0)
	}

	if (CMD === 'works') {
		const r = await api.works({ count: Math.min(numOf('--count', 20), 50), cursor: numOf('--cursor', 0), secuid: argOf('--secuid') })
		out(r)
		process.exit(r.ok ? 0 : 1)
	}

	if (CMD === 'detail') {
		const aweme = argOf('--aweme')
		if (!aweme) die({ error: '缺 --aweme' })
		const r = await api.detail(aweme)
		out(r)
		process.exit(r.ok ? 0 : 1)
	}

	if (CMD === 'likes') {
		const r = await api.likes({ count: Math.min(numOf('--count', 20), 50), cursor: numOf('--cursor', 0), secuid: argOf('--secuid') })
		out(r)
		process.exit(r.ok ? 0 : 1)
	}

	if (CMD === 'notices') {
		const g = argOf('--group')
		const r = await api.notices({
			groups: g ? [Number(g)] : undefined,
			limit: Math.min(numOf('--limit', 30), 60),
		})
		out(r)
		process.exit(r.ok ? 0 : 1)
	}

	if (CMD === 'share') {
		/* 分享卡片：把视频以抖音自己的卡片发给好友（文字链接在抖音里点不开）。
		 * 只认昵称 +（可选）sec_uid；同名多个一律拒发。 */
		const r = await shareCard({
			awemeId: argOf('--aweme') || argOf('--id'),
			nick: argOf('--to'),
			secUid: argOf('--sec'),
			dry: has('--dry'),
			ownerOnly: has('--owner-only'),
		})
		out(r)
		process.exit(r.ok ? 0 : 1)
	}

	if (CMD === 'dm') {
		/**
		 * 私信是**只读**的：`--list` 看会话，`--to <sec_uid>` 读某个人的对话。
		 * 发消息还没做（要真页面，别半成品冒充完整）。
		 * ⚠️ 认人只认 sec_uid → 数字 uid 的反查结果，不按昵称猜。
		 */
		const to = argOf('--to') || argOf('--sec')
		const uid = argOf('--uid')
		const limit = Math.min(numOf('--limit', 30), 60)
		const text = argOf('--text')
		if (text) {
			/* 发私信：走真页面点击（tools/im-send.mjs），--dry 只打开会话打字、不按发送。
			 * `--to` 既收 sec_uid 也收昵称：sec_uid 形如 MS4wLjABAAAA…，其余当昵称。 */
			const isSec = /^MS4wLjAB/.test(to)
			const r = await im.send({ secUid: isSec ? to : '', nick: isSec ? '' : to, text, dry: has('--dry') })
			out(r)
			process.exit(r.ok ? 0 : 1)
		}
		const r = to || uid
			? await im.read({ secUid: to, uid, limit })
			: await im.conversations({ limit: Math.min(limit, 20) })
		out(r)
		process.exit(r.ok ? 0 : 1)
	}

	if (CMD === 'cost') {
		/* 花费账本在 QQ 那边（`qq-pet\tools\token-report.mjs`），这里只做转发：
		 * 一份数据只能有一个来源，两处各算一遍迟早对不上。 */
		const script = process.env.TOKEN_REPORT
			|| join(process.env.QQ_PET_HOME || join(homedir(), '.dsh', 'profiles', 'desktop', 'qq-pet'), 'tools', 'token-report.mjs')
		if (!existsSync(script)) die({ error: '找不到账本脚本: ' + script })
		const r = await new Promise((res) => {
			const c = spawn(process.execPath, [script, '--short', ...(argOf('--days') ? ['--days', argOf('--days')] : [])], { windowsHide: true })
			let o = ''
			c.stdout.on('data', (d) => { o += d })
			c.on('close', (code) => res({ code, o }))
			c.on('error', (e) => res({ code: -1, o: String(e && e.message || e) }))
		})
		try { out(JSON.parse(r.o.slice(Math.max(0, r.o.indexOf('{'))))) } catch { die({ error: '账本没返回 JSON', raw: r.o.slice(-300) }) }
		process.exit(0)
	}

	if (CMD === 'search') {
		const kw = argOf('--kw') || argOf('--keyword') || argv[1]
		if (!kw) die({ error: '缺关键词：search --kw 小鲸鱼' })
		const r = await api.searchVideo({ keyword: String(kw), count: Math.min(numOf('--count', 10), 30), offset: numOf('--offset', 0) })
		out(r)
		process.exit(r.ok ? 0 : 1)
	}

	if (CMD === 'delcomment') {
		const aweme = argOf('--aweme')
		const cid = argOf('--cid')
		if (!aweme || !cid) die({ error: '缺 --aweme 或 --cid' })
		if (has('--dry')) { out({ ok: true, stage: 'dry', would: { aweme, cid } }); process.exit(0) }
		const r = await api.deleteComment({ aweme, cid })
		out(r)
		process.exit(r.ok ? 0 : 1)
	}

	if (CMD === 'check') {
		const files = [...allOf('--img'), ...allOf('--video')]
		const r = checkFiles(files)
		out(r)
		process.exit(r.ok ? 0 : 1)
	}

	if (CMD === 'snapshot') {
		const sub = String(argv[1] || 'list').trim()
		if (sub === 'list') { out({ ok: true, snapshots: listSnapshots(), profile: profileDir() }); process.exit(0) }
		if (sub === 'save') { const r = await saveSnapshot({ note: argOf('--note') }); out(r); process.exit(r.ok ? 0 : 1) }
		if (sub === 'restore') {
			const name = argv[2]
			if (!name) die({ error: '写成 snapshot restore <名字>（名字用 snapshot list 看）' })
			const r = await restoreSnapshot(name)
			out(r)
			process.exit(r.ok ? 0 : 1)
		}
		die({ error: 'snapshot 只认 list / save / restore', got: sub })
	}

	if (CMD === 'comments') {
		const aweme = argOf('--aweme')
		if (!aweme) die({ error: '缺 --aweme' })
		const r = await api.comments(aweme, { count: Math.min(numOf('--count', 20), 50) })
		out(r)
		process.exit(r.ok ? 0 : 1)
	}

	if (CMD === 'reply') {
		const aweme = argOf('--aweme')
		const cid = argOf('--cid')
		const text = String(argOf('--text') || '')
		const root = argOf('--root')
		const author = argOf('--author')
		const reason = argOf('--reason')
		if (!aweme) die({ error: '缺 --aweme' })
		if (!text) die({ error: '缺 --text' })
		if (text.length > LIMITS.textMax) die({ error: `正文 ${text.length} 字，上限 ${LIMITS.textMax}` })
		// 楼中楼：cid 是被回的那条，root 是楼根（不传就当顶层评论）
		if (root && root === aweme) die({ error: 'root 不能是视频 id（那是 aweme，不是楼根）' })
		if (root && !/^\d+$/.test(root)) die({ error: 'root 必须是纯数字的评论 id（0-25 踩过：传了非数字，挂成顶层评论）' })

		const q = checkQuota({ aweme, cid, authorUid: author, root })
		if (!q.ok) die({ stage: 'quota', why: q.why, retryAfter: q.retryAfter || '', quota: stats(aweme) })

		/* 第二道闸：消息预算（跨通道的总量 / 小时 / 间隔 / 单人 / 单楼）。
		 * 两套额度是**叠加**的：ledger 管「同视频/同人/同楼」的细账，budget 管全局节奏。 */
		const bq = budget.check({ ch: 'comment', peer: author, thread: root || cid, text })
		if (!bq.ok) die({ stage: 'budget', why: bq.why, retryAfter: bq.retryAfter || '', budget: bq.quota })

		/* 落点是这套里最容易悄悄错的地方（错了就变成一条新的顶层评论），dry 也把它打出来。 */
		const planThread = root || cid
		const planReplyTo = root && cid ? cid : ''
		if (has('--dry')) {
			out({ ok: true, stage: 'dry', would: { aweme, cid, root, text, chars: text.length, reply_id: planThread, reply_to_reply_id: planReplyTo }, quota: stats(aweme), budget: bq.quota.messages })
			process.exit(0)
		}

		/* 没有楼根（对方就是顶层评论）→ reply_id=cid，否则会变成「新发一条顶层评论」。 */
		const thread = planThread
		const r = await api.reply({ aweme, text, root: thread, replyTo: planReplyTo })
		if (r.ok) {
			/* 记账统一走 sendlog：它自己 await（以前没 await 会被 process.exit 掐掉），
			 * 并按 cid 幂等（重复调用只记一次）。 */
			await recordOutbound({
				aweme, cid, root, authorUid: author, text, reason, newCid: r.cid,
				ch: 'comment', thread: root || cid, note: 'reply ' + cid,
			})
		}
		out({ ...r, stage: 'api', quota: stats(aweme), budget: bq.quota.messages })
		process.exit(r.ok ? 0 : 1)
	}

	if (CMD === 'publish') {
		const files = [...allOf('--img'), ...allOf('--video')]
		const opts = {
			files,
			title: argOf('--title'),
			desc: argOf('--desc'),
			who: argOf('--who'),
			declare: argOf('--declare'),
			at: argOf('--at'),
			cover: argOf('--cover') || '',
			draft: has('--draft'),
			publish: has('--publish'),
			fresh: has('--fresh'),
			clean: has('--clean'),
			reupload: has('--reupload'),
			noShot: has('--no-shot'),
			dry: has('--dry'),
		}
		const v = validate(opts)
		if (!v.ok) die({ stage: 'validate', errors: v.errors, plan: v.plan })
		/* 声明必填 + 首跑 dry：规矩只写一份，CLI 也不能绕（工具层同样这两道）。 */
		if (opts.publish || opts.draft) {
			if (!opts.declare) die({ stage: 'declare', error: '要 --declare（一般 ai）；真发不许 none', options: DECLARE })
			if (opts.publish && opts.declare === 'none') die({ stage: 'declare', error: '真发不能挂「无声明」' })
		}
		if (opts.publish && needsFirstRunDry()) {
			die({ stage: 'first-run', error: '这台机器还没跑过一次成功的 dry 发布；先 `dy.mjs publish … --dry` 走一遍' })
		}
		/* 无人值守：只有显式 --auto 才走这条路，且四道闸缺一条就退回人工。 */
		if (has('--auto') && opts.publish) {
			const { checkAuto } = await import('../lib/unattended.mjs')
			const { readSettings } = await import('../lib/settings.mjs')
			const gate = checkAuto(readSettings())
			if (!gate.ok) die({ stage: 'unattended', reason: gate.stage, error: gate.reason })
		}
		if (has('--dry')) {
			try { markDryRun('cli publish --dry') } catch { /* 状态写不进去不影响演练结果 */ }
			out({ ok: true, stage: 'dry', plan: v.plan }); process.exit(0)
		}
		const r = await publishRun(opts)
		try { if (opts.publish && r && r.ok !== false) markPublished() } catch { /* 记账失败不该改结果 */ }
		try {
			if (has('--auto') && opts.publish) {
				const { recordAuto } = await import('../lib/unattended.mjs')
				recordAuto({ ok: Boolean(r && r.ok !== false), title: opts.title || '', declare: opts.declare || '' })
			}
		} catch { /* 账本写不进去，不该把发布结果变成失败 */ }
		out(r)
		process.exit(r.ok ? 0 : 1)
	}

	if (CMD === 'quick') {
		/* QQ 里发过来就能用的一条龙：一段文案 + 若干文件。
		 * 哥哥在 QQ 里发「视频/图片 + 文案」，这边只要把文案原样带进来：
		 *   标题 = 第一行（图文 ≤20 字、视频 ≤30 字，超了自动截）
		 *   简介 = 整段文案
		 * 默认 private + 只存草稿 —— 没人盯着的时候不往公开推荐里塞东西。 */
		const files = [...allOf('--img'), ...allOf('--video')]
		const text = String(argOf('--text') || '')
		if (!files.length) die({ stage: 'arg', error: '缺少 --img 或 --video' })
		const isVideo = files.some((f) => /\.(mp4|mov|m4v|webm|mkv)$/i.test(f))
		const limit = isVideo ? 30 : 20
		const firstLine = text.split(/\r?\n/).map((s2) => s2.trim()).find(Boolean) || ''
		const opts = {
			files,
			title: argOf('--title') || firstLine.slice(0, limit),
			desc: argOf('--desc') || text,
			who: argOf('--who') || 'private',
			declare: argOf('--declare') || 'ai',
			at: argOf('--at') || '',
			cover: argOf('--cover') || '',
			draft: !has('--publish'),
			publish: has('--publish'),
			fresh: false,
			clean: false,
			reupload: false,
			noShot: true,
			dry: has('--dry'),
		}
		const v = validate(opts)
		if (!v.ok) die({ stage: 'validate', errors: v.errors, plan: v.plan })
		/* 发布不占消息总闸，但有自己的一天 5 条上限 */
		const bq = budget.check({ ch: 'publish' })
		if (!bq.ok) die({ stage: 'budget', why: bq.why, quota: bq.quota.messages })
		if (has('--dry')) { out({ ok: true, stage: 'dry', plan: v.plan, budget: bq.quota.messages }); process.exit(0) }
		const r = await publishRun(opts)
		if (r && r.ok) budget.record({ ch: 'publish', note: 'quick ' + opts.title })
		out(r)
		process.exit(r.ok ? 0 : 1)
	}

	if (CMD === 'latest') {
		/* QQ 里刚发来的媒体落在 $DSH_HOME/media/onebot（media_<ts>_<hash>.<ext>）。
		 * 这里只负责「最近 N 分钟内有哪些新文件」，判断该发哪条还是人来定 —— */
		const min = Number(argOf('--min') || 30)
		const n = Number(argOf('--n') || 5)
		const dir = argOf('--dir') || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'media', 'onebot')
		const since = Date.now() - Math.max(1, min) * 60000
		const out2 = []
		try {
			for (const e of readdirSync(dir, { withFileTypes: true })) {
				if (!e.isFile()) continue
				if (!/\.(jpg|jpeg|png|webp|gif|mp4|mov|m4v|webm)$/i.test(e.name)) continue
				const p = join(dir, e.name)
				const st2 = statSync(p)
				if (st2.mtimeMs >= since) out2.push({ file: p, name: e.name, size: st2.size, at: new Date(st2.mtimeMs).toISOString() })
			}
		} catch (e) {
			die({ stage: 'read', error: String((e && e.message) || e), dir })
		}
		out2.sort((a, b2) => String(b2.at).localeCompare(String(a.at)))
		out({ ok: true, dir, windowMin: min, files: out2.slice(0, Math.max(1, n)) })
		process.exit(0)
	}

	if (CMD === 'ledger') {
		out({ ok: true, stats: stats(), recent: recent(numOf('--recent', 8)) })
		process.exit(0)
	}

	/* ── 趋势：每天存一条，看涨没涨 ───────────────────────────────── */
	if (CMD === 'trend') {
		const mod = await import('../lib/trend.mjs')
		const act = String(argv[1] || 'show')
		if (act === 'save') { out(await mod.save()); process.exit(0) }
		if (act === 'rows') { out({ ok: true, rows: mod.read() }); process.exit(0) }
		out({ ok: true, ...mod.summary(numOf('--days', 14)) })
		process.exit(0)
	}

	/* ── 昵称：抄一次 /chat，把 uid→昵称 存下来 ─────────────────────── */
	if (CMD === 'names') {
		const mod = await import('../lib/names.mjs')
		if (has('--refresh')) { out(await mod.refresh({ limit: numOf('--limit', 20) })); process.exit(0) }
		const map = mod.allNames()
		out({ ok: true, known: Object.keys(map).length, names: map })
		process.exit(0)
	}

	/* ── 队列：失败的重放 ─────────────────────────────────────────── */
	if (CMD === 'queue') {
		const mod = await import('../lib/queue.mjs')
		const act = String(argv[1] || 'list')
		if (act === 'list') { out(mod.list({ state: argOf('--state') })); process.exit(0) }
		if (act === 'clear') { out(mod.clear({ dead: has('--dead') })); process.exit(0) }
		if (act === 'retry') {
			const api = await import('../lib/api.mjs')
			const im = await import('../lib/im-send.mjs')
			const share = await import('../lib/share.mjs')
			const r = await mod.retry({
				reply: (p) => api.reply({ aweme: p.aweme, text: p.text, root: p.root || undefined }),
				dm: (p) => im.sendByUi({ nick: p.nick || '', secUid: p.sec_uid || '', text: p.text }),
				share: (p) => share.shareCard({ aweme: p.aweme, nick: p.nick || '', secUid: p.sec_uid || '' }),
			}, { limit: numOf('--limit', 5) })
			out(r)
			process.exit(0)
		}
		die({ error: 'queue 只认 list / retry / clear' })
	}

	/* ── 盯梢：来新私信就弹通知 ───────────────────────────────────── */
	/* ── 看一条视频：抽成拼图，把证据摆出来（2026-11-15）─────────────
	 * 和 `watch` 不是一回事：`watch` 是盯私信的常驻开关，`see` 是「我现在要看这一条」。
	 * 抽帧只产出图片和事实，**不产出观后感** —— 描述必须由真的看过那张图的调用方写。 */
	if (CMD === 'see') {
		const mod = await import('../lib/watch.mjs')
		const id = String(argOf('--aweme') || '').trim()
		if (!id) die({ error: '要 --aweme（作品 id）' })
		const w = await mod.watchOnce(id, { frames: true, cells: numOf('--cells', 6) })
		const { playUrl, ...rest } = w
		out({
			...rest,
			playUrlLen: String(playUrl || '').length,
			next: w.frames
				? '下一步：read_image 打开 sheet，按格子顺序（左上→右下）一格一句话说你看到什么，再谈感受。没看清的格子说没看清，别补。'
				: '没抽到画面（' + (w.frameError || '未知') + '）。只能凭文案和热评说话，别编画面。',
		})
		process.exit(0)
	}

	if (CMD === 'watch') {
		const mod = await import('../lib/watch.mjs')
		const act = String(argv[1] || 'once')
		if (act === 'once') { out(await mod.tick({ quiet: !has('--loud') })); process.exit(0) }
		if (act === 'status') { out(mod.status()); process.exit(0) }
		if (act === 'start') {
			out(mod.start({ everySec: numOf('--every', 90), quiet: !has('--loud') }))
			/* 命令行跑常驻：到 --for 秒后自己退（默认一小时），不留在后台没人管 */
			await new Promise((r) => setTimeout(r, Math.max(30, numOf('--for', 3600)) * 1000))
			mod.stop()
			process.exit(0)
		}
		die({ error: 'watch 只认 once / start / status' })
	}

	/* ── 登录：出二维码 / 查状态 ──────────────────────────────────── */
	if (CMD === 'login') {
		const mod = await import('../lib/login.mjs')
		const act = String(argv[1] || 'whoami')
		if (act === 'whoami') { out(await mod.whoami()); process.exit(0) }
		if (act === 'qr') {
			const r = await mod.qrShot()
			if (r.image) {
				/* 命令行不吐 base64（几万字符没法看），落成文件再给路径 */
				const { writeFileSync, mkdirSync } = await import('node:fs')
				const dir = join(process.env.DSH_HOME || join(process.env.USERPROFILE || '.', '.dsh'), 'douyin-duty')
				mkdirSync(dir, { recursive: true })
				const p = join(dir, 'login-qr.png')
				writeFileSync(p, Buffer.from(r.image.split(',')[1], 'base64'))
				out({ ok: true, already: false, file: p, rect: r.rect })
			} else out(r)
			process.exit(0)
		}
		die({ error: 'login 只认 whoami / qr' })
	}

	/* ── 值班：跑一轮（默认只看不自动回） ─────────────────────────── */
	if (CMD === 'duty') {
		const mod = await import('../lib/duty.mjs')
		const act = String(argv[1] || 'run')
		if (act === 'status') { out(mod.status()); process.exit(0) }
		if (act === 'collect') { out(await mod.collect({ worksN: numOf('--works', 3), perWork: numOf('--per', 20) })); process.exit(0) }
		const r = await mod.run({
			autoReply: has('--auto'),
			maxPerRun: numOf('--max', envNum('DOUYIN_STUDIO_REPLY_MAX', 2)),
			dry: has('--dry'),
		})
		out(r)
		process.exit(0)
	}

	/* ── 收件箱：把「谁在等我」整理成一张清单 ─────────────────────── */
	if (CMD === 'inbox') {
		const lim = Math.min(numOf('--limit', 10), 30)
		if (has('--dm-only')) { const r = await inbox.dmCandidates({ limit: lim }); out(r); process.exit(r.ok ? 0 : 1) }
		if (has('--at-only')) { const r = await inbox.atCandidates({ limit: lim, enrich: numOf('--enrich', 3) }); out(r); process.exit(r.ok ? 0 : 1) }
		if (has('--own-only')) { const r = await inbox.ownComments({ limit: lim, worksN: numOf('--works', 3) }); out(r); process.exit(r.ok ? 0 : 1) }
		const r = await inbox.inbox({ limit: lim })
		out(r)
		process.exit(r.ok ? 0 : 1)
	}

	/* ── 消息预算：看今天还能发几条 ───────────────────────────────── */
	if (CMD === 'budget') {
		if (has('--reset')) { out({ ok: true, reset: budget.reset() }); process.exit(0) }
		out({ ok: true, ...budget.stats(), recent: budget.recent(numOf('--recent', 8)) })
		process.exit(0)
	}

	/* ── 发私信（带预算） ─────────────────────────────────────────── */
	if (CMD === 'dm-send') {
		const to = argOf('--to') || argOf('--sec') || argOf('--nick')
		const uid = argOf('--uid')
		const text = String(argOf('--text') || '')
		if (!to && !uid) die({ error: '要给 --to（sec_uid 或昵称）或 --uid' })
		if (!text.trim()) die({ error: '缺 --text' })
		const q = budget.check({ ch: 'dm', peer: uid || to, text })
		if (!q.ok) die({ stage: 'budget', why: q.why, retryAfter: q.retryAfter || '', budget: q.quota.messages })
		if (has('--dry')) {
			out({ ok: true, stage: 'dry', would: { to, uid, text, chars: text.length }, budget: q.quota.messages })
			process.exit(0)
		}
		const isSec = /^MS4wLjAB/.test(String(to || ''))
		const r = await im.send({ secUid: isSec ? to : '', nick: isSec ? '' : String(to || ''), text, dry: false })
		if (r.ok) budget.record({ ch: 'dm', peer: uid || to, note: r.verified_http ? 'dm verified' : 'dm unverified' })
		out({ ...r, stage: 'send', budget: q.quota.messages })
		process.exit(r.ok ? 0 : 1)
	}

	/* ── 回 @我 的通知（落在评论区，走 at 通道） ──────────────────── */
	if (CMD === 'at-reply') {
		const aweme = argOf('--aweme')
		const cid = argOf('--cid')
		const root = argOf('--root') || argOf('--rootid')
		const author = argOf('--author')
		const text = String(argOf('--text') || '')
		if (!aweme) die({ error: '缺 --aweme' })
		if (!text.trim()) die({ error: '缺 --text' })
		/* 落点先算清楚：顶层 @（root 空）→ reply_id=cid，把回复挂在对方那条评论下；
		 * 楼中楼（root 有值）→ reply_id=楼根 + reply_to_reply_id=cid，挂到具体那个人。 */
		const plan = planAtReply({ cid, root })
		const q = budget.check({ ch: 'at', peer: author, thread: plan.thread, text })
		if (!q.ok) die({ stage: 'budget', why: q.why, retryAfter: q.retryAfter || '', budget: q.quota.messages })
		if (has('--dry')) { out({ ok: true, stage: 'dry', would: { aweme, cid, root, text, reply_id: plan.thread, reply_to_reply_id: plan.replyTo }, budget: q.quota.messages }); process.exit(0) }
		/* ⚠️ 2026-11-02 真机：@ 我 的那条多半是顶层评论，通知里 root_comment_id 是空的。
		 *    这时还按 root='' 发，会变成「一条新的顶层评论」，不是「回这条」。
		 *    没给楼根就把被 @ 的那条当父评论（reply_id=cid）。 */
		const thread = plan.thread
		const r = await api.reply({ aweme, text, root: thread, replyTo: plan.replyTo })
		if (r.ok) {
			/* 同上：出口一个，记账在出口里。 */
			await recordOutbound({
				aweme, cid, root, authorUid: author, text, reason: 'at', newCid: r.cid,
				ch: 'at', thread: plan.thread, note: '@ ' + aweme,
			})
		}
		out({ ...r, stage: 'api', budget: q.quota.messages })
		process.exit(r.ok ? 0 : 1)
	}

	/* 某条评论下面的回复（楼中楼）。没有这一步就永远看不到楼中楼，
	 * 也就永远"没成功过" —— 下面那些 cid 就是回楼中楼时 --cid 要的值。 */
	if (CMD === 'replies') {
		const aweme = String(argOf('--aweme') || '')
		const cid = String(argOf('--cid') || '')
		if (!aweme || !cid) die({ error: '缺 --aweme / --cid（cid = 那条评论的 id）' })
		const r = await api.replies(aweme, cid, { count: Math.min(numOf('--count', 20), 50) })
		out({
			...r,
			hint: '回楼中楼：--aweme ' + aweme + ' --cid <下面某条的 cid> --root ' + cid,
		})
		process.exit(r.ok ? 0 : 1)
	}

	/* ── 刷视频（内容限定 + 去重，只读） ──────────────────────────── */
	if (CMD === 'feed') {
		const csv = (s) => String(s || '').split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean)
		const allow = csv(argOf('--allow') || process.env.DOUYIN_STUDIO_KEYWORDS || '')
		const block = csv(argOf('--block') || process.env.DOUYIN_STUDIO_BLOCKWORDS || '')
		const r = await feed.browse({
			count: numOf('--count', envNum('DOUYIN_STUDIO_FEED_COUNT', 20)),
			gapMs: numOf('--gap', envNum('DOUYIN_STUDIO_FEED_GAP', 0)) * 1000,
			allow, block,
			minSec: numOf('--min-sec', envNum('DOUYIN_STUDIO_FEED_MIN_SEC', 5)),
			maxSec: numOf('--max-sec', envNum('DOUYIN_STUDIO_FEED_MAX_SEC', 180)),
			minDigg: numOf('--min-digg', envNum('DOUYIN_STUDIO_FEED_MIN_DIGG', 0)),
			skipSeen: !has('--no-seen'),
			markSeen: has('--mark-seen'),
			limit: numOf('--limit', 12),
		})
		out({ ...r, seen: feed.seenStats() })
		process.exit(r.ok ? 0 : 1)
	}

	/* ── 每天给他投递几条视频（私信分享卡片，条数/时间在设置里） ────── */
	if (CMD === 'digest') {
		const auto = await import('../lib/autopilot.mjs')
		auto.configure({ runCli: async (args) => {
			const r = await new Promise((res) => {
				const c = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args], {
					env: { ...process.env }, windowsHide: true,
				})
				let o = ''
				c.stdout.on('data', (d) => { o += d })
				c.on('close', () => { try { res(JSON.parse(o)) } catch { res({ ok: false, error: '子命令输出不是 JSON' }) } })
				c.on('error', (e) => res({ ok: false, error: String((e && e.message) || e) }))
			})
			return r
		} })
		const r = await auto.runDigest({ dry: has('--dry'), manual: true })
		out(r)
		process.exit(r.ok ? 0 : 1)
	}

	/* ── 在自己作品下发一条顶层评论（走 own 通道，额度更小） ───────── */
	if (CMD === 'comment-self') {
		const aweme = argOf('--aweme')
		const text = String(argOf('--text') || '')
		if (!aweme) die({ error: '缺 --aweme' })
		if (!text.trim()) die({ error: '缺 --text' })
		const q = budget.check({ ch: 'own', peer: '', thread: aweme, text })
		if (!q.ok) die({ stage: 'budget', why: q.why, retryAfter: q.retryAfter || '', budget: q.quota.messages })
		if (has('--dry')) { out({ ok: true, stage: 'dry', would: { aweme, text }, budget: q.quota.messages }); process.exit(0) }
		const r = await api.reply({ aweme, text })
		if (r.ok) budget.record({ ch: 'own', thread: aweme, note: 'own comment' })
		out({ ...r, stage: 'api', budget: q.quota.messages })
		process.exit(r.ok ? 0 : 1)
	}

	/* ── 在评论区 @ 人（真的 @，带 text_extra，对方会收到提醒） ──────
	 * 2026-11-03 哥哥要的：把视频推给他的是「分享卡片」，但评论区里 @ 他
	 * 才是抖音原生提醒。接口带 text_extra 就能发出来（实测 status_code 0），
	 * 但能不能真的弹提醒只有手机端看得见 —— 发完要让他确认一次。 */
	if (CMD === 'comment-at') {
		const aweme = String(argOf('--aweme') || '')
		const nick = String(argOf('--to') || '').trim()
		const uid = String(argOf('--uid') || '').trim()
		const sec = String(argOf('--sec') || '').trim()
		const raw = String(argOf('--text') || '').trim()
		if (!aweme) die({ error: '缺 --aweme' })
		if (!nick) die({ error: '缺 --to（对方抖音昵称）' })
		if (!uid || !sec) die({ error: '缺 --uid / --sec（对方的数字 uid 和 sec_uid，认人只认这两个）' })
		if (!raw) die({ error: '缺 --text' })
		const at = '@' + nick
		const text = raw.startsWith(at) ? raw : at + ' ' + raw
		/* 形状照真 @ 抄的（2026-11-03 抓哥哥手动 @ 我那条）：type 必须是 0，
		 * 多带 nickname 反而会让服务端忽略这条 —— 之前就是这样，发出去全是纯文本。 */
		const extra = [{ start: 0, end: at.length, type: 0, user_id: uid, sec_uid: sec, hashtag_name: '', hashtag_id: '' }]
		const q = budget.check({ ch: 'comment', peer: uid, thread: aweme, text })
		if (!q.ok) die({ stage: 'budget', why: q.why, retryAfter: q.retryAfter || '', budget: q.quota.messages })
		if (has('--dry')) {
			out({ ok: true, stage: 'dry', would: { aweme, to: nick, uid, text, extra }, budget: q.quota.messages })
			process.exit(0)
		}
		const r = await api.reply({ aweme, text, extra })
		if (r.ok) {
			/* 新发的顶层 @ 没有"被回的 cid"，但它同样是一次对外发送 ——
			 * 以前只记额度不写账本，于是「今天做了什么」里看不到这条 @。 */
			await recordOutbound({
				aweme, cid: '', authorUid: uid, authorName: nick, text,
				reason: 'comment-at ' + nick, newCid: r.cid,
				ch: 'at', thread: aweme, note: 'at ' + nick,
			})
		}
		out({ ...r, stage: 'api', at: nick, text, budget: q.quota.messages })
		process.exit(r.ok ? 0 : 1)
	}

	if (CMD === 'watchback') {
		/* 谁回了我：只读通知，整理成待回列表（默认只看主人）。 */
		const { pickReplies } = await import('../lib/watchback.mjs')
		const { readSettings: rs } = await import('../lib/settings.mjs')
		const st = rs()
		const n = await api.notices({ limit: Math.min(numOf('--limit', 30), 60) })
		if (!n || !n.ok) die({ stage: 'notices', error: (n && n.error) || '通知读不到' })
		const all = pickReplies(n.items || [], { ownerUid: st.ownerUid || '', limit: Math.min(numOf('--max', 10), 20) })
		const list = has('--owner-only') ? all.filter((x) => x.fromOwner) : all
		out({ ok: true, count: list.length, items: list })
		process.exit(0)
	}

	if (CMD === 'risk') {
		/* 风控冷却：默认看状态，`risk clear` 手动解除。 */
		const mod = await import('../lib/risk.mjs')
		if (String(argv[1] || '') === 'clear') {
			out(mod.clearRisk())
			process.exit(0)
		}
		out({ ok: true, ...mod.riskState() })
		process.exit(0)
	}

	if (CMD === 'comment-image') {
		/* 评论带图：走页面上的「图片」按钮 + 回车，不碰上传接口。 */
		const aweme = argOf('--aweme') || argOf('--id') || ''
		const file = argOf('--file') || argOf('--img') || ''
		const { commentWithImage } = await import('../lib/comment-image.mjs')
		const r = await commentWithImage({ aweme, file, text: argOf('--text') || '', dry: has('--dry') })
		out(r)
		process.exit(r.ok ? 0 : 1)
	}

	if (CMD === 'delete') {
		const title = argOf('--title')
		if (!title) die({ error: '缺 --title（只删标题完全匹配的那条，防止删错）' })
		const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'delete.mjs')
		const r = await new Promise((res) => {
			const c = spawn(process.execPath, [script, '--title', title], {
				env: { ...process.env, CDP_PORT: String(port()), DOUYIN_TITLE: title }, windowsHide: true,
			})
			let o = ''
			c.stdout.on('data', (d) => { o += d })
			c.on('close', (code) => res({ code, o }))
			c.on('error', (e) => res({ code: -1, o: String(e && e.message || e) }))
		})
		try {
			const j = JSON.parse(r.o.slice(Math.max(0, r.o.indexOf('{'))))
			out(j)
			process.exit(j.ok ? 0 : 1)
		} catch {
			die({ error: '删除脚本没返回 JSON', code: r.code, raw: r.o.slice(-400) })
		}
	}

	die({ error: '不认识的命令：' + CMD, ...HELP })
} catch (e) {
	die({ error: String((e && e.message) || e), stack: String((e && e.stack) || '').split('\n').slice(0, 4) })
}
