/**
 * tests/viewmodel.test.mjs —— 视图模型的验收
 * ============================================================================
 * 这一层的意义是"界面显示什么"可以被单测。所以钉的是显示规则，不是像素：
 *   ① 三种来源（私信 / @我 / 自己评论区）字段名不同，要归一
 *   ② 相对时间走 reltime 的口径（不能自己再算一遍，否则又差 8 小时）
 *   ③ 空文本有兜底、超长有省略号
 *   ④ 该跳过的条目标 skip
 * ============================================================================
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { rawOf, inboxItemView, inboxHeadline, heroView, dutyLogView, funnelView } from '../lib/viewmodel.mjs'

const NOW = new Date(2026, 10, 5, 18, 0, 0).getTime()
const at = (ms) => new Date(NOW - ms).toISOString()
const MIN = 60000

test('rawOf：三种来源的字段名归一', () => {
	assert.deepEqual(rawOf('dm', { last_at: 'A', last_text: 'B' }), { at: 'A', text: 'B', from: '' })
	assert.deepEqual(rawOf('at', { at: 'A', content: 'C' }), { at: 'A', text: 'C', from: '' })
	assert.deepEqual(rawOf('own', { at: 'A', text: 'T' }), { at: 'A', text: 'T', from: '' })
})

test('inboxItemView：私信取 last_*，@我取 content', () => {
	const dm = inboxItemView('dm', { last_at: at(5 * MIN), last_text: '在吗' }, { now: NOW })
	assert.equal(dm.preview, '在吗')
	assert.equal(dm.when, '5 分钟前')

	const a = inboxItemView('at', { at: at(60 * MIN), content: '@小肥鱼 你好' }, { now: NOW })
	assert.equal(a.when, '1 小时前')
	assert.equal(a.preview, '@小肥鱼 你好')
})

test('inboxItemView：空文本给兜底，不显示空白行', () => {
	assert.equal(inboxItemView('dm', { last_at: at(MIN), last_text: '' }, { now: NOW }).preview, '（没有文字内容）')
})

test('inboxItemView：超长截断并加省略号', () => {
	const long = '一'.repeat(200)
	const v = inboxItemView('own', { at: at(MIN), text: long }, { now: NOW })
	assert.equal(v.preview.length, 120)
	assert.ok(v.preview.endsWith('…'))
})

test('inboxItemView：why/blocked 最多各留两条/一条', () => {
	const v = inboxItemView('at', {
		at: at(MIN), content: 'x',
		why: ['a', 'b', 'c'], blocked: ['1', '2'],
	}, { now: NOW })
	assert.deepEqual(v.notes, ['a', 'b'])
	assert.deepEqual(v.blocked, ['1'])
})

test('inboxItemView：worth=false 或 status=skip 标成 skip', () => {
	assert.equal(inboxItemView('at', { at: at(MIN), content: 'x', worth: false }, { now: NOW }).tone, 'skip')
	assert.equal(inboxItemView('at', { at: at(MIN), content: 'x', status: 'skip' }, { now: NOW }).tone, 'skip')
	assert.equal(inboxItemView('at', { at: at(MIN), content: 'x', worth: true }, { now: NOW }).tone, 'todo')
})

test('inboxHeadline：只数值得回的，带刷新时间', () => {
	const inbox = {
		at: at(2 * MIN),
		items: [{ worth: true }, { worth: false }, { worth: true, status: 'skip' }, { worth: true }],
	}
	const h = inboxHeadline(inbox, NOW)
	assert.equal(h.worth, 2)
	assert.match(h.text, /^2 条值得回 · 2 分钟前$/)
})

test('inboxHeadline：空列表说人话', () => {
	assert.equal(inboxHeadline({ items: [] }, NOW).text, '暂时没有该回的')
})

test('heroView：三个数是「待回 / 额度剩 / 上一条成败」，不是粉丝数', () => {
	const h = heroView({
		budget: { messages: { day: 6, max: 20, left: 14 } },
		inbox: {
			dm: { items: [{ worth: true }, { status: 'skip' }] },
			at: { items: [{ worth: true }] },
			own: { items: [] },
		},
		runs: [{ kind: 'send:comment', ok: true, at: '2026-11-05T09:58:00.000Z' }],
		now: NOW,
	})
	assert.equal(h.pending, 2)
	assert.equal(h.quotaLeft, 14)
	assert.equal(h.quotaPct, 30)
	assert.equal(h.lastReply.ok, true)
})

test('heroView：没数据就是 null，不许画成 0', () => {
	const h = heroView({ budget: {}, inbox: {}, runs: [], now: NOW })
	assert.equal(h.pending, null)
	assert.equal(h.quotaLeft, null)
	assert.equal(h.lastReply, null)
})

test('dutyLogView：跳过原因进日志，且按时间倒序', () => {
	const d = dutyLogView({
		rounds: [{ at: '2026-11-05T08:00:00.000Z', ok: false, skipped: 'skip-quota' }],
		runs: [{ at: '2026-11-05T09:00:00.000Z', kind: 'send:comment', ok: true, target: 'cid1' }],
		now: NOW,
	})
	assert.equal(d.total, 2)
	assert.equal(d.items[0].kind, '回评')
	assert.match(d.items[1].title, /额度用完/)
	assert.equal(d.items[1].tone, 'warn')
})

test('dutyLogView：坏数据不崩，条数受 limit 限制', () => {
	const d = dutyLogView({ runs: [null, {}], rounds: [null], limit: 1, now: NOW })
	assert.equal(d.items.length, 1)
})

test('dutyLogView：只读命令不进日志，业务账里的历史回评补上', () => {
	const d = dutyLogView({
		runs: [{ at: '2026-11-05T09:30:00.000Z', kind: 'status', ok: true }],
		replies: [{ at: '2026-11-05T09:00:00.000Z', who: '涛哥' }],
		now: NOW,
	})
	assert.equal(d.total, 1)
	assert.equal(d.items[0].kind, '回评')
	assert.match(d.items[0].detail, /涛哥/)
})

test('heroView：动作账没有发送时，用业务账兜底', () => {
	const h = heroView({ budget: {}, inbox: {}, runs: [], replies: [{ ok: true, at: '2026-11-05T09:00:00.000Z' }], now: NOW })
	assert.equal(h.lastReply.ok, true)
})

test('funnelView：三段漏斗按本地日历日算「今天回了多少」', () => {
  const f = funnelView({
    inbox: { dm: { items: [{ worth: true }, { status: 'skip' }] }, at: { items: [{ worth: true }] } },
    replies: [
      { at: '2026-11-05T02:00:00.000Z' },  // 本地 10:00，今天
      { at: '2026-11-04T02:00:00.000Z' },  // 昨天，不算
      { at: '坏值' },
    ],
    now: NOW,
  })
  assert.equal(f.seen, 3)
  assert.equal(f.worth, 2)
  assert.equal(f.sent, 1)
  assert.equal(f.hasData, true)
})

test('funnelView：没数据不假装有数据', () => {
  assert.equal(funnelView({ inbox: {}, replies: [], now: NOW }).hasData, false)
})
