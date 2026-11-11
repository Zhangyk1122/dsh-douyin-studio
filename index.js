/**
 * dsh-douyin-studio —— 小汐的抖音工作室（host 半端）
 * ============================================================================
 * 和旧插件（dsh-douyin-scroll）刻意分开：那边是「值班链路 + 设置页 + 一堆历史脚本」，
 * 这边是**干净的三层**：
 *
 *   引擎层  `lib/cdp.mjs`（唯一碰浏览器的地方）、`lib/api.mjs`（站在登录页里 fetch）、
 *           `lib/ledger.mjs`（额度 + 三重去重）、`lib/publish.mjs`（发布菜谱）
 *   工具层  本文件：只做参数整形 + 起子进程 + 解析 JSON，不含业务逻辑
 *   菜谱层  `tools/dy.mjs`：一条命令跑完一串（回评四道闸、发布前置校验、删稿唯一命中）
 *
 * 为什么工具只做「起子进程」：同一套逻辑必须能被 CLI 直接跑（她在终端里也能用），
 * 不能只活在插件里。参数、额度、去重全在 `lib/`，两边共用一份。
 * ============================================================================
 */
import { loadHostDeps } from './lib/hostdeps.mjs'
import { registerTools } from './lib/tools.mjs'
import { registerExtraTools } from './lib/tools-extra.mjs'
import * as WATCH from './lib/watch.mjs'
import * as DUTY from './lib/duty.mjs'
import * as AUTOPILOT from './lib/autopilot.mjs'
import * as OWNER from './lib/owner.mjs'
import { execJson } from './lib/proc.mjs'
import { checkOrigin } from './lib/guard.mjs'
import { serveInbox, DEFAULT_TTL } from './lib/cache.mjs'
import { readSettings, writeSettings, settingsEnv, DEFAULTS } from './lib/settings.mjs'
import * as BUDGET from './lib/budget.mjs'
import * as ROUNDS from './lib/roundstate.mjs'
import { isKilled, killFile, killInfo, setKill } from './lib/killswitch.mjs'
import { runJob } from './lib/jobs.mjs'
import { readSnapshot } from './lib/dashboard.mjs'
import { atomicWriteJson, readJsonSafe } from './lib/fsx.mjs'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const hostDeps = await loadHostDeps()
const z = hostDeps.z
const defineTool = hostDeps.defineTool

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, 'tools', 'dy.mjs')

export const name = 'douyin-studio'
export const inject = ['tools', 'webServer']

/** 🔴 每个字段都要 `.extra('volatile', true)`，否则 settings.update() 会抛「没有 volatile 字段」 */
export const Config = !z ? undefined : z.object({
	/** 浏览器调试端口（和别的插件共用同一个） */
	cdpPort: z.natural().default(9334).extra('volatile', true),
	/** Chrome 登录资料目录（留空 = $DSH_HOME/douyin-duty/chrome-profile） */
	profileDir: z.string().default('').extra('volatile', true),
	/** 没窗口时自己起一个 */
	autoOpen: z.boolean().default(true).extra('volatile', true),
	/** 一天最多回几条 */
	perDay: z.natural().default(20).extra('volatile', true),
	/** 来新私信就弹桌面通知（2026-11-05 审计 B2-09 起默认关：新装的插件不在后台自己醒着；要就手动开） */
	watchOn: z.boolean().default(false).extra('volatile', true),
	/** 盯私信的间隔（秒，最小 30） */
	watchEverySec: z.natural().default(90).extra('volatile', true),
	/** 值班：定时去看一眼评论区（默认关——它自己会动手，得先点头） */
	dutyOn: z.boolean().default(false).extra('volatile', true),
	/** 值班间隔（分钟，最小 10） */
	dutyEveryMin: z.natural().default(30).extra('volatile', true),
	/** 值班时**自动回**（默认关：只收集、不替你说话） */
	dutyAutoReply: z.boolean().default(false).extra('volatile', true),
	/** 刷视频的内容限定（逗号分隔，命中才留下；空 = 不筛） */
	keywords: z.string().default('').extra('volatile', true),
	/** 刷视频的黑名单（逗号分隔，命中就划走） */
	blockKeywords: z.string().default('').extra('volatile', true),
	/** 额度细则覆盖（JSON，例如 {"perDay":{"dm":20}}；留空用预算默认值） */
	limitsJson: z.string().default('').extra('volatile', true),
})

