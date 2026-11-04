/**
 * lib/budget.mjs 的单元测试 —— 消息预算
 * ============================================================================
 * 盯四件事（每件都是真出过事或真会出事的）：
 *   ① 日限 / 小时限 / 最小间隔都会拦
 *   ② 同一个人、同一栋楼的日限单独算
 *   ③ 总闸是所有消息通道一起算的
 *   ④ 账本坏了必须 **拒绝**（fail-closed），不能当成「今天还一条没发」
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'

const TMP = mkdtempSync(join(tmpdir(), 'budget-test-'))
process.env.DOUYIN_STUDIO_HOME = TMP

const budget = await import('../lib/budget.mjs')

after(() => rmSync(TMP, { recursive: true, force: true }))

const file = () => join(TMP, 'budget.json')
const now = Date.parse('2026-11-02T20:00:00+08:00')

const resetFile = () => {
	try { rmSync(file(), { force: true }) } catch { /* 没有就算了 */ }
}
beforeEach(() => {
	resetFile()
	delete process.env.DOUYIN_STUDIO_LIMITS
})

describe('预算：基本通道', () => {
	it('新账本什么都能发', () => {
		const r = budget.check({ ch: 'comment', now })
		assert.equal(r.ok, true)
		assert.equal(r.quota.messages.day, 0)
	})

	it('记一条之后，同一通道立刻被最小间隔挡住', () => {
		budget.record({ ch: 'dm', peer: 'u1', now })
		const r = budget.check({ ch: 'dm', peer: 'u1', now: now + 5000 })
		assert.equal(r.ok, false)
		assert.match(r.why, /隔/)
	})

	it('过了间隔就放行', () => {
		budget.record({ ch: 'dm', peer: 'u1', now })
		const r = budget.check({ ch: 'dm', peer: 'u1', now: now + 61_000 })
		assert.equal(r.ok, true)
	})

	it('同一通道一天到顶就拒', () => {
		for (let i = 0; i < 15; i++) budget.record({ ch: 'dm', peer: 'u' + i, now: now + i * 120_000 })
		const r = budget.check({ ch: 'dm', peer: 'new', now: now + 15 * 120_000 })
		assert.equal(r.ok, false)
		assert.match(r.why, /上限 15/)
	})

	it('一小时太多也拒（即使日额还有）', () => {
		for (let i = 0; i < 5; i++) budget.record({ ch: 'dm', peer: 'u' + i, now: now + i * 61_000 })
		const r = budget.check({ ch: 'dm', peer: 'new', now: now + 5 * 61_000 })
		assert.equal(r.ok, false)
		assert.match(r.why, /这一小时/)
	})

	it('同一个人一天 2 条封顶', () => {
		budget.record({ ch: 'comment', peer: 'u7', thread: 't1', now })
		budget.record({ ch: 'comment', peer: 'u7', thread: 't2', now: now + 60_000 })
		const r = budget.check({ ch: 'comment', peer: 'u7', thread: 't3', now: now + 120_000 })
		assert.equal(r.ok, false)
		assert.match(r.why, /同一个人/)
	})

	it('同一栋楼一天 1 条', () => {
		budget.record({ ch: 'comment', peer: 'u1', thread: 'root-9', now })
		const r = budget.check({ ch: 'comment', peer: 'u2', thread: 'root-9', now: now + 60_000 })
		assert.equal(r.ok, false)
		assert.match(r.why, /同一栋楼/)
	})
})

describe('预算：总闸与正文', () => {
	it('四个通道共用 40 条总闸', () => {
		let t = now
		for (let i = 0; i < 20; i++) { budget.record({ ch: 'comment', peer: 'c' + i, thread: 'x' + i, now: t }); t += 120_000 }
		for (let i = 0; i < 15; i++) { budget.record({ ch: 'dm', peer: 'd' + i, now: t }); t += 120_000 }
		for (let i = 0; i < 5; i++) { budget.record({ ch: 'at', peer: 'a' + i, now: t }); t += 120_000 }
		const r = budget.check({ ch: 'own', now: t })
		assert.equal(r.ok, false)
		assert.match(r.why, /总数|总闸/)
	})

	it('publish 不占消息总闸，但自己有条数限制', () => {
		budget.record({ ch: 'own', thread: 'w1', now })
		/* 总闸是 40，只有 1 条 own 时 publish 不该被总闸拦 —— 但会被自己的间隔拦，
		 * 所以先记一条 publish，再看紧接着的第二条是被「间隔」还是被「总数」挡。 */
		const first = budget.check({ ch: 'publish', now: now + 10_000 })
		assert.equal(first.ok, true)
		budget.record({ ch: 'publish', note: 'first', now: now + 10_000 })
		const second = budget.check({ ch: 'publish', now: now + 20_000 })
		assert.equal(second.ok, false)
		assert.match(second.why, /隔/)
	})

	it('私信正文超过 300 字拒绝', () => {
		const r = budget.check({ ch: 'dm', text: 'x'.repeat(301), now })
		assert.equal(r.ok, false)
		assert.match(r.why, /上限 300/)
	})

	it('评论正文超过 500 字拒绝', () => {
		const r = budget.check({ ch: 'comment', text: 'x'.repeat(501), now })
		assert.equal(r.ok, false)
		assert.match(r.why, /上限 500/)
	})
})

