/**
 * lib/queue.mjs —— 失败重试队列
 * ============================================================================
 * 为什么要有：回评/发私信/发卡片都是「网络上真做了一件事」，一失败就没了，
 * 要么我重跑一遍（可能已经发过 → 重复），要么忘了（事情就这么丢了）。
 *
 * 做法：失败先落盘，记下「本来要做什么」；下次 `queue retry` 一条条重放，
 * 成功的删掉，试满 5 次还没成就标 dead（不再自动重试，等人看）。
 *
 * ⚠️ 重放必须**幂等**：回评靠 cid 去重、发私信靠内容+时间戳比对，
 *    已经成功的不会因为重放再发一次。
 * ============================================================================
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteJson, readJsonSafe } from './fsx.mjs'

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DIR = join(HOME, 'douyin-duty')
export const QUEUE_FILE = join(DIR, 'queue.json')

const MAX_TRIES = 5

/* 队列丢了 = 那些「本来要重放」的活儿凭空消失，而且没人会发现。
 * 所以原子写 + 读坏了留现场，见 lib/fsx.mjs。 */
/* 读的时候把整个文件记下来，写的时候原样带回去 —— 不认识的字段不能被 save 冲掉，
 * 这是 lib/autopilot.mjs 那次事故（2026-11-04，一晚 13 条私信）的同一个教训。 */
let META = {}
const load = () => {
	const j = readJsonSafe(QUEUE_FILE, null)
	META = j && typeof j === 'object' ? j : {}
	return j && Array.isArray(j.items) ? j.items : []
}
const save = (items) => atomicWriteJson(QUEUE_FILE, { ...META, updated_at: new Date().toISOString(), items })

let seq = 0
const id = () => 'q' + Date.now().toString(36) + (seq++).toString(36)

/** 记一条待重试（同名同类同目标的失败会合并成一条，只把次数往上加） */
export function add({ kind, payload = {}, error = '' }) {
	const items = load()
	const key = kind + ':' + JSON.stringify(payload)
	const hit = items.find((x) => x.key === key && x.state !== 'dead')
	if (hit) {
		hit.tries = Math.max(hit.tries, 0)
		hit.last_error = String(error).slice(0, 300)
		hit.updated_at = new Date().toISOString()
	} else {
		items.push({
			id: id(), key, kind, payload,
			tries: 0, state: 'pending',
			last_error: String(error).slice(0, 300),
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		})
	}
	save(items)
	return { ok: true, pending: items.filter((x) => x.state === 'pending').length }
}

export function list({ state = '' } = {}) {
	const items = load()
	return { ok: true, items: state ? items.filter((x) => x.state === state) : items }
}

const drop = (items, id2) => items.filter((x) => x.id !== id2)

/**
 * 重放。handlers = { reply(payload), dm(payload), share(payload) }
 * 返回每条的结果；成功的删除，失败的 tries+1，超限标 dead。
 */
export async function retry(handlers = {}, { limit = 5 } = {}) {
	const items = load()
	const todo = items.filter((x) => x.state === 'pending').slice(0, limit)
	const out = []
	let cur = items
	for (const it of todo) {
		const fn = handlers[it.kind]
		if (typeof fn !== 'function') {
			it.state = 'dead'
			it.last_error = '没有这种任务的处理函数: ' + it.kind
			out.push({ id: it.id, kind: it.kind, ok: false, error: it.last_error })
			continue
		}
		try {
			const r = await fn(it.payload)
			if (r && r.ok) {
				cur = drop(cur, it.id)
				out.push({ id: it.id, kind: it.kind, ok: true, result: r })
			} else {
				it.tries += 1
				it.last_error = String((r && (r.error || r.why)) || '失败').slice(0, 300)
				it.updated_at = new Date().toISOString()
				if (it.tries >= MAX_TRIES) { it.state = 'dead' }
				out.push({ id: it.id, kind: it.kind, ok: false, error: it.last_error, tries: it.tries })
			}
		} catch (e) {
			it.tries += 1
			it.last_error = String((e && e.message) || e).slice(0, 300)
			it.updated_at = new Date().toISOString()
			if (it.tries >= MAX_TRIES) it.state = 'dead'
			out.push({ id: it.id, kind: it.kind, ok: false, error: it.last_error, tries: it.tries })
		}
	}
	save(cur)
	return {
		ok: true,
		tried: out.length,
		done: out.filter((x) => x.ok).length,
		left: cur.filter((x) => x.state === 'pending').length,
		dead: cur.filter((x) => x.state === 'dead').length,
		results: out,
	}
}

export function clear({ dead = false } = {}) {
	const items = load().filter((x) => (dead ? x.state !== 'dead' : false))
	save(items)
	return { ok: true, left: items.length }
}
