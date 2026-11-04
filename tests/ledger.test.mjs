/**
 * tests/ledger.test.mjs —— 「同一条不重复回、同一个人不追着回」的六道闸
 * ============================================================================
 * 为什么这个文件最该存在：checkQuota 是纯逻辑，但它错了的代价不是"不好用"，
 * 是**在别人的视频底下重复回评** —— 那是风控最爱抓的行为，代价是掉登录。
 * 这个模块 324 行，之前一条测试都没有。
 *
 * 判据全在函数入参里（now / aweme / cid / authorUid / root），
 * 所以要造哪个时段、哪条视频，都不用等真实时间。
 * ============================================================================
 */
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, after } from 'node:test'

const HOME = await mkdtemp(join(tmpdir(), 'dy-ledger-'))
process.env.DOUYIN_STUDIO_HOME = HOME
process.env.DSH_HOME = HOME

const led = await import('../lib/ledger.mjs')
const FILE = join(HOME, 'ledger.json')

const day = '2026-11-04'
/* 中午 12:00：时段 noon。晚上 20:00：night。下午 15:00：off。 */
const noon = new Date(2026, 10, 4, 12, 0, 0)
const night = new Date(2026, 10, 4, 20, 0, 0)
const off = new Date(2026, 10, 4, 15, 0, 0)

/** 造一条账本记录（只写闸门关心的字段） */
const r = (o = {}) => ({
	at: '2026-11-04T12:00:00Z', day, window: 'noon',
	aweme: 'A1', cid: 'c1', root: '', author: 'u1', text: 'x', ...o,
})
const write = (replies) => writeFile(FILE, JSON.stringify({ version: 1, replies }), 'utf8')

after(async () => { try { await rm(HOME, { recursive: true, force: true }) } catch { /* 已经删了 */ } })

describe('checkQuota 六道闸', () => {
	it('空账本：放行', async () => {
		await write([])
		assert.equal(led.checkQuota({ aweme: 'A1', cid: 'c1', authorUid: 'u1', now: noon }).ok, true)
	})

	it('① 同一个 cid 回过就不再回（换任何条件都不行）', async () => {
		await write([r({ cid: 'c9' })])
		const q = led.checkQuota({ aweme: 'A2', cid: 'c9', authorUid: 'u9', now: night })
		assert.equal(q.ok, false)
		assert.match(q.why, /cid|回过了/)
	})

	it('② 全天总量到 20 就停（跨时段、跨视频一起算）', async () => {
		await write(Array.from({ length: 20 }, (_, i) => r({ cid: 'c' + i, aweme: 'A' + i, author: 'u' + i, window: 'off' })))
		const q = led.checkQuota({ aweme: 'NEW', cid: 'cn', authorUid: 'un', now: night })
		assert.equal(q.ok, false)
		assert.match(q.why, /20|回满/)
	})

	it('③ 同一条视频、同一个时段最多 5 条；换个时段就重新算', async () => {
		await write(Array.from({ length: 5 }, (_, i) => r({ cid: 'c' + i, aweme: 'A1', author: 'u' + i })))
		assert.equal(led.checkQuota({ aweme: 'A1', cid: 'x1', authorUid: 'ux', now: noon }).ok, false)
		assert.equal(led.checkQuota({ aweme: 'A1', cid: 'x2', authorUid: 'ux', now: night }).ok, true, '晚上是新时段')
	})

	it('off 时段不卡视频额度（但按总量算）', async () => {
		await write(Array.from({ length: 5 }, (_, i) => r({ cid: 'c' + i, aweme: 'A1', window: 'off', author: 'u' + i })))
		assert.equal(led.checkQuota({ aweme: 'A1', cid: 'x1', authorUid: 'ux', now: off }).ok, true)
	})

	it('④ 同一个人一天最多 2 条', async () => {
		await write([r({ cid: 'a', author: 'u1', aweme: 'A1' }), r({ cid: 'b', author: 'u1', aweme: 'A2' })])
		const q = led.checkQuota({ aweme: 'A3', cid: 'c', authorUid: 'u1', now: night })
		assert.equal(q.ok, false)
		assert.match(q.why, /这个人|同一个人|2 条/)
	})

	it('⑤ 同一栋楼一天只回一次；楼中楼按 root 算', async () => {
		await write([r({ cid: 'x', root: 'R1', author: 'u1' })])
		const q = led.checkQuota({ aweme: 'A9', cid: 'y', root: 'R1', authorUid: 'u2', now: night })
		assert.equal(q.ok, false)
		assert.match(q.why, /楼/)
	})

	it('⑥ 账本坏了 → 一律拒绝（fail-closed），不是"当作空账本放行"', async () => {
		await writeFile(FILE, '{ 这不是 json', 'utf8')
		const q = led.checkQuota({ aweme: 'A1', cid: 'c1', authorUid: 'u1', now: noon })
		assert.equal(q.ok, false)
		assert.equal(q.category, 'LOCAL')
		assert.match(q.why, /账本/)
	})
})
