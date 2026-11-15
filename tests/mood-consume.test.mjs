/**
 * tests/mood-consume.test.mjs —— 心情的消费面（调研 D8）
 * ============================================================================
 * 钉两条边界：
 *   ① 只改「量」（刷几条、话长短），不改事实、不改内容；
 *   ② 没给状态时读当前的，给状态时用给的——测试不碰真实 mood.json。
 * ============================================================================
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { feedAdjust, moodPaceLine } from '../lib/mood.mjs'

const at = Date.now()
const st = (energy) => ({ energy, valence: 0, arousal: 0.3, affinity: 0.3, at })

describe('feedAdjust：精力 → 每轮刷几条', () => {
	it('没力气对半（向上取整，至少 1 条）', () => {
		assert.equal(feedAdjust(st(0.2), 20).perRound, 10)
		assert.equal(feedAdjust(st(0.2), 1).perRound, 1, '再少也得看一条')
		assert.match(feedAdjust(st(0.2), 20).why, /少刷/)
	})

	it('精神足多看两条，但不越过上限', () => {
		assert.equal(feedAdjust(st(0.9), 20).perRound, 22)
		assert.equal(feedAdjust(st(0.9), 49).perRound, 50, '封顶 50')
		assert.match(feedAdjust(st(0.9), 20).why, /多看两条/)
	})

	it('平常 → 原样，不干涉', () => {
		assert.equal(feedAdjust(st(0.55), 20).perRound, 20)
		assert.equal(feedAdjust(st(0.55), 20).why, '')
	})

	it('没配轮量 → 0，不硬编一个', () => {
		assert.equal(feedAdjust(st(0.5), 0).perRound, 0)
		assert.equal(feedAdjust(st(0.5), 'abc').perRound, 0)
	})

	it('边界值：0.3 不算没力气，0.75 不算精神足（严格小于/大于）', () => {
		assert.equal(feedAdjust(st(0.3), 20).perRound, 20)
		assert.equal(feedAdjust(st(0.75), 20).perRound, 20)
	})
})

describe('moodPaceLine：精力 → 回复长短', () => {
	it('没劲 → 短；精神足 → 多半句；平常 → 空串', () => {
		assert.match(moodPaceLine(st(0.2)), /短/)
		assert.match(moodPaceLine(st(0.9)), /半句/)
		assert.equal(moodPaceLine(st(0.55)), '')
	})
})
