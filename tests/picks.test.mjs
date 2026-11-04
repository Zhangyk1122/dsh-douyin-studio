/**
 * tests/picks.test.mjs —— 候选库的验收
 * ============================================================================
 * 这里钉四件事：
 *   ① 归一化：脏数据不崩
 *   ② 判：该挡的挡住（广告 / 超长 / 短 / 屏蔽词 / 赞数）
 *   ③ 打分：可解释 —— **没有理由时必须坦白，不许编**
 *   ④ 合并：人给过的结论（state）不被后续刷取覆盖
 * 全部纯函数，不需要浏览器。
 * ============================================================================
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { toCandidate, judge, mergeItems, rank, setState, stats, MAX, WEIGHTS } from '../lib/picks.mjs'

const c = (o = {}) => ({
	aweme_id: '7', desc: '露营装备清单', tags: ['露营'], author: '某人', sec_uid: 'sec1',
	duration_sec: 30, digg: 10000, comment: 100, share: 10, is_ad: false,
	create_date: new Date().toISOString().slice(0, 19).replace('T', ' '), state: 'new',
	first_seen: '2026-11-01T00:00:00Z', ...o,
})

/* ── ① 归一化 ────────────────────────────────────────────── */
test('空对象也能归一化，不崩', () => {
	const r = toCandidate({})
	assert.equal(r.aweme_id, '')
	assert.equal(r.desc, '')
	assert.deepEqual(r.tags, [])
	assert.equal(r.state, 'new')
})

test('aweme_id 一律转字符串（接口给数字时别踩）', () => {
	assert.equal(toCandidate({ aweme_id: 123 }).aweme_id, '123')
})

test('feed 的扁平结构和 api 的嵌套结构都认（作者名不能空）', () => {
	const flat = toCandidate({ aweme_id: '1', author: '辰辰辰chen', author_sec_uid: 'MS4w1' })
	assert.equal(flat.author, '辰辰辰chen')
	assert.equal(flat.sec_uid, 'MS4w1')
	const nest = toCandidate({ aweme_id: '2', author: { nickname: '小汐', sec_uid: 'MS4w2' } })
	assert.equal(nest.author, '小汐')
	assert.equal(nest.sec_uid, 'MS4w2')
})

test('desc 截 200 字并压掉换行', () => {
	const r = toCandidate({ desc: 'a\n\nb'.repeat(120) })
	assert.equal(r.desc.length, 200)
	assert.equal(r.desc.includes('\n'), false)
})

/* ── ② 挡 ────────────────────────────────────────────────── */
test('广告直接挡', () => {
	assert.equal(judge(c({ is_ad: true }), {}).ok, false)
})

test('超过 maxSec 挡，不到 minSec 也挡', () => {
	assert.equal(judge(c({ duration_sec: 600 }), { maxSec: 180 }).blocked, true)
	assert.equal(judge(c({ duration_sec: 3 }), { minSec: 5 }).blocked, true)
})

test('minSec 为 0 时不拿"太短"挡人（0 表示不限，不是"至少 0 秒"）', () => {
	assert.equal(judge(c({ duration_sec: 1 }), { minSec: 0 }).ok, true)
})

test('屏蔽词命中 → 挡，并把命中的词写进理由', () => {
	const r = judge(c({ desc: '这个广告真烦' }), { blockKeywords: ['广告'] })
	assert.equal(r.ok, false)
	assert.match(r.why, /广告/)
})

test('赞数门槛没过 → 挡', () => {
	assert.equal(judge(c({ digg: 3 }), { minDigg: 100 }).ok, false)
})

/* ── ③ 打分可解释 ─────────────────────────────────────────── */
test('分数永远落在 0–1', () => {
	for (const ctx of [{}, { keywords: ['露营'] }, { authors: ['某人'] }, { tags: ['露营'] }]) {
		const r = judge(c(), ctx)
		assert.ok(r.score >= 0 && r.score <= 1, JSON.stringify(ctx) + ' 得分越界：' + r.score)
	}
})

test('权重加起来是 1.00（改了要同步这条）', () => {
	const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0)
	assert.equal(Math.round(sum * 100) / 100, 1)
})

test('命中关键词 → 理由里有关键词，且分数高于没命中', () => {
	const plain = judge(c({ desc: '随便的东西', tags: [] }), {})
	const hitKw = judge(c({ desc: '露营装备清单', tags: [] }), { keywords: ['露营'] })
	assert.match(hitKw.why, /露营/)
	assert.ok(hitKw.score > plain.score)
})

