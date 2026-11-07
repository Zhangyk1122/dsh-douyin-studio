/**
 * tests/text-guard.test.mjs —— 出站正文类型闸（0.4.6，观察模式）
 * ============================================================================
 * 事故：2026-11-07T12:59:45Z 一条私信正文是 `[object Object]`。
 * 这里钉三件事：字符串原样过、非字符串记下 rawType 但仍放行（观察）、
 * 开了 block 才真的拦。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { guardText, rawTypeOf, GUARD_ENV } from '../lib/text-guard.mjs'

test('字符串：原样通过', () => {
	const g = guardText('日报 · 11/7', 'test')
	assert.equal(g.ok, true)
	assert.equal(g.text, '日报 · 11/7')
	assert.equal(g.rawType, 'string')
	assert.equal(g.blocked, false)
})

test('对象：观察模式下放行，但 rawType 记成 object（就是 [object Object] 的来源）', () => {
	delete process.env[GUARD_ENV]
	const g = guardText({ ok: true }, 'test')
	assert.equal(g.ok, true)
	assert.equal(g.blocked, false)
	assert.equal(g.rawType, 'object')
	assert.equal(g.text, '[object Object]')
})

test('number / array / null：类型分得开，值与空值都转得出来', () => {
	assert.equal(rawTypeOf(1), 'number')
	assert.equal(rawTypeOf([]), 'array')
	assert.equal(rawTypeOf(null), 'null')
	assert.equal(guardText(42, 't').text, '42')
	assert.equal(guardText(null, 't').text, '')
	assert.equal(guardText(42, 't').rawType, 'number')
})

test('开 block：非字符串真的拦下，错误里带 rawType', () => {
	process.env[GUARD_ENV] = 'block'
	try {
		const g = guardText({ a: 1 }, 'test')
		assert.equal(g.ok, false)
		assert.equal(g.blocked, true)
		assert.match(String(g.error), /rawType=object/)
	} finally { delete process.env[GUARD_ENV] }
})

test('开 block 时字符串照样过（别把正常日报拦了）', () => {
	process.env[GUARD_ENV] = 'block'
	try {
		const g = guardText('日报 · 11/7', 'test')
		assert.equal(g.ok, true)
	} finally { delete process.env[GUARD_ENV] }
})

test('where 带得回去（日志里能认出是哪条链）', () => {
	assert.equal(guardText('x', 'im-report').where, 'im-report')
})
