/**
 * 工具定义（douyin_studio_*）——从 index.js 拆出来的（2026-11-03，体量闸前的整理）
 * ============================================================================
 * 每一条都只是「整形参数 → 起 CLI 子进程」，真正动手的代码在 tools/dy.mjs 与 lib/。
 * 拆出来之后 index.js 只留配置、状态、路由和生命周期，改一个工具不用碰宿主接线。
 */
import { DECLARE_VALUES, titleHint } from './publish-rules.mjs'
import { isKilled, killFile, killInfo, killedReply, setKill } from './killswitch.mjs'
import { markDryRun, markPublished, needsFirstRunDry } from './firstrun.mjs'
import { checkAuto, recordAuto } from './unattended.mjs'
import { readSettings } from './settings.mjs'

/**
 * 会**发出去**的工具（2026-11-05 加总闸时清出来的清单）。
 * 判断标准是「不可逆」：发出去的消息、点掉的发布、删掉的东西。只读的永远不挡。
 * publish 只在真发/存草稿时算写 —— 只摆好不点，是可回退的。
 */
const WRITE_TOOLS = new Set([
	'douyin_studio_reply',
	'douyin_studio_dm',
	'douyin_studio_dm_send',
	'douyin_studio_at_reply',
	'douyin_studio_comment_self',
	'douyin_studio_comment_at',
	'douyin_studio_share',
	'douyin_studio_publish',
	'douyin_studio_delete',
	'douyin_studio_delcomment',
	'douyin_studio_queue',
])

/**
 * 这一次调用是不是真的会写。
 * @param {string} name 工具名
 * @param {Record<string, unknown>} a 参数
 * @returns {boolean} true = 会被总闸挡
 */
export function writeIntent(name, a) {
	if (!WRITE_TOOLS.has(name)) return false
	if (a.dry === true) return false
	if (name === 'douyin_studio_queue') return a.action === 'retry'
	if (name === 'douyin_studio_publish') return a.publish === true || a.draft === true
	return true
}

