/**
 * tests/comment-filter.test.mjs —— 先判后说。
 *
 * 记得住人（contacts）是一半；另一半是**不值得回的不回**。
 * 抽奖号、互关号、纯表情、「666」回一句既烧额度又像机器人。
 * 这几条钉子保证：噪声挡得住，真人一个都不误伤。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { judgeComment, dedupeByText } from '../lib/comment-filter.mjs'

test('正常留言照回', () => {
	for (const t of ['猫又掉毛了吧', '这张好看', '你画的吗？', '哈哈哈哈哈笑死', '第一张的光是真的好']) {
		assert.equal(judgeComment({ text: t }).reply, true, t)
	}
})

test('空 / 纯表情 / 纯符号不回', () => {
	for (const t of ['', '   ', '😂😂😂', '？？？', '。。。', '❤️❤️']) {
		assert.equal(judgeComment({ text: t }).reply, false, t)
	}
})

test('广告与引流不回', () => {
	for (const t of ['互关互粉', '看我主页有惊喜', '加微信 领取教程', 'https://x.cn/a', '兼职日赚300']) {
		assert.equal(judgeComment({ text: t }).reply, false, t)
	}
})

test('凑热闹的短句不回', () => {
	for (const t of ['666', '第一', '打卡', '沙发', 'dd']) {
		assert.equal(judgeComment({ text: t }).reply, false, t)
	}
})

test('表情+两个字仍然回（别把真人误杀）', () => {
	assert.equal(judgeComment({ text: '好看😂' }).reply, true)
	assert.equal(judgeComment({ text: '猫猫🐱' }).reply, true)
})

test('同一句话刷屏只留第一条', () => {
	const list = [{ cid: '1', text: '好看' }, { cid: '2', text: '好看' }, { cid: '3', text: '不一样' }]
	assert.deepEqual(dedupeByText(list).map((x) => x.cid), ['1', '3'])
})
