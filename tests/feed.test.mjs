/**
 * tests/feed.test.mjs —— 刷视频「按我的关键词」这件事的验收
 * ============================================================================
 * 以前不管有没有关键词都走推荐流，再用关键词去筛别人的视频；
 * 现在有词就**按词去搜**。这里钉两件事：
 *   ① 数据源怎么选（pickSource）
 *   ② 四道筛子（applyFilters）—— 纯函数，能造任何数据
 * browse() 本身要真浏览器，不在这里测。
 * ============================================================================
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { pickSource, applyFilters } from '../lib/feed.mjs'

const v = (o = {}) => ({
	aweme_id: '1', desc: '', tags: [], author: '', duration_sec: 30, digg: 100, is_ad: false, ...o,
})

test('设了关键词 → 走搜索（这才是"按我的词筛"）', () => {
	assert.equal(pickSource(['猫']), 'search')
	assert.equal(pickSource(['猫', '狗']), 'search')
})

test('没设关键词 → 退回推荐流', () => {
	assert.equal(pickSource([]), 'recommend')
	assert.equal(pickSource(null), 'recommend')
	assert.equal(pickSource(undefined), 'recommend')
})

test('只有空白词 → 仍按推荐流（别搜个空字符串）', () => {
	// pickSource 本身只看数组长度；空白词在 browse 里先被 normalize 掉
	assert.equal(pickSource([]), 'recommend')
})

test('筛子：关键词命中 desc / 标签 / 作者都算', () => {
	const list = [
		v({ aweme_id: 'a', desc: '今天钓鱼' }),
		v({ aweme_id: 'b', tags: ['钓鱼佬'] }),
		v({ aweme_id: 'c', author: '钓鱼王' }),
		v({ aweme_id: 'd', desc: '完全无关' }),
	]
	const { kept, dropped } = applyFilters({ list, allow: ['钓鱼'] })
	assert.deepEqual(kept.map((x) => x.aweme_id), ['a', 'b', 'c'])
	assert.equal(dropped.allow, 1)
})

test('筛子：黑名单优先于白名单（同时命中就滚）', () => {
	const list = [v({ aweme_id: 'a', desc: '钓鱼 但 广告号' })]
	const { kept, dropped } = applyFilters({ list, allow: ['钓鱼'], block: ['广告'] })
	assert.equal(kept.length, 0)
	assert.equal(dropped.block, 1)
})

test('筛子：广告、时长、点赞门槛各拦各的', () => {
	const list = [
		v({ aweme_id: 'ad', is_ad: true }),
		v({ aweme_id: 'short', duration_sec: 3 }),
		v({ aweme_id: 'long', duration_sec: 300 }),
		v({ aweme_id: 'low', digg: 5 }),
		v({ aweme_id: 'ok' }),
	]
	const { kept, dropped } = applyFilters({ list, minSec: 5, maxSec: 180, minDigg: 50 })
	assert.deepEqual(kept.map((x) => x.aweme_id), ['ok'])
	assert.equal(dropped.ad, 1)
	assert.equal(dropped.short, 1)
	assert.equal(dropped.long, 1)
	assert.equal(dropped.digg, 1)
})

test('筛子：搜索来的条目没有时长（0）不许被当成"太短"误杀', () => {
	const list = [v({ aweme_id: 'a', duration_sec: 0 })]
	const { kept } = applyFilters({ list, minSec: 5 })
	assert.equal(kept.length, 1, '搜索接口不给时长，别拿 0 当真')
})

test('筛子：见过的跳过，同一批里的重复也跳过', () => {
	const list = [v({ aweme_id: 'a' }), v({ aweme_id: 'a' }), v({ aweme_id: 'b' })]
	const { kept, dropped } = applyFilters({ list, seen: new Set(['b']) })
	assert.deepEqual(kept.map((x) => x.aweme_id), ['a'])
	assert.equal(dropped.dup, 1)
	assert.equal(dropped.seen, 1)
})

test('筛子：没有 aweme_id 的条目直接丢（不然列表里会出现空行）', () => {
	const { kept } = applyFilters({ list: [{ aweme_id: '' }, v({ aweme_id: 'x' })] })
	assert.deepEqual(kept.map((x) => x.aweme_id), ['x'])
})

test('why 里要带来源，让人看得出这条是从哪来的', () => {
	const { kept } = applyFilters({ list: [v({ via: '关键词:钓鱼', desc: '钓鱼佬的一天' })], allow: ['钓鱼'] })
	assert.deepEqual(kept[0].why, ['关键词:钓鱼', '匹配关键词'])
})
