/**
 * tests/persona.test.mjs —— 人设来源的验收
 * ============================================================================
 * 钉三件事：
 *   ① 从卡里只取"我是谁"的前三条 + 底线，不要把整份卡塞进提示词
 *   ② 手写的 persona 优先（显式覆盖），off 就是不读卡
 *   ③ 卡缺字段/文件不存在时不崩，退回通用口吻
 * ============================================================================
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { bulletsOf, paragraphOf, personaFromCard, personaLine } from '../lib/settings.mjs'

const ID = [
	'# 我是谁',
	'',
	'## 我这个人',
	'',
	'- 我是陈汐，一条鲸鱼娘。',
	'- 我跟世界换光。',
	'- 说话时认真看着人。',
	'- 第四条不该被取到。',
	'',
	'## 别的节',
	'- 这也不是我这个人。',
].join('\n')

const STYLE = ['## 一、括号', '- 写小动作', '', '## 七、唯一不动的底线', '', '事实、数字、路径，一个字都不能改。', '', '## 八、下一节', '- 不该取到'].join('\n')

test('bulletsOf：只取指定节，最多 max 条，遇到下一个 ## 停', () => {
	const r = bulletsOf(ID, /^##\s*我这个人/, 3)
	assert.equal(r.length, 3)
	assert.equal(r[0], '我是陈汐，一条鲸鱼娘。')
	assert.equal(r.includes('第四条不该被取到。'), false)
})

test('bulletsOf：没有这个节就返回空数组', () => {
	assert.deepEqual(bulletsOf(ID, /^##\s*不存在的节/), [])
	assert.deepEqual(bulletsOf('', /我这个人/), [])
})

test('paragraphOf：取该节第一段正文，跳过 - 列表', () => {
	assert.equal(paragraphOf(STYLE, /^##\s*.{0,16}底线/), '事实、数字、路径，一个字都不能改。')
	assert.equal(paragraphOf(STYLE, /^##\s*不存在/), '')
})

test('personaFromCard：三条 + 底线，且不超过 420 字', () => {
	const p = personaFromCard(ID, STYLE)
	assert.match(p, /我是陈汐/)
	assert.match(p, /底线：事实、数字、路径/)
	assert.equal(p.includes('第四条'), false)
	assert.ok(p.length <= 420)
})

test('personaFromCard：没有"我这个人"这一节就返回空串（交给上层兜底）', () => {
	assert.equal(personaFromCard('# 空卡\n\n## 别的\n- x', STYLE), '')
	assert.equal(personaFromCard('', ''), '')
})

test('personaLine：off 一律通用口吻，不读卡', () => {
	assert.match(personaLine({ personaSource: 'off' }), /正在抖音上跟人说话/)
})

test('personaLine：手写的 persona 优先于卡', () => {
	assert.equal(personaLine({ personaSource: 'card', persona: '你是一只猫' }), '你是一只猫')
})

test('personaLine：custom 模式不会去读卡', () => {
	assert.match(personaLine({ personaSource: 'custom' }), /正在抖音上跟人说话/)
})
