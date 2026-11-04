/**
 * tests/cache.test.mjs —— 「先给旧的，后台再刷」的判定规则
 * ============================================================================
 * 这条策略决定了面板是「秒开」还是「转圈 15 秒」，而且规则一改没人看得出来，
 * 所以把三种结论都钉住：
 *   cold  = 没缓存（或 limit 变了）→ 只能等
 *   fresh = 还新鲜 → 直接给，别再打接口
 *   stale = 过期了 → **照样立刻给**，同时后台刷
 * 最容易写错的两种：把 stale 当成 cold（又变回干等），
 * 以及时间戳坏了当成 fresh（拿一份来路不明的数据当新的）。
 * ============================================================================
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { decideCache, serveInbox, DEFAULT_TTL } from '../lib/cache.mjs'

const NOW = Date.parse('2026-11-02T23:30:00.000Z')
const at = (msAgo) => new Date(NOW - msAgo).toISOString()
const cacheAt = (msAgo, extra = {}) => ({ at: at(msAgo), limit: 8, data: { ok: true }, ...extra })

test('没有缓存 → cold（首次打开只能等，之后不会）', () => {
	assert.equal(decideCache(null, { now: NOW }).mode, 'cold')
	assert.equal(decideCache(undefined, { now: NOW }).mode, 'cold')
	assert.equal(decideCache({ at: at(0) }, { now: NOW }).mode, 'cold') // 有 at 没 data 也算没有
})

test('新鲜 → fresh，不再打接口', () => {
	const d = decideCache(cacheAt(30_000), { now: NOW })
	assert.equal(d.mode, 'fresh')
	assert.equal(d.ageMs, 30_000)
})

test('过期 → stale，但仍然是「立刻给」，不是「等新的」', () => {
	const d = decideCache(cacheAt(5 * 60_000), { now: NOW })
	assert.equal(d.mode, 'stale')
	assert.ok(d.ageMs >= 5 * 60_000 - 1000)
})

test('边界：正好等于 TTL 还算是新鲜的，超过才算过期', () => {
	assert.equal(decideCache(cacheAt(DEFAULT_TTL), { now: NOW, ttl: DEFAULT_TTL }).mode, 'fresh')
	assert.equal(decideCache(cacheAt(DEFAULT_TTL + 1), { now: NOW, ttl: DEFAULT_TTL }).mode, 'stale')
})

test('limit 换了 → cold，不拿条数对不上的旧数据凑数', () => {
	assert.equal(decideCache(cacheAt(1000, { limit: 8 }), { now: NOW, limit: 20 }).mode, 'cold')
	assert.equal(decideCache(cacheAt(1000, { limit: 8 }), { now: NOW, limit: 8 }).mode, 'fresh')
	// 不传 limit 就不过滤（给命令行 / 调试用）
	assert.equal(decideCache(cacheAt(1000, { limit: 8 }), { now: NOW }).mode, 'fresh')
})

test('时间戳坏了 → 当过期处理，绝不当成新的', () => {
	const d = decideCache({ at: '这不是时间', limit: 8, data: { ok: true } }, { now: NOW })
	assert.equal(d.mode, 'stale')
	assert.ok(Number.isFinite(d.ageMs))
})

test('时间戳在未来（改了系统时间）→ 夹到 0，不当成负数', () => {
	const d = decideCache(cacheAt(-60_000), { now: NOW })
	assert.equal(d.mode, 'fresh')
	assert.equal(d.ageMs, 0)
})

/* ── serveInbox：整条路由的行为。「秒开」说的就是 stale 那条不能 await ── */

const REFRESH_MS = 120
const slowRefresh = (calls) => (lim) => {
	calls.push(lim)
	return new Promise((r) => setTimeout(() => r({ ok: true, counts: { dm: 99 } }), REFRESH_MS))
}

test('冷启动：只能等，且标记 cold', async () => {
	const calls = []
	const t = Date.now()
	const o = await serveInbox({ lim: 8, cache: null, refresh: slowRefresh(calls), now: NOW })
	assert.ok(Date.now() - t >= REFRESH_MS - 10, '冷启动应该等真结果')
	assert.equal(o.waited, true)
	assert.equal(o.fromCache, false)
	assert.equal(o.body.counts.dm, 99)
	assert.equal(o.body.cache.cold, true)
	assert.deepEqual(calls, [8])
})

test('有缓存且新鲜：不刷、立刻回', async () => {
	const calls = []
	const t = Date.now()
	const o = await serveInbox({
		lim: 8, cache: cacheAt(1000, { data: { ok: true, counts: { dm: 7 } } }),
		refresh: slowRefresh(calls), now: NOW,
	})
	assert.ok(Date.now() - t < 40, '新鲜度够就不该等')
	assert.equal(o.waited, false)
	assert.equal(o.fromCache, true)
	assert.equal(o.body.counts.dm, 7)
	assert.equal(o.body.cache.refreshing, false)
	assert.equal(calls.length, 0, '新鲜时不该去打接口')
})

test('过期：立刻回旧的，并**不等**后台刷新（这条就是秒开）', async () => {
	const calls = []
	const t = Date.now()
	const o = await serveInbox({
		lim: 8, cache: cacheAt(5 * 60_000, { data: { ok: true, counts: { dm: 3 } } }),
		refresh: slowRefresh(calls), now: NOW,
	})
	const spent = Date.now() - t
	assert.ok(spent < 40, `过期也不该等，实际等了 ${spent}ms`)
	assert.equal(o.waited, false)
	assert.equal(o.body.counts.dm, 3, '先给旧数据')
	assert.equal(o.body.cache.refreshing, true, '同时告诉前端后台在刷')
	assert.equal(o.body.cache.stale, true)
	assert.deepEqual(calls, [8], '后台那轮要真的发出去')
})

test('已有别的轮次在跑（busy）：照样秒回，且 refreshing 为真', async () => {
	const o = await serveInbox({
		lim: 8, cache: cacheAt(1000, { data: { ok: true, counts: { dm: 1 } } }),
		busy: true, refresh: slowRefresh([]), now: NOW,
	})
	assert.equal(o.waited, false)
	assert.equal(o.body.cache.refreshing, true)
})

test('fresh=1：忽略缓存等真结果', async () => {
	const calls = []
	const t = Date.now()
	const o = await serveInbox({
		lim: 8, force: true, cache: cacheAt(1000, { data: { ok: true, counts: { dm: 1 } } }),
		refresh: slowRefresh(calls), now: NOW,
	})
	assert.ok(Date.now() - t >= REFRESH_MS - 10)
	assert.equal(o.waited, true)
	assert.equal(o.body.counts.dm, 99, '强制刷新必须拿到新数据')
})
