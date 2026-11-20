/**
 * lib/dashboard.mjs —— 「现在这一刻的调度与值班状态」的唯一读数口
 * ============================================================================
 * 为什么从 index.js 抽出来：宿主把 index.js 常驻内存，改完不重启就验不了；
 * 而本项目的规矩是「同一套逻辑必须能被 CLI 直接跑」。快照逻辑放进 lib，
 * 面板路由和 `node tools/dy.mjs schedule` 共用一份，随时能用真实数据验。
 *
 * 只读：不写任何状态文件、不发请求、不触发刷新。
 * 注：不叫 snapshot.mjs —— 那个名字已经被「截图存档」占了。
 * ============================================================================
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readJsonSafe } from './fsx.mjs'
import { planDay, decide, formatClock } from './scheduler.mjs'
import * as ROUNDS from './roundstate.mjs'
import { readRuns } from './runlog.mjs'
import { heroView, dutyLogView, funnelView } from './viewmodel.mjs'
import { readSettings } from './settings.mjs'
import * as BUDGET from './budget.mjs'
import { recent as ledgerRecent } from './ledger.mjs'
import { repliedMap } from './autopilot.mjs'

/** 纯拼装：所有外部数据由调用方给，便于单测。 */
export function buildSnapshot({
	now = Date.now(), settings = {}, budgetStats = null, inbox = {},
	runs = [], replies = [], ledger = [], rows = [], state = null, health = null, paused = false,
} = {}) {
	const plan = planDay(settings, now)
	const s = state || { day: '', done: 0, failures: 0 }
	const same = s.day === plan.day
	const done = same ? Math.max(0, Number(s.done) || 0) : 0
	const failures = same ? Math.max(0, Number(s.failures) || 0) : 0
	const quotaLeft = budgetStats && budgetStats.messages
		? Number(budgetStats.messages.left)
		: null
	const next = decide({ now, plan, done, failures, quotaLeft, paused })
	return {
		ok: true, day: plan.day, mode: plan.mode,
		points: plan.points.map(formatClock), spreadMin: plan.spreadMin,
		done, failures, quotaLeft, paused,
		health: health || { level: next.level === 'stop' ? 'stop' : 'ok', failures, reason: '' },
		next,
		summary: ROUNDS.summarizeRounds(rows),
		rounds: rows.slice(-8).reverse(),
		/* 2026-11-19 本地修：头部「待回」要扣掉已经回过的 —— 否则回过一次也永远挂着 1。
		 * 只影响 hero 这一个数字；漏斗仍用原始 inbox（它统计的是「看到/值得」）。 */
		hero: (() => {
			const rm = (() => { try { return repliedMap() } catch { return { dm: {}, at: {} } } })()
			const atKey = (x) => String((x && x.aweme_id) || '') + ':' + String((x && (x.comment_id || x.root_comment_id)) || '')
			const cut = (pack, drop) => (pack && Array.isArray(pack.items)
				? { ...pack, items: pack.items.filter((x) => !drop(x)) }
				: pack)
			const filtered = {
				...inbox,
				dm: cut(inbox && inbox.dm, (x) => {
					const r = x && rm.dm[String(x.uid)]
					if (!r) return false
					const t = x && x.last_at
					return !(t && String(t) > String(r))
				}),
				at: cut(inbox && inbox.at, (x) => Boolean(x && rm.at[atKey(x)])),
			}
			const countPending = (ib) => {
				const packs = [ib && ib.dm, ib && ib.at, ib && ib.own].filter(Boolean)
				const items = packs.length
					? packs.flatMap((q) => (Array.isArray(q.items) ? q.items : []))
					: (Array.isArray(ib && ib.items) ? ib.items : [])
				return items.filter((x) => x && x.worth !== false && x.status !== 'skip').length
			}
			const hasInbox = Boolean(inbox && (inbox.dm || inbox.at || inbox.own || Array.isArray(inbox.items)))
			return heroView({
				budget: budgetStats || {},
				inbox: filtered,
				runs, replies, now,
				pendingOverride: hasInbox ? countPending(filtered) : undefined,
			})
		})(),
		log: dutyLogView({ runs, replies, rounds: rows, now }),
		funnel: funnelView({ inbox, replies: ledger, now }),
	}
}

/** 从盘上读一份真实快照。inboxData 由调用方给（宿主有内存缓存，CLI 没有）。 */
export function readSnapshot(now = Date.now(), inboxData = null) {
	const settings = readSettings()
	let budgetStats = null
	try { budgetStats = BUDGET.stats(now) } catch { /* 读不到就不设额度闸 */ }
	let inbox = inboxData
	if (!inbox) {
		/* 收件箱缓存历史上放在 douyin-duty，其它状态在 douyin-studio —— 两处都找。 */
		const base = process.env.DSH_HOME || join(homedir(), '.dsh')
		const candidates = [
			join(ROUNDS.dir(), 'inbox-cache.json'),
			join(base, 'douyin-duty', 'inbox-cache.json'),
		]
		for (const f of candidates) {
			const cache = readJsonSafe(f, null,
				(v) => Boolean(v && typeof v === 'object' && v.at && v.data))
			if (cache) { inbox = cache.data; break }
		}
		inbox = inbox || {}
	}
	let replies = []
	let ledger = []
	try {
		ledger = ledgerRecent(40)
		replies = ledger.slice(0, 6).map((r) => ({
			kind: 'send:comment', ok: true, at: r.at || '',
			who: r.author || '', target: r.author || r.cid || '',
			detail: String(r.text || '').slice(0, 50), error: '',
		}))
	} catch { /* 业务账读不到就只靠动作账 */ }
	return buildSnapshot({
		now, settings, budgetStats, inbox, replies, ledger,
		runs: readRuns(40),
		rows: ROUNDS.readRounds(30, planDay(settings, now).day),
		state: ROUNDS.readState(),
		health: ROUNDS.readHealth(),
		paused: ROUNDS.isPaused(),
	})
}
