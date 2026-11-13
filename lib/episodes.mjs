/**
 * lib/episodes.mjs —— 一周压成三条「情节」，不是流水账。
 *
 * 为什么（2026-11-13）：现在只有 diary 和 events，两个极端——一个太碎（每条事件一行），
 * 一个太概括（今天回了几条）。中间那层才像人的记忆：
 * 「这周跟一个总在半夜留言的人聊了两次」「发了三条，都是猫」。
 *
 * 规矩：
 *   - 每条情节必须绑 `refs`（事件 id），点得回去，不许凭空总结；
 *   - 只写有证据的事，数量对不上就写数量；
 *   - 一周只生成一次（同一周重复调用返回同一份）。
 */

import { join } from 'node:path'
import { studioHome } from './killswitch.mjs'
import { atomicWriteJson, readJsonSafe } from './fsx.mjs'
import { readEvents } from './events.mjs'

export const episodesFile = () => join(studioHome(), 'episodes.json')

const DAY = 24 * 3600 * 1000

/** 周一为一周开始（本地时区） */
export function weekKey(now = Date.now()) {
	const d = new Date(now)
	const day = (d.getDay() + 6) % 7
	const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day)
	const p = (n) => String(n).padStart(2, '0')
	return `${mon.getFullYear()}-${p(mon.getMonth() + 1)}-${p(mon.getDate())}`
}

const KIND_LABEL = {
	publish: '发了一条作品',
	comment: '回了评论',
	at: '@ 了哥哥',
	dm: '发了私信',
	share: '分享了视频',
	like: '点了赞',
	scan: '刷了一轮',
}

/** 只有这些算「做了事」；scan/status/refresh/ledger-start 是机器动作，不进情节 */
export const ACTION_KINDS = ['publish', 'comment', 'at', 'dm', 'share', 'like']

/**
 * 从事件里压三条：
 *   1) 产出（发/回/私信各多少，一条代表）
 *   2) 人（和谁打交道最多）
 *   3) 意外（失败、被跳过、或最晚的一次动作）
 */
export function buildEpisode({ events = [], week = '', now = Date.now() } = {}) {
	const list = (Array.isArray(events) ? events : []).filter((e) => e && e.id && e.at)
	const okOnes = list.filter((e) => !e.result || e.result.ok !== false)
	const acts = okOnes.filter((e) => ACTION_KINDS.includes(e.kind))
	const counts = {}
	for (const e of acts) counts[e.kind] = (counts[e.kind] || 0) + 1

	const out = []

	const produced = ACTION_KINDS.filter((k) => counts[k])
	if (produced.length) {
		/* refs 必须真是这几类事，不能随便抓前三条 */
		const refs = acts.filter((e) => counts[e.kind]).slice(0, 3).map((e) => e.id)
		out.push({ text: '这周' + produced.map((k) => `${KIND_LABEL[k]} ${counts[k]} 次`).join('，'), refs })
	}

	// 和谁打交道最多：优先有 nick 的目标
	const byWho = new Map()
	for (const e of okOnes) {
		const nick = e.target && (e.target.nick || e.target.uid)
		if (!nick) continue
		const cur = byWho.get(String(nick)) || { n: 0, refs: [] }
		cur.n += 1
		if (cur.refs.length < 2) cur.refs.push(e.id)
		byWho.set(String(nick), cur)
	}
	const top = [...byWho.entries()].sort((a, b) => b[1].n - a[1].n)[0]
	if (top && top[1].n >= 2) {
		out.push({ text: `和「${top[0]}」碰过 ${top[1].n} 次`, refs: top[1].refs })
	}

	const bad = list.filter((e) => e.result && e.result.ok === false)
	if (bad.length) {
		const last = bad[bad.length - 1]
		out.push({
			text: `有 ${bad.length} 次没成（最近一次：${String((last.result && last.result.error) || '没说原因').slice(0, 40)}）`,
			refs: bad.slice(-2).map((e) => e.id),
		})
	} else if (acts.length) {
		const last = acts[acts.length - 1]
		out.push({
			text: `最近一次是${KIND_LABEL[last.kind] || last.kind}（${new Date(last.at).toLocaleString('zh-CN')}）`,
			refs: [last.id],
		})
	}

	return { week, at: Number(now), lines: out.slice(0, 3) }
}

/** 读本周情节；没有就从事件里现压一份并落盘 */
export function weeklyEpisode({ now = Date.now(), events = null } = {}) {
	const week = weekKey(now)
	const saved = readJsonSafe(episodesFile(), null)
	if (saved && saved.week === week && Array.isArray(saved.lines)) return saved
	const evs = events || readEvents(400)
	const fresh = buildEpisode({ events: evs, week, now })
	try {
		atomicWriteJson(episodesFile(), fresh)
	} catch {
		/* 写不进去也能用，下次重算 */
	}
	return fresh
}

/** 给提示词：一句到三句，带证据感但不报 id */
export function episodeLine({ now = Date.now() } = {}) {
	const ep = weeklyEpisode({ now })
	const lines = ep.lines.map((x) => x.text)
	return lines.length ? lines.join('；') : ''
}

export const weekAgo = (now = Date.now()) => now - 7 * DAY
