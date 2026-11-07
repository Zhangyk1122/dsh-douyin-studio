/**
 * tests/text-guard.test.mjs —— 出站正文类型闸（0.4.6 观察 / 0.4.7 默认拦）
 * ============================================================================
 * 事故：2026-11-07T12:59:45Z 一条私信正文是 `[object Object]`。
 * 根因：`index.js` 的 `say = String(await generate(...))`，`generate()` 回的是 `{ok,text}`。
 * 这里钉五件事：字符串原样过、非字符串默认就拦、`=observe` 退回记账、
 * `textOfResult()` 从对象里取正文、`index.js` 里不再出现 `String(await generate(`。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { guardText, guardMode, rawTypeOf, textOfResult, GUARD_ENV } from '../lib/text-guard.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 临时切模式，跑完还原 */
function withMode(v, fn) {
	const old = process.env[GUARD_ENV]
	if (v === null) delete process.env[GUARD_ENV]
	else process.env[GUARD_ENV] = v
	try { return fn() } finally {
		if (old === undefined) delete process.env[GUARD_ENV]
		else process.env[GUARD_ENV] = old
	}
}

test('字符串：原样通过（两种模式下都一样）', () => {
	const g = guardText('日报 · 11/7', 'test')
	assert.equal(g.ok, true)
	assert.equal(g.text, '日报 · 11/7')
	assert.equal(g.rawType, 'string')
	assert.equal(g.blocked, false)
})

test('默认（不设环境变量）= 拦截：对象当场 ok:false，错误里带 rawType', () => {
	withMode(null, () => {
		assert.equal(guardMode(), 'block')
		const g = guardText({ ok: true }, 'test')
		assert.equal(g.ok, false)
		assert.equal(g.blocked, true)
		assert.equal(g.mode, 'block')
		assert.equal(g.rawType, 'object')
		assert.match(String(g.error), /rawType=object/)
	})
})

test('=observe 退回记账模式：放行但仍记 rawType', () => {
	for (const v of ['observe', 'off', '0', 'false']) {
		withMode(v, () => {
			assert.equal(guardMode(), 'observe', v)
			const g = guardText({ ok: true }, 'test')
			assert.equal(g.ok, true, v)
			assert.equal(g.blocked, false, v)
			assert.equal(g.text, '[object Object]')
		})
	}
})

test('number / array / null：类型分得开，值与空值都转得出来', () => {
	assert.equal(rawTypeOf(1), 'number')
	assert.equal(rawTypeOf([]), 'array')
	assert.equal(rawTypeOf(null), 'null')
	assert.equal(guardText(42, 't').text, '42')
	assert.equal(guardText(null, 't').text, '')
	assert.equal(guardText(42, 't').rawType, 'number')
})

test('textOfResult：{ok,text} 取 text，绝不吐 [object Object]', () => {
	assert.equal(textOfResult({ ok: true, text: '这条想给你看看' }), '这条想给你看看')
	assert.equal(textOfResult({ ok: true, say: '好耶' }), '好耶')
	assert.equal(textOfResult({ content: '正文' }), '正文')
	assert.equal(textOfResult('直接是字符串'), '直接是字符串')
	assert.equal(textOfResult({ ok: false }), '')
	assert.equal(textOfResult(null), '')
	assert.equal(textOfResult(42), '')
	assert.equal(textOfResult({ text: '   ' }), '')
	assert.ok(!textOfResult({ ok: true }).includes('[object'))
})

test('guardText 的 where 带得回去（日志里能认出是哪条链）', () => {
	assert.equal(guardText('x', 'im-report').where, 'im-report')
})

test('index.js 里不再有 String(await generate( —— 事故写法不许回潮', () => {
	const src = readFileSync(join(ROOT, 'index.js'), 'utf8')
	/* 注释里可以写这段事故代码（讲清楚为什么改），只查真正会跑的代码行 */
	const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
	assert.equal(code.includes('String(await generate('), false, '又出现了 String(await generate( ')
	assert.ok(code.includes('textOfResult(g)'), '感想那段应该走 textOfResult(g)')
})
