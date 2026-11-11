import test from 'node:test'
import assert from 'node:assert/strict'

import { PROMPT } from '../lib/duty.mjs'
import { normalize, DEFAULTS } from '../lib/settings.mjs'

/* 2026-11-11：回复前不看评论，等于闭着眼接话。
 * 这条测试钉两件事：①热评真的进了提示 ②没有热评时不硬塞空段。 */

test('PROMPT 带上热评（带赞数）', () => {
	const p = PROMPT(
		{ aweme_title: '海边捡到的贝壳', text: '这个真的好看', author: '小林', hot: [{ text: '我也想要', digg: 12 }, { text: '在哪捡的', digg: 0 }] },
		{},
	)
	assert.match(p, /这条下面别人在说/)
	assert.match(p, /- 我也想要（12 赞）/)
	assert.match(p, /- 在哪捡的\n/, '没赞的那条不该带空括号')
})

test('没有热评就不加这一段', () => {
	const p = PROMPT({ aweme_title: 'x', text: 'y', author: 'z' }, {})
	assert.equal(p.includes('这条下面别人在说'), false)
})

test('热评最多三条', () => {
	const hot = [1, 2, 3, 4, 5].map((n) => ({ text: 'c' + n, digg: n }))
	const p = PROMPT({ aweme_title: 'x', text: 'y', hot }, {})
	assert.equal(p.split('\n- c').length - 1, 3)
})

test('settings 默认还是 feed，search 才切', () => {
	assert.equal(DEFAULTS.scanMode, 'feed')
	assert.equal(normalize({}).scanMode, 'feed')
	assert.equal(normalize({ scanMode: 'search', scanKeywords: '猫，狗' }).scanMode, 'search')
	assert.equal(normalize({ scanMode: 'search', scanKeywords: '猫，狗' }).scanKeywords, '猫，狗')
	assert.equal(normalize({ scanMode: 'nonsense' }).scanMode, 'feed')
})
