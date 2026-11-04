/**
 * lib/trend.mjs —— 每天存一条「我的号什么水平」，攒成折线
 * ============================================================================
 * 为什么要落盘：接口只给「现在」，不给「趋势」。想知道这周涨了多少粉、播放有没有掉，
 * 只能自己每天记一笔。记的是**原始数字**，折线怎么画是面板的事。
 *
 * 一天只写一条（同一天重跑会覆盖当天的，不是追加），存 `douyin-duty/trend.jsonl`。
 * ============================================================================
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { self, works } from './api.mjs'
import { atomicWriteText } from './fsx.mjs'

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DIR = join(HOME, 'douyin-duty')
const FILE = join(DIR, 'trend.jsonl')

const day = (d = new Date()) => {
	const p = (n) => String(n).padStart(2, '0')
	return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

const num = (v) => {
	const n = Number(v)
	return Number.isFinite(n) ? n : 0
}

/** 抓一次现在的数（字段名以 api.mjs 的实际输出为准：self 给 follower/following/aweme_count/total_favorited，
 *  works 每条给 digg/comment/share/collect，**没有播放数**——所以播放那栏留 0，别编） */
export async function collect() {
	const me = await self()
	if (me && me.ok === false) return me
	const u = (me && me.user) || {}
	const ws = await works({ count: 20 })
	const list = (ws && ws.list) || []
	const diggs = list.reduce((s, w) => s + num(w.digg), 0)
	const comments = list.reduce((s, w) => s + num(w.comment), 0)
	return {
		ok: true,
		row: {
			day: day(),
			at: new Date().toISOString(),
			nick: u.nickname || '',
			followers: num(u.follower),
			following: num(u.following),
			liked_total: num(u.total_favorited),
			works: num(u.aweme_count),
			recent_works: list.length,
			recent_diggs: diggs,
			recent_comments: comments,
		},
	}
}

/** 追加/覆盖今天那条 */
export async function save() {
	const r = await collect()
	if (!r.ok) return r
	const rows = read()
	const i = rows.findIndex((x) => x && x.day === r.row.day)
	if (i >= 0) rows[i] = r.row
	else rows.push(r.row)
	/* 整份重写，所以必须原子：写到一半被杀，丢掉的是**全部历史**而不只是今天。 */
	const w = atomicWriteText(FILE, rows.map((x) => JSON.stringify(x)).join('\n') + '\n')
	if (!w.ok) return { ok: false, error: '趋势写不进去：' + w.error }
	return { ok: true, saved: r.row, total_days: rows.length }
}

/** 读全部（坏行直接跳过，不让一条脏数据毁掉整条曲线） */
export function read() {
	try {
		if (!existsSync(FILE)) return []
		return readFileSync(FILE, 'utf8')
			.split(/\r?\n/)
			.filter(Boolean)
			.map((l) => { try { return JSON.parse(l) } catch { return null } })
			.filter(Boolean)
			.sort((a, b) => String(a.day).localeCompare(String(b.day)))
	} catch { return [] }
}

/** 给面板/命令看：最近 n 天 + 首尾差 */
export function summary(n = 14) {
	const rows = read().slice(-n)
	if (!rows.length) return { ok: true, rows: [], note: '还没有历史，跑一次 trend save' }
	const first = rows[0]
	const last = rows[rows.length - 1]
	const delta = (k) => num(last[k]) - num(first[k])
	return {
		ok: true,
		rows,
		days: rows.length,
		from: first.day,
		to: last.day,
		delta: {
			followers: delta('followers'),
			liked_total: delta('liked_total'),
			works: delta('works'),
			recent_plays: delta('recent_plays'),
		},
	}
}

export { FILE as TREND_FILE }
