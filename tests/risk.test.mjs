import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'risk-'))
process.env.DOUYIN_STUDIO_HOME = home

const { looksLikeRisk, riskState, noteRisk, clearRisk, coolingGate, guardedWrite, riskFile } = await import('../lib/risk.mjs')

test('风控识别：码与文字都认', () => {
	assert.equal(looksLikeRisk({ code: -352 }), true)
	assert.equal(looksLikeRisk({ code: 0, error: '操作太快了' }), true)
	assert.equal(looksLikeRisk({ code: 0, error: '正常失败' }), false)
	assert.equal(looksLikeRisk(null), false)
})

test('一开始不冷却', () => {
	assert.equal(riskState().cooling, false)
	assert.equal(coolingGate(), null)
})

test('记一次风控：30 分钟后到期', () => {
	const now = Date.UTC(2026, 10, 13, 12, 0, 0)
	const r = noteRisk('操作太快', { code: -352, now })
	assert.equal(r.minutes, 30)
	assert.equal(riskState(now).cooling, true)
	assert.match(coolingGate(now), /停 30 分钟/)
	assert.equal(riskState(now + 31 * 60000).cooling, false)
})

test('连续撞：时长翻倍、封顶 6 小时', () => {
	const now = Date.UTC(2026, 10, 13, 12, 0, 0)
	let mins = 0
	for (let i = 0; i < 5; i++) mins = noteRisk('频繁', { now }).minutes
	assert.equal(mins, 240)
})

test('手动解除', () => {
	const now = Date.now()
	noteRisk('x', { now })
	clearRisk(now)
	assert.equal(riskState(now).cooling, false)
})

test('guardedWrite：冷却中直接拒，不调用内部', async () => {
	const now = Date.now()
	noteRisk('y', { now })
	let called = false
	const r = await guardedWrite(async () => { called = true; return { ok: true } }, { now })
	assert.equal(called, false)
	assert.equal(r.stage, 'risk')
})

test('guardedWrite：失败像风控就记账', async () => {
	clearRisk()
	const r = await guardedWrite(async () => ({ ok: false, error: '频繁', code: -412 }))
	assert.equal(r.risk, 'recorded')
	assert.ok(r.cooldownMin >= 30)
	assert.ok(riskFile().endsWith('risk.json'))
})
