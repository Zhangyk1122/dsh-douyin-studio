/**
 * tests/unattended.test.mjs —— 无人值守的四道闸
 * ============================================================================
 * 这条链子一旦判错，代价是"没人看着的时候发出去一条"。所以每个 stage 都要钉：
 * 关着 / 不在窗口 / 额度用完 / 首跑没 dry / 总闸。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DOUYIN_STUDIO_HOME = mkdtempSync(join(tmpdir(), 'dys-auto-'))

const { inWindow, checkAuto, recordAuto, countToday, windowState } = await import('../lib/unattended.mjs')
const { markDryRun } = await import('../lib/firstrun.mjs')
const { setKill } = await import('../lib/killswitch.mjs')

/* 用「今天的某个时刻」，不用写死日期：账本按真实本地日期分天，
 * 写死 2026-11-05 会在跨零点那条测试里莫名变成 0 条。 */
const at = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d }
const base = { unattendedPublish: true, unattendedFrom: '20:00', unattendedTo: '23:30', unattendedPerDay: 1 }

test('窗口：普通段、跨零点、空段', () => {
	assert.equal(inWindow('20:00', '23:30', at(21)), true)
	assert.equal(inWindow('20:00', '23:30', at(19, 59)), false)
	assert.equal(inWindow('20:00', '02:00', at(1)), true)
	assert.equal(inWindow('20:00', '02:00', at(12)), false)
	assert.equal(inWindow('', '', at(21)), false)
})

test('默认关：没开就拒', () => {
	assert.equal(checkAuto({ ...base, unattendedPublish: false }, at(21)).stage, 'unattended-off')
})

test('不在窗口就拒，理由里带时间', () => {
	const r = checkAuto(base, at(12))
	assert.equal(r.stage, 'window')
	assert.match(r.reason, /12:00/)
})

test('首跑没 dry：拒', () => {
	assert.equal(checkAuto(base, at(21)).stage, 'first-run')
})

test('dry 过 + 窗口内 + 额度够：放行；发一条后额度用完', () => {
	markDryRun('test')
	assert.deepEqual(checkAuto(base, at(21)), { ok: true })
	recordAuto({ ok: true, title: 't' })
	assert.equal(countToday(at(21)), 1)
	assert.equal(checkAuto(base, at(21)).stage, 'quota')
})

test('总闸优先：停损开着就拒，理由不看窗口', () => {
	setKill(true, '测试')
	assert.equal(checkAuto(base, at(21)).stage, 'killswitch')
	setKill(false)
})

test('windowState 面板读数', () => {
	const w = windowState(base, at(21))
	assert.equal(w.on, true)
	assert.equal(w.open, true)
	assert.equal(w.used, 1)
	assert.equal(w.left, 0)
})
