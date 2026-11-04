/**
 * lib/inbox.mjs 的判定规则测试（纯函数，不碰网络）
 * ============================================================================
 * 收件箱的价值全在「哪条该回」这个判断上。判错了两种后果都难看：
 *   · 把系统通知当人回 → 像个自动回复机
 *   · 把真问题判成 skip → 人等着，这边当没看见
 * 所以这里把每条规则单独钉死，改规则时先看这些断言。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

const { judgeDm, ageRank } = await import('../lib/inbox.mjs')

const NOW = Date.parse('2026-11-02T20:00:00+08:00')
const at = (minAgo) => new Date(NOW - minAgo * 60000).toISOString()

const conv = (...msgs) => ({ messages: msgs.map(([from, text, minAgo]) => ({ from, text, at: at(minAgo) })) })

describe('judgeDm：该不该回', () => {
	it('最后一条是我发的 → 等着，不算该回', () => {
		const j = judgeDm(conv(['them', '在吗', 30], ['me', '在', 20]), { now: NOW })
		assert.equal(j.status, 'waiting')
		assert.equal(j.worth, false)
		assert.match(j.blocked.join(), /还没回/)
	})

	it('只有表情 → skip', () => {
		const j = judgeDm(conv(['them', '[送心]', 10]), { now: NOW })
		assert.equal(j.worth, false)
		assert.match(j.blocked.join(), /表情/)
	})

	it('半小时前的提问 → 高优先，值得回', () => {
		const j = judgeDm(conv(['them', '你这个模型 api 是多少呀？', 30]), { now: NOW })
		assert.equal(j.worth, true)
		assert.equal(j.status, 'high')
		assert.ok(j.why.some((w) => w.includes('提问')))
	})

	it('三天前的普通消息 → 不算该回（凉了）', () => {
		const j = judgeDm(conv(['them', '你这鱼挺有意思的', 3 * 1440]), { now: NOW })
		assert.equal(j.worth, false)
		assert.match(j.blocked.join(), /小时没动/)
	})

	it('官方号发来的系统话术 → skip', () => {
		const j = judgeDm(conv(['them', '你关注的 大肥鱼 发布了新作品', 5]), { now: NOW, nick: '抖音小助手' })
		assert.equal(j.worth, false)
		assert.match(j.blocked.join(), /系统通知/)
	})

	it('空会话 → empty', () => {
		const j = judgeDm({ messages: [] }, { now: NOW })
		assert.equal(j.status, 'empty')
		assert.equal(j.worth, false)
	})

	it('收到视频卡片 → 不算「只有表情」，值得点开看', () => {
		const j = judgeDm({ messages: [{ from: 'them', text: '[视频卡片]', at: at(200), kind: 'card' }] }, { now: NOW })
		assert.equal(j.worth, true)
		assert.ok(j.why.join().includes('卡片'))
		assert.equal(j.blocked.length, 0)
	})

	it('第一次私信 + 问句 → 加分里有「第一次」', () => {
		const j = judgeDm(conv(['them', '请问你用的什么模型？', 120]), { now: NOW })
		assert.equal(j.worth, true)
		assert.ok(j.why.some((w) => w.includes('第一次')))
	})

	it('长文本、上午发的 → 够分但不算高优先', () => {
		const j = judgeDm(conv(['them', '我看了你那条关于限额的视频，说得挺清楚的，就是额度分摊那部分我没太跟上', 600]), { now: NOW })
		assert.equal(j.worth, true)
		assert.notEqual(j.status, 'high')
	})
})

describe('ageRank：@我 的通知按新旧定身价', () => {
	it('半小时内 → high', () => {
		const r = ageRank(30)
		assert.equal(r.status, 'high')
		assert.equal(r.worth, true)
	})

	it('两小时 → 还是高优先（6 小时内都算新）', () => {
		assert.equal(ageRank(120).status, 'high')
	})

	it('十小时 → worth（当天，但不新鲜了）', () => {
		assert.equal(ageRank(600).status, 'worth')
	})

	it('三天 → stale，但还是值得回', () => {
		const r = ageRank(3 * 1440)
		assert.equal(r.status, 'stale')
		assert.equal(r.worth, true)
		assert.ok(r.why.join().includes('已经过了'))
	})

	it('八天 → 不算该回了', () => {
		const r = ageRank(8 * 1440)
		assert.equal(r.worth, false)
		assert.ok(r.blocked.join().includes('天前'))
	})

	it('时间读不出来（-1）→ 不拦', () => {
		const r = ageRank(-1)
		assert.equal(r.worth, true)
		assert.equal(r.status, 'todo')
	})
})
