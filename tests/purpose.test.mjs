import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'dys-purpose-'))
process.env.DOUYIN_STUDIO_HOME = home

const P = await import('../lib/purpose.mjs')

const at = (y, m, d, h) => new Date(y, m - 1, d, h, 30, 0).getTime()

test('时段按本地时间切', () => {
	assert.equal(P.slotOf(at(2026, 11, 13, 8)), 'morning')
	assert.equal(P.slotOf(at(2026, 11, 13, 11)), 'afternoon')
	assert.equal(P.slotOf(at(2026, 11, 13, 18)), 'night')
})

test('同一天多次生成，结果一模一样', () => {
	const now = at(2026, 11, 13, 15)
	const a = P.planDay({ now, keywords: ['猫', '风景'] })
	const b = P.planDay({ now: now + 3 * 3600e3, keywords: ['猫', '风景'] })
	assert.deepEqual(a.items.map((x) => x.text), b.items.map((x) => x.text))
	assert.equal(a.day, b.day)
})

test('换了天就换一份', () => {
	const a = P.planDay({ now: at(2026, 11, 13, 15), keywords: [] })
	const b = P.planDay({ now: at(2026, 11, 14, 15), keywords: [] })
	assert.notEqual(a.day, b.day)
})

test('三段齐全，文案里没有话题标签和 @', () => {
	const p = P.planDay({ now: at(2026, 11, 13, 9), keywords: ['光'] })
	assert.equal(p.items.length, 3)
	for (const it of p.items) {
		assert.ok(it.text.length > 0 && it.text.length <= 60)
		assert.ok(!/[#@]/.test(it.text), `不该带标签或 @：${it.text}`)
	}
})

test('兴趣词最多掺一条，不会三条全是词', () => {
	let hits = 0
	for (let d = 1; d <= 28; d++) {
		const p = P.planDay({ now: at(2026, 11, d, 15), keywords: ['甜妹'] })
		hits += p.items.filter((x) => x.text.includes('甜妹')).length
	}
	assert.ok(hits > 0, '总得掺进去几次')
	assert.ok(hits <= 28 * 2, '不能每条都塞')
})

test('第一次读会生成并落盘，第二次读同一份', () => {
	const now = at(2026, 11, 13, 20)
	const a = P.loadPurpose({ now, keywords: ['猫'] })
	const b = P.loadPurpose({ now: now + 1000 })
	assert.equal(a.day, b.day)
	assert.deepEqual(a.items.map((x) => x.text), b.items.map((x) => x.text))
})

test('currentIntent 跟着当前时段走，done 之后措辞变过去式', () => {
	const now = at(2026, 11, 13, 20)
	const it = P.currentIntent(now)
	assert.equal(it.slot, 'night')
	assert.match(P.purposeLine(now), /想做/)
	P.markDone('night', now)
	assert.match(P.purposeLine(now), /做过了/)
})

test('昨天的计划不会当成今天的', () => {
	const yesterday = at(2026, 11, 12, 20)
	P.loadPurpose({ now: yesterday, keywords: [] })
	const today = P.loadPurpose({ now: at(2026, 11, 13, 20), keywords: [] })
	assert.equal(today.day, '2026-11-13')
})

test('snapshot 带当前时段和那句话', () => {
	const s = P.purposeSnapshot(at(2026, 11, 13, 9))
	assert.equal(s.now, 'morning')
	assert.match(s.line, /^今天这个时候/)
	assert.equal(s.items.length, 3)
})

test.after(() => rmSync(home, { recursive: true, force: true }))
