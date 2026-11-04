/**
 * 昵称缓存：私信接口（imapi 2043）里**没有昵称**——只有 uid 和消息正文。
 * 但 `/chat` 页面上每行都有昵称，所以：
 *   ① 打开 /chat 抄下「昵称 + 最后一条消息」
 *   ② 跟接口拿到的会话列表按「最后一条消息」对上
 *   ③ 对得上、而且是**唯一**对上，才写进缓存
 *
 * ⚠️ 不按序号、不按时间猜人：宁可没名字，也不把 A 的名字安到 B 头上。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openPage, sleep } from './chrome.mjs'
import { conversations } from './im.mjs'
import { atomicWriteJson, readJsonSafe } from './fsx.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = join(HERE, '..', '..', '..', 'douyin-duty')
const FILE = join(DATA, 'dm-names.json')

const CHAT_URL = 'https://www.douyin.com/chat'

/**
 * 抄页面上每行的「昵称 + conv_id」。
 * ⚠️ 昵称在 DOM 里，`conv_id` 不在 DOM 里——它藏在 React fiber 的 `memoizedProps.virtualItem.id`
 *    （实测形如 `0:1:123456789:987654321`）。顺着 `fiber.return` 往上爬几层就有。
 *    一开始我试过「按最后一条消息的文字对」，对不上：页面显示的是 `分享[视频]`、时间也在里面，
 *    跟接口给的正文根本不是一个字符串。别用文字猜人。
 */
const SCRAPE = `(() => {
	const convIdOf = (el) => {
		const k = Object.keys(el).find((x) => x.startsWith('__reactFiber'));
		let f = el ? el[k] : null;
		for (let d = 0; f && d < 12; d++) {
			const p = f.memoizedProps;
			if (p && p.virtualItem && p.virtualItem.id) return String(p.virtualItem.id);
			f = f.return;
		}
		return '';
	};
	const rows = [...document.querySelectorAll('[data-e2e="conversation-item"]')];
	return JSON.stringify(rows.map((el) => {
		const t = el.querySelector('.conversationConversationItemtitle');
		const lines = (el.innerText || '').split('\\n').map((s) => s.trim()).filter(Boolean);
		return {
			nick: ((t ? t.innerText : '') || lines[0] || '').trim(),
			text: (lines[lines.length - 1] || '').trim(),
			conv_id: convIdOf(el),
		};
	}));
})()`

const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase()

/* 昵称表丢了不致命（顶多显示成「抖音号 …1234」），但一样走原子写：
 * 这文件是爬页面爬来的，重爬一次要开浏览器，不值得为一次半截写重爬。 */
function load() {
	return readJsonSafe(FILE, null, (v) => v && typeof v === 'object' && !Array.isArray(v)) || {}
}

function save(map) {
	return atomicWriteJson(FILE, map).ok
}

/** 缓存里查一个人 */
export function nameOf(uid) {
	const map = load()
	const hit = map[String(uid || '')]
	return hit && hit.nick ? hit.nick : ''
}

export function allNames() {
	return load()
}

/**
 * 抄一遍页面、对上名字、写缓存。
 * 返回 { ok, scraped, convs, matched, saved } —— matched 里只放唯一对上的。
 */
export async function refresh({ limit = 20 } = {}) {
	const api = await conversations({ limit })
	if (!api || api.ok === false) return { ok: false, error: (api && api.error) || '读不到会话列表' }

	const c = await openPage({ url: CHAT_URL })
	let rows = []
	try {
		await sleep(3500)
		for (let i = 0; i < 8; i++) {
			rows = JSON.parse((await c.ev(SCRAPE)) || '[]')
			if (rows.length) break
			await sleep(700)
		}
	} finally { c.close() }

	const byConv = new Map()   // conv_id -> nicks（只保留唯一）
	for (const r of rows) {
		if (!r.nick || !r.conv_id) continue
		const arr = byConv.get(r.conv_id) || []
		arr.push(r.nick)
		byConv.set(r.conv_id, arr)
	}

	const map = load()
	const matched = {}
	const myUid = String(api.my_uid || '')
	for (const conv of api.conversations || []) {
		const cid = String(conv.conv_id || '')
		const cands = byConv.get(cid) || []
		if (cands.length !== 1) continue
		const uid = String(conv.peer_uid || '')
		if (!uid) continue
		matched[uid] = cands[0]
		map[uid] = { nick: cands[0], at: new Date().toISOString(), conv_id: cid }
	}

	const saved = save(map)
	return {
		ok: true, saved, my_uid: myUid,
		scraped: rows.length, convs: (api.conversations || []).length,
		matched: Object.keys(matched).length, names: matched,
		known: Object.keys(map).length,
		unmatched: rows.filter((r) => !r.conv_id).length,
	}
}
