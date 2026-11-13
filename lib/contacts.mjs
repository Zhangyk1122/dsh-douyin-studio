/**
 * lib/contacts.mjs —— 评论区的人，是一张会长的脸，不是一串 id。
 *
 * 为什么要这个（2026-11-13）：
 *   回复「没特色」的根子不是文笔，是**每一条都像第一次见**。
 *   同一个人上个月来过三次、说过「猫又掉毛了」「加班到两点」，
 *   下次他再来，回复里如果能接一句「上次那摊毛还没扫完吧」，
 *   那才叫认识；不然每条都只能说「哈哈好可爱」。
 *
 * 存哪：`<studioHome>/contacts.json`
 *   { rev, at, users: { "<uid>": { nick, secUid, count, replies, firstAt, lastAt, texts:[…3] } } }
 *
 * 规矩（都是为了不让这张脸变糊）：
 *   - 只记**他说的原话**，不记我们的推测、不记情绪标签、不记模型总结；
 *   - 一人最多留 3 句、每句 ≤80 字，新的顶掉旧的；
 *   - 最多 400 人，满了就丢「最久没出现且从没回过」的那些；
 *   - 读坏了当空表（readJsonSafe），不因为一个坏文件把值班干停。
 */

import { join } from 'node:path'
import { studioHome } from './killswitch.mjs'
import { atomicWriteJson, readJsonSafe } from './fsx.mjs'

export const MAX_USERS = 400
export const MAX_TEXTS = 3
export const MAX_TEXT_CHARS = 80

const now = () => Date.now()

export const contactsFile = () => join(studioHome(), 'contacts.json')

const cleanText = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS)

/** 读全表：坏文件/老格式都归一成 { rev, users }。 */
export function loadContacts() {
	const raw = readJsonSafe(contactsFile(), { rev: 0, users: {} })
	const users = raw && typeof raw.users === 'object' && raw.users ? raw.users : {}
	const out = {}
	for (const [uid, u] of Object.entries(users)) {
		if (!uid || !u || typeof u !== 'object') continue
		out[uid] = {
			nick: String(u.nick || '').slice(0, 40),
			secUid: String(u.secUid || '').slice(0, 120),
			count: Math.max(0, Number(u.count) || 0),
			replies: Math.max(0, Number(u.replies) || 0),
			firstAt: Number(u.firstAt) || 0,
			lastAt: Number(u.lastAt) || 0,
			/* 热度：被召回几次。30 天没被想起就自己淡掉（对齐 Ombre 的遗忘曲线） */
			heat: Math.max(0, Number(u.heat) || 0),
			lastHit: Number(u.lastHit) || 0,
			texts: Array.isArray(u.texts) ? u.texts.map(cleanText).filter(Boolean).slice(0, MAX_TEXTS) : [],
		}
	}
	return { rev: Number(raw && raw.rev) || 0, users: out }
}

export function saveContacts(db) {
	const next = { rev: (Number(db && db.rev) || 0) + 1, at: now(), users: (db && db.users) || {} }
	atomicWriteJson(contactsFile(), next)
	return next
}

/** 满了先丢最没价值的人：从没回过、且最久没出现。 */
function trim(users) {
	const keys = Object.keys(users)
	if (keys.length <= MAX_USERS) return users
	const score = (k) => (users[k].replies > 0 ? 1e12 : 0) + (users[k].lastAt || 0)
	const keep = keys.sort((a, b) => score(b) - score(a)).slice(0, MAX_USERS)
	const out = {}
	for (const k of keep) out[k] = users[k]
	return out
}

/**
 * 记一次「他说了句话」。同句不重复记（他连发两条一样的，只算一次）。
 * @param {{uid?:string, nick?:string, secUid?:string, text?:string, at?:number}} c
 */
export function remember(c = {}) {
	const uid = String(c.uid || c.authorUid || '').trim()
	const text = cleanText(c.text)
	if (!uid || !text) return null
	const db = loadContacts()
	const u = db.users[uid] || { nick: '', secUid: '', count: 0, replies: 0, firstAt: now(), lastAt: 0, texts: [] }
	u.count += 1
	u.lastAt = Number(c.at) || now()
	if (c.nick) u.nick = String(c.nick).slice(0, 40)
	if (c.secUid) u.secUid = String(c.secUid).slice(0, 120)
	if (!u.texts.includes(text)) u.texts = [text, ...u.texts].slice(0, MAX_TEXTS)
	db.users[uid] = u
	db.users = trim(db.users)
	saveContacts(db)
	return u
}

/** 我们回过他一次 —— 只动计数与时间，不改他说过的话。 */
export function noteReply(uid) {
	const key = String(uid || '').trim()
	if (!key) return null
	const db = loadContacts()
	const u = db.users[key]
	if (!u) return null
	u.replies += 1
	u.lastAt = now()
	saveContacts(db)
	return u
}

export function profileOf(uid) {
	const key = String(uid || '').trim()
	if (!key) return null
	const db = loadContacts()
	return db.users[key] || null
}

/** 热度衰减一半要 30 天；读的时候算，不写回。 */
export const HEAT_HALF_LIFE_D = 30

export function heatOf(u, at = now()) {
	if (!u) return 0
	const h = Math.max(0, Number(u.heat) || 0)
	if (!h) return 0
	const days = Math.max(0, (Number(at) - (Number(u.lastHit) || Number(u.lastAt) || Number(at))) / 86400000)
	return h * Math.pow(0.5, days / HEAT_HALF_LIFE_D)
}

/** 被想起来一次：热度 +1，记时间。 */
export function bumpHeat(uid, at = now()) {
	const key = String(uid || '').trim()
	if (!key) return null
	const db = loadContacts()
	const u = db.users[key]
	if (!u) return null
	u.heat = Math.max(0, Number(u.heat) || 0) + 1
	u.lastHit = Number(at) || now()
	saveContacts(db)
	return u
}

/**
 * 给提示词用的一行「这个人」。没有记录就返回 ''（**不许编**）。
 * 只有 count>=2 才说「来过几次」——第一次来的人不该被说成熟客。
 * @param {string} uid
 * @param {{maxTexts?:number}} [o]
 */
export function summaryFor(uid, { maxTexts = 2 } = {}) {
	const u = profileOf(uid)
	if (!u || !u.texts.length) return ''
	const bits = []
	if (u.count >= 2) bits.push('来过 ' + u.count + ' 次')
	if (u.replies > 0) bits.push('你回过他 ' + u.replies + ' 次')
	const said = u.texts.slice(0, Math.max(1, maxTexts)).map((t) => '「' + t + '」').join('')
	return (bits.length ? bits.join('，') + '，' : '') + '以前说过' + said
}

/** 面板/自检用：只给规模，不吐原文（原文属于用户数据）。 */
export function stats() {
	const db = loadContacts()
	const all = Object.values(db.users)
	return {
		users: all.length,
		known: all.filter((u) => u.count >= 2).length,
		replied: all.filter((u) => u.replies > 0).length,
	}
}
