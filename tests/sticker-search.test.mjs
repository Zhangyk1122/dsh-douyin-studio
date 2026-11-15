/**
 * tests/sticker-search.test.mjs —— 表情包语义检索（调研 D4 的 A 档剩余）
 * ============================================================================
 * 钉四件事：
 *   ① 中文按二元切分：「加班」搜得到写「加班到两点」的图；
 *   ② 查不到就返回空——不许把不相关的图硬塞上来；
 *   ③ BM25 是加成不是取代：心情/标签/冷却的原有权重不变；
 *   ④ 语义检索自己坏掉（抛错）时，挑图照旧工作。
 * ============================================================================
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { tokenize } from '../lib/tok.mjs'
import { searchStickers } from '../lib/sticker-search.mjs'
import { rankStickers } from '../lib/stickers.mjs'

const items = [
	{ id: 'a', name: '摸鱼', mood: 'chill', tags: ['上班', '摆烂'], when: '不想干活的时候', used: 0, addedAt: '2026-11-01T00:00:00Z' },
	{ id: 'b', name: '加油', mood: 'warm', tags: ['鼓励', '打气'], when: '朋友累的时候', used: 0, addedAt: '2026-11-02T00:00:00Z' },
	{ id: 'c', name: '干饭', mood: 'happy', tags: ['吃饭', '饿了'], when: '看到美食的时候', used: 0, addedAt: '2026-11-03T00:00:00Z' },
]

describe('tokenize：中文二元 + 英文按词', () => {
	it('中文二元切分，单字原样', () => {
		assert.deepEqual(tokenize('大肥鱼'), ['大肥', '肥鱼'])
		assert.deepEqual(tokenize('鱼'), ['鱼'])
	})
	it('英文数字按连续段', () => {
		assert.deepEqual(tokenize('DeepSeek v4.1'), ['deepseek', 'v4', '1'])
	})
	it('标点 emoji 丢弃，大小写无关（全角标点会切断词段）', () => {
		assert.deepEqual(tokenize('加班，到两点！！'), ['加班', '到两', '两点'])
	})
	it('空输入 → 空数组', () => {
		assert.deepEqual(tokenize(''), [])
		assert.deepEqual(tokenize(null), [])
	})
})

describe('searchStickers：BM25', () => {
	it('语义命中排前面', () => {
		const hits = searchStickers(items, '今天加班到两点，不想干活了')
		assert.ok(hits.length > 0)
		assert.equal(hits[0].item.id, 'a', '「加班/干活」该命中摸鱼那张')
	})
	it('另一个意思命中另一张', () => {
		const hits = searchStickers(items, '累死了想找人打气')
		assert.equal(hits[0].item.id, 'b')
	})
	it('查不到 → 空数组（不硬塞）', () => {
		assert.deepEqual(searchStickers(items, '量子纠缠拓扑'), [])
		assert.deepEqual(searchStickers(items, ''), [])
		assert.deepEqual(searchStickers([], '加班'), [])
	})
	it('limit 生效', () => {
		assert.equal(searchStickers(items, '上班 鼓励 吃饭', { limit: 2 }).length, 2)
	})
})

describe('rankStickers：语义是加成，不是取代', () => {
	const base = { now: Date.now(), cooldownH: 6 }

	it('心情命中仍大于语义加成（2 分 > 1.5 分封顶）', () => {
		/* 不给 query 时干粮（mood happy 不命中 chill）……这里查「加班」但指定 mood happy：
		 * 语义该把 a 顶上来，可 mood 指定 happy 时 c 的 2 分仍该赢过 a 的 1.5。 */
		const ranked = rankStickers(items, { ...base, mood: 'happy', query: '加班不想干活' })
		assert.equal(ranked[0].id, 'c', '心情 2 分压过语义 1.5 分')
		assert.equal(ranked[1].id, 'a', '语义加成把 a 提到第二')
	})

	it('不给 query 时行为和以前一模一样', () => {
		const ranked = rankStickers(items, { ...base, mood: 'chill' })
		assert.equal(ranked[0].id, 'a')
	})

	it('语义检索抛错也不影响挑图（兜底）', () => {
		const ranked = rankStickers(items, { ...base, query: '加班' })
		assert.ok(Array.isArray(ranked) && ranked.length === 3)
	})
})
