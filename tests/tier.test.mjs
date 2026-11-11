import test from 'node:test'
import assert from 'node:assert/strict'
import { pickTier } from '../lib/tier.mjs'

test('每天第一轮先 @：at 还有额度、今天还没 @ 过 → at', () => {
	assert.equal(pickTier({ shareLeft: 2, atLeft: 2, usedAt: 0 }), 'at')
})

test('今天已经 @ 过 → 走私信', () => {
	assert.equal(pickTier({ shareLeft: 2, atLeft: 1, usedAt: 1 }), 'dm')
})

test('私信额度用完、@ 还剩 → 回落到 at', () => {
	assert.equal(pickTier({ shareLeft: 0, atLeft: 2, usedAt: 1 }), 'at')
})

test('@ 用完、私信还剩 → dm', () => {
	assert.equal(pickTier({ shareLeft: 1, atLeft: 0, usedAt: 1 }), 'dm')
})

test('两边都没额度 → 空串（这一轮不叫人）', () => {
	assert.equal(pickTier({ shareLeft: 0, atLeft: 0, usedAt: 1 }), '')
})

test('缺字段 / 负数 / 字符串都当 0 处理，不抛', () => {
	assert.equal(pickTier({}), '')
	assert.equal(pickTier(null), '')
	assert.equal(pickTier({ shareLeft: -3, atLeft: -1, usedAt: 0 }), '')
	assert.equal(pickTier({ shareLeft: '2', atLeft: '1', usedAt: '0' }), 'at')
})

test('回归：以前「私信优先」会让 at 永远轮不到（shareLeft 恒 >0）', () => {
	// 旧逻辑 shareLeft>0 ? 'dm' : ... 在 shareLeft=2 时永远给 dm；新逻辑第一天必须给 at。
	for (const usedAt of [0]) {
		assert.notEqual(pickTier({ shareLeft: 2, atLeft: 2, usedAt }), 'dm')
	}
})
