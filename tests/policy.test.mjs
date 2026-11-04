import test from 'node:test'
import assert from 'node:assert/strict'
import {
	minutesOf, inWindow, dayKey, dueDaily, dmCandidates,
	mediaKind, titleOf, nextFile, publishLeft, planAtReply,
} from '../lib/policy.mjs'

/* ── 时间窗口 ─────────────────────────────────────────────────────────── */

test('minutesOf：合法与不合法要分得清', () => {
	assert.equal(minutesOf('00:00'), 0)
	assert.equal(minutesOf('09:30'), 570)
	assert.equal(minutesOf('23:59'), 1439)
	assert.equal(minutesOf('24:00'), null)
	assert.equal(minutesOf('9:30'), null)   // 必须两位，避免 09:3 这种半截值
	assert.equal(minutesOf(''), null)
	assert.equal(minutesOf(undefined), null)
})

test('inWindow：普通区间左闭右开', () => {
	assert.equal(inWindow(570, '09:00', '12:00'), true)
	assert.equal(inWindow(720, '09:00', '12:00'), false)  // 12:00 整不算
	assert.equal(inWindow(540, '09:00', '12:00'), true)
})

test('inWindow：跨午夜（23:00→07:30）', () => {
	assert.equal(inWindow(23 * 60 + 30, '23:00', '07:30'), true)
	assert.equal(inWindow(7 * 60 + 29, '23:00', '07:30'), true)
	assert.equal(inWindow(7 * 60 + 30, '23:00', '07:30'), false)
	assert.equal(inWindow(12 * 60, '23:00', '07:30'), false)
})

test('inWindow：端点相同 / 没填 = 不静音（绝不能变成全天静音）', () => {
	assert.equal(inWindow(600, '09:00', '09:00'), false)
	assert.equal(inWindow(600, '', ''), false)
	assert.equal(inWindow(600, '09:00', ''), false)
})

test('dayKey 用本地日期，个位数补零', () => {
	assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05')
})

/* ── 每天一次的任务 ───────────────────────────────────────────────────── */

test('dueDaily：没到点不跑', () => {
	assert.equal(dueDaily({ lastDay: '', today: '2026-11-03', nowMin: 8 * 60, at: '21:30' }), false)
})

test('dueDaily：到点就跑，过了宽限就不补（避免半夜补发早上好）', () => {
	assert.equal(dueDaily({ lastDay: '', today: '2026-11-03', nowMin: 21 * 60 + 30, at: '21:30' }), true)
	assert.equal(dueDaily({ lastDay: '', today: '2026-11-03', nowMin: 23 * 60, at: '21:30', graceMin: 60 }), false)
})

test('dueDaily：今天已经跑过就不再跑', () => {
	assert.equal(dueDaily({ lastDay: '2026-11-03', today: '2026-11-03', nowMin: 22 * 60, at: '21:30' }), false)
	// 昨天跑的，今天到点仍要跑
	assert.equal(dueDaily({ lastDay: '2026-11-02', today: '2026-11-03', nowMin: 22 * 60, at: '21:30' }), true)
})

test('dueDaily：时间格式不对就不跑（宁可不动，也别乱发）', () => {
	assert.equal(dueDaily({ lastDay: '', today: '2026-11-03', nowMin: 600, at: '' }), false)
	assert.equal(dueDaily({ lastDay: '', today: '2026-11-03', nowMin: 600, at: '9:00' }), false)
})

/* ── 私信候选 ─────────────────────────────────────────────────────────── */

const conv = (peer, last, type = 1) => ({
	peer_uid: peer, type, messages: [{ from: 'me', text: '在', at: '2026-11-03T01:00:00Z' }, last],
})

test('dmCandidates：最后一句是我说的 → 不该回', () => {
	const list = dmCandidates([conv('u1', { from: 'me', text: '好', at: '2026-11-03T02:00:00Z' })])
	assert.equal(list.length, 0)
})

test('dmCandidates：对方的最后一句比上次回过的更新 → 该回', () => {
	const list = dmCandidates(
		[conv('u1', { from: 'them', text: '在吗', at: '2026-11-03T03:00:00Z' })],
		{ replied: { u1: '2026-11-03T02:00:00Z' } },
	)
	assert.equal(list.length, 1)
	assert.equal(list[0].text, '在吗')
})

