/**
 * lib/unread.mjs 的单元测试。
 * 重点不是「能跑」，而是：红点什么时候该亮、什么时候必须灭。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'

/* unread.mjs 在 import 时就定了目录，所以要先把 DSH_HOME 指到临时目录再动态 import */
const TMP = mkdtempSync(join(tmpdir(), 'unread-test-'))
process.env.DSH_HOME = TMP
mkdirSync(join(TMP, 'douyin-duty'), { recursive: true })

const { unreadOf, markRead, marks, decorate } = await import('../lib/unread.mjs')

const FILE = join(TMP, 'douyin-duty', 'dm-read.json')
const reset = () => {
	try { rmSync(FILE) } catch { /* 本来就没有 */ }
}

before(() => reset())
after(() => rmSync(TMP, { recursive: true, force: true }))
beforeEach(() => reset())

describe('unreadOf', () => {
	it('没有 last_at → 不算未读', () => {
		assert.equal(unreadOf({ peer_uid: 'u1' }), 0)
	})

	it('最后一条是我发的 → 不算未读', () => {
		assert.equal(unreadOf({ peer_uid: 'u1', last_at: '2026-11-02T10:00:00Z', from: 'me' }), 0)
	})

	it('从没标记过、最后一条是对方发的 → 未读', () => {
		assert.equal(unreadOf({ peer_uid: 'u1', last_at: '2026-11-02T10:00:00Z', from: 'them' }), 1)
	})

	it('标记时间戳比消息新 → 已读', () => {
		markRead('u1', '2026-11-02T11:00:00Z')
		assert.equal(unreadOf({ peer_uid: 'u1', last_at: '2026-11-02T10:00:00Z', from: 'them' }), 0)
	})

	it('标记之后又来了新消息 → 又变未读', () => {
		markRead('u1', '2026-11-02T11:00:00Z')
		assert.equal(unreadOf({ peer_uid: 'u1', last_at: '2026-11-02T12:00:00Z', from: 'them' }), 1)
	})
})

describe('markRead', () => {
	it('空 uid → 拒绝，不写文件', () => {
		const r = markRead('', '2026-11-02T10:00:00Z')
		assert.equal(r.ok, false)
		assert.deepEqual(marks(), {})
	})

	it('不许被更旧的时间戳倒推', () => {
		markRead('u2', '2026-11-02T12:00:00Z')
		const r = markRead('u2', '2026-11-02T09:00:00Z')
		assert.equal(r.at, '2026-11-02T12:00:00Z')
		assert.equal(marks()['u2'], '2026-11-02T12:00:00Z')
	})

	it('文件坏掉时当作没有标记（不抛）', () => {
		writeFileSync(FILE, '这不是 json', 'utf8')
		assert.deepEqual(marks(), {})
		assert.equal(unreadOf({ peer_uid: 'u3', last_at: '2026-11-02T10:00:00Z', from: 'them' }), 1)
	})
})

describe('decorate', () => {
	it('给每行打 unread，并给出总数', () => {
		markRead('a', '2026-11-02T10:00:00Z')
		const { list, unread } = decorate([
			{ peer_uid: 'a', last_at: '2026-11-02T09:00:00Z', from: 'them' },
			{ peer_uid: 'b', last_at: '2026-11-02T09:00:00Z', from: 'them' },
			{ peer_uid: 'c', last_at: '2026-11-02T09:00:00Z', from: 'me' },
			{ peer_uid: 'd', last_at: '2026-11-02T09:00:00Z', from: 'them' },
		])
		assert.deepEqual(list.map((r) => r.unread), [0, 1, 0, 1])
		assert.equal(unread, 2)
	})

	it('空列表不炸', () => {
		assert.deepEqual(decorate(null), { list: [], unread: 0 })
	})
})