export function registerTools({ ctx, defineTool, textOutput, run, S, DUTY, WATCH }) {
	const safe = (v) => {
		if (v === undefined || v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
		try { return JSON.parse(JSON.stringify(v)) } catch { return String(v) }
	}
	/** ⚠️ 宿主的 parameters 是**扁平属性表**（`{ count: { type, description, required: true } }`），
	 *  不是 JSON Schema（写成 `{type:'object',properties:{}}` 会在 defineTool 里直接抛
	 *  `unsupported JSON schema: parameters.type must be a value schema object`）。 */
	const tool = (spec) => ctx.tools.register(defineTool({
		...spec,
		output: textOutput,
		async execute(args) {
			const a = args || {}
			/* 总闸在最外层：不管调用方是面板、调度器还是模型自己，写之前都过同一次检查。 */
			if (writeIntent(spec.name, a) && isKilled()) return JSON.stringify(killedReply(spec.name))
			return safe(await spec.execute(a))
		},
	}))

	tool({
		name: 'douyin_studio_status',
		description: '抖音账号体检：我是谁（昵称/uid/粉丝/作品数）、今天回评额度还剩多少、浏览器/CDP 有没有起来。只读，不占额度。',
		parameters: {},
		execute: () => run(['status'], { timeout: 90000 }),
	})

	tool({
		name: 'douyin_studio_works',
		description: '列作品（默认自己）：每条只给 aweme_id、文案前 300 字、发布时间、赞/评/藏/转、作者、share_url。字段是投影过的，不 raw 直通。',
		parameters: {
			count: { type: 'number', description: '几条（默认 20，最多 50）' },
			cursor: { type: 'number', description: '翻页游标，用上次返回的 max_cursor' },
			secuid: { type: 'string', description: '看谁的（sec_uid），留空 = 自己' },
		},
		execute: (a) => {
			const args = ['works', '--count', String(Math.min(Number(a.count) || 20, 50))]
			if (a.cursor) args.push('--cursor', String(a.cursor))
			if (a.secuid) args.push('--secuid', String(a.secuid))
			return run(args)
		},
	})

	tool({
		name: 'douyin_studio_comments',
		description: '拉一条作品下的评论（带楼中楼层级）：cid、text、赞数、level、root_comment_id（楼根）、user、image（图文评论 text 会是空的）。回评前先用它找靶子。',
		parameters: {
			aweme: { type: 'string', description: '作品 id', required: true },
			count: { type: 'number', description: '几条（默认 20，最多 50）' },
		},
		execute: (a) => {
			if (!a.aweme) return { ok: false, error: '缺 aweme' }
			const args = ['comments', '--aweme', String(a.aweme)]
			if (a.count) args.push('--count', String(Math.min(Number(a.count) || 20, 50)))
			return run(args)
		},
	})

	tool({
		name: 'douyin_studio_replies',
		description: [
			'某条评论**底下**的回复（楼中楼）。只拉顶层评论是不够的 —— 楼中楼这一层压根不在里面，',
			'所以「回楼中楼」以前既看不见也回不到。这里拿到的 cid 就是回楼中楼时要的 --cid。',
			'回的时候：thread=楼根（传进来的 cid），对某个人说就再带 replyTo=他的 cid。',
		].join(''),
		parameters: {
			aweme: { type: 'string', description: '作品 id', required: true },
			cid: { type: 'string', description: '楼根评论 id（哪一条下面的回复）', required: true },
			count: { type: 'number', description: '几条（默认 20，最多 50）' },
		},
		execute: (a) => {
			if (!a.aweme || !a.cid) return { ok: false, error: '缺 aweme / cid' }
			const args = ['replies', '--aweme', String(a.aweme), '--cid', String(a.cid)]
			if (a.count) args.push('--count', String(Math.min(Number(a.count) || 20, 50)))
			return run(args)
		},
	})

	tool({
		name: 'douyin_studio_reply',
		description: [
			'在抖音回一条评论。发之前过四道闸：这条 cid 回过没、这个人今天回过没、这栋楼（root_comment_id）今天回过没、总额度够不够。',
			'回复楼中楼：cid 填被回的那条，root 填楼根（两个字段分工不同，填错会变成一条冒出来的顶层评论）。',
			'reason 是「为什么回」，记进账本，事后复盘用。',
		].join(' '),
		parameters: {
			aweme: { type: 'string', description: '作品 id', required: true },
			text: { type: 'string', description: '正文（≤500 字，emoji/颜文字直接写进去）', required: true },
			cid: { type: 'string', description: '要回的评论 cid（楼中楼就是对方那条）' },
			root: { type: 'string', description: '楼根 cid（顶层评论不用填）' },
			author: { type: 'string', description: '对方 uid（填了才能查「同一人每天 2 条」）' },
			reason: { type: 'string', description: '为什么回（≤160 字）' },
			dry: { type: 'boolean', description: '只演练不发出' },
		},
		execute: (a) => {
			const args = ['reply', '--aweme', String(a.aweme), '--text', String(a.text)]
			if (a.cid) args.push('--cid', String(a.cid))
			if (a.root) args.push('--root', String(a.root))
			if (a.author) args.push('--author', String(a.author))
			if (a.reason) args.push('--reason', String(a.reason))
			if (a.dry) args.push('--dry')
			return run(args)
		},
	})

	tool({
		name: 'douyin_studio_publish',
		description: [
			'发抖音（图文或视频）。本地先挡错：标题超长、定时太近、参数打架都会在跑之前拒掉。',
			'顺序：传文件→（图文自动切「发布图文」）→填标题/简介→选可见性→自主声明→定时→点发布→回读核实。',
			'不给 publish / draft 就只「摆好不点」，最后一下留给哥哥。',
		].join(' '),
		parameters: {
			img: { type: 'array', items: { type: 'string' }, description: '图片绝对路径（可多张，最多 35）' },
			video: { type: 'string', description: '视频绝对路径（与 img 二选一）' },
			title: { type: 'string', description: '标题（' + titleHint() + '）' },
			desc: { type: 'string', description: '简介（≤1000 字）' },
			cover: { type: 'string', description: '封面图绝对路径（视频用）' },
			who: { type: 'string', enum: ['public', 'friend', 'private'], description: '谁可以看' },
			declare: { type: 'string', enum: DECLARE_VALUES, description: '自主声明（真发/存草稿时必填；真发不许 none）' },
			at: { type: 'string', description: '定时发布 "2026-11-05 20:00"（抖音只收 2 小时后~14 天内）' },
			publish: { type: 'boolean', description: '真点发布' },
			draft: { type: 'boolean', description: '存草稿（与 publish 互斥）' },
			dry: { type: 'boolean', description: '只校验不执行' },
			auto: { type: 'boolean', description: '无人值守：要同时过 开关/窗口/额度/首跑 dry 四道，缺一条就拒（默认 false）' },
		},
		execute: async (a) => {
			/* A2-06：声明不许空。真发那一路更不许 none —— 平台要求，也是审计里点名的缺口。 */
			if (a.publish === true || a.draft === true) {
				if (!a.declare) {
					return JSON.stringify({
						ok: false,
						needsDeclare: true,
						options: DECLARE_VALUES,
						note: '发布/存草稿前必须选自主声明（一般用 ai）。不填不会替你猜，免得发出去才发现标错',
					})
				}
				if (a.publish === true && a.declare === 'none') {
					return JSON.stringify({ ok: false, error: '真发不能挂「无声明」，换 ai/view/repost/market/fiction 之一' })
				}
			}
			/* 首跑必须 dry：没成功摆过一次，就不许点不可逆的那一下。 */
			if (a.publish === true && needsFirstRunDry()) {
				return JSON.stringify({
					ok: false,
					needsFirstRunDry: true,
					note: '这台机器还没跑过一次成功的 dry 发布。先传 dry:true 把整条链走一遍（不点发布），再真发',
				})
			}
			/* 无人值守：没人点的那一下。只认显式 `auto:true`，四道闸缺一条就退回人工。 */
			if (a.auto === true) {
				let st = {}
				try { st = readSettings() } catch { st = {} }
				const gate = checkAuto(st)
				if (!gate.ok) {
					return JSON.stringify({ ok: false, unattended: true, stage: gate.stage, reason: gate.reason })
				}
			}
			const args = ['publish']
			if (a.auto === true) args.push('--auto')
			for (const f of (a.img || [])) args.push('--img', String(f))
			if (a.video) args.push('--video', String(a.video))
			if (a.title) args.push('--title', String(a.title))
			if (a.desc) args.push('--desc', String(a.desc))
			if (a.cover) args.push('--cover', String(a.cover))
			if (a.who) args.push('--who', String(a.who))
			if (a.declare) args.push('--declare', String(a.declare))
			if (a.at) args.push('--at', String(a.at))
			if (a.publish) args.push('--publish')
			if (a.draft) args.push('--draft')
			if (a.dry) args.push('--dry')
			const out = await run(args, { timeout: 600000 })
			/* 走到这里说明 CLI 没抛：dry 记「摆过一次」，真发记「已经发过」——两者都解开首跑锁。 */
			try {
				if (a.dry) markDryRun('publish --dry')
				else if (a.publish === true) markPublished()
				/* 自动发的账要和真发同一时刻落，否则额度会漏算一条。 */
				if (a.auto === true && a.publish === true) {
					recordAuto({ ok: !(out && out.ok === false), title: String(a.title || ''), declare: String(a.declare || '') })
				}
			} catch { /* 状态文件写不进去，不该让发布结果变成失败 */ }
			return out
		},
	})

	tool({
		name: 'douyin_studio_kill',
		description: [
			'一键全局停损：开 / 关 / 看状态。开着的时候所有会发出去的动作（回评、私信、@、分享、发布、删除、队列重试）一律拒。',
			'只读动作不受影响 —— 出事时更需要看现场。停损是文件级的，面板、CLI、调度器读的是同一份。',
		].join(' '),
		parameters: {
			action: { type: 'string', enum: ['status', 'on', 'off'], description: 'status 只看 / on 立刻停 / off 解除（默认 status）' },
			reason: { type: 'string', description: '为什么停（写进 KILL 文件，事后对得上）' },
		},
		execute: (a) => {
			const action = String(a.action || 'status')
			if (action === 'on') return JSON.stringify(setKill(true, a.reason || '工具层手动停损'))
			if (action === 'off') return JSON.stringify(setKill(false))
			const info = killInfo()
			return JSON.stringify({ ok: true, killed: Boolean(info), info, file: killFile() })
		},
	})

	tool({
		name: 'douyin_studio_detail',
		description: '一条作品的真数据（赞/评/藏/转/时长/作者）+ 文案原文。作品删了或设成私密会明确报没拿到——那时候别猜数据。',
		parameters: { aweme: { type: 'string', description: '作品 id', required: true } },
		execute: (a) => run(['detail', '--aweme', String(a.aweme || '')]),
	})

	tool({
		name: 'douyin_studio_likes',
		description: '某人「喜欢」列表里的公开作品（默认自己）。⚠️ 空数组有两种含义：真没点过 / 他把喜欢设成私密了，别当成「他什么都没赞」。',
		parameters: {
			count: { type: 'number', description: '几条（默认 20，最多 50）' },
			cursor: { type: 'number', description: '翻页游标' },
			secuid: { type: 'string', description: '看谁的（sec_uid），留空 = 自己' },
		},
		execute: (a) => {
			const args = ['likes', '--count', String(Math.min(Number(a.count) || 20, 50))]
			if (a.cursor) args.push('--cursor', String(a.cursor))
			if (a.secuid) args.push('--secuid', String(a.secuid))
			return run(args)
		},
	})

	tool({
		name: 'douyin_studio_notices',
		description: [
			'读互动通知：谁 @ 了我（45/46）、谁回复了我的评论（31/32，这类最容易漏）、谁关注/点赞/评论了我。',
			'每条回 cid（要回就回这条）和 root_comment_id（楼根，回楼中楼时传它）。',
			'只读：请求里 is_mark_read=0，不会把通知标成已读。',
		].join(' '),
		parameters: {
			limit: { type: 'number', description: '最多回几条（默认 30，最多 60）' },
			group: { type: 'number', description: '只看某一组（700 @我 / 960 评论 / 401 点赞关注 / 601 其他），一般不用给' },
		},
		execute: (a) => {
			const args = ['notices', '--limit', String(Math.min(Number(a.limit) || 30, 60))]
			if (a.group) args.push('--group', String(a.group))
			return run(args, { timeout: 180000 })
		},
	})

	tool({
		name: 'douyin_studio_share',
		description: [
			'把一条视频以**抖音分享卡片**发给好友（不是文字链接——文字链接在抖音里点不开）。',
			'走真页面：打开视频页、真实鼠标 hover 出分享面板、按昵称/sec_uid 精确找人、点分享。',
			'发完用接口回读：只有「这次调用之后」的新卡片才算数。同名多人一律拒发。',
		].join(' '),
		parameters: {
			aweme: { type: 'string', description: '视频 id', required: true },
			to: { type: 'string', description: '好友昵称（分享面板里显示的名字）' },
			sec_uid: { type: 'string', description: '对方的 sec_uid（有重名时必须给）' },
			dry: { type: 'boolean', description: '只展开面板看找到的是谁，不发' },
			confirm: { type: 'boolean', description: '🔴 真发必须由用户当场同意后传 true' },
		},
		execute: (a) => {
			if (!a.aweme) return JSON.stringify({ ok: false, error: '要给视频 id' })
			if (!a.to && !a.sec_uid) return JSON.stringify({ ok: false, error: '要给昵称或 sec_uid' })
			if (!a.dry && a.confirm !== true) {
				return JSON.stringify({
					ok: false,
					needsConfirm: true,
					aweme: String(a.aweme),
					to: String(a.to || a.sec_uid || ''),
					note: '分享卡片会真发到对方私信，撤不回来。用户点头后再带 confirm: true；先看目标就传 dry: true',
				})
			}
			const args = ['share', '--aweme', String(a.aweme)]
			if (a.to) args.push('--to', String(a.to))
			if (a.sec_uid) args.push('--sec', String(a.sec_uid))
			if (a.dry) args.push('--dry')
			return run(args, { timeout: 300000 })
		},
	})

	tool({
		name: 'douyin_studio_dm',
		description: [
			'读私信（只读，不发）。不给 to 就列最近会话；给 to（sec_uid）或 uid 就读和那个人的对话。',
			'纯 HTTP 走 imapi，约 0.5 秒，不用起第二个浏览器。',
			'认人只认 sec_uid→数字 uid 的反查结果，绝不按昵称猜；陌生人不覆盖。',
		].join(' '),
		parameters: {
			to: { type: 'string', description: '对方的 sec_uid 或昵称（想读某个人 / 发给谁时给）' },
			uid: { type: 'string', description: '对方的数字 uid（只读时可用，省一次反查）' },
			limit: { type: 'number', description: '每个会话看最近几条（默认 30，最多 60）' },
			text: { type: 'string', description: '要发的话；给了就是「发私信」，不给就是只读' },
			dry: { type: 'boolean', description: '发私信时只打开会话打字、不按发送' },
			confirm: { type: 'boolean', description: '🔴 真发必须由用户当场同意后传 true，否则只回草稿' },
		},
		execute: (a) => {
			const to = String(a.to || '').trim()
			const text = String(a.text || '').trim()
			if (text) {
				/* 写操作：没有 confirm 就只回草稿。发出去撤不回来，这一步不能靠「应该没问题」。 */
				if (a.confirm !== true) {
					return JSON.stringify({
						ok: false,
						needsConfirm: true,
						draft: text,
						to: to || '(未指定)',
						note: '要真发，请用户点头后带 confirm: true 再调一次；只想试一试就传 dry: true（只打字不发送）',
					})
				}
				const args = ['dm', '--text', text]
				if (to) args.push('--to', to)
				if (a.dry) args.push('--dry')
				return run(args, { timeout: 300000 })
			}
			const args = ['dm', '--limit', String(Math.min(Number(a.limit) || 30, 60))]
			if (to) args.push('--to', to)
			if (a.uid) args.push('--uid', String(a.uid))
			return run(args, { timeout: 120000 })
		},
	})

	tool({
		name: 'douyin_studio_names',
		description: [
			'私信昵称缓存。imapi 的会话列表只给 uid 不给昵称，所以另开一次 /chat 页面抄名字，',
			'用 React fiber 里的 conv_id 跟接口的会话严格对上（对不上、或同一 conv 出现两个名字，一律不写）。',
			'action=refresh 抄一遍，action=list 看缓存。',
		].join(' '),
		parameters: {
			action: { type: 'string', description: 'refresh（抄一遍）/ list（看缓存），默认 list' },
		},
		execute: (a) => {
			const args = ['names']
			if (String(a.action || '') === 'refresh') args.push('--refresh')
			return run(args, { timeout: 180000 })
		},
	})

	tool({
		name: 'douyin_studio_cost',
		description: '看今天 / 近几天花了多少钱（读的是 QQ 那边同一份 token 账本，不另算一遍）。只读。',
		parameters: { days: { type: 'number', description: '看最近几天（默认 7）' } },
		execute: (a) => {
			const args = ['cost']
			if (a.days) args.push('--days', String(a.days))
			return run(args, { timeout: 90000 })
		},
	})

	tool({
		name: 'douyin_studio_delete',
		description: '删掉自己发的某一条（按标题**完全相等**，且只允许唯一命中）。命不中或命中多条都会拒绝——删除没有撤销。',
		parameters: { title: { type: 'string', description: '作品标题（必须完全一致）', required: true } },
		execute: (a) => run(['delete', '--title', String(a.title || '')], { timeout: 180000 }),
	})

	tool({
		name: 'douyin_studio_ledger',
		description: '看回评台账：今天回了几条、各时段用了多少、最近几条回了什么（含 reason 和是否进楼）。只读。',
		parameters: { recent: { type: 'number', description: '看最近几条（默认 8）' } },
		execute: (a) => run(['ledger', '--recent', String(Math.min(Number(a.recent) || 8, 50))], { timeout: 60000 }),
	})

	tool({
		name: 'douyin_studio_search',
		description: '按关键词搜视频（找靶子、看同行）。只读。',
		parameters: {
			keyword: { type: 'string', description: '关键词', required: true },
			count: { type: 'number', description: '几条（默认 10，最多 30）' },
			offset: { type: 'number', description: '翻页游标（用上次返回的 cursor）' },
		},
		execute: (a) => run(['search', '--kw', String(a.keyword || ''), '--count', String(Math.min(Number(a.count) || 10, 30)), '--offset', String(Number(a.offset) || 0)], { timeout: 90000 }),
	})

	tool({
		name: 'douyin_studio_delcomment',
		description: '删掉自己在别人视频下的一条评论（只能删自己的）。删除没有撤销，cid 要确认对。',
		parameters: {
			aweme: { type: 'string', description: '视频 id', required: true },
			cid: { type: 'string', description: '评论 id（douyin_studio_comments 里拿）', required: true },
			dry: { type: 'boolean', description: '只看会不会过，不真删' },
		},
		execute: (a) => {
			const args = ['delcomment', '--aweme', String(a.aweme || ''), '--cid', String(a.cid || '')]
			if (a.dry) args.push('--dry')
			return run(args, { timeout: 90000 })
		},
	})

	tool({
		name: 'douyin_studio_check',
		description: '发布前本地查文件：尺寸、比例、大小、张数。不碰浏览器，秒回。',
		parameters: {
			files: { type: 'string', description: '图片/视频的绝对路径，多个用逗号分隔', required: true },
		},
		execute: (a) => {
			const args = ['check']
			for (const f of String(a.files || '').split(',').map((s) => s.trim()).filter(Boolean)) args.push('--img', f)
			return run(args, { timeout: 60000 })
		},
	})

	tool({
		name: 'douyin_studio_snapshot',
		description: '登录态快照：action=list 看有哪些、save 现在存一份、restore 还原某一份（浏览器开着就用 CDP 塞 cookie，不用关）。',
		parameters: {
			action: { type: 'string', description: 'list / save / restore', required: true },
			name: { type: 'string', description: 'restore 时要还原的名字（list 里看）' },
			note: { type: 'string', description: 'save 时记一句为什么存' },
		},
		execute: (a) => {
			const action = String(a.action || 'list')
			if (action === 'list') return run(['snapshot', 'list'], { timeout: 60000 })
			if (action === 'save') {
				const args = ['snapshot', 'save']
				if (a.note) args.push('--note', String(a.note))
				return run(args, { timeout: 120000 })
			}
			if (action === 'restore') {
				if (!a.name) return { ok: false, error: 'restore 要给 name（先用 action=list 看）' }
				return run(['snapshot', 'restore', String(a.name)], { timeout: 120000 })
			}
			return { ok: false, error: 'action 只认 list / save / restore' }
		},
	})

	/* ── 2026-11-01 追加：趋势 / 队列 / 盯梢 / 值班 / 登录 ───────────── */

	tool({
		name: 'douyin_studio_trend',
		description: '号的数据趋势：每天存一条（粉丝/总赞/作品数/最近作品的赞与评论），再看最近 N 天的涨跌。action: save / show。',
		parameters: {
			action: { type: 'string', description: 'save（存今天这条）/ show（看趋势），默认 show' },
			days: { type: 'number', description: 'show 时看最近几天，默认 14' },
		},
		execute: (a) => run(['trend', a.action === 'save' ? 'save' : 'show', '--days', String(a.days || 14)], { timeout: 180000 }),
	})

	tool({
		name: 'douyin_studio_queue',
		description: '失败重试队列：回评/私信/分享卡片失败会落盘，这里 list / retry / clear（试满 5 次标 dead）。',
		parameters: {
			action: { type: 'string', description: 'list / retry / clear，默认 list' },
			limit: { type: 'number', description: 'retry 一次最多重放几条，默认 5' },
		},
		execute: (a) => run(['queue', ['list', 'retry', 'clear'].includes(a.action) ? a.action : 'list', '--limit', String(a.limit || 5)], { timeout: 300000 }),
	})

	tool({
		name: 'douyin_studio_watch',
		description: '盯私信：来新的弹 Windows 通知（静音时段只记不弹）。action: once / status / start / stop。',
		parameters: {
			action: { type: 'string', description: 'once（跑一次）/ status / start / stop，默认 once' },
			loud: { type: 'boolean', description: '静音时段也弹（默认不弹）' },
		},
		execute: (a) => {
			const act = a.action || 'once'
			if (act === 'start') return JSON.stringify({ ok: true, ...WATCH.start({ everySec: S.watchEverySec, quiet: !a.loud }) })
			if (act === 'stop') return JSON.stringify({ ok: true, ...WATCH.stop() })
			if (act === 'status') return JSON.stringify({ ok: true, ...WATCH.status() })
			return run(['watch', 'once'].concat(a.loud ? ['--loud'] : []), { timeout: 120000 })
		},
	})

	tool({
		name: 'douyin_studio_duty',
		description: [
			'值班：看一眼我最近作品下的新评论，挑该接的。',
			'默认**只收集、不自动回**（autoReply 默认关）；开了自动回会走生成 → 回 → 记账，失败进队列。',
			'action: run（跑一轮）/ status / collect（只收集候选）。',
		].join(' '),
		parameters: {
			action: { type: 'string', description: 'run / status / collect，默认 run' },
			auto: { type: 'boolean', description: '这一轮就自动回（默认跟着配置走）' },
			dry: { type: 'boolean', description: '只生成不发送' },
			max: { type: 'number', description: '这一轮最多回几条，默认 2' },
		},
		execute: (a) => {
			const act = a.action || 'run'
			if (act === 'status') return JSON.stringify({ ok: true, ...DUTY.status() })
			if (act === 'collect') return run(['duty', 'collect'], { timeout: 180000 })
			const auto = a.auto === true || (a.auto === undefined && S.dutyAutoReply)
			return run(['duty', 'run', '--max', String(a.max || 2)].concat(auto ? ['--auto'] : []).concat(a.dry ? ['--dry'] : []), { timeout: 300000 })
		},
	})

	tool({
		name: 'douyin_studio_login',
		description: '登录状态 / 出二维码：action=whoami（现在登录没）/ qr（没登录就截一张二维码，已登录直接说不用扫）。',
		parameters: { action: { type: 'string', description: 'whoami / qr，默认 whoami' } },
		execute: (a) => run(['login', a.action === 'qr' ? 'qr' : 'whoami'], { timeout: 180000 }),
	})

	/* ── 2026-11-02 新增：收件箱 / 私信 / @我 / 刷视频 / 自己评论区 ───────── */

	tool({
		name: 'douyin_studio_inbox',
		description: [
			'收件箱：把私信、@我、我作品下的新评论整理成一张可行动清单。',
			'每条带 worth（值不值得回）、why/blocked（为什么）、以及回一句要用的 id（uid/cid/root/aweme）。',
			'只读，不发任何东西。先看这张表，再决定回哪条。',
		].join(' '),
		parameters: {
			limit: { type: 'number', description: '每块最多几条（默认 10，最多 30）' },
			only: { type: 'string', description: '只看一块：dm / at / own；不传 = 三块都要' },
			enrich: { type: 'number', description: '@我 时补几条视频详情（默认 3，最多 5）' },
		},
		execute: (a) => {
			const lim = String(Math.min(Number(a.limit) || 10, 30))
			const only = String(a.only || '').trim()
			const args = ['inbox', '--limit', lim]
			if (only === 'dm') args.push('--dm-only')
			else if (only === 'at') args.push('--at-only', '--enrich', String(Math.min(Number(a.enrich) || 3, 5)))
			else if (only === 'own') args.push('--own-only')
			return run(args, { timeout: 240000 })
		},
	})

	tool({
		name: 'douyin_studio_dm_send',
		description: [
			'发一条私信（带消息预算：日限/小时限/间隔/同一人每天 2 条/总闸）。',
			'走真页面点击，发完用接口回读核实。',
			'🔴 真发必须由用户当场同意后传 confirm:true；不给 confirm 只回草稿；dry:true 只打字不发送。',
		].join(' '),
		parameters: {
			to: { type: 'string', description: '对方 sec_uid 或昵称（昵称要唯一）' },
			uid: { type: 'string', description: '对方数字 uid（记账用，更准）' },
			text: { type: 'string', description: '正文（≤300 字）' },
			dry: { type: 'boolean', description: '只打开会话打字、不按发送' },
			confirm: { type: 'boolean', description: '🔴 真发必须用户点头后传 true' },
		},
		execute: (a) => {
			const text = String(a.text || '').trim()
			const to = String(a.to || '').trim()
			if (!text) return { ok: false, error: '正文是空的' }
			// ⚠️ dry 也要放行：description 说「dry:true 只打字不发送」，
			//    2026-11-03 之前这里只认 confirm → dry 传了也照样被拦，永远走不到 --dry。
			if (a.confirm !== true && a.dry !== true) return { ok: false, needsConfirm: true, draft: text, to, note: '点头后再带 confirm:true；想先看看就传 dry:true' }
			const args = ['dm-send', '--text', text]
			if (to) args.push('--to', to)
			if (a.uid) args.push('--uid', String(a.uid))
			if (a.dry) args.push('--dry')
			return run(args, { timeout: 300000 })
		},
	})

	tool({
		name: 'douyin_studio_at_reply',
		description: [
			'回一条「@我」的通知（落在对应评论区，走 at 通道的额度）。',
			'楼中楼：cid = 被回的那条，root = 楼根（不传就当顶层评论）。',
			'🔴 真发要用户点头后传 confirm:true。',
		].join(' '),
		parameters: {
			aweme: { type: 'string', description: '视频 id' },
			cid: { type: 'string', description: '被回的那条评论 id（没有就先发顶层）' },
			root: { type: 'string', description: '楼根评论 id（回了就落进这栋楼）' },
			text: { type: 'string', description: '正文（≤500 字）' },
			confirm: { type: 'boolean', description: '🔴 真发必须用户点头后传 true' },
		},
		execute: (a) => {
			const text = String(a.text || '').trim()
			if (!text) return { ok: false, error: '正文是空的' }
			if (a.confirm !== true) return { ok: false, needsConfirm: true, draft: text, aweme: String(a.aweme || ''), note: '点头后再带 confirm:true' }
			const args = ['at-reply', '--aweme', String(a.aweme), '--text', text]
			if (a.cid) args.push('--cid', String(a.cid))
			if (a.root) args.push('--root', String(a.root))
			return run(args, { timeout: 180000 })
		},
	})

	tool({
		name: 'douyin_studio_feed',
		description: [
			'刷视频（推荐流），按内容限定过滤：时长区间、关键词白名单/黑名单、最低点赞、去重。只读，不点赞不评论。',
			'每次多刷几轮拼一批；见过的默认跳过（markSeen=true 才记进去重表）。',
		].join(' '),
		parameters: {
			count: { type: 'number', description: '每轮要几条（默认 20）' },
			rounds: { type: 'number', description: '刷几轮（默认 3，最多 6）' },
			allow: { type: 'string', description: '白名单关键词，逗号分隔；空 = 用插件配置里的 keywords' },
			block: { type: 'string', description: '黑名单关键词，逗号分隔' },
			minSec: { type: 'number', description: '最短秒数（默认 5）' },
			maxSec: { type: 'number', description: '最长秒数（默认 180）' },
			minDigg: { type: 'number', description: '最低点赞数（默认 0）' },
			markSeen: { type: 'boolean', description: '把这次留下的记进去重表' },
			limit: { type: 'number', description: '最多返回几条（默认 12）' },
		},
		execute: (a) => {
			const args = ['feed',
				'--count', String(Math.min(Number(a.count) || 20, 50)),
				'--rounds', String(Math.min(Number(a.rounds) || 3, 6)),
				'--limit', String(Math.min(Number(a.limit) || 12, 50))]
			/* 不传就用 CLI 的默认（5 / 180 秒）；老写法传 0 会把默认盖成「不限」 */
			if (a.minSec != null && Number(a.minSec) > 0) args.push('--min-sec', String(Number(a.minSec)))
			if (a.maxSec != null && Number(a.maxSec) > 0) args.push('--max-sec', String(Number(a.maxSec)))
			if (a.minDigg) args.push('--min-digg', String(a.minDigg))
			if (a.allow) args.push('--allow', String(a.allow))
			if (a.block) args.push('--block', String(a.block))
			if (a.markSeen) args.push('--mark-seen')
			return run(args, { timeout: 300000 })
		},
	})

	tool({
		name: 'douyin_studio_comment_self',
		description: [
			'在我自己的作品下发一条顶层评论（走 own 通道，额度最小：5 条/天）。',
			'🔴 真发要用户点头后传 confirm:true；dry:true 只校验。',
		].join(' '),
		parameters: {
			aweme: { type: 'string', description: '我的作品 id' },
			text: { type: 'string', description: '正文（≤500 字）' },
			dry: { type: 'boolean', description: '只校验不发送' },
			confirm: { type: 'boolean', description: '🔴 真发必须用户点头后传 true' },
		},
		execute: (a) => {
			const text = String(a.text || '').trim()
			if (!text) return { ok: false, error: '正文是空的' }
			if (!a.confirm && !a.dry) return { ok: false, needsConfirm: true, draft: text, aweme: String(a.aweme || ''), note: '点头后再带 confirm:true' }
			const args = ['comment-self', '--aweme', String(a.aweme), '--text', text]
			if (a.dry) args.push('--dry')
			return run(args, { timeout: 180000 })
		},
	})

	tool({
		name: 'douyin_studio_digest',
		description: [
			'刷一轮视频、挑最好的一条发给主人（私信分享卡片 + 一句感想）。',
			'条数与时间在设置里（每天刷几轮 / 每轮几条 / 每天私信发你几条 sharePerDay）。',
			'视频来源是刷视频那套筛子（关键词/时长/去重）。dry:true 只挑不发。',
		].join(' '),
		parameters: {
			dry: { type: 'boolean', description: '只挑视频不发送' },
		},
		execute: (a) => run(['digest', ...(a.dry ? ['--dry'] : [])], { timeout: 240000 }),
	})

	tool({
		name: 'douyin_studio_comment_at',
		description: [
			'在评论区发一条真的 @ 某个人的评论（带 text_extra，对方会收到抖音原生提醒）。',
			'不是分享卡片 —— 分享是把视频发到私信；这个是在视频评论区 @ 他。',
			'🔴 真发要用户点头后传 confirm:true；dry:true 只校验。',
		].join(' '),
		parameters: {
			aweme: { type: 'string', description: '视频 id' },
			to: { type: 'string', description: '对方抖音昵称（显示在 @ 后面）' },
			uid: { type: 'string', description: '对方数字 uid（认人只认这个）' },
			sec: { type: 'string', description: '对方 sec_uid' },
			text: { type: 'string', description: '正文（不含 @，会自动加在最前面；≤500 字）' },
			dry: { type: 'boolean', description: '只校验不发送' },
			confirm: { type: 'boolean', description: '🔴 真发必须用户点头后传 true' },
		},
		execute: (a) => {
			const text = String(a.text || '').trim()
			if (!text) return { ok: false, error: '正文是空的' }
			if (!a.to || !a.uid || !a.sec) return { ok: false, error: '缺 to / uid / sec（认人只认 uid + sec_uid）' }
			if (!a.confirm && !a.dry) return { ok: false, needsConfirm: true, draft: '@' + a.to + ' ' + text, aweme: String(a.aweme || ''), note: '点头后再带 confirm:true' }
			const args = ['comment-at', '--aweme', String(a.aweme), '--to', String(a.to), '--uid', String(a.uid), '--sec', String(a.sec), '--text', text]
			if (a.dry) args.push('--dry')
			return run(args, { timeout: 180000 })
		},
	})

	tool({
		name: 'douyin_studio_budget',
		description: '消息预算：今天各通道还剩几条、最近发了什么、总闸多少。reset=true 清空今天的账（慎用）。只读为主。',
		parameters: {
			recent: { type: 'number', description: '最近几条（默认 8）' },
			reset: { type: 'boolean', description: '清空今天的账（要真的重来才用）' },
		},
		execute: (a) => {
			const args = ['budget', '--recent', String(Math.min(Number(a.recent) || 8, 30))]
			if (a.reset === true) args.push('--reset')
			return run(args, { timeout: 60000 })
		},
	})

}
