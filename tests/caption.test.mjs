import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanCaption, topicsOf, looksCopied, rotate, AT_FALLBACKS, DM_FALLBACKS } from '../lib/caption.mjs'

test('cleanCaption：话题、@、链接、表情都洗掉', () => {
	const s = cleanCaption('@辰辰辰chen 这条我觉得你会喜欢：#丁达尔之境 #Muse强大的Muse，Muse好 https://v.douyin.com/xYz/ 😂')
	assert.ok(!s.includes('#'))
	assert.ok(!s.includes('@'))
	assert.ok(!s.includes('http'))
	assert.ok(!s.includes('😂'))
	assert.ok(s.includes('Muse好'))
})

test('cleanCaption：没文案 / 全标记 都能给出空串而不是 null', () => {
	assert.equal(cleanCaption(''), '')
	assert.equal(cleanCaption(null), '')
	assert.equal(cleanCaption('#a #b @c'), '')
})

test('cleanCaption：截断在字数上限，不切半个空白', () => {
	const s = cleanCaption('一'.repeat(500), 160)
	assert.equal(s.length, 160)
})

test('topicsOf：只收话题词，去重，最多 5 个', () => {
	assert.deepEqual(topicsOf('#丁达尔之境 #Muse强大的Muse #丁达尔之境 #c #d #e'), ['丁达尔之境', 'Muse强大的Muse', 'c', 'd', 'e'])
	assert.deepEqual(topicsOf('没有话题'), [])
})

test('looksCopied：逐字搬原文案要拦住', () => {
	const src = cleanCaption('#丁达尔之境 这条我觉得你会喜欢：Muse 好')
	assert.equal(looksCopied('这条我觉得你会喜欢：Muse 好', src), true)
	assert.equal(looksCopied('刚刷到这条，第一反应是你也会喜欢', src), false)
})

test('looksCopied：太短的不判（避免把「好看」误杀）', () => {
	assert.equal(looksCopied('好看', '好看'), false)
})

test('rotate：同一秒拿到同一条，不会乱跳', () => {
	assert.equal(rotate(AT_FALLBACKS, 1000), rotate(AT_FALLBACKS, 1500))
	assert.ok(AT_FALLBACKS.includes(rotate(AT_FALLBACKS, 1000)))
})

test('兜底文案里没有话题标签、没有 @', () => {
	for (const t of [...AT_FALLBACKS, ...DM_FALLBACKS]) {
		assert.ok(!t.includes('#'), t)
		assert.ok(!t.includes('@'), t)
	}
})