/**
 * tests/taste.test.mjs —— 口味画像的验收
 * ============================================================================
 * 这里钉六件事：
 *   ① 样本不够就不许有结论（< 20 一律空）
 *   ② 半衰期真的是 14 天（不是"大概"）
 *   ③ 身份只认 sec_uid，昵称不算
 *   ④ 各种正样本的权重要有高低（自己发的 > 存下的 > 赞过的）
 *   ⑤ 纯函数：同输入同 now，输出必须一模一样
 *   ⑥ 脏数据不崩
 * 全部纯函数，不需要浏览器、不写盘。
 * ============================================================================
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTaste, toContext, empty, MIN_EVIDENCE, HALF_LIFE_DAYS } from '../lib/taste.mjs'

const NOW = Date.parse('2026-11-05T12:00:00Z')
const T = (days) => new Date(NOW - days * 86400000).toISOString()
const many = (n, f) => Array.from({ length: n }, (_, i) => f(i))
const like = (o = {}) => ({
	aweme_id: '1', desc: '露营装备', tags: ['露营'],
	author: { nickname: '某人', sec_uid: 'sec1' }, duration_sec: 30, at: T(1), ...o,
})

/* ── ① 样本预算 ──────────────────────────────────────────── */
test('空输入就是空画像，hours 也得有 24 格', () => {
	const t = buildTaste({}, NOW)
	assert.deepEqual(t.authors, {})
	assert.deepEqual(t.tags, {})
	assert.equal(t.hours.length, 24)
	assert.equal(t.evidence, 0)
})

test(`证据不足 ${MIN_EVIDENCE} 条：有数据也不许下结论`, () => {
	const t = buildTaste({ likes: many(19, (i) => like({ aweme_id: String(i) })) }, NOW)
	assert.deepEqual(t.authors, {})
	assert.deepEqual(t.tags, {})
	assert.equal(t.evidence, 19)
})

test(`正好 ${MIN_EVIDENCE} 条才开始有结论`, () => {
	const t = buildTaste({ likes: many(20, (i) => like({ aweme_id: String(i) })) }, NOW)
	assert.ok(Object.keys(t.authors).length > 0)
	assert.equal(t.evidence, 20)
})

/* ── ② 半衰期 ────────────────────────────────────────────── */
test(`半衰期 ${HALF_LIFE_DAYS} 天：今天赞的权重是两周前的两倍`, () => {
	const likes = [
		...many(10, (i) => like({ aweme_id: 'a' + i, author: { nickname: 'A', sec_uid: 'secA' }, at: T(0) })),
		...many(10, (i) => like({ aweme_id: 'b' + i, author: { nickname: 'B', sec_uid: 'secB' }, at: T(HALF_LIFE_DAYS) })),
	]
	const t = buildTaste({ likes }, NOW)
	assert.equal(t.authors.secA, 1)
	assert.ok(Math.abs(t.authors.secB - 0.5) < 0.01, `secB=${t.authors.secB}`)
})

/* ── ③ 身份 ──────────────────────────────────────────────── */
test('只有昵称、没有 sec_uid 的作者不进画像（昵称会改）', () => {
	const likes = many(20, (i) => like({ aweme_id: String(i), author: { nickname: '无名氏' }, sec_uid: '' }))
	const t = buildTaste({ likes }, NOW)
	assert.deepEqual(t.authors, {})
})

test('嵌套和扁平两种 sec_uid 都认', () => {
	const likes = [
		...many(10, (i) => like({ aweme_id: 'n' + i, author: { nickname: 'N', sec_uid: 'nest' } })),
		...many(10, (i) => like({ aweme_id: 'f' + i, author: 'F', author_sec_uid: 'flat' })),
	]
	const t = buildTaste({ likes }, NOW)
	assert.equal(t.authors.nest, 1)
	assert.equal(Math.round(t.authors.flat * 100) / 100, 1)
})

