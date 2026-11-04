/**
 * lib/autopilot.mjs 里两个纯函数的测试
 * ============================================================================
 * 自主执行最怕的不是「发失败」，是「发了一条不该发的」：
 * 拿十几天前的老话回人、回官方号的通知、对着一个视频卡片生成一句话。
 * 这里把「挑谁回」和「跨天计数」钉死，剩下的 IO 部分靠演练（tmp/smoke-autopilot.mjs）。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

const { pickDm, pickAt, nextPublishCount, inActive } = await import('../lib/autopilot.mjs')

const NOW = Date.now()
const iso = (minAgo) => new Date(NOW - minAgo * 60000).toISOString()

const conv = (peer, msgs, type = 1) => ({
	type,
	peer_uid: peer,
	messages: msgs.map(([from, text, minAgo, kind]) => ({ from, text, at: iso(minAgo), kind: kind || 'text' })),
})

describe('pickDm：自主回私信挑谁', () => {
	it('十分钟前的一句提问 → 回', () => {
		const out = pickDm([conv('u1', [['them', '你这个模型是哪个呀？', 10]])], { nickOf: () => '小明' })
		assert.equal(out.length, 1)
		assert.equal(out[0].peer, 'u1')
		assert.ok(out[0].why.join().length > 0)
	})

	it('视频卡片 → 跳过（没正文，不猜）', () => {
		const out = pickDm([conv('u1', [['them', '[视频卡片]', 10, 'card']])], { nickOf: () => '小明' })
		assert.equal(out.length, 0)
	})

	it('官方号的通知 → 跳过', () => {
		const out = pickDm([conv('u1', [['them', '你关注的 大肥鱼 发布了新作品', 10]])], { nickOf: () => '抖音小助手' })
		assert.equal(out.length, 0)
	})

	it('十几天前的老话 → 跳过（回过去太突兀）', () => {
		const out = pickDm([conv('u1', [['them', '在吗', 15 * 1440]])], { nickOf: () => '小明' })
		assert.equal(out.length, 0)
	})

	it('已经回过的同一句 → 跳过', () => {
		const at = iso(10)
		const out = pickDm([conv('u1', [['them', '在吗', 10]])], { replied: { u1: at }, } )
		assert.equal(out.length, 0)
	})

	it('连续失败两次的人 → 先放弃', () => {
		const out = pickDm([conv('u1', [['them', '在吗', 10]])], { tries: { u1: 2 }, nickOf: () => '小明' })
		assert.equal(out.length, 0)
	})

	it('群聊不碰', () => {
		const out = pickDm([conv('g1', [['them', '大家好', 5]], 2)], { nickOf: () => '群' })
		assert.equal(out.length, 0)
	})
})

describe('pickAt：自主回 @ 挑谁', () => {
	const at = (o) => ({ worth: true, blocked: [], aweme_id: 'a1', comment_id: 'c1', root_comment_id: '', at: iso(10), ...o })

	it('有落点的 → 回，挑最新的一条', () => {
		const out = pickAt([at({ at: iso(600), comment_id: 'c-old' }), at({ at: iso(5), comment_id: 'c-new' })], { max: 1 })
		assert.equal(out.length, 1)
		assert.equal(out[0].comment_id, 'c-new')
	})

	it('没有落点（aweme/评论 id 都缺）→ 跳过', () => {
		assert.equal(pickAt([at({ aweme_id: '' })], { max: 1 }).length, 0)
		assert.equal(pickAt([at({ comment_id: '', root_comment_id: '' })], { max: 1 }).length, 0)
	})

	it('过了 7 天 worth=false → 跳过', () => {
		assert.equal(pickAt([at({ worth: false })], { max: 1 }).length, 0)
	})

	it('被拦下（blocked 非空）→ 跳过', () => {
		assert.equal(pickAt([at({ blocked: ['超过 7 天'] })], { max: 1 }).length, 0)
	})

	/* 2026-11-03 的事故：同一条 @ 在 12:46 和 12:51 各回了一遍。
	 * 通知会一直躺在列表里，不回记一笔，就会每 5 分钟回同一句。 */
	it('已经回过的（aweme:cid 在 replied 里）→ 跳过', () => {
		const one = at({ comment_id: 'c-done' })
		assert.equal(pickAt([one], { max: 1, replied: { 'a1:c-done': '2026-11-03T12:46:00Z' } }).length, 0)
		assert.equal(pickAt([one], { max: 1, replied: {} }).length, 1)
	})

	/* 4 天前那条 @ 被一遍遍捡起来回，是这次「回两遍」的另一半原因 */
	it('过期的 @（status=stale / age_min 超 72 小时）→ 不回', () => {
		assert.equal(pickAt([at({ status: 'stale' })], { max: 1 }).length, 0)
		assert.equal(pickAt([at({ age_min: 4 * 24 * 60 })], { max: 1 }).length, 0)
		assert.equal(pickAt([at({ status: 'worth', age_min: 30 })], { max: 1 }).length, 1)
	})

	/* 楼中楼的通知 comment_id 可能为空、只有 root_comment_id：
	 * 去重键要是跟着空，所有这种通知会共用同一个键，回完一条就把别的都吞了。 */
	it('只有 root_comment_id 的通知：去重键跟着 root 走', () => {
		const onlyRoot = at({ comment_id: '', root_comment_id: 'r-9' })
		assert.equal(pickAt([onlyRoot], { max: 1, replied: { 'a1:r-9': 'x' } }).length, 0)
		assert.equal(pickAt([onlyRoot], { max: 1, replied: { 'a1:': 'x' } }).length, 1)
	})
})

describe('inActive：只在自己的时段动', () => {
	it('窗口内 → true，窗口外 → false', () => {
		const s = { activeFrom: '00:30', activeTo: '08:30' }
		assert.equal(inActive(s, new Date(2026, 10, 3, 3, 0)), true)
		assert.equal(inActive(s, new Date(2026, 10, 3, 13, 0)), false)
	})

	it('跨午夜窗口（22:00-06:00）', () => {
		const s = { activeFrom: '22:00', activeTo: '06:00' }
		assert.equal(inActive(s, new Date(2026, 10, 3, 23, 0)), true)
		assert.equal(inActive(s, new Date(2026, 10, 3, 12, 0)), false)
	})

	it('两个都没填 → 不限制', () => {
		assert.equal(inActive({ activeFrom: '', activeTo: '' }, new Date(2026, 10, 3, 12, 0)), true)
	})
})

describe('nextPublishCount：跨天归零', () => {
	it('同一天累加', () => {
		assert.equal(nextPublishCount({ day: '2026-11-03', today: '2026-11-03', count: 2 }), 3)
	})

	it('换了一天 → 从 1 开始', () => {
		assert.equal(nextPublishCount({ day: '2026-11-02', today: '2026-11-03', count: 4 }), 1)
	})

	it('从没发过 → 1', () => {
		assert.equal(nextPublishCount({ day: '', today: '2026-11-03', count: 0 }), 1)
	})
})
