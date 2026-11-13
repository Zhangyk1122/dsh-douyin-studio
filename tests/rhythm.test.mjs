import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'dys-rhythm-'))
process.env.DOUYIN_STUDIO_HOME = home

const R = await import('../lib/rhythm.mjs')
const C = await import('../lib/contacts.mjs')

test('短句停得短，长句停得久，都夹在 2–6 秒', () => {
	delete process.env.DOUYIN_STUDIO_FAST
	assert.equal(R.typingMs('好'), 2000)
	const mid = R.typingMs('今天这个也太好笑了吧哈哈哈哈')
	const long = R.typingMs('今天这个也太好笑了吧哈哈哈哈'.repeat(5))
	assert.ok(mid > 2000 && mid < long)
	assert.equal(long, 6000)
})

test('rng 落在跳过区就漏看', () => {
	delete process.env.DOUYIN_STUDIO_FAST
	const d = R.humanDelay('嗯嗯', { rng: () => 0.01 })
	assert.equal(d.skip, true)
})

test('重要场合永不漏看，但还是要停', () => {
	delete process.env.DOUYIN_STUDIO_FAST
	const d = R.humanDelay('看这条', { rng: () => 0.001, important: true })
	assert.equal(d.skip, false)
	assert.ok(d.delayMs >= 2000)
})

test('FAST=1 时零延迟', () => {
	process.env.DOUYIN_STUDIO_FAST = '1'
	const d = R.humanDelay('测试', { rng: () => 0.001 })
	assert.deepEqual(d, { delayMs: 0, skip: false, reason: 'fast' })
	delete process.env.DOUYIN_STUDIO_FAST
})

test('联系人热度：被想起 +1，30 天后减半', () => {
	const now = Date.now()
	C.saveContacts({ rev: 0, users: {} })
	C.remember({ uid: 'u1', nick: '阿猫', text: '猫又掉毛了', at: now })
	C.bumpHeat('u1', now)
	const u = C.profileOf('u1')
	assert.equal(u.heat, 1)
	assert.equal(C.heatOf(u, now), 1)
	const half = C.heatOf(u, now + C.HEAT_HALF_LIFE_D * 86400000)
	assert.ok(Math.abs(half - 0.5) < 0.01)
})

test('老数据没有 heat 字段也不炸', () => {
	C.saveContacts({ rev: 0, users: { u2: { nick: '老记录', count: 1, replies: 0, texts: ['hi'] } } })
	const u = C.profileOf('u2')
	assert.equal(u.heat, 0)
	assert.equal(C.heatOf(u), 0)
	assert.deepEqual(C.bumpHeat('nobody'), null)
})

test.after(() => rmSync(home, { recursive: true, force: true }))
