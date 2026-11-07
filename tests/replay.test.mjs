/**
 * tests/replay.test.mjs —— 真实输入 → 判定的回放测试
 * ============================================================================
 * 已有的 400+ 例几乎都是纯逻辑的构造输入。它们抓不到另一类事故：
 * 抖音把字段名换了、评论时间格式变了、页面结构改了 —— 代码还是对的，输入不对了。
 * 这份 fixture 是从活账号读回的**原始形状**，钉的是"拿到真数据时判定还对不对"。
 * ============================================================================
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDouyinTime, toIsoZ, relTime } from '../lib/reltime.mjs'
import { judgeDm } from '../lib/inbox.mjs'
import { planAtReply } from '../lib/policy.mjs'
import { inboxItemView } from '../lib/viewmodel.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIX = JSON.parse(readFileSync(join(HERE, 'fixtures', 'douyin-sample.json'), 'utf8'))
const NOW = new Date(2026, 10, 5, 18, 58, 0).getTime()

test('回放：create_date 是无时区标记的 UTC，不能按本地解', () => {
	const c = FIX.comments[2]
	assert.equal(parseDouyinTime(c.create_date), Date.UTC(2026, 10, 5, 10, 26, 24))
	assert.equal(toIsoZ(c.create_date), '2026-11-05T10:26:24.000Z')
	assert.match(relTime(c.create_date, NOW), /32 分钟前|3\d 分钟前/)
})

test('回放：楼中楼的落点必须是「楼根 + 被回那条」，不能变成新顶层评论', () => {
	const c = FIX.comments[1]
	assert.equal(c.level, 2)
	const plan = planAtReply({ cid: c.cid, root: c.reply_id })
	assert.equal(plan.thread, '7701086319522906918')
	assert.equal(plan.replyTo, c.cid)
	assert.equal(plan.level, 2)
	const top = planAtReply({ cid: FIX.comments[2].cid, root: '' })
	assert.equal(top.thread, FIX.comments[2].cid)
	assert.equal(top.replyTo, '')
	assert.equal(top.level, 1)
})

test('回放：机器人自己的评论能被认出来（uid 在 fixture 里）', () => {
	const mine = FIX.comments.filter((c) => String(c.user.uid) === FIX.selfUid)
	assert.equal(mine.length, 2, '两条她自己发的评论会进候选池，没有 selfUid 就挡不住')
	assert.ok(mine.every((c) => c.cid))
})

test('回放：私信判定 —— 该回 / 等对方 / 只有表情 / 视频卡片', () => {
	const byNick = Object.fromEntries(FIX.conversations.map((c) => [c.nick, c]))
	const ask = judgeDm(byNick['涛哥，梦想哭了'], { now: NOW, nick: '涛哥，梦想哭了' })
	assert.equal(ask.worth, true)
	assert.ok(ask.why.some((x) => /提问/.test(x)))

	const waiting = judgeDm(byNick['已回过的人'], { now: NOW, nick: '已回过的人' })
	assert.equal(waiting.status, 'waiting')
	assert.equal(waiting.worth, false)

	const emoji = judgeDm(byNick['只发表情的人'], { now: NOW, nick: '只发表情的人' })
	assert.equal(emoji.worth, false)
	assert.ok(emoji.blocked.some((x) => /表情/.test(x)))

	/* 视频卡片：正文是占位文字，但人家专门发来给我看 —— 不能当垃圾丢掉。 */
	const card = judgeDm(byNick['辰辰辰chen'], { now: NOW, nick: '辰辰辰chen' })
	assert.equal(card.worth, true)
	assert.ok(card.why.some((x) => /视频卡片/.test(x)))
})

test('回放：@我 条目进界面时预览和相对时间都不空', () => {
	const c = FIX.comments[2]
	const v = inboxItemView('at', {
		at: toIsoZ(c.create_date), content: c.text, why: ['@了我，等一个回应'],
	}, { now: NOW })
	assert.match(v.preview, /^@辰辰辰chen/)
	assert.ok(v.when && !/小时前/.test(v.when), v.when)
	assert.equal(v.notes[0], '@了我，等一个回应')
})
