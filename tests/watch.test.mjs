import { test } from 'node:test'
import assert from 'node:assert/strict'
import { watchOf, watchLine, cachedWatch, resetWatchCache, gridOf, TTL_MS } from '../lib/watch.mjs'

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

/* ── 2026-11-15：接上抽帧之后新增的（`dy see`）─────────────────────
 * 抽帧本身要 ffmpeg 和网络，不进单测；这里只测不花钱的那部分。 */

test('gridOf：短片 6 格，长片加格，低于 6 也按 6 走', () => {
	assert.deepEqual(gridOf(6), { cols: 3, rows: 2, cells: 6 })
	assert.deepEqual(gridOf(4), { cols: 3, rows: 2, cells: 6 })
	assert.deepEqual(gridOf(9), { cols: 3, rows: 3, cells: 9 })
	assert.deepEqual(gridOf(12), { cols: 4, rows: 3, cells: 12 })
	assert.deepEqual(gridOf(16), { cols: 4, rows: 4, cells: 16 })
	assert.deepEqual(gridOf(40), { cols: 5, rows: 4, cells: 20 })
	assert.deepEqual(gridOf(''), { cols: 3, rows: 2, cells: 6 })
})

test('gridOf：声明 6 格就真给 6 个格子，不许少也不许多到离谱', () => {
	for (const n of [6, 9, 12, 16, 20]) {
		const g = gridOf(n)
		assert.equal(g.cols * g.rows, g.cells)
		assert.ok(g.cells <= n + 4)
	}
})

test('watchOf：detail 带 play_url 就折进来（抽帧要用），没带就是空串', () => {
	const withUrl = watchOf('7500000000000000001', {
		ok: true,
		aweme: { ...detailOk.aweme, play_url: 'https://v11.example/x.mp4', width: 1080, height: 1920 },
	}, { ok: true, list: [] })
	assert.equal(withUrl.playUrl, 'https://v11.example/x.mp4')
	assert.equal(withUrl.size, '1080x1920')
	assert.equal(withUrl.sheet, '') // 没抽就是空的，不许挂一个假路径

	const noUrl = watchOf('x', detailOk, { ok: true, list: [] })
	assert.equal(noUrl.playUrl, '')
	assert.equal(noUrl.size, '')
})

test('TTL 是 30 分钟：同一条不会每轮都去请求', () => {
	assert.equal(TTL_MS, 30 * 60 * 1000)
})