test('dmCandidates：同一句已经回过了 → 不重复回', () => {
	const at = '2026-11-03T03:00:00Z'
	const list = dmCandidates([conv('u1', { from: 'them', text: '在吗', at })], { replied: { u1: at } })
	assert.equal(list.length, 0)
})

test('dmCandidates：失败两次的人先放弃，不要死磕', () => {
	const c = [conv('u1', { from: 'them', text: '在吗', at: '2026-11-03T03:00:00Z' })]
	assert.equal(dmCandidates(c, { tries: { u1: 2 }, maxTries: 2 }).length, 0)
	assert.equal(dmCandidates(c, { tries: { u1: 1 }, maxTries: 2 }).length, 1)
})

test('dmCandidates：群聊不碰；没有 peer 的跳过', () => {
	assert.equal(dmCandidates([conv('u1', { from: 'them', text: 'hi', at: 'x' }, 2)]).length, 0)
	assert.equal(dmCandidates([{ type: 1, peer_uid: '', messages: [{ from: 'them', text: 'hi', at: 'x' }] }]).length, 0)
})

test('dmCandidates：卡片没有正文时标 empty，让调用方自己决定回不回', () => {
	const list = dmCandidates([conv('u1', { from: 'them', text: '', kind: 'card', at: '2026-11-03T03:00:00Z' })])
	assert.equal(list.length, 1)
	assert.equal(list[0].empty, true)
	assert.equal(list[0].kind, 'card')
})

/* ── 内容库 ───────────────────────────────────────────────────────────── */

test('mediaKind 只认视频/图片，别的返回空', () => {
	assert.equal(mediaKind('a.MP4'), 'video')
	assert.equal(mediaKind('b.jpeg'), 'image')
	assert.equal(mediaKind('c.txt'), '')
	assert.equal(mediaKind('d'), '')
})

test('titleOf 去扩展名、下划线变空格、截 20 字，不猜内容', () => {
	assert.equal(titleOf('今天的晚饭_第二版.mp4'), '今天的晚饭 第二版')
	assert.equal(titleOf('a'.repeat(40) + '.png').length, 20)
})

test('nextFile 按传入顺序取第一条没发过的', () => {
	assert.equal(nextFile(['a.mp4', 'b.mp4'], { 'a.mp4': '1' }), 'b.mp4')
	assert.equal(nextFile(['a.mp4'], { 'a.mp4': '1' }), null)
	assert.equal(nextFile([], {}), null)
})

test('publishLeft：跨天自动归零；负数不会出现', () => {
	assert.equal(publishLeft({ day: '2026-11-03', today: '2026-11-03', count: 1, perDay: 2 }), 1)
	assert.equal(publishLeft({ day: '2026-11-02', today: '2026-11-03', count: 5, perDay: 2 }), 2)
	assert.equal(publishLeft({ day: '2026-11-03', today: '2026-11-03', count: 9, perDay: 2 }), 0)
})

/* ── 回评落点 ─────────────────────────────────────────────────────────── */

/* 2026-11-03：哥哥说「回的楼中楼并不是回到别人评论上」。
 * 落点只有一个变量：root 空不空。空 → 挂对方那条；有值 → 楼根 + reply_to。 */
test('planAtReply：顶层评论挂对方那条（reply_id=cid）', () => {
	assert.deepEqual(planAtReply({ cid: '111', root: '' }), { thread: '111', replyTo: '', level: 1 })
	assert.deepEqual(planAtReply({ cid: '111' }), { thread: '111', replyTo: '', level: 1 })
})

test('planAtReply：楼中楼 = 楼根 + 具体那个人', () => {
	assert.deepEqual(planAtReply({ cid: '222', root: '111' }), { thread: '111', replyTo: '222', level: 2 })
})

test('planAtReply：root 和 cid 相同（自己就是楼根）→ 当顶层处理，别把 reply_id 和 reply_to 指同一条', () => {
	assert.deepEqual(planAtReply({ cid: '111', root: '111' }), { thread: '111', replyTo: '', level: 1 })
})

test('planAtReply：什么都没有 → 空计划（调用方该拒发）', () => {
	assert.deepEqual(planAtReply({}), { thread: '', replyTo: '', level: 0 })
})
