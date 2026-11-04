/**
 * lib/budget.mjs —— 消息预算（一张表管住所有会「出门」的动作）
 * ============================================================================
 * 为什么要有它：回评有自己的账本（ledger.mjs，管去重 + 同视频/同人/同楼的细账），
 * 但**私信、@我、自己作品下发言**原来一个闸都没有。四个出口各算各的，等于没算。
 *
 * 这里的口径是「一条消息 = 一个名额」，按通道分池，再加一道总闸：
 *
 *   comment  回别人评论 / 楼中楼      （和 ledger 的 20 条/天叠加生效，谁先拦谁赢）
 *   dm       私信
 *   at       回 @我 的通知（落在评论区，但单独看，免得把回复额度吃光）
 *   own      在自己作品下发顶层评论
 *   publish  发作品（不占消息总闸，但自己有限额）
 *
 * 四道约束：通道日限 → 通道小时限 → 通道最小间隔 → 单人/单楼日限，
 * 最后统一卡「消息总闸」（totalPerDay，不含 publish）。
 *
 * 默认值刻意保守（2026-11-02 定）：小号被风控一次要停好几天，宁可少发。
 * 改额度：DOUYIN_STUDIO_LIMITS='{"perDay":{"dm":20}}' 或插件配置里的 limiters。
 *
 * 账本坏了 = **一律拒绝**（fail-closed）。宁可今天不回，也不要风控账号。
 * ============================================================================
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { atomicWriteJson, readJsonChecked } from './fsx.mjs'

/** 账本目录：和 ledger.mjs 同一处 */
export const homeDir = () => process.env.DOUYIN_STUDIO_HOME
	|| join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'douyin-studio')

export const budgetFile = () => join(homeDir(), 'budget.json')

export const CHANNELS = ['comment', 'dm', 'at', 'own', 'publish']

/** 默认额度（消息条数 / 秒） */
export const DEFAULTS = {
	perDay: { comment: 20, dm: 15, at: 10, own: 5, publish: 5 },
	perHour: { comment: 6, dm: 5, at: 4, own: 3, publish: 2 },
	/** 同一通道两条之间的最小间隔（秒）——比额度更能防「一口气刷出去」 */
	minGapSec: { comment: 45, dm: 60, at: 60, own: 30, publish: 120 },
	/** 四个消息通道加起来一天最多几条（publish 不算） */
	totalPerDay: 40,
	/** 对同一个人一天最多几条（dm / comment 两个通道分开算） */
	perPeerPerDay: { dm: 2, comment: 2 },
	/**
	 * 不设「同一人每天几条」上限的人（uid 或 sec_uid）。
	 * 主人号放这里：跟他说话不该被「今天已经回过 2 条」挡住。
	 * 其它闸（日总量 / 小时 / 间隔 / 同一栋楼）照旧。
	 */
	exemptPeers: [],
	/** 同一栋楼一天最多几条（comment） */
	perThreadPerDay: 1,
	/** 正文长度上限（字符） */
	textMax: 500,
	/** 私信正文上限（比评论更短，风控更敏感） */
	dmTextMax: 300,
}

/** 从环境变量叠一层（面板 / index.js 传进来的） */
function overrides() {
	const raw = process.env.DOUYIN_STUDIO_LIMITS
	if (!raw) return {}
	try {
		const j = JSON.parse(raw)
		return j && typeof j === 'object' ? j : {}
	} catch { return {} }
}

/** 合并后的实际额度（每次读都算，改环境变量不用重启进程） */
export function LIMITS() {
	const o = overrides()
	const pick = (key) => {
		const base = { ...DEFAULTS[key] }
		const add = o[key]
		if (!add || typeof add !== 'object') return base
		for (const ch of Object.keys(add)) {
			const n = Number(add[ch])
			if (Number.isFinite(n) && n >= 0) base[ch] = n
		}
		return base
	}
	const scalar = (key) => {
		const n = Number(o[key])
		return Number.isFinite(n) && n > 0 ? n : DEFAULTS[key]
	}
	const ex = Array.isArray(o.exemptPeers) ? o.exemptPeers.map(String).filter(Boolean) : [...DEFAULTS.exemptPeers]
	/* 主人号走单独的环境变量：设置页只填一个 uid，不用去拼 limitsJson */
	const owner = String(process.env.DOUYIN_STUDIO_OWNER_UID || '').trim()
	if (owner && !ex.includes(owner)) ex.push(owner)
	return {
		perDay: pick('perDay'),
		perHour: pick('perHour'),
		minGapSec: pick('minGapSec'),
		totalPerDay: scalar('totalPerDay'),
		perPeerPerDay: pick('perPeerPerDay'),
		perThreadPerDay: scalar('perThreadPerDay'),
		exemptPeers: ex,
		textMax: DEFAULTS.textMax,
		dmTextMax: DEFAULTS.dmTextMax,
	}
}