describe('预算：坏账本 fail-closed', () => {
	it('JSON 坏了就拒绝，且给出证据路径', async () => {
		mkdirSync(TMP, { recursive: true })
		writeFileSync(file(), '{ 这不是 json', 'utf8')
		const r = budget.check({ ch: 'dm', now })
		assert.equal(r.ok, false)
		assert.match(r.why, /账本/)
		assert.ok(r.broken)
		/* 坏文件被挪走留证（下一次读看到的是「还没写过」，不会一直 broken） */
		const { readdirSync } = await import('node:fs')
		assert.ok(readdirSync(TMP).some((f) => f.startsWith('budget.json.corrupt-')), '坏账本要留证据文件')
	})

	it('坏账本时 record 不写（别把证据盖了）', () => {
		mkdirSync(TMP, { recursive: true })
		writeFileSync(file(), 'null', 'utf8')
		const w = budget.record({ ch: 'dm', now })
		assert.equal(w.ok, false)
	})
})

describe('预算：环境变量覆盖', () => {
	it('DOUYIN_STUDIO_LIMITS 能改通道日限', () => {
		process.env.DOUYIN_STUDIO_LIMITS = JSON.stringify({ perDay: { dm: 1 } })
		budget.record({ ch: 'dm', peer: 'a', now })
		const r = budget.check({ ch: 'dm', peer: 'b', now: now + 120_000 })
		assert.equal(r.ok, false)
		assert.match(r.why, /上限 1/)
	})
})

describe('预算：主人号不设「同一人每天 N 条」', () => {
	it('ownerUid 那条不该被 perPeer 挡住（其余人照旧）', () => {
		process.env.DOUYIN_STUDIO_LIMITS = ''
		process.env.DOUYIN_STUDIO_OWNER_UID = '110149990088'
		/* 先把主人号刷到上限（comment 每人 2 条） */
		budget.record({ ch: 'comment', peer: '110149990088', thread: 't1', now })
		budget.record({ ch: 'comment', peer: '110149990088', thread: 't2', now })
		const owner = budget.check({ ch: 'comment', peer: '110149990088', thread: 't3', text: 'hi', now: now + 120_000 })
		assert.equal(owner.ok, true, '主人号不该被 perPeer 拦：' + owner.why)

		budget.record({ ch: 'comment', peer: '42', thread: 'u1', now })
		budget.record({ ch: 'comment', peer: '42', thread: 'u2', now: now + 60_000 })
		const other = budget.check({ ch: 'comment', peer: '42', thread: 'u3', text: 'hi', now: now + 180_000 })
		assert.equal(other.ok, false, '别人还是 2 条上限')
		assert.match(other.why, /同一个人/)
	})

	it('只免 perPeer：同一栋楼照样管', () => {
		process.env.DOUYIN_STUDIO_OWNER_UID = '110149990088'
		/* 每个 it 之前账本会被清空，所以这里自己造一栋已经回过的楼 */
		budget.record({ ch: 'comment', peer: '110149990088', thread: 't1', now })
		const a = budget.check({ ch: 'comment', peer: '110149990088', thread: 't1', text: 'hi', now: now + 600_000 })
		assert.equal(a.ok, false, '同一栋楼今天回过就不能再回')
		assert.match(a.why, /同一栋楼/)
	})

	it('没填 ownerUid 时谁都不赦免', () => {
		delete process.env.DOUYIN_STUDIO_OWNER_UID
		delete process.env.DOUYIN_STUDIO_LIMITS
		budget.record({ ch: 'comment', peer: '110149990088', thread: 'z1', now })
		budget.record({ ch: 'comment', peer: '110149990088', thread: 'z2', now })
		const r = budget.check({ ch: 'comment', peer: '110149990088', thread: 'z9', text: 'hi', now: now + 900_000 })
		assert.equal(r.ok, false)
		assert.match(r.why, /同一个人/)
	})
})
