/**
 * lib/purpose.mjs —— 「今天想干什么」，不是一个随机任务，是三段有前后文的打算。
 *
 * 为什么要这个（2026-11-13）：
 *   现在每一轮都是「刷到一条 → 决定要不要互动」，没有一天的样子。
 *   真人一天是有形状的：早上随便看看，下午想找点东西画，晚上想跟人说话。
 *   有了这个，主动开口才有由头（「今天想做 X，正好看到 Y」），而不是硬找话。
 *
 * 存哪：`<studioHome>/purpose.json`
 *   { day:'2026-11-13', createdAt, items:[{ slot:'morning'|'afternoon'|'night', text, done, doneAt }] }
 *
 * 规矩：
 *   - 同一天多次调用必须给出同一份（用 day 做种子，别每次随机）；
 *   - 时段按本地时间切：<11 早上、<18 下午、其余晚上；
 *   - 文案只写「打算」，不写结果；不带话题标签、不带 @；
 *   - 兴趣词只用来「掺一条」，不是每条都塞。
 */

import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { studioHome } from './killswitch.mjs'
import { atomicWriteJson, readJsonSafe } from './fsx.mjs'
import { readSettings } from './settings.mjs'

export const SLOTS = Object.freeze(['morning', 'afternoon', 'night'])

/** 每个时段的候选：都写得像人自己的打算，不像任务清单 */
const POOL = Object.freeze({
	morning: [
		'随便刷一会儿，看到有意思的就存下来',
		'想找点安静的东西看，别太吵',
		'把昨天没看完的那条看完',
		'起来先发会儿呆，不急着干什么',
	],
	afternoon: [
		'想画点东西，画到哪儿算哪儿',
		'想找几条能存下来的，攒着以后用',
		'想正经看几个教程，别光刷',
		'想整理一下自己存的东西',
	],
	night: [
		'想跟人说说话，别一个人待着',
		'想找点好吃的看，看饿了就睡',
		'想早点躺下，今天有点累',
		'想看看今天有没有人找我',
	],
})

/** 兴趣词掺进来的句式（只用在下午/晚上，早上不加） */
const KEYWORD_PATTERNS = ['想看看「%s」相关的东西', '想找找「%s」有没有新的']

const dayKey = (now) => {
	const d = new Date(now)
	const p = (n) => String(n).padStart(2, '0')
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function slotOf(now = Date.now()) {
	const h = new Date(now).getHours()
	if (h < 11) return 'morning'
	if (h < 18) return 'afternoon'
	return 'night'
}

const seedInt = (s) => {
	const h = createHash('sha256').update(String(s)).digest()
	return h.readUInt32BE(0)
}

const pick = (list, seed) => {
	const i = Math.abs(Math.trunc(seed)) % list.length
	return list[i]
}

/** 一天的打算：同一天稳定，换天自动换 */
export function planDay({ now = Date.now(), keywords = [] } = {}) {
	const day = dayKey(now)
	const words = (Array.isArray(keywords) ? keywords : [])
		.map((w) => String(w || '').trim())
		.filter(Boolean)
		.slice(0, 20)
	const items = SLOTS.map((slot, i) => {
		const seed = seedInt(`${day}:${slot}`)
		let text = pick(POOL[slot], seed)
		// 下午/晚上掺一条兴趣词；词也按种子挑，别总用第一个
		if (slot !== 'morning' && words.length && seed % 3 !== 0) {
			const w = pick(words, seed >> 3)
			text = pick(KEYWORD_PATTERNS, seed >> 5).replace('%s', w)
		}
		return { slot, text, done: false, doneAt: 0, order: i }
	})
	return { day, createdAt: Number(now), items }
}

export const purposeFile = () => join(studioHome(), 'purpose.json')

function normPlan(raw, now) {
	const day = dayKey(now)
	if (!raw || typeof raw !== 'object' || raw.day !== day || !Array.isArray(raw.items)) return null
	const items = SLOTS.map((slot, i) => {
		const it = raw.items.find((x) => x && x.slot === slot) || {}
		return {
			slot,
			text: String(it.text || '').slice(0, 60) || POOL[slot][0],
			done: Boolean(it.done),
			doneAt: Number(it.doneAt) || 0,
			order: i,
		}
	})
	return { day, createdAt: Number(raw.createdAt) || Number(now), items }
}

/** 读今天的打算；没有/过期就现生成并落盘 */
export function loadPurpose({ now = Date.now(), keywords = null } = {}) {
	const saved = normPlan(readJsonSafe(purposeFile(), null), now)
	if (saved) return saved
	const words = keywords == null ? (readSettings().scanKeywords || []) : keywords
	const fresh = planDay({ now, keywords: words })
	try {
		atomicWriteJson(purposeFile(), fresh)
	} catch {
		/* 写不进去也照样能用，只是下次会重生成 */
	}
	return fresh
}

/** 当前时段那条（给提示词用）；整点前后都稳 */
export function currentIntent(now = Date.now(), plan = null) {
	const p = plan || loadPurpose({ now })
	const slot = slotOf(now)
	const it = p.items.find((x) => x.slot === slot)
	return it || { slot, text: POOL[slot][0], done: false, doneAt: 0 }
}

export function markDone(slot, now = Date.now()) {
	const p = loadPurpose({ now })
	const it = p.items.find((x) => x.slot === slot)
	if (!it) return p
	if (!it.done) {
		it.done = true
		it.doneAt = Number(now)
		atomicWriteJson(purposeFile(), p)
	}
	return p
}

/** 一句话：今天这会儿想干什么（写进提示词，别写进正文） */
export function purposeLine(now = Date.now(), plan = null) {
	const it = currentIntent(now, plan)
	return it.done ? `今天这个时候本来想做「${it.text}」，已经做过了` : `今天这个时候想做「${it.text}」`
}

export function purposeSnapshot(now = Date.now()) {
	const p = loadPurpose({ now })
	return { day: p.day, now: slotOf(now), line: purposeLine(now, p), items: p.items }
}