const today = (d = new Date()) => {
	const p = (n) => String(n).padStart(2, '0')
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const EMPTY = () => ({ day: today(), entries: [] })

/** 读账本；坏了返回 {broken:true}，调用方必须拒绝 */
export function read() {
	const f = budgetFile()
	const { value, corrupt } = readJsonChecked(f, null, (v) => v && typeof v === 'object' && Array.isArray(v.entries))
	if (corrupt) return { broken: true, corrupt, file: f, day: today(), entries: [] }
	if (!value) return { broken: false, file: f, ...EMPTY() }
	/* 跨天：老条目留着没用，但保留最近 200 条供人看 */
	const day = today()
	if (value.day !== day) return { broken: false, file: f, day, entries: [], prevDay: value.day, prevCount: (value.entries || []).length }
	return { broken: false, file: f, day, entries: Array.isArray(value.entries) ? value.entries : [] }
}

/** 只统计今天的、某个通道的条数 */
const count = (entries, ch, sinceMs = 0) => entries.filter((e) => e && e.ch === ch && (!sinceMs || (e.at || 0) >= sinceMs)).length

/**
 * 看还能不能发。**纯读**，不改账本。
 * @param {{ch:string, peer?:string, thread?:string, text?:string, now?:number}} p
 * @returns {{ok:boolean, why?:string, retryAfter?:string, quota:object}}
 */
export function check({ ch, peer = '', thread = '', text = '', now = Date.now() } = {}) {
	const L = LIMITS()
	if (!CHANNELS.includes(ch)) return { ok: false, why: '不认识的通道: ' + ch, quota: stats() }
	const b = read()
	const quota = stats()
	if (b.broken) {
		return { ok: false, why: `预算账本坏了（已挪到 ${b.corrupt || '旁边'}），今天先别发`, quota, broken: true }
	}
	const body = String(text || '')
	const max = ch === 'dm' ? L.dmTextMax : L.textMax
	if (body.length > max) return { ok: false, why: `正文 ${body.length} 字，上限 ${max}`, quota }

	const es = b.entries
	const nowMs = now
	const hourAgo = nowMs - 3600_000
	const dayN = count(es, ch)
	const hourN = count(es, ch, hourAgo)

	if (dayN >= L.perDay[ch]) return { ok: false, why: `${ch} 今天已发 ${dayN} 条（上限 ${L.perDay[ch]}）`, quota }
	if (hourN >= L.perHour[ch]) return { ok: false, why: `${ch} 这一小时已发 ${hourN} 条（上限 ${L.perHour[ch]}），缓一缓`, quota }

	const last = es.filter((e) => e && e.ch === ch).sort((a, b2) => (b2.at || 0) - (a.at || 0))[0]
	const gapMs = (L.minGapSec[ch] || 0) * 1000
	if (last && nowMs - (last.at || 0) < gapMs) {
		const left = Math.ceil((gapMs - (nowMs - (last.at || 0))) / 1000)
		return { ok: false, why: `${ch} 两条之间要隔 ${L.minGapSec[ch]} 秒，还差 ${left} 秒`, retryAfter: `${left}s`, quota }
	}

	if (ch !== 'publish') {
		const msgs = es.filter((e) => e && e.ch !== 'publish').length
		if (msgs >= L.totalPerDay) return { ok: false, why: `今天消息总数 ${msgs} 条到顶了（总闸 ${L.totalPerDay}）`, quota }
	}

	const peerCap = L.perPeerPerDay[ch]
	const exempt = (L.exemptPeers || []).includes(String(peer))
	if (peer && peerCap && !exempt && es.filter((e) => e && e.ch === ch && e.peer === String(peer)).length >= peerCap) {
		return { ok: false, why: `同一个人（${peer}）今天已 ${ch} ${peerCap} 条`, quota }
	}
	if (ch === 'comment' && thread && es.filter((e) => e && e.ch === ch && e.thread === String(thread)).length >= L.perThreadPerDay) {
		return { ok: false, why: `同一栋楼（${thread}）今天已经回过 ${L.perThreadPerDay} 条`, quota }
	}
	return { ok: true, quota }
}

/**
 * 记一条（发成功之后调用）。
 * @param {{ch:string, peer?:string, thread?:string, note?:string, now?:number}} p
 */
export function record({ ch, peer = '', thread = '', note = '', now = Date.now() } = {}) {
	const b = read()
	if (b.broken) return { ok: false, why: '预算账本坏了，不敢写（怕把证据覆盖掉）' }
	const es = (b.entries || []).slice(-400)
	es.push({ ch, at: now, peer: String(peer || ''), thread: String(thread || ''), note: String(note || '').slice(0, 60) })
	const day = today()
	const w = atomicWriteJson(budgetFile(), { day, entries: es })
	return w.ok ? { ok: true, count: es.length } : { ok: false, why: w.error }
}

/** 给面板 / doctor 看的快照 */
export function stats(now = Date.now()) {
	const L = LIMITS()
	const b = read()
	const es = b.broken ? [] : b.entries
	const hourAgo = now - 3600_000
	const per = {}
	for (const ch of CHANNELS) {
		const dayN = count(es, ch)
		const hourN = count(es, ch, hourAgo)
		const last = es.filter((e) => e && e.ch === ch).sort((a, c) => (c.at || 0) - (a.at || 0))[0]
		per[ch] = {
			day: dayN, dayMax: L.perDay[ch],
			hour: hourN, hourMax: L.perHour[ch],
			lastAt: last ? new Date(last.at).toISOString() : '',
			left: Math.max(0, L.perDay[ch] - dayN),
		}
	}
	const msgs = es.filter((e) => e && e.ch !== 'publish').length
	return {
		day: b.day,
		broken: Boolean(b.broken),
		file: budgetFile(),
		per,
		messages: { day: msgs, max: L.totalPerDay, left: Math.max(0, L.totalPerDay - msgs) },
		limits: L,
	}
}

/** 最近几条（面板用） */
export function recent(n = 10) {
	const b = read()
	if (b.broken) return []
	return (b.entries || []).slice(-Math.max(1, Math.min(Number(n) || 10, 50))).map((e) => ({
		ch: e.ch, peer: e.peer, thread: e.thread, note: e.note,
		at: e.at ? new Date(e.at).toISOString() : '',
	}))
}

/** 今天的账清空（只用于「我要重新开始」这种显式操作） */
export function reset() {
	const f = budgetFile()
	if (!existsSync(f)) return { ok: true, already: true }
	const w = atomicWriteJson(f, { day: today(), entries: [] })
	return w.ok ? { ok: true } : { ok: false, why: w.error }
}
