/**
 * 第二批工具（2026-11-05）：无人值守、互动灰度、作业账
 * ============================================================================
 * 为什么单独一个文件：`lib/tools.mjs` 已经 728 行，体量闸是 760。把新东西塞进去，
 * 下一轮谁想改 publish 都得先拆文件。这里只放"看/开/关"三类，真正动手的仍在 CLI。
 */
import { readSettings, writeSettings } from './settings.mjs'
import { windowState, autoFile, readAuto } from './unattended.mjs'
import { planEngage, authorsOf, usedToday, engageFile } from './engage.mjs'
import { readJobs, jobsFile } from './jobs.mjs'
import { isKilled, killedReply } from './killswitch.mjs'
import { load as loadPicks } from './picks.mjs'

/**
 * 注册这三条工具。
 * @param {{ctx:any, defineTool:Function, textOutput:any}} deps 宿主注入的注册器
 */
export function registerExtraTools({ ctx, defineTool, textOutput }) {
	/**
	 * ⚠️ 2026-11-07 修：这里原来返回 `JSON.stringify(v)`（字符串），而三条工具的
	 * `output` 用的是 index.js 的 textOutput —— 它的 schema 是 `type:'object'`。
	 * 宿主校验不过 ⇒ 三条工具一律报 `invalid output: "value" must be an object`。
	 * 老工具（lib/tools.mjs:48-56 的 safe）返回的是**对象**，所以只有这三条新工具全废。
	 * 现在统一走对象；JSON 往返只为去掉 undefined / 函数这类不可序列化的东西。
	 */
	const ok = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v)
	const tool = (spec) => ctx.tools.register(defineTool({
		...spec,
		output: textOutput,
		execute(args) { return ok(spec.execute(args || {})) },
	}))

	tool({
		name: 'douyin_studio_unattended',
		description: [
			'无人值守发布：status 看窗口与今天额度，on/off 开关，可顺带改 from/to/perDay。',
			'开了也只是"允许"，真发还要过：窗口内、额度未满、首跑 dry 过、总闸没开。默认关。',
		].join(' '),
		parameters: {
			action: { type: 'string', enum: ['status', 'on', 'off'], description: '默认 status' },
			from: { type: 'string', description: '窗口开始 HH:MM（可跨零点）' },
			to: { type: 'string', description: '窗口结束 HH:MM' },
			perDay: { type: 'number', description: '每天最多自动发几条（0–5）' },
		},
		execute: (a) => {
			const patch = {}
			for (const k of ['from', 'to']) {
				if (typeof a[k] === 'string' && a[k]) patch['unattended' + k[0].toUpperCase() + k.slice(1)] = a[k]
			}
			if (a.perDay !== undefined) patch.unattendedPerDay = a.perDay
			const action = String(a.action || 'status')
			if (action === 'on' && isKilled()) return killedReply('unattended.on')
			if (action === 'on' || action === 'off') patch.unattendedPublish = action === 'on'
			if (Object.keys(patch).length) {
				const w = writeSettings(patch)
				if (!w.ok) return { ok: false, error: w.error }
			}
			const S = readSettings()
			return { ok: true, ...windowState(S), file: autoFile(), recent: readAuto().slice(-3) }
		},
	})

	tool({
		name: 'douyin_studio_engage',
		description: [
			'主动互动灰度：status 看额度与白名单，plan 从已收集的候选里挑出"今天会碰谁"（只出清单，不发东西），on/off 开总开关。',
			'白名单为空时一条都不会碰；同一个作者一天只碰一次。执行仍走 comment_at / share，且要 confirm。',
		].join(' '),
		parameters: {
			action: { type: 'string', enum: ['status', 'plan', 'on', 'off'], description: '默认 status' },
			authors: { type: 'string', description: '白名单作者，逗号分隔（on 时建议一起给）' },
		},
		execute: (a) => {
			const action = String(a.action || 'status')
			if (action === 'on' && isKilled()) return killedReply('engage.on')
			const patch = {}
			if (typeof a.authors === 'string' && a.authors.trim()) patch.engageAuthors = a.authors.trim()
			if (action === 'on' || action === 'off') patch.engageOn = action === 'on'
			if (Object.keys(patch).length) {
				const w = writeSettings(patch)
				if (!w.ok) return { ok: false, error: w.error }
			}
			const S = readSettings()
			const used = usedToday()
			if (action !== 'plan') {
				return { ok: true, on: S.engageOn, authors: authorsOf(S), perDay: S.engagePerDay, used: used.count, gapSec: S.engageGapSec, file: engageFile() }
			}
			let items = []
			/* picks.load() 回的是 {updatedAt, items}，不是数组。
			 * 以前直接 .slice() → TypeError 吞进 catch → 清单永远是空的。 */
			try {
				const r = loadPicks()
				const arr = Array.isArray(r) ? r : (r && r.items) || []
				items = Array.isArray(arr) ? arr.slice(0, 300) : []
			} catch { items = [] }
			return planEngage(S, { items })
		},
	})

	tool({
		name: 'douyin_studio_jobs',
		description: '后台作业账：最近几条（成功/失败/耗时/是否被总闸挡）。查"昨晚那一轮为什么没跑"用这个。',
		parameters: {
			count: { type: 'number', description: '几条（默认 10，最多 50）' },
		},
		execute: (a) => {
			const n = Math.max(1, Math.min(50, Number(a.count) || 10))
			return { ok: true, killed: isKilled(), file: jobsFile(), jobs: readJobs(n) }
		},
	})
}
