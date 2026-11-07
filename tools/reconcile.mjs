#!/usr/bin/env node
/**
 * tools/reconcile.mjs —— 对账：拿线上的真实评论，去核账本里有没有
 * ============================================================================
 * 为什么需要它：
 *   账本是"我以为我发过什么"，线上才是"我到底发过什么"。
 *   只要中间任何一环静默失败（2026-11-05 就发生了两次：await 丢失、分支没调记账），
 *   账本就会少记 —— 而少记的后果不是"数字不好看"，是**去重闸失效**：
 *   同一条评论会被再回一次。
 *
 *   所以成熟系统从不假设"记账一定成功"，而是定期对账（reconciliation）。
 *   这不是承认失败，是标准控制手段。
 *
 * 用法：
 *   node tools/reconcile.mjs                 # 查最近 3 条作品，只报告不写
 *   node tools/reconcile.mjs --works 5       # 查更多
 *   node tools/reconcile.mjs --fix           # 把缺的补进账本（不补额度）
 *   node tools/reconcile.mjs --aweme 123     # 只查一条
 *
 * 设计取舍：
 *   · 只补账本，**不动额度**。历史发送不该计入今天的额度。
 *   · 只认"作者是我自己"的评论，别把别人的评论补进来。
 *   · 补进去的 cid 留空、newCid 填线上 cid —— 和正常记账同形，闸①照样能查。
 * ============================================================================
 */
import { works, comments, replies } from '../lib/api.mjs'
import { readLedger } from '../lib/ledger.mjs'
import { recordOutbound } from '../lib/sendlog.mjs'
import { selfUid } from '../lib/selfid.mjs'

const argv = process.argv.slice(2)
const has = (k) => argv.includes(k)
const argOf = (k, d = '') => {
	const i = argv.indexOf(k)
	return i >= 0 ? (argv[i + 1] || d) : d
}
const numOf = (k, d) => {
	const n = Number(argOf(k, ''))
	return Number.isFinite(n) && n > 0 ? n : d
}

const ME = selfUid()
if (!ME) {
	console.error('不知道机器人自己的 uid（self.json 里没有）。先在面板打开一次，或跑 tools/selfcheck.mjs --self-uid 看提示。')
	process.exit(2)
}

const LEDGER = readLedger() || { replies: [] }
const seen = new Set()
for (const r of LEDGER.replies || []) {
	if (r.cid) seen.add(String(r.cid))
	if (r.newCid) seen.add(String(r.newCid))
}

/** 我发的评论里，账本没有的那些。 */
const missing = []
const note = (aweme, c) => {
	const cid = String(c.cid || '')
	if (!cid || seen.has(cid)) return
	missing.push({
		aweme,
		cid,
		text: String(c.text || ''),
		root: String(c.root_comment_id && c.root_comment_id !== '0' ? c.root_comment_id : ''),
		level: Number(c.level) || 1,
		created: String(c.create_date || ''),
	})
}

const targets = []
if (argOf('--aweme')) {
	targets.push(argOf('--aweme'))
} else {
	const w = await works({ count: numOf('--works', 3) })
	const list = (w && (w.list || w.items || w.works)) || []
	for (const x of list.slice(0, numOf('--works', 3))) targets.push(String(x.aweme_id || x.aweme || ''))
}
for (const id of targets.filter(Boolean)) {
	const r = await comments(id, { count: numOf('--count', 20) })
	const list = (r && r.list) || []
	for (const c of list) {
		if (String(c.user && c.user.uid) === ME) note(id, c)
		/* 有楼中楼就把楼里也翻一遍 —— 不回自己的楼，是这次要验的重点之一。 */
		if (Number(c.sub_count) > 0) {
			const rr = await replies(id, c.cid, { count: 20 })
			for (const s of (rr && rr.list) || []) {
				if (String(s.user && s.user.uid) === ME) note(id, s)
			}
		}
	}
}

if (has('--json')) {
	process.stdout.write(JSON.stringify({ me: ME, works: targets.length, missing }, null, 2) + '\n')
	process.exit(missing.length ? 1 : 0)
}

console.log('对账：扫了 ' + targets.length + ' 条作品，找到 ' + missing.length + ' 条线上有我、账本没有的评论')
for (const m of missing) {
	console.log('  · ' + m.aweme + ' / ' + m.cid + '  [L' + m.level + ']  ' + m.text.slice(0, 34))
}

if (!missing.length) {
	console.log('✓ 账本和线上一致')
	process.exit(0)
}

if (!has('--fix')) {
	console.log('\n只报告，没写盘。要补进账本：加 --fix（不补额度，历史发送不计今天）')
	console.log('⚠️ 补记的时间戳是"现在"，历史评论会被算进今天 —— 只建议补今天的漏账。')
	process.exit(1)
}

let n = 0
for (const m of missing) {
	await recordOutbound({
		aweme: m.aweme,
		cid: '',
		root: m.root,
		authorUid: ME,
		authorName: '自己',
		text: m.text,
		reason: 'reconcile ' + m.cid,
		newCid: m.cid,
		ch: 'comment',
		thread: m.root || '',
		note: 'reconcile',
		bill: false,
	})
	n++
}
console.log('\n已补记 ' + n + ' 条（额度未动）')
process.exit(0)
