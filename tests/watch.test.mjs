import { test } from 'node:test'
import assert from 'node:assert/strict'
import { watchOf, watchLine, cachedWatch, resetWatchCache } from '../lib/watch.mjs'

const detailOk = {
	ok: true,
	aweme: {
		aweme_id: '7500000000000000001',
		desc: '今天在河边蹲了半天',
		duration_ms: 23500,
		digg: 12345,
		comment: 67,
		collect: 8,
		create_date: '2026-11-13 10:00:00',
	},
}

test('watchOf：详情 + 评论折成「我看过」的事实', () => {
	const w = watchOf('7500000000000000001', detailOk, {
		ok: true,
		list: [
			{ cid: '1', text: '这条我看了三遍', digg: 30 },
			{ cid: '2', text: '水好清', digg: 99 },
			{ cid: '3', text: '', digg: 500 },
		],
	})
	assert.equal(w.ok, true)
	assert.equal(w.durationSec, 24) // 23500ms 四舍五入是 24 秒
	assert.equal(w.digg, 12345)
	assert.equal(w.comment, 67)
	assert.deepEqual(w.hot.map((h) => h.cid), ['2', '1']) // 空文本不进来，按赞排
	assert.equal(w.frames, false) // 没有 vision 就是没有，不假装
})

test('watchOf：详情失败不抛，只是 ok:false', () => {
	const w = watchOf('x', { ok: false, error: '作品已删除' }, null)
	assert.equal(w.ok, false)
	assert.equal(w.diggs === undefined, true)
	assert.deepEqual(w.hot, [])
})

test('watchLine：只给事实，不给形容词', () => {
	const w = watchOf('a', detailOk, { ok: true, list: [{ cid: '1', text: '水好清', digg: 99 }] })
	const line = watchLine(w)
	assert.match(line, /24 秒/)
	assert.match(line, /1\.2 万 赞/)
	assert.match(line, /67 条评论/)
	assert.match(line, /「水好清」/)
	assert.equal(/很好看|绝了|yyds/.test(line), false)
})

test('watchLine：拿不到详情就返回空串（调用方少一行提示）', () => {
	assert.equal(watchLine(null), '')
	assert.equal(watchLine({ ok: false }), '')
})

test('watchLine：没有热评也能只说时长', () => {
	const w = watchOf('a', detailOk, { ok: true, list: [] })
	assert.match(watchLine(w), /24 秒/)
	assert.equal(watchLine(w).includes('评论里在说'), false)
})

test('cachedWatch / resetWatchCache：只读缓存，不发请求', () => {
	resetWatchCache()
	assert.equal(cachedWatch('nope'), null)
	resetWatchCache()
	assert.equal(cachedWatch(''), null)
})