test('没有命中任何特征时，理由必须坦白"平台在推的"，不许编', () => {
	/* 日期也要造旧：新鲜度本身就是一个合法理由，留着它会抢走"最大贡献"这一位 */
	const r = judge(c({ desc: '无关内容', tags: [], author: '路人', digg: 0, create_date: '2026-01-01 00:00:00' }), { minSec: 0, maxSec: 0 })
	assert.equal(r.ok, true)
	assert.match(r.why, /平台在推的/)
})

test('互动量高的分更高（同条件下单调）', () => {
	const low = judge(c({ digg: 10, tags: [] }), {}).score
	const high = judge(c({ digg: 500000, tags: [] }), {}).score
	assert.ok(high > low)
})

/* ── ④ 合并 ──────────────────────────────────────────────── */
test('同 id 不重复，只更新客观数据', () => {
	const old = [{ ...c(), score: 0.4, state: 'new' }]
	const next = [{ ...c({ digg: 99999 }), score: 0.5 }]
	const merged = mergeItems(old, next)
	assert.equal(merged.length, 1)
	assert.equal(merged[0].digg, 99999)
})

test('人给过的结论不被刷取覆盖（点赞过的还是点赞过）', () => {
	const old = [{ ...c(), state: 'liked', score: 0.4 }]
	const merged = mergeItems(old, [{ ...c(), score: 0.9 }])
	assert.equal(merged[0].state, 'liked')
	assert.equal(merged[0].score, 0.9, '分数该取更高的那个')
})

test('超上限时先淘汰忽略过的，再淘汰看过的', () => {
	const old = [
		{ ...c({ aweme_id: 'a' }), state: 'dismissed', first_seen: '2026-10-01T00:00:00Z' },
		{ ...c({ aweme_id: 'b' }), state: 'seen', first_seen: '2026-10-02T00:00:00Z' },
		{ ...c({ aweme_id: 'c' }), state: 'new', first_seen: '2026-10-03T00:00:00Z' },
	]
	const merged = mergeItems(old, [], { max: 2 })
	const ids = merged.map((x) => x.aweme_id).sort()
	assert.deepEqual(ids, ['b', 'c'])
})

/* ── 排序 / 状态 / 计数 ──────────────────────────────────── */
test('rank 过滤掉 dismissed 并按分降序', () => {
	const list = [
		{ ...c({ aweme_id: 'a' }), score: 0.2 },
		{ ...c({ aweme_id: 'b' }), score: 0.9 },
		{ ...c({ aweme_id: 'c' }), score: 0.5, state: 'dismissed' },
	]
	assert.deepEqual(rank(list).map((x) => x.aweme_id), ['b', 'a'])
})

test('setState 只改那一条，非法状态原样返回', () => {
	const list = [{ ...c({ aweme_id: 'a' }) }, { ...c({ aweme_id: 'b' }) }]
	const out = setState(list, 'a', 'saved')
	assert.equal(out[0].state, 'saved')
	assert.equal(out[1].state, 'new')
	assert.equal(setState(list, 'a', '瞎写').length, 2)
	assert.equal(setState(list, 'a', '瞎写')[0].state, 'new')
})

test('sent 会顺手记 notified_at（"今天叫过几次"靠它）', () => {
	const out = setState([{ ...c() }], '7', 'sent')
	assert.match(out[0].notified_at, /^\d{4}-\d{2}-\d{2}/)
})

test('stats 数得清：总数 / 新的 / 今天叫过 / 存下的', () => {
	const s = stats([
		{ ...c({ aweme_id: 'a' }), state: 'new' },
		{ ...c({ aweme_id: 'b' }), state: 'saved' },
		{ ...c({ aweme_id: 'c' }), state: 'sent', notified_at: new Date().toISOString() },
		{ ...c({ aweme_id: 'd' }), state: 'sent', notified_at: '2020-01-01T00:00:00Z' },
	])
	assert.equal(s.total, 4)
	assert.equal(s.fresh, 1)
	assert.equal(s.called, 1)
	assert.equal(s.keep, 1)
})

test('MAX 是个合理的数（不是 0 也不是无穷）', () => {
	assert.ok(MAX >= 100 && MAX <= 1000)
})
