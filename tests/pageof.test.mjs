import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pageOf } from '../lib/feed.mjs'

/* 2026-11-11 / 11-12 两轮 scan-round 的 ok:false 就死在这儿：
 * 页面 evaluate 回 "null" → JSON.parse 得 null → 下一行 page.ok 抛 TypeError。 */

test('pageOf：raw 是 null / undefined / 空串，都给人话而不是 TypeError', () => {
	for (const raw of [null, undefined, '']) {
		const r = pageOf(raw)
		assert.equal(r.ok, false)
		assert.match(r.error, /没返回内容/)
	}
})

test('pageOf：JSON 解析不了就说"不是 JSON"，带上开头 120 字', () => {
	const r = pageOf('<html>请先登录</html>')
	assert.equal(r.ok, false)
	assert.match(r.error, /不是 JSON|没返回 JSON/)
	assert.match(r.error, /请先登录/)
})

test('pageOf：解析成 null / 数字 / 字符串，都不算对象', () => {
	assert.equal(pageOf('null').ok, false)
	assert.equal(pageOf('0').ok, false)
	assert.equal(pageOf('"ok"').ok, false)
})

test('pageOf：对象但 ok:false，保留页面自己给的原因', () => {
	const r = pageOf(JSON.stringify({ ok: false, error: '未登录' }))
	assert.equal(r.ok, false)
	assert.equal(r.error, '未登录')
})

test('pageOf：ok:true 但没有 list，给空数组（后面筛子照常跑）', () => {
	const r = pageOf(JSON.stringify({ ok: true }))
	assert.equal(r.ok, true)
	assert.deepEqual(r.list, [])
})

test('pageOf：正常一页', () => {
	const r = pageOf(JSON.stringify({ ok: true, list: [{ aweme_id: '1' }, { aweme_id: '2' }] }))
	assert.equal(r.ok, true)
	assert.equal(r.list.length, 2)
})