/* ── ④ 权重与话题 ────────────────────────────────────────── */
test('自己发的（1.5）压过赞过的（1.0）', () => {
	const likes = many(10, (i) => like({ aweme_id: 'l' + i, tags: ['只看'], author: { sec_uid: 'onlyLike' } }))
	const pubs = many(10, (i) => ({ at: T(1), tags: ['我发'], duration_sec: 40 }))
	const t = buildTaste({ likes, publishes: pubs }, NOW)
	assert.equal(t.tags['我发'], 1)
	assert.ok(Math.abs(t.tags['只看'] - 1 / 1.5) < 0.01, `只看=${t.tags['只看']}`)
})

test('话题从 tags 数组和文案 # 号两处来，去重', () => {
	const likes = many(20, (i) => like({ aweme_id: String(i), tags: ['露营', { tag_name: '露营' }], desc: '今天 #露营 #钓鱼' }))
	const t = buildTaste({ likes }, NOW)
	assert.deepEqual(Object.keys(t.tags).sort(), ['钓鱼', '露营'])
	assert.equal(t.tags['露营'], 1)
})

test('picks 只算 saved / liked，dismissed 和 new 不算', () => {
	const picks = [
		...many(10, (i) => ({ aweme_id: 'p' + i, state: 'saved', sec_uid: 'savedMe', tags: ['存'], at: T(1) })),
		...many(10, (i) => ({ aweme_id: 'q' + i, state: 'liked', sec_uid: 'likedMe', tags: ['赞'], at: T(1) })),
		...many(10, (i) => ({ aweme_id: 'r' + i, state: 'dismissed', sec_uid: 'nope', tags: ['跳过'], at: T(1) })),
		...many(10, (i) => ({ aweme_id: 's' + i, state: 'new', sec_uid: 'nope2', tags: ['没看'], at: T(1) })),
	]
	const t = buildTaste({ picks }, NOW)
	assert.ok(t.authors.savedMe > 0 && t.authors.likedMe > 0)
	assert.equal(t.authors.nope, undefined)
	assert.equal(t.tags['跳过'], undefined)
	/* 被 filter 掉的不是正样本，也不该算证据 */
	assert.equal(t.evidence, 20)
})

/* ── ⑤ 时长与小时 ────────────────────────────────────────── */
test('时长取 p50 / p90（秒）', () => {
	const likes = many(20, (i) => like({ aweme_id: String(i), duration_sec: i + 1 }))
	const t = buildTaste({ likes }, NOW)
	assert.equal(t.dur.p50, 10)
	assert.equal(t.dur.p90, 18)
})

test('小时直方图 24 格，样本落在对应的小时', () => {
	const at = new Date(NOW)
	at.setHours(23, 30, 0, 0)
	const likes = many(20, (i) => like({ aweme_id: String(i), at: at.toISOString() }))
	const t = buildTaste({ likes }, NOW)
	assert.equal(t.hours.length, 24)
	assert.ok(t.hours[23] > 0)
	assert.equal(t.hours.reduce((a, b) => a + b, 0) > 0, true)
})

/* ── ⑥ 纯函数与脏数据 ────────────────────────────────────── */
test('同输入同 now：两次结果完全一致', () => {
	const likes = many(25, (i) => like({ aweme_id: String(i) }))
	assert.deepEqual(buildTaste({ likes }, NOW), buildTaste({ likes }, NOW))
})

test('坏时间戳不崩，但也不算进权重', () => {
	const likes = many(20, (i) => like({ aweme_id: String(i), at: '不是时间' }))
	const t = buildTaste({ likes }, NOW)
	assert.equal(t.evidence, 20)
	assert.deepEqual(t.authors, {})
})

test('toContext 按权重取头部，最多 30 个作者 / 20 个话题', () => {
	const likes = many(40, (i) => like({ aweme_id: String(i), author: { sec_uid: 's' + i }, tags: ['t' + i] }))
	const t = buildTaste({ likes }, NOW)
	const ctx = toContext(t)
	assert.equal(ctx.authors.length, 30)
	assert.equal(ctx.tags.length, 20)
	assert.equal(toContext(empty()).authors.length, 0)
})
