import { test } from 'node:test'
import assert from 'node:assert/strict'

const S = await import('../lib/speakup.mjs')

const at = (h) => new Date(2026, 11, 13, h, 30, 0).getTime()

test('夜里不说话', () => {
	const r = S.decide({ now: at(3), pending: 5 })
	assert.equal(r.ok, false)
	assert.equal(r.reason, 'quiet')
})

test('说满了就不说', () => {
	const r = S.decide({ now: at(20), today: 2, pending: 3 })
	assert.equal(r.ok, false)
	assert.equal(r.reason, 'quota')
})

test('刚说过要冷却', () => {
	const now = at(20)
	const r = S.decide({ now, lastAt: now - 10 * 60 * 1000, pending: 3 })
	assert.equal(r.ok, false)
	assert.equal(r.reason, 'cooldown')
})

test('有没回的评论 = 最硬的由头', () => {
	const r = S.decide({ now: at(20), pending: 2, lastAt: at(12) })
	assert.equal(r.ok, true)
	assert.equal(r.reason, 'pending')
})

test('心情激动也算由头', () => {
	const r = S.decide({ now: at(20), mood: { arousal: 0.8 } })
	assert.equal(r.ok, true)
	assert.equal(r.reason, 'excited')
})

test('日程没做且到了那个时段，可以开口', () => {
	const r = S.decide({ now: at(20), intent: { text: '想跟人说说话', done: false } })
	assert.equal(r.ok, true)
	assert.equal(r.reason, 'intent')
})

test('什么都没发生就不说——这才是默认', () => {
	const r = S.decide({ now: at(14), intent: { text: '想做点东西', done: true }, mood: { arousal: 0.2 } })
	assert.equal(r.ok, false)
	assert.equal(r.reason, 'no-reason')
})

test('跨零点的免打扰区间也算对', () => {
	const gates = { quietFrom: 23, quietTo: 7 }
	assert.equal(S.decide({ now: at(23), pending: 1, gates }).reason, 'quiet')
	assert.equal(S.decide({ now: at(6), pending: 1, gates }).reason, 'quiet')
	assert.equal(S.decide({ now: at(12), pending: 1, gates }).ok, true)
})

test('默认一天最多两次', () => {
	assert.equal(S.GATES.maxPerDay, 2)
	assert.equal(S.GATES.coolMin, 90)
})