export function apply(ctx, config) {
	const cfg = config || {}

	/* ⚠️ 2026-11-01：宿主传进来的 config 是**响应式包装**，字段本身是对象不是标量
	 *    （`JSON.stringify(cfg.cdpPort)` 会得到 `{}`，`String(cfg.cdpPort)` 会得到 `"[object Object]"`）。
	 *    所以一律在这里落成普通值，后面只认 S —— 别再把 cfg.xxx 直接拼进环境变量或 JSON。
	 *    这条是浏览器面板上看到 `"cdpPort":{}` 才发现的：逻辑跑得通（CLI 自己有默认值），
	 *    但「设置页显示的」和「实际用的」不是一回事，那种错最难查。 */
	const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d }
	const str = (v) => (typeof v === 'string' ? v : '')
	const S = {
		cdpPort: num(cfg.cdpPort, 9334),
		profileDir: str(cfg.profileDir),
		autoOpen: cfg.autoOpen === false ? false : true,
		perDay: num(cfg.perDay, 20),
		watchOn: cfg.watchOn === true,
		watchEverySec: num(cfg.watchEverySec, 90),
		dutyOn: cfg.dutyOn === true,
		dutyEveryMin: num(cfg.dutyEveryMin, 30),
		dutyAutoReply: cfg.dutyAutoReply === true,
		keywords: str(cfg.keywords),
		blockKeywords: str(cfg.blockKeywords),
		limitsJson: str(cfg.limitsJson),
	}

	/** 额度：配置里的 perDay 现在**真的接线**了（以前只是个显示值）。
	 *  perDay 管「回评 + 自己评论区」这条评论通道的日上限；其余通道走预算默认值，
	 *  要改细节就填 limitsJson（JSON 覆盖，例如 {"perDay":{"dm":20}}）。 */
	const limitsEnv = () => {
		let base = {}
		try { base = S.limitsJson ? JSON.parse(S.limitsJson) : {} } catch { base = {} }
		const perDay = { ...(base.perDay || {}) }
		if (!Number.isFinite(Number(perDay.comment))) perDay.comment = S.perDay
		return JSON.stringify({ ...base, perDay })
	}

	/* 把「面板上的额度 / 主人 uid」注入宿主进程。
	 * 不注的话，面板里发私信、挑卡「发我」这些**在宿主里查额度**的动作，
	 * 用的还是默认值（主人也可能被"同一人每天 2 条"拦住）。 */
	/* 盯私信发现新消息 → 立刻叫一轮「回私信」。
	 * 以前是"90 秒发现、30 分钟才回"，中间隔着一个定时器 —— 对方体感就是慢半拍。
	 * 两道保险：dmBusy 防重入，autopilot 内部还有一把单飞锁（dmRunning）。 */
	let dmBusy = false
	const replyDmNow = async () => {
		if (dmBusy) return
		dmBusy = true
		try { await AUTOPILOT.runDm({}) } catch { /* 即时回失败还有定时器兜底 */ }
		finally { dmBusy = false }
	}

	const syncBudget = () => {
		try {
			const st = readSettings()
			let lim = {}
			try { lim = S.limitsJson ? JSON.parse(S.limitsJson) : {} } catch { lim = {} }
			const perDay = { ...(lim.perDay || {}) }
			if (!Number.isFinite(Number(perDay.comment))) perDay.comment = S.perDay
			BUDGET.configure({ limits: { ...lim, perDay }, ownerUid: st.ownerUid })
		} catch { /* 读不到设置就沿用默认额度，不要因此挂掉 */ }
	}
	syncBudget()

	const env = () => {
		const e = { ...process.env }
		e.DOUYIN_CDP_PORT = String(S.cdpPort)
		if (S.profileDir) e.DOUYIN_PROFILE = S.profileDir
		if (S.autoOpen === false) e.DOUYIN_NO_AUTO_OPEN = '1'
		e.DOUYIN_STUDIO_LIMITS = limitsEnv()
		/* 面板设置优先，其次才是插件配置里的默认值。
		 * 这一步是「设置页真的有用」的关键：不合并进 env，页面上存的关键词/时长就只是摆设。 */
		let se = {}
		try { se = settingsEnv() } catch { se = {} }
		if (se.DOUYIN_STUDIO_KEYWORDS) e.DOUYIN_STUDIO_KEYWORDS = se.DOUYIN_STUDIO_KEYWORDS
		else if (S.keywords) e.DOUYIN_STUDIO_KEYWORDS = S.keywords
		if (se.DOUYIN_STUDIO_BLOCKWORDS) e.DOUYIN_STUDIO_BLOCKWORDS = se.DOUYIN_STUDIO_BLOCKWORDS
		else if (S.blockKeywords) e.DOUYIN_STUDIO_BLOCKWORDS = S.blockKeywords
		for (const k of [
			'DOUYIN_STUDIO_FEED_MIN_SEC', 'DOUYIN_STUDIO_FEED_MAX_SEC', 'DOUYIN_STUDIO_FEED_MIN_DIGG',
			'DOUYIN_STUDIO_FEED_COUNT', 'DOUYIN_STUDIO_FEED_ROUNDS', 'DOUYIN_STUDIO_REPLY_MAX',
			'DOUYIN_STUDIO_QUIET_FROM', 'DOUYIN_STUDIO_QUIET_TO', 'DOUYIN_STUDIO_OWNER_UID',
		]) {
			if (se[k]) e[k] = se[k]
		}
		return e
	}

	/**
	 * 跑一条子命令，把 stdout 里的 JSON 解析出来（**永远不抛，永远 resolve**）。
	 * 2026-11-02：从 spawnSync 换成异步 spawn —— 同步版会把整个宿主的事件循环按住，
	 * 而 /inbox 的超时是 240 秒、实际也要十几秒。详见 lib/proc.mjs 顶部。
	 * 调用方写法不用改：它一直在 await，现在只是真的异步了。
	 */
	const run = (args, { timeout = 120000 } = {}) => {
		if (!existsSync(CLI)) {
			return Promise.resolve({
				ok: false, category: 'LOCAL',
				error: '缺少 tools/dy.mjs', hint: '插件文件不全，重新装一次',
			})
		}
		/* 不管子进程那边怎么收场，调用方拿到的**永远是对象**。
		 * 2026-11-11：某两轮 scan 拿到 null，`r.ok` 直接抛 TypeError，
		 * 真正的失败原因（stderr / 退出码）一个字都没留下 —— 只剩一行
		 * `Cannot read properties of null (reading 'ok')`。 */
		return execJson(CLI, args, { timeout, env: env() }).then((v) => (
			v && typeof v === 'object'
				? v
				: { ok: false, category: 'LOCAL', error: 'CLI 没给出结果对象（' + (v === null ? 'null' : typeof v) + '）' }
		))
	}

	const textOutput = {
		schema: { type: 'object', properties: {}, additionalProperties: true },
		render: (_a, v) => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }],
	}
	registerTools({ ctx, defineTool, textOutput, run, S, DUTY, WATCH })
	/* 第二批（2026-11-05）：无人值守 / 互动灰度 / 作业账。拆文件是为了不让 tools.mjs 撞体量闸。 */
	try { registerExtraTools({ ctx, defineTool, textOutput }) } catch (e) {
		try { console.warn('[douyin-studio] 第二批工具没挂上：' + String((e && e.message) || e)) } catch { /* 日志挂了不该影响加载 */ }
	}

	/* ⭐ 2026-11-01：给设置页用的 HTTP 路由（面板「抖音工作室」）。
	 *    只暴露**不花钱、不发表**的只读动作；发布类操作一律走工具/命令行，
	 *    不让一个网页按钮就能把东西发出去。 */
	const sendJson = (res, code, body) => {
		try {
			const s = JSON.stringify(body)
			res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
			res.end(s)
		} catch { try { res.end('{}') } catch { /* 已断开 */ } }
	}

	/** 面板 POST 进来的 JSON（只读这几个字段，别的不认） */
	const readBody = (req) => new Promise((resolve) => {
		let buf = ''
		let done = false
		// 只结算一次：'end' 之后还会来 'close'，不放这个闸就会重复 resolve（无害但脏），
		// 而超限 destroy() 之后 'end' 根本不会来 —— 老写法会让这条请求永远挂着。
		const fin = (v) => { if (!done) { done = true; resolve(v) } }
		req.on('data', (b) => {
			buf += b
			if (buf.length > 4000) {
				try { req.destroy() } catch { /* 已断 */ }
				fin({})
			}
		})
		req.on('end', () => { try { fin(JSON.parse(buf || '{}')) } catch { fin({}) } })
		req.on('error', () => fin({}))
		req.on('close', () => fin({}))
	})
	/* 状态目录跟其它模块保持同一套算法：$DSH_HOME 优先，否则 ~/.dsh。
	 * 原来写的是 join(HERE,'..','..','douyin-duty') —— 只在 `~/.dsh/plugins/<名字>` 这种
	 * 安装布局下才对；装进 profile 树（~/.dsh/profiles/<id>/plugins/…）会算到别处去。 */
	const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
	const DATA = join(DSH_HOME, 'douyin-duty')

	/* ── 收件箱缓存：「秒开」靠的就是这一块 ──────────────────────────────
	 * /inbox 要走私信 + 通知 + 作品评论三条链路，十几秒。打开面板干等十几秒是
	 * 不能接受的，所以：磁盘上留一份上次的结果，打开时**立刻给旧的**，
	 * 同时后台跑一轮把新的补上（前端轮询，看到新的就换掉）。
	 * 策略判定在 lib/cache.mjs，这里只管读写和「同一时刻只跑一轮」。 */
	const INBOX_CACHE = join(DATA, 'inbox-cache.json')
	const INBOX_TTL = DEFAULT_TTL
	/** 同一时刻只允许一轮在飞 —— 面板连点刷新不能变成对抖音连打三枪 */
	let inboxTask = null

	const readInboxCache = () => {
		const j = readJsonSafe(INBOX_CACHE, null,
			(v) => Boolean(v && typeof v === 'object' && v.at && v.data))
		return j || null
	}
	const startInboxRefresh = (lim) => {
		if (inboxTask) return inboxTask
		inboxTask = (async () => {
			try {
				const r = await run(['inbox', '--limit', String(lim)], { timeout: 240000 })
				// 失败**不覆盖**上一份好的缓存：一份 2 分钟前的真实列表，
				// 比一份「刷新失败后的空结果」有用得多。
				if (r && r.ok) {
					atomicWriteJson(INBOX_CACHE, { at: new Date().toISOString(), limit: lim, data: r })
				}
				return r
			} finally {
				inboxTask = null
			}
		})()
		return inboxTask
	}
	/* ── 候选库：同一时刻只跑一轮，跑完写盘 ──────────────────────────────
	 * 为什么放后台：一轮要真浏览器 + 几轮刷，十几秒到几分钟。请求里等它 = 面板卡住。
	 * 和 /inbox 的一条规矩：**慢的东西不许在请求路径上 await**。 */
	/* ── 口味画像：每次刷完重算一遍 ──────────────────────────────────────
	 * 纯读本地记录（发布日志 / 回评账本 / 候选库），几百条，几十毫秒，不起浏览器。
	 * 样本不够（< 20 条）时 buildTaste 会返回空结构 —— 那就退回"只讲关键词"，
	 * 不许拿三五条数据编出一个口味来。 */
	const tasteNow = async () => {
		try {
			const { buildTaste, toContext } = await import('./lib/taste.mjs')
			const { recent } = await import('./lib/publishes.mjs')
			const { readLedger } = await import('./lib/ledger.mjs')
			const picksLib = await import('./lib/picks.mjs')
			const t = buildTaste({
				publishes: recent(50).rows,
				ledger: (readLedger().replies || []),
				picks: picksLib.load().items || [],
			})
			return { ...toContext(t), evidence: t.evidence }
		} catch {
			return { authors: [], tags: [], evidence: 0 }
		}
	}
	/* 「看到好看的，叫一下主人」。两个出口分开数（sharePerDay / atPerDay）：
	 *   私信：先发分享卡片，再补一句「为什么想给你看」
	 *   评论区：在那条视频下 @ 主人
	 * 0 = 那条路不走。计数落 notify-state.json，跨天清零。没配主人昵称就跳过。 */
	const tellOwner = async (cand, st) => {
		if (!Array.isArray(cand) || !cand.length) return { ok: true, sent: false, why: '这轮没有候选' }
		if (!st.ownerNick) return { ok: true, sent: false, why: '没填主人昵称，不敢乱叫' }
		const { isQuiet } = await import('./lib/toast.mjs')
		const { dayKey } = await import('./lib/schedule.mjs')
		const hhmm = (v) => {
			const m = String(v || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/)
			return m ? Number(m[1]) + Number(m[2]) / 60 : undefined
		}
		/* 计价文件必须跟其它状态放一处：budget / ledger / queue 全都认 DSH_HOME，
		 * 只有这里硬编码 homedir() 的话，装进 profile 或临时 HOME 跑测试就会写错地方。 */
		const { homeDir: budgetHome } = await import('./lib/budget.mjs')
		const file = join(budgetHome(), 'notify-state.json')
		const prev = readJsonSafe(file, { day: '', share: 0, at: 0 }) || { day: '', share: 0, at: 0 }
		const today = dayKey(new Date())
		const used = prev.day === today
			? { day: today, share: Number(prev.share) || 0, at: Number(prev.at) || 0 }
			: { day: today, share: 0, at: 0 }
		if (st.notifyQuiet && isQuiet(new Date(), { from: hhmm(st.quietFrom), to: hhmm(st.quietTo) })) {
			return { ok: true, sent: false, why: '静音时段，先不吵你' }
		}
		/* 今天已经「叫过」的那条别再叫。
		 * 分数最高的候选会在一天里的**每一轮**都排第一，不记一笔的话，
		 * 同一条视频能一天发你两次、@ 你两次 —— 和 11-04 那晚连发 13 条私信是同一个病：
		 * 发完没落账，下一轮又以为「还没发」。 */
		const already = prev.day === today && Array.isArray(prev.sent) ? prev.sent.map(String) : []
		const fresh = cand.filter((c) => !already.includes(String(c.aweme_id)))
		if (!fresh.length) return { ok: true, sent: false, why: '这轮候选今天都给你发过了' }
		const top = [...fresh].sort((a, b) => (b.score || 0) - (a.score || 0))[0]
		/* 还有额度的那条路才走；私信优先（更直接），私信满了才轮到评论区。 */
		const shareLeft = Math.max(0, Number(st.sharePerDay) || 0) - used.share
		const atLeft = Math.max(0, Number(st.atPerDay) || 0) - used.at
		/* 2026-11-11：以前这里写死「私信优先」，而私信额度 2、每天只扫 2 轮，
		 * shareLeft 永远 > 0 → @ 一次都发不出去（notify-state 的 at 长期为 0）。
		 * 现在抽到 lib/tier.mjs：每天第一轮先 @，之后才走私信。 */
		const { pickTier } = await import('./lib/tier.mjs')
		const tier = pickTier({ shareLeft, atLeft, usedAt: used.at })
		if (!tier) return { ok: true, sent: false, why: '今天的「叫我」额度用完了' }
		const desc = String(top.desc || '').replace(/\s+/g, ' ').slice(0, 60)
		/* 主人的 sec_uid：settings 里叫 `ownerSecUid`，这里以前读的是 `ownerSec` ——
		 * 字段名对不上，于是它永远是空串：分享卡片不带 --sec，私信只按昵称找人，
		 * 而昵称在会话列表里一旦滚出首屏就是「会话没打开（等不到输入框）」。
		 * 11-09 之后那几次「私发好像没有」，一半是这个。两个都认，谁有值用谁。 */
		const ownerSec = String(st.ownerSecUid || st.ownerSec || '').trim()
		let r = null
		let say = ''
		let sayError = ''
		if (tier === 'dm') {
			r = await run(['share', '--aweme', top.aweme_id, '--to', st.ownerNick,
				...(ownerSec ? ['--sec', ownerSec] : [])], { timeout: 180000 })
			/* 光甩个卡片太干。补一句它自己看完想说的话 —— 用主人配的人设，20 字以内。 */
			if (r && r.ok) {
				try {
					const { generate } = await import('./lib/duty.mjs')
					const { personaLine } = await import('./lib/settings.mjs')
					const { textOfResult } = await import('./lib/text-guard.mjs')
					const g = await generate([personaLine(st), '你在刷抖音，看到这条想分享给主人。',
						'视频文案：' + (desc || '（没有文案）'),
						'只写一句你为什么想给他看，20 字以内，别用问号收尾。'].join('\n'), { timeout: 45000 })
					/* generate() 回的是 `{ok, text}`。以前这里 `String(await generate(...))`，
					 * 整个对象被 String() 成 `[object Object]` —— 2026-11-07T12:59:45Z 那条私信
					 * 就是它。现在按字段取（text/say/content/reply），取不到给空串走下面的兜底。 */
					say = textOfResult(g).replace(/\s+/g, ' ').trim().slice(0, 40)
				} catch { say = '' }
				/* 生成失败也要有一句话。以前这里是 `if (say)`：模型一抖，就只甩一张卡片过去，
				 * 收件人只看见一个视频，不知道你想说什么 —— 这就是「发视频不发消息」。
				 * 兜底不是瞎编：它就是这条的标题剪短，信息量够、也不会装成人说的话。 */
				if (!say) say = '这条想给你看看：' + (desc.slice(0, 24) || '刚刷到的')
				const dr = await run(['dm', '--to', ownerSec || st.ownerNick, '--text', say], { timeout: 180000 })
				/* 带话没发出去 = 卡片旁边没字，等于白说。
				 * 以前这里只 `say = ''`，失败原因随着变量一起消失 —— 用户只看到"视频没带字"，
				 * 系统里查不出为什么。现在：① 只在**确认没发出去**的错上换目标重试一次；
				 * ② 原因写进 notify-state，面板和自检都看得到。 */
				if (!(dr && dr.ok)) {
					sayError = String((dr && (dr.error || dr.why)) || '未知原因')
					const preSend = /没打开|没有「|找不到|反查不到|正文是空/.test(sayError)
					const alt = ownerSec ? st.ownerNick : ownerSec
					if (preSend && alt) {
						const dr2 = await run(['dm', '--to', alt, '--text', say], { timeout: 180000 })
						if (dr2 && dr2.ok) { sayError = '' } else { sayError += ' / 换目标也失败：' + String((dr2 && (dr2.error || dr2.why)) || '未知') }
					}
					if (sayError) say = ''
				}
			}
		} else {
			/* 🔴 这里以前只传了 --uid，缺 --to（昵称）和 --sec，而 comment-at 三个都要，
			 * 于是每一次都在参数校验那一步 die 掉了 —— 评论区 @ 从来没真正发出去过。 */
			const atNick = String(st.ownerNick || '').trim()
			const atUid = String(st.ownerUid || '').trim()
			const atSec = String(ownerSec).trim()
			if (!atNick || !atUid || !atSec) {
				return {
					ok: false, sent: false, tier: 'at',
					why: '@ 到评论区需要「昵称 + 数字 uid + sec_uid」三样都填（现在缺 ' +
						[!atNick ? '昵称' : '', !atUid ? 'uid' : '', !atSec ? 'sec_uid' : ''].filter(Boolean).join('、') + '）',
				}
			}
			/* @ 的那句话以前是写死的「这条我觉得你会喜欢：…」—— 一条模板，天天同一句，
			 * 用户一眼看出是机器。现在让她自己写；模型抖了才退回模板（模板不会崩，只是不好听）。 */
			let atText = ''
			try {
				const { generate } = await import('./lib/duty.mjs')
				const { personaLine } = await import('./lib/settings.mjs')
				const { textOfResult } = await import('./lib/text-guard.mjs')
				const g = await generate([
					'你在抖音刷到这条，想 @ 主人来看。',
					'视频文案：' + (desc || '（没有文案）'),
					'写一句给他看的话：说清为什么想让他看，别用问号收尾，别提 AI，别用「快来看」这种吆喝。',
					'不要自己写 @ 昵称 —— 系统会在最前面加 @，你只写后面那半句。',
				].join('\n'), { system: personaLine(st), timeout: 45000, maxTokens: 90 })
				/* 她偶尔还是会把「@辰辰」自己写上，而 comment-at 会自动加一次 → 变成「@辰辰 @辰辰 …」。
				 * 这里统一剥掉开头那个 @，兜住。 */
				atText = textOfResult(g).replace(/^\s*@\S+\s*/, '').replace(/\s+/g, ' ').trim().slice(0, 60)
			} catch { atText = '' }
			if (!atText) atText = '这条我觉得你会喜欢：' + (desc.slice(0, 24) || '刷到的一个')
			say = atText
			r = await run(['comment-at', '--aweme', top.aweme_id, '--to', atNick, '--uid', atUid, '--sec', atSec,
				'--text', atText], { timeout: 180000 })
		}
		const sent = Boolean(r && r.ok)
		/* 「发出去了」和「他真的收到了」不是一回事：
		 * 分享卡片成功、跟着的那句话失败时，收件人只看见一个视频，不知道你想说什么。
		 * 以前账上照样 ok:true —— 2026-11-10 那条 `ok:true stage dm error:"会话列表里没有「辰辰辰chen」"`
		 * 就是这么来的，用户看到的是「私发好像没有」，系统里全绿。
		 * 现在：卡片发了但话没跟上，记 `dm-card-only`，并且 ok:false。 */
		const delivered = sent && !(tier === 'dm' && sayError)
		const stage = delivered ? tier : (sent ? 'dm-card-only' : tier)
		/* 顶层动作账：CLI 自己会记一条，但"分享卡片 + 补一句话"是一个组合动作，
		 * 只有这里知道它整体成没成、补的话有没有发出去。 */
		try {
			const { logRun } = await import('./lib/runlog.mjs')
			logRun({ kind: 'tellOwner', target: top.aweme_id, ok: delivered, stage, error: sayError || String((r && r.error) || '') })
		} catch { /* 记账失败不影响主流程 */ }
		if (sent) {
			const next = { day: today, share: used.share + (tier === 'dm' ? 1 : 0), at: used.at + (tier === 'at' ? 1 : 0), say, sayError,
				aweme: top.aweme_id, tier, notifiedAt: new Date().toISOString(),
				/* 落账：今天发过哪几条。少了这一行，下一轮又挑同一条（分最高的那条永远是它）。 */
				sent: [...already, String(top.aweme_id)].slice(-20) }
			atomicWriteJson(file, next)
		}
		return { ok: delivered, sent, tier: stage, aweme: top.aweme_id, say,
			why: delivered ? '' : (sayError || ((r && (r.error || r.stage)) || '发失败了')) }
	}

	let picksTask = null
	const startPicksCollect = (mark = () => {}) => {
		if (picksTask) return picksTask
		picksTask = (async () => {
			try {
				const st = readSettings()
				const csv = (s) => String(s || '').split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean)
				/* 「每轮看几个」是用户视角的数字；feed 内部自己按条数反推翻几页，
				 * 用户不用再理解 count / rounds 两层参数。每条之间歇 scanGap 秒。 */
				const n = Math.min(Math.max(Number(st.scanPerRound) || 20, 1), 50)
				/* 每轮之间不用同一个秒数：固定 6 秒滚一整晚，比随机更像脚本。 */
				const gap = Math.max(0, Math.round((Number(st.scanGap) || 0) * (0.7 + Math.random() * 0.6)))
				/* 选题也能走搜索：feed 是算法给的，search 是关键词找的。
				 * 默认还是 feed —— 换模式只影响「这一轮去哪找」，后面挑/打分/入库是同一套。 */
				const kws = csv(st.scanKeywords)
				let r = null
				if (st.scanMode === 'search' && kws.length) {
					const kw = kws[Math.floor(Math.random() * kws.length)]
					/* 先试「页面内直连搜索」：一次 10 条 1.4–1.8 秒（实测 1793/1456/1402 ms），
					 * feed 滚 20 条要 26–63 秒。接口抖动、未登录、结构变了，一律退回 CLI，
					 * 保证「慢但能跑」永远在。 */
					let sr = null
					if (st.scanApi !== false) {
						try {
							const { searchFast } = await import('./lib/feedapi.mjs')
							sr = await searchFast({ keyword: kw, count: Math.min(n, 20), pages: n > 20 ? 2 : 1 })
						} catch (e) { sr = { ok: false, error: 'api: ' + String((e && e.message) || e).slice(0, 80) } }
					}
					let apiError = sr && !sr.ok ? String(sr.error || 'api 没给结果') : ''
					if (!sr || !sr.ok) {
						const cr = await run(['search', '--kw', kw, '--count', String(n)], { timeout: 120000 })
						if (cr && cr.ok) { sr = cr; apiError = apiError ? 'api 失败后转 CLI（' + apiError + '）' : '' }
						else if (apiError) sr = { ...(cr || {}), error: apiError + ' / cli: ' + String((cr && cr.error) || '没结果') }
						else sr = cr
					}
					/* search 回的是 list，feed 是 items：统一成 items 再进 picks。 */
					if (sr && sr.ok) r = { ...sr, source: 'search', keyword: kw, items: sr.items || sr.list || [], apiError }
					else r = { ...(sr || {}), stage: 'search', apiError }
				} else {
					r = await run(['feed',
						'--count', String(n),
						'--gap', String(gap),
						'--limit', String(n),
						'--mark-seen',
					], { timeout: 300000 })
				}
				/* 阶段计时（0.4.5）：feed 这一跳把「浏览器 + 滚动 + 网络」都包在一起了，
				 * 先量出来是哪一段贵；要再细分得动 CLI 内部，那是下一步的事。 */
				mark('feed')
				/* 失败也要是「对象」。以前直接 `return r`：r 可能是 null（CLI 只回 null /
				 * 解析失败），调用方 `r.ok` 就把 TypeError 抛出去，真实原因全丢。
				 * 现在把 error + stderr 尾巴一起带上去，rounds.jsonl / jobs 里能看到人话。 */
				if (!r || !r.ok) {
					const err = String((r && (r.error || r.stage)) || '没拿到结果')
					const tail = String((r && r.stderr) || '').replace(/\s+/g, ' ').trim().slice(-200)
					return { ok: false, stage: 'feed', error: tail ? err + ' | stderr: ' + tail : err }
				}
				const { toCandidate, judge, mergeItems, load, save } = await import('./lib/picks.mjs')
				const taste = await tasteNow()
				const ctx = {
					keywords: csv(st.keywords), blockKeywords: csv(st.blockKeywords),
					minSec: st.minSec, maxSec: st.maxSec, minDigg: st.minDigg,
					/* 作者 / 话题的重合度来自口味画像；样本不够时这两个是空数组，
					 * judge 就只讲"命中关键词"——宁可说得少，也不假装认识你。 */
					authors: taste.authors, tags: taste.tags,
				}
				const cand = []
				for (const it of r.items || []) {
					const c = toCandidate(it, String(r.source || ''))
					const j = judge(c, ctx)
					if (!j.ok) continue
					cand.push({ ...c, score: j.score, why: j.why })
				}
				mark('judge')
				save(mergeItems(load().items, cand))
				mark('save')
				/* 刷完一轮，挑最好的那条「叫一下主人」——分享卡片 或 评论区 @。
				 * 叫不叫、叫几次、用哪一档，全看设置里的通知预算；不许绕过它。 */
				let told = null
				try { told = await tellOwner(cand, st) } catch { /* 叫不动也不影响入库 */ }
				return { ok: true, picked: cand.length, fetched: r.fetched, told }
			} finally {
				picksTask = null
			}
		})()
		return picksTask
	}

	const readJsonFile = async (p, dflt) => {

		try {
			const { readFileSync } = await import('node:fs')
			return JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
		} catch { return dflt }
	}

	/* 调度的唯一读数口：面板、CLI、scanTick 都用 lib/dashboard.mjs 的同一份。
	 * 只读，不触发任何动作；收件箱用内存缓存，绝不为了一个数字去刷抖音。 */
	const scheduleSnapshot = (now = Date.now()) => {
		const cache = readInboxCache()
		return readSnapshot(now, (cache && cache.data) || null)
	}

	if (ctx.webServer && typeof ctx.webServer.register === 'function') {
		ctx.effect(() => ctx.webServer.register({
			kind: 'prefix',
			path: '/api/douyin-studio',
			handler: async (req, res) => {
				try {
					const url = new URL(req.url || '/', 'http://127.0.0.1')
					const p = url.pathname.replace(/^\/api\/douyin-studio/, '') || '/'
					/* 跨站请求先挡掉：这套接口没有 token，靠的是「只有本机页面会调」。
					 * 但浏览器里任何一个网页都能往 127.0.0.1 发 POST —— 而这里有
					 * /dm/send、/queue/retry、/duty，都是真会动手的。见 lib/guard.mjs。 */
					const guard = checkOrigin(req.headers)
					if (!guard.ok) {
						return sendJson(res, 403, {
							ok: false, stage: 'guard',
							error: '拒绝跨站请求：' + guard.why,
							hint: '如果你是故意从别的地方调，设 DOUYIN_STUDIO_ALLOW_ORIGIN 放行',
						})
					}
					if (req.method === 'GET' && p === '/config') {
						/* 2026-11-01：这里必须回**普通值**，不能回 `cfg.xxx` 本身（那是响应式包装，序列化成 `{}`）。 */
						return sendJson(res, 200, { ok: true, ...S })
					}
					if (req.method === 'GET' && p === '/status') {
						const st = await run(['status'], { timeout: 90000 })
						/* 顺手把机器人自己的 uid 记下来：自检要用它判「有没有回错到自己」。
						 * 只写 self.json，不碰 autopilot-state（那个文件归 autopilot 整份读改写）。 */
						try {
							await import('./lib/selfid.mjs').then((m) => m.remember(st))
						} catch {
							/* 记不住不影响面板读数 */
						}
						return sendJson(res, 200, st)
					}
					if (req.method === 'GET' && p === '/doctor') return sendJson(res, 200, await run(['doctor'], { timeout: 120000 }))
					if (req.method === 'GET' && p === '/snapshots') return sendJson(res, 200, await run(['snapshot', 'list'], { timeout: 60000 }))

					/* 调度读数 + 暂停开关。只影响「刷视频」这个只读动作，不碰发送。 */
					if (req.method === 'GET' && p === '/schedule') return sendJson(res, 200, scheduleSnapshot())
					if (req.method === 'POST' && p === '/schedule/pause') {
						const body = await readBody(req)
						ROUNDS.setPaused(Boolean(body && body.paused))
						return sendJson(res, 200, scheduleSnapshot())
					}
					/* 总闸：面板这一下、工具那一层、CLI 那一条，读写的都是同一个 KILL 文件。 */
					if (req.method === 'GET' && p === '/kill') {
						return sendJson(res, 200, { ok: true, killed: isKilled(), info: killInfo(), file: killFile() })
					}
					if (req.method === 'POST' && p === '/kill') {
						const body = await readBody(req)
						setKill(Boolean(body && body.on), String((body && body.reason) || ''))
						return sendJson(res, 200, { ok: true, killed: isKilled(), info: killInfo(), file: killFile() })
					}
					/* 值班日志：把动作账里跟「回/发/跳」有关的行给面板，不暴露全量。 */
					if (req.method === 'GET' && p === '/runs') {
						const n = Math.max(1, Math.min(60, Number(url.searchParams.get('limit') || 20)))
						const { readRuns } = await import('./lib/runlog.mjs')
						return sendJson(res, 200, {
							ok: true,
							items: readRuns(n).reverse().map((r) => ({
								at: r.at, kind: r.kind, target: String(r.target || '').slice(0, 40),
								ok: Boolean(r.ok), stage: r.stage || '', error: String(r.error || '').slice(0, 120),
							})),
						})
					}

					/* ── 面板要用的几条（2026-11-01 加）：全部只读 + 一条需要 confirm 的发送 ── */
					if (req.method === 'GET' && p === '/dm') {
						const lim = Math.max(1, Math.min(20, Number(url.searchParams.get('limit') || 8)))
						const { conversations } = await import('./lib/im.mjs')
						const { nameOf } = await import('./lib/names.mjs')
						const { decorate } = await import('./lib/unread.mjs')
						const r = await conversations({ limit: lim })
						const list = (r.conversations || []).map((c) => {
							const ms = Array.isArray(c.messages) ? c.messages : []
							const last = ms[ms.length - 1] || {}
							return {
								peer_uid: c.peer_uid || '',
								nick: nameOf(c.peer_uid),
								conv_id: c.conv_id || '',
								count: c.count || ms.length,
								last_at: last.at || c.last_at || '',
								from: last.from || '',
								kind: last.kind || '',
								preview: String(last.text || '').replace(/\s+/g, ' ').slice(0, 42),
							}
						})
						const dec = decorate(list)
						return sendJson(res, 200, { ok: true, me_uid: r.my_uid || '', list: dec.list, unread: dec.unread })
					}
					/* 面板点开某个会话 = 看过了。不记这一步，红点永远灭不掉。 */
					if (req.method === 'POST' && p === '/dm/mark-read') {
						const body = await readBody(req)
						const { markRead } = await import('./lib/unread.mjs')
						return sendJson(res, 200, markRead(body.uid, body.at))
					}
					if (req.method === 'GET' && p === '/dm/read') {
						const sec = String(url.searchParams.get('sec') || '').trim()
						const uid = String(url.searchParams.get('uid') || '').trim()
						if (!sec && !uid) return sendJson(res, 400, { ok: false, error: '要给 sec_uid 或 uid' })
						const { read } = await import('./lib/im.mjs')
						const r = await read({ secUid: sec, uid, limit: 15 })
						const msgs = (r.messages || []).slice(-15).map((m) => ({
							at: m.at || '',
							from: m.from || '',
							kind: m.kind || '',
							text: String(m.text || '').replace(/\s+/g, ' ').slice(0, 160),
						}))
						return sendJson(res, 200, { ok: r.ok !== false, nick: r.nick || '', messages: msgs, error: r.error })
					}
					if (req.method === 'POST' && p === '/dm/send') {
						const body = await readBody(req)
						const text = String(body.text || '').trim()
						const sec = String(body.sec_uid || '').trim()
						const uid = String(body.uid || '').trim()
						let nick = String(body.nick || '').trim()
						if (!text) return sendJson(res, 400, { ok: false, error: '正文是空的' })
						if (!nick && !sec && !uid) return sendJson(res, 400, { ok: false, error: '要给昵称 / sec_uid / uid' })
						/* 面板只给了数字 uid 时，先用接口把昵称反查出来 —— 发私信那一步是按昵称认行的 */
						if (!nick) {
							const { read } = await import('./lib/im.mjs')
							const r0 = await read({ secUid: sec, uid, limit: 1 })
							nick = String(r0.nick || '').trim()
							if (!nick) return sendJson(res, 200, { ok: false, error: '反查不到昵称', detail: r0.error })
						}
						/* 🔴 双确认：面板上点一次 = 打出草稿；点第二次（confirm:true）才真发。
						 *    撤不回来的事，不许一次点击就做完。 */
						if (body.confirm !== true) {
							return sendJson(res, 200, { ok: false, needsConfirm: true, draft: text, nick })
						}
						/* 消息预算：面板也得走同一道闸，不能因为「是人在点」就绕过 */
						const budgetMod = await import('./lib/budget.mjs')
						const bq = budgetMod.check({ ch: 'dm', peer: uid || nick, text })
						if (!bq.ok) return sendJson(res, 200, { ok: false, stage: 'budget', error: bq.why, budget: bq.quota.messages })
						const { sendByUi } = await import('./lib/im-send.mjs')
						const r = await sendByUi({ nick, secUid: sec, text, dry: body.dry === true })
						if (r && r.ok && body.dry !== true) budgetMod.record({ ch: 'dm', peer: uid || nick, note: 'dm panel' })
						return sendJson(res, 200, r)
					}

					/* ── 2026-11-02：收件箱 / 预算 / 刷视频 / 自己评论区 ───────────── */
					if (req.method === 'GET' && p === '/inbox') {
						const lim = Math.max(1, Math.min(20, Number(url.searchParams.get('limit') || 8)))
						/* 秒开：有缓存就立刻给，后台补；没有才等。判定在 lib/cache.mjs。 */
						const out = await serveInbox({
							lim,
							force: url.searchParams.get('fresh') === '1',
							cache: readInboxCache(),
							busy: Boolean(inboxTask),
							refresh: startInboxRefresh,
							ttl: INBOX_TTL,
						})
						return sendJson(res, 200, { ...out.body, kill: { on: isKilled(), info: killInfo() } })
					}
					/* 只要一个数字（tab 角标）—— 读缓存，**绝不触发刷新**。
					 * 角标不值得为它跑一轮浏览器：打开设置页不是「我要看私信」。 */
					if (req.method === 'GET' && p === '/inbox/count') {
						const c = readInboxCache()
						const d = (c && c.data) || null
						const k = (x) => Number((d && d.counts && d.counts[x]) || 0)
						return sendJson(res, 200, {
							ok: true, cached: Boolean(c), at: (c && c.at) || '',
							reply: d ? k('dm') + k('at') + k('own') : 0,
						})
					}
					if (req.method === 'GET' && p === '/budget') {
						const { stats: bStats, recent: bRecent } = await import('./lib/budget.mjs')
						const { LIMITS: bLed, stats: lStats } = await import('./lib/ledger.mjs')
						/* 带上评论那层的细账：面板要能看见「同一视频每时段 ≤5」这类约束，
						 * 否则用户以为只有总闸一条线。 */
						return sendJson(res, 200, { ok: true, ...bStats(), recent: bRecent(8), ledger: { limits: bLed, today: lStats() } })
					}
					if (req.method === 'POST' && p === '/feed') {
						const body = await readBody(req)
						/* 前端不再带参数了（面板上只有一处能改，就是「设置 → 刷视频」）。
						 * 但 CLI 和老调用还照旧传参数 —— 传了就用传的，没传才回落到设置。 */
						const st = readSettings()
						const num = (v, d) => (v == null || String(v).trim() === '' ? d : Number(v) || 0)
						const pick = (v, d) => (v == null || String(v).trim() === '' ? d : String(v))
						const args = ['feed',
							'--count', String(Math.min(num(body.count, st.scanPerRound || 20), 50)),
							'--gap', String(num(body.gap, st.scanGap || 0)),
							'--limit', String(Math.min(num(body.limit, 12), 50))]
						const minSec = num(body.minSec, st.minSec)
						const maxSec = num(body.maxSec, st.maxSec)
						const allow = pick(body.allow, st.keywords)
						const block = pick(body.block, st.blockKeywords)
						if (minSec > 0) args.push('--min-sec', String(minSec))
						if (maxSec > 0) args.push('--max-sec', String(maxSec))
						if (allow) args.push('--allow', String(allow))
						if (block) args.push('--block', String(block))
						if (body.markSeen) args.push('--mark-seen')
						const r = await run(args, { timeout: 300000 })
						return sendJson(res, 200, r)
					}

					/* ── 候选库「挑」：刷完的东西留下来，才有得挑 ──────────────────
					 * 和 /inbox 一样是「先给缓存再后台补」：collect 立刻回，前端轮询。
					 * 判分逻辑全在 lib/picks.mjs（纯函数，21 例测试），这里只组装 ctx。 */
					if (req.method === 'GET' && p === '/picks') {
						const { load, rank, stats } = await import('./lib/picks.mjs')
						const all = load()
						return sendJson(res, 200, {
							ok: true,
							items: rank(all.items).slice(0, 30),
							stats: stats(all.items),
							updatedAt: all.updatedAt,
							refreshing: Boolean(picksTask),
						})
					}
					if (req.method === 'POST' && p === '/picks/collect') {
						const started = !picksTask
						startPicksCollect()
						return sendJson(res, 200, { ok: true, started, refreshing: true })
					}
					if (req.method === 'POST' && p === '/picks/act') {
						const body = await readBody(req)
						const id = String(body.id || '').trim()
						const act = String(body.act || '').trim()
						if (!id) return sendJson(res, 400, { ok: false, error: '要给 id' })
						const mod = await import('./lib/picks.mjs')
						const items = mod.load().items
						const one = items.find((x) => String(x.aweme_id) === id)
						if (!one) return sendJson(res, 404, { ok: false, error: '候选库没这条（可能已被淘汰）' })
						/* 本地状态：看过了 / 不想看。都不出门，不用确认。 */
						if (act === 'seen' || act === 'dismissed') {
							mod.save(mod.setState(items, id, act))
							return sendJson(res, 200, { ok: true, id, state: act })
						}
						/* 发我 = 把视频卡片分享到你自己的会话里。**撤不回来**，所以双确认，
						 * 和 /dm/send 同一个标准；也走同一个 dm 额度池。 */
						if (act === 'sent') {
							/* 已经发过的别再发第二遍：列表里它还留着（方便你回看），
							 * 但按钮再点一次就是一条重复私信，白烧额度。 */
							if (one.state === 'sent') {
								return sendJson(res, 200, { ok: false, stage: 'state', error: '这条已经发给你了' })
							}
							const nick = String(readSettings().ownerNick || '').trim()
							if (!nick) return sendJson(res, 200, { ok: false, stage: 'settings', error: '还没填主人昵称（设置 › 主人）' })
							if (body.confirm !== true) {
								return sendJson(res, 200, { ok: false, needsConfirm: true, nick, title: one.desc, hint: '再点一次就发到你的私信里' })
							}
							const budgetMod = await import('./lib/budget.mjs')
							const bq = budgetMod.check({ ch: 'dm', peer: nick, text: one.desc.slice(0, 60) })
							if (!bq.ok) return sendJson(res, 200, { ok: false, stage: 'budget', error: bq.why, budget: bq.quota.messages })
							const { share } = await import('./lib/share.mjs')
							const r = await share({ awemeId: one.aweme_id, nick })
							if (r && r.ok) {
								mod.save(mod.setState(mod.load().items, id, 'sent'))
								budgetMod.record({ ch: 'dm', peer: nick, note: 'picks send' })
							}
							return sendJson(res, 200, r)
						}
						return sendJson(res, 400, { ok: false, error: 'act 只认 seen / dismissed / sent' })
					}
					/* 在自己作品下发顶层评论：双确认，和私信一个标准 */
					if (req.method === 'POST' && p === '/comment-self') {
						const body = await readBody(req)
						const aweme = String(body.aweme || '').trim()
						const text = String(body.text || '').trim()
						if (!aweme || !text) return sendJson(res, 400, { ok: false, error: '要给 aweme 和 text' })
						if (body.confirm !== true) return sendJson(res, 200, { ok: false, needsConfirm: true, draft: text, aweme })
						const r = await run(['comment-self', '--aweme', aweme, '--text', text], { timeout: 180000 })
						return sendJson(res, 200, r)
					}

					/* ── 设置：面板写、CLI 读（经 env()） ─────────────────────────── */
					if (req.method === 'GET' && p === '/settings') {
						return sendJson(res, 200, { ok: true, settings: readSettings(), defaults: DEFAULTS, patch: true })
					}
					if (req.method === 'POST' && p === '/settings') {
						const body = await readBody(req)
						/* patch = 单字段改完立刻存（面板失焦自动保存）；没有 patch 才是整份覆盖。
						 * 不合并的话，patch 会被 normalize 补成默认值，把别的设置一起清掉。 */
						const full = body && body.patch
							? { ...readSettings(), ...body.patch }
							: (body && body.settings ? body.settings : body)
						const r = writeSettings(full)
						/* 存完就按新值把定时器重开一遍 —— 这样面板改时长/间隔，不用重启 DSH。
						 * 关着的（值班没启动过）不硬拉起来，免得改了个数字把机器人唤醒了。 */
						let daily = null
						if (r.ok) {
							syncBudget()
							const n = readSettings()
							try {
								const ds = DUTY.status()
								if (ds && ds.running) {
									DUTY.start({ everyMin: n.dutyEveryMin || S.dutyEveryMin, autoReply: n.autoComment || S.dutyAutoReply, maxPerRun: 2 })
								}
							} catch { /* 值班重开失败不该让保存失败 */ }
							try {
								const ws = WATCH.status()
								if (ws && ws.running) WATCH.start({ everySec: n.watchEverySec || S.watchEverySec, quiet: true, startDelaySec: 0, onFresh: replyDmNow })
							} catch { /* 同上 */ }
							AUTOPILOT.configure({ runCli: run })
							/* reportAt 改了要立刻重排定点任务（0.4.7）——
							 * 不然「22:30 → 00:30」这种改动得重启宿主才算数。
							 * 自动巡航没在跑时 rearm 返回 running:false，不会把机器人弄醒。 */
							try { daily = AUTOPILOT.rearm().daily } catch { /* 排不上不影响保存 */ }
						}
						return sendJson(res, r.ok ? 200 : 500, { ...r, live: r.ok, daily, hint: r.ok ? '已保存，定时器按新值重开了' : '' })
					}

					/* ── 主人身份校验：面板上那颗红绿灯 ─────────────────────────
					 * 只读：拉一遍会话 + 必要时抄一遍昵称表，不发任何消息。
					 * 绿灯才算「认到了这个号」，红灯要带理由（没填 / 没聊过 / 重名 / 号是机器人自己）。 */
					if (req.method === 'POST' && p === '/owner/verify') {
						const body = await readBody(req)
						const st = readSettings()
						const nick = String((body && body.nick) != null ? body.nick : st.ownerNick || '').trim()
						const uid = String((body && body.uid) != null ? body.uid : st.ownerUid || '').trim()
						try {
							const r = await OWNER.verify({ nick, uid })
							return sendJson(res, 200, { ok: true, ...r })
						} catch (e) {
							return sendJson(res, 200, { ok: false, level: 'red', why: '查的时候出错了：' + String((e && e.message) || e) })
						}
					}

					/* ── 在「机器人的浏览器」里打开（不是系统默认浏览器） ─────────
					 * 用户点视频时，系统浏览器是用**他自己的账号**登录的；这里要求用插件
					 * 托管的那个 Chrome（登录的是机器人号），所以走 CDP 开新标签。 */
					if (req.method === 'POST' && p === '/open') {
						const body = await readBody(req)
						const link = String(body.url || '').trim()
						let host = ''
						try { host = new URL(link).hostname.toLowerCase() } catch { /* 下面判空 */ }
						// 只允许抖音域：这是个通用"开个网页"的口子，不设白名单等于开了浏览器代理
						if (!/(^|\.)douyin\.com$/.test(host)) {
							return sendJson(res, 400, { ok: false, error: '只允许打开 douyin.com 的链接' })
						}
						try {
							const { newTab } = await import('./lib/cdp.mjs')
							const tab = await newTab(link)
							return sendJson(res, 200, { ok: true, opened: link, tab: tab && (tab.id || tab) })
						} catch (e) {
							return sendJson(res, 200, {
								ok: false, category: 'CDP', error: '打不开机器人浏览器：' + String((e && e.message) || e),
								hint: '先确认那台 Chrome 起着（面板顶部「诊断」里有调试端口）',
							})
						}
					}

					/* ── 把一条视频当卡片分享给某个人（走 share，双确认） ─────────── */
					if (req.method === 'POST' && p === '/share') {
						const body = await readBody(req)
						const aweme = String(body.aweme || '').trim()
						const to = String(body.to || '').trim()
						if (!aweme || !to) return sendJson(res, 400, { ok: false, error: '要给 aweme 和 to（昵称）' })
						if (body.confirm !== true) {
							return sendJson(res, 200, { ok: false, needsConfirm: true, draft: { aweme, to } })
						}
						const args = ['share', '--aweme', aweme, '--to', to]
						if (body.sec) args.push('--sec', String(body.sec))
						if (body.dry === true) args.push('--dry')
						const r = await run(args, { timeout: 300000 })
						return sendJson(res, 200, r)
					}

					/* ── 发布（默认只存草稿；真发要显式 publish:true + confirm） ──── */
					if (req.method === 'POST' && p === '/publish') {
						const body = await readBody(req)
						const title = String(body.title || '').trim()
						const file = String(body.file || '').trim()
						const kind = body.kind === 'video' ? 'video' : 'image'
						if (!title || !file) return sendJson(res, 400, { ok: false, error: '要给 title 和 file（绝对路径）' })
						const who = ['public', 'friend', 'private'].includes(body.who) ? body.who : 'private'
						const asDraft = body.publish !== true
						if (body.confirm !== true) {
							return sendJson(res, 200, {
								ok: false, needsConfirm: true,
								draft: { kind, title, file, who, 存草稿: asDraft },
								hint: asDraft ? '再点一次会存成草稿（不发出去）' : '再点一次会**真的发布**',
							})
						}
						const args = ['publish', kind === 'video' ? '--video' : '--img', file, '--title', title, '--who', who]
						if (body.desc) args.push('--desc', String(body.desc))
						if (body.declare === 'ai') args.push('--declare', 'ai')
						args.push(asDraft ? '--draft' : '--publish')
						if (body.at) args.push('--at', String(body.at))
						const r = await run(args, { timeout: 600000 })
						return sendJson(res, 200, r)
					}
					/* 回评论（顶层或楼中楼）：两道闸都在 CLI 里，这里只做「双确认」。
					 * 面板点「回」第一下 → needsConfirm；再点一下带 confirm:true 才真发。 */
					if (req.method === 'POST' && p === '/reply') {
						const body = await readBody(req)
						const aweme = String(body.aweme || '').trim()
						const cid = String(body.cid || '').trim()
						const root = String(body.root || '').trim()
						const author = String(body.author || '').trim()
						const text = String(body.text || '').trim()
						if (!aweme || !text) return sendJson(res, 400, { ok: false, error: '要给 aweme 和 text' })
						if (body.confirm !== true) {
							return sendJson(res, 200, { ok: false, needsConfirm: true, draft: text, aweme, cid, root })
						}
						const args = ['reply', '--aweme', aweme, '--text', text]
						if (cid) args.push('--cid', cid)
						if (root) args.push('--root', root)
						if (author) args.push('--author', author)
						if (body.dry === true) args.push('--dry')
						const r = await run(args, { timeout: 180000 })
						return sendJson(res, 200, r)
					}
					if (req.method === 'GET' && p === '/ledger') {
						const n = Math.max(1, Math.min(30, Number(url.searchParams.get('n') || 6)))
						/* 🔴 2026-11-03 修：这里原来手读 `douyin-duty/reply-ledger.json`，
						 *    但账本真正的家是 `$DSH_HOME/douyin-studio/ledger.json`（lib/ledger.mjs 管）。
						 *    那个文件从来没有人写 → 「回评记录」永远空白，而且字段名也对不上
						 *    （账本里是 author/text，不是 nick）。改成走 lib/ledger.mjs 的 recent()。 */
						const { recent } = await import('./lib/ledger.mjs')
						const rows = recent(n).map((r) => ({
							at: r.at || '',
							who: r.author || '',
							text: String(r.text || '').slice(0, 60),
							reason: String(r.reason || '').slice(0, 40),
						}))
						return sendJson(res, 200, { ok: true, rows })
					}
					if (req.method === 'GET' && p === '/trend') {
						const { summary } = await import('./lib/trend.mjs')
						return sendJson(res, 200, summary(Math.max(1, Number(url.searchParams.get('days') || 14))))
					}
					if (req.method === 'POST' && p === '/trend/save') {
						const { save } = await import('./lib/trend.mjs')
						return sendJson(res, 200, await save())
					}
					if (req.method === 'GET' && p === '/queue') {
						const { list } = await import('./lib/queue.mjs')
						const r = list()
						return sendJson(res, 200, { ok: true, pending: (r.items || []).filter((x) => x.state === 'pending').length, dead: (r.items || []).filter((x) => x.state === 'dead').length, items: (r.items || []).slice(-10) })
					}
					/* 手动重放一次队列。面板上点这个 = 真的会去回答/发东西，
					 * 所以必须 confirm:true 才动；默认只报「有多少条等着」。 */
					if (req.method === 'POST' && p === '/queue/retry') {
						const body = await readBody(req)
						if (body.confirm !== true) {
							const { list: qList } = await import('./lib/queue.mjs')
							const items = qList().items || []
							return sendJson(res, 200, {
								ok: false,
								needsConfirm: true,
								pending: items.filter((x) => x.state === 'pending').length,
								hint: '重放会真的去回评论/发私信，再点一次确认',
							})
						}
						const { retry } = await import('./lib/queue.mjs')
						const { reply } = await import('./lib/api.mjs')
						const r = await retry({
							reply: (p) => reply({ aweme: p.aweme, text: p.text, cid: p.cid, root: p.root || undefined }),
							dm: async (p) => {
								const { sendByUi } = await import('./lib/im-send.mjs')
								return sendByUi({ nick: p.nick, secUid: p.sec_uid, text: p.text })
							},
							share: async (p) => {
								const { share } = await import('./lib/share.mjs')
								return share({ awemeId: p.aweme, nick: p.nick, secUid: p.sec_uid })
							},
						}, { limit: Math.max(1, Math.min(5, Number(body.limit) || 3)) })
						return sendJson(res, 200, r)
					}
					/* 发布历史：只认 publish-cli 写的 RESULT 行 */
					if (req.method === 'GET' && p === '/publishes') {
						const { recent } = await import('./lib/publishes.mjs')
						return sendJson(res, 200, recent(Math.max(1, Math.min(20, Number(url.searchParams.get('n') || 6)))))
					}
					/* 导出：唯一一条不回 JSON 的接口（回 text/csv）。
					 * 逻辑全在 lib/export-route.mjs —— 那边能单测、能挂真服务器跑；
					 * 这里只做三件事：取参数、调用、写响应。 */
					if (req.method === 'GET' && p === '/export') {
						const { handleExport } = await import('./lib/export-route.mjs')
						const { recent: recentLedger } = await import('./lib/ledger.mjs')
						const { recent: recentPublishes } = await import('./lib/publishes.mjs')
						const out = handleExport({
							what: url.searchParams.get('what'),
							recentLedger,
							recentPublishes,
						})
						res.writeHead(out.status, out.headers)
						return res.end(out.body)
					}
					/* 出错别散在四个文件里等人翻 —— 这里合成一条时间线：队列里的死信 +
					 * 发布日志里的异常行 + 值班上一轮的 error。 */
					if (req.method === 'GET' && p === '/errors') {
						const n = Math.max(1, Math.min(30, Number(url.searchParams.get('n') || 10)))
						const rows = []

						const { list: qList } = await import('./lib/queue.mjs')
						for (const it of qList().items || []) {
							if (it.state === 'dead') {
								rows.push({
									at: it.at || it.updatedAt || '',
									kind: 'queue-dead',
									text: String(it.error || '重试耗尽').slice(0, 120),
									detail: String(it.kind || '') + ' / ' + String(it.payload?.aweme || ''),
								})
							}
						}

						try {
							const logPath = join(HERE, 'lib', 'publish-log.jsonl')
							const { readFileSync } = await import('node:fs')
							const txt = readFileSync(logPath, 'utf8').replace(/^\uFEFF/, '')
							for (const line of txt.split('\n')) {
								if (!/UNCAUGHT|CAPTCHA|失败|error=/i.test(line)) continue
								const at = (line.match(/^\S+/) || [''])[0]
								rows.push({ at, kind: 'publish', text: line.slice(0, 160) })
							}
						} catch { /* 没日志就算了 */ }

						try {
							const { lastRun } = await import('./lib/duty.mjs')
							const last = lastRun()
							if (last && last.error) rows.push({ at: last.at || '', kind: 'duty', text: String(last.error).slice(0, 160) })
						} catch { /* ignore */ }

						rows.sort((a, b) => String(b.at).localeCompare(String(a.at)))
						return sendJson(res, 200, { ok: true, rows: rows.slice(0, n) })
					}
					if (req.method === 'GET' && p === '/names') {
						const { allNames } = await import('./lib/names.mjs')
						return sendJson(res, 200, { ok: true, names: allNames() })
					}
					if (req.method === 'POST' && p === '/names/refresh') {
						const { refresh } = await import('./lib/names.mjs')
						return sendJson(res, 200, await refresh({ limit: 20 }))
					}
					if (req.method === 'GET' && p === '/watch') return sendJson(res, 200, { ok: true, ...WATCH.status(), config: { on: S.watchOn, everySec: S.watchEverySec } })
					/* 盯私信也能从面板开关 —— 以前只能改配置再重启，等于没有开关 */
					if (req.method === 'POST' && p === '/watch') {
						const body = await readBody(req)
						if (body.action === 'start') return sendJson(res, 200, { ok: true, ...WATCH.start({ everySec: Number(S.watchEverySec) || 90, quiet: true, onFresh: replyDmNow }) })
						if (body.action === 'stop') return sendJson(res, 200, { ok: true, ...WATCH.stop() })
						return sendJson(res, 200, { ok: true, ...WATCH.status() })
					}
					/* 清队列：只清「已经放弃」的死信，pending 一律不动 */
					if (req.method === 'POST' && p === '/queue/clear') {
						const body = await readBody(req)
						if (body.confirm !== true) return sendJson(res, 200, { ok: false, needsConfirm: true, hint: '只清死信，再点一次确认' })
						const { clear } = await import('./lib/queue.mjs')
						return sendJson(res, 200, clear({ dead: true }))
					}
					if (req.method === 'GET' && p === '/duty') return sendJson(res, 200, { ok: true, ...DUTY.status() })
					if (req.method === 'POST' && p === '/duty') {
						const body = await readBody(req)
						if (body.action === 'start') {
							/* 「自己回评论」= 值班在跑 + autoReply 开着。开关状态要落盘，
							 * 否则重启后又变回"开着但只挑不回"，用户会以为它偷懒。 */
							if (typeof body.auto === 'boolean') writeSettings({ autoComment: body.auto })
							const auto = typeof body.auto === 'boolean' ? body.auto : (readSettings().autoComment || S.dutyAutoReply)
							return sendJson(res, 200, { ok: true, ...DUTY.start({ everyMin: S.dutyEveryMin, autoReply: auto, maxPerRun: 2, manual: true }) })
						}
						if (body.action === 'stop') {
							if (body.auto === false) writeSettings({ autoComment: false })
							return sendJson(res, 200, { ok: true, ...DUTY.stop() })
						}
						return sendJson(res, 200, { ok: true, ...DUTY.status() })
					}
					/* ── 自主执行：它自己回私信 / 发作品 / 报平安 ────────────────
					 * GET  = 现在开着什么、今天发了几条、最近自己做过什么
					 * POST = 演练（dry:true，不真发）或真做（要 confirm:true） */
					if (req.method === 'GET' && p === '/autopilot') {
						AUTOPILOT.configure({ runCli: run })
						return sendJson(res, 200, AUTOPILOT.status())
					}
					if (req.method === 'POST' && p === '/autopilot/run') {
						const body = await readBody(req)
						if (body.dry !== true && body.confirm !== true) {
							return sendJson(res, 200, { ok: false, needsConfirm: true, hint: '再点一次：会真的回私信 / 发作品' })
						}
						AUTOPILOT.configure({ runCli: run })
						return sendJson(res, 200, await AUTOPILOT.runAll({ dry: body.dry === true, manual: body.manual === true }))
					}
					if (req.method === 'GET' && p === '/login/qr') {
						const { qrShot } = await import('./lib/login.mjs')
						return sendJson(res, 200, await qrShot())
					}
					if (req.method === 'POST' && p === '/snapshot') {
						const r = await run(['snapshot', 'save', '--note', 'from-panel'], { timeout: 120000 })
						return sendJson(res, 200, r)
					}
					return sendJson(res, 404, { ok: false, error: 'unknown ' + req.method + ' ' + p })
				} catch (e) {
					sendJson(res, 500, { ok: false, error: String((e && e.message) || e) })
				}
			},
		}), 'douyin-studio: /api/douyin-studio 路由')
	} else {
		try { console.warn('[douyin-studio] 没有 webServer，设置页的数据接口没挂上（工具照常可用）') } catch { /* 日志挂了不该影响加载 */ }
	}

	/* 起来之后按配置自动开：
	 *   - 盯私信：默认开，但**延迟 90 秒**再跑第一下（刚开机浏览器还没起，抢没有意义）
	 *   - 值班：默认关（它会自己动手，得先点头才开）
	 * 这两个都是「自己会醒」的东西，所以卸载时必须停掉，别留着幽灵定时器。 */
	if (S.watchOn && !isKilled()) {
		try { WATCH.start({ everySec: S.watchEverySec, quiet: true, startDelaySec: 90, onFresh: replyDmNow }) } catch { /* 盯梢起不来不该挡住插件 */ }
	}
	/* 值班：配置里开着，或面板上勾了「自己回评论」，都要起 */
	try {
		const st0 = readSettings()
		if ((S.dutyOn || st0.autoComment) && !isKilled()) {
			DUTY.start({ everyMin: S.dutyEveryMin, autoReply: st0.autoComment || S.dutyAutoReply, maxPerRun: 2 })
		}
	} catch { /* 设置读不到就不起，别把插件拖挂 */ }

	/* 自主执行：定时器常驻，每轮自己看开关 —— 关着就是空转，不花钱也不发东西。
	 * 2026-11-04 从 5 分钟放到 30 分钟：主人说私信不用一直盯，跟回评论一个节奏就行。
	 * 这样面板上开/关立刻生效，不需要重启。 */
	try { if (!isKilled()) AUTOPILOT.start({ everyMin: 30, runCli: run }) } catch { /* 起不来不影响手动 */ }

	/* 每天自动刷几轮：轮次由 lib/schedule.mjs 铺开（纯函数，单测钉着）。
	 * 只有「现在轮到了、今天还没刷过这一轮」才真去刷；跨天清零。
	 * 刷的是 feed —— 只读，不点赞不评论，所以不占消息额度也不动别人的东西。 */
	/* 轮次落盘（2026-11-04）：以前存在内存里，DSH 一重启就归零，
	 * 当天已刷过的那几轮会被当成没刷过再刷一遍。 */
	const scanTick = async () => {
		/* 总闸：停损开着就整轮不跑（不刷、不写状态）。只读也停，是因为出事时不想再花额度。 */
		if (isKilled()) return
		let snap
		try { snap = scheduleSnapshot() } catch { return }
		const next = snap.next || {}
		const priorFailures = snap.failures
		const prev = ROUNDS.readState()
		/* 跨过 await 之后再写状态，一律走单写者队列：否则暂停 / 刷新 / 下一轮
		 * 同时到达时，后写的一份会把先写的那一份整块盖掉。 */
		const sameDay = (cur) => (cur && cur.day === snap.day
			? cur : { day: snap.day, done: 0, failures: 0 })
		await ROUNDS.updateHealth((cur) => ({
			...cur,
			level: next.level === 'stop' ? 'stop' : next.level === 'warn' ? 'warn' : 'ok',
			failures: priorFailures, action: next.action,
			reason: String(next.reason || next.label || ''),
			at: new Date().toISOString(),
		}))

		/* 跳过类：不消耗轮次，但要留痕。同一个 (day, index, 原因) 只写一行，
		 * 否则 tick 每 5 分钟来一次，rounds.jsonl 会被重复行刷爆。 */
		if (next.action === 'pause' || next.action === 'stop' || next.action === 'skip-quota') {
			const key = snap.day + ':' + next.index + ':' + next.action
			if (String(prev.lastSkipKey || '') !== key) {
				ROUNDS.appendRound({ round: next.index, ok: false, skipped: next.action, error: next.reason })
				await ROUNDS.updateState((cur0) => ({ ...sameDay(cur0), lastSkipKey: key }))
			}
			return
		}
		if (next.action !== 'run') return

		/* 先记一笔再刷：宁可这一轮没刷成，也不要因为中途崩了就在同一个点上反复重试。 */
		const t0 = Date.now()
		await ROUNDS.updateState((cur0) => ({
			...sameDay(cur0), done: next.index + 1, failures: 0,
			lastAt: new Date().toISOString(), lastSkipKey: '',
		}))
		try {
			/* 一轮刷完 = 一个作业：失败退避重试两次，每一步之前都看总闸（lib/jobs.mjs）。 */
			const r = await runJob('scan-round', startPicksCollect, {
		tries: 2,
		/* 预检只量浏览器这一跳：scan-round 有过 1.2s / 63.6s 的巨大抖动，
		 * 没有 pre 这个数就分不清是逻辑慢还是 CDP 冷启动/被系统挂起。 */
		preflight: async () => { const { listTabs } = await import('./lib/cdp.mjs'); await listTabs() },
	})
			const ok = Boolean(r && r.ok !== false && !r.error)
			const err = ok ? '' : String((r && (r.error || r.stage)) || '没拿到结果')
			const failures = ok ? 0 : priorFailures + 1
			await ROUNDS.updateState((cur0) => ({ ...sameDay(cur0), failures, lastError: err }))
			ROUNDS.appendRound({
				round: next.index, ok, took: Date.now() - t0,
				seen: Math.max(0, Number(r && r.fetched) || 0),
				kept: Math.max(0, Number(r && r.picked) || 0),
				error: err,
			})
			await ROUNDS.updateHealth((cur) => ({
				...cur, level: ok ? 'ok' : failures >= 6 ? 'stop' : failures >= 3 ? 'warn' : 'ok',
				failures, action: ok ? 'run-ok' : 'run-fail', reason: err || '刷完了',
				at: new Date().toISOString(),
			}))
		} catch (e) {
			const err = String((e && e.message) || e)
			await ROUNDS.updateState((cur0) => ({
				...sameDay(cur0), failures: priorFailures + 1, lastError: err,
			}))
			ROUNDS.appendRound({ round: next.index, ok: false, took: Date.now() - t0, error: err })
		}
	}

	let scanTimer = null
	try {
		scanTimer = setInterval(scanTick, 300000)
		if (scanTimer.unref) scanTimer.unref()
		const first = setTimeout(scanTick, 60000)
		if (first.unref) first.unref()
	} catch { /* 起不来就只留手动 */ }

	if (typeof ctx.effect === 'function') {
		ctx.effect(() => () => {
			try { if (scanTimer) clearInterval(scanTimer) } catch { /* 已经停了 */ }
			try { WATCH.stop() } catch { /* 已经停了 */ }
			try { DUTY.stop() } catch { /* 已经停了 */ }
			try { AUTOPILOT.stop() } catch { /* 已经停了 */ }
		}, 'douyin-studio: 卸载时停掉盯梢与值班')
	}
}
