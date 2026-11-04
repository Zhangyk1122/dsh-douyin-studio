/**
 * tests/notify.test.mjs —— 通知预算的验收
 * ============================================================================
 * 钉住四件事：
 *   ① 额度用完了就是不许叫（`calledToday:2` 必须 ok:false —— 这是硬验收）
 *   ② 三档分得清：入库不打扰 / @ 才算叫 / 私信还要求"你最近在找同类"
 *   ③ 用户自己设的上限（maxTier）和静音时段优先于分数
 *   ④ 沉默要能照实说，不许硬凑
 * ============================================================================
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { allowNotify, silentNote, INGEST, AT, DM } from '../lib/notify.mjs'

const s = (score) => ({ score })

/* ── ① 额度 ──────────────────────────────────────────────── */
test('今天已经叫过 2 次（默认上限）：一分也不给', () => {
	const r = allowNotify({ items: [s(9.9)], calledToday: 2, perDay: 2 })
	assert.equal(r.ok, false)
	assert.equal(r.tier, 'none')
	assert.match(r.why, /已经叫过 2 次/)
})

test('perDay 设成 0：永远只入库', () => {
	const r = allowNotify({ items: [s(0.99)], calledToday: 0, perDay: 0 })
	assert.equal(r.ok, false)
	assert.match(r.why, /只入库/)
})

/* ── ② 三档 ──────────────────────────────────────────────── */
test('什么都没有：不打扰，也不编理由', () => {
	const r = allowNotify({})
	assert.equal(r.ok, false)
	assert.equal(r.ingested, 0)
	assert.equal(r.why, '没有过线的候选')
})

test(`入库线 ${INGEST}：够线但不吵`, () => {
	const r = allowNotify({ items: [s(0.5)] })
	assert.equal(r.ok, false)
	assert.equal(r.tier, 'none')
	assert.equal(r.ingested, 1)
	assert.match(r.why, /进库/)
})

test(`${AT} 就算过 @ 线`, () => {
	const r = allowNotify({ items: [s(0.8)] })
	assert.equal(r.ok, true)
	assert.equal(r.tier, 'at')
})

test(`${DM} 且最近搜过同类，才配发私信（默认最高只到 @）`, () => {
	const hot = allowNotify({ items: [s(0.95)], searchedRecently: true, maxTier: 'dm' })
	assert.equal(hot.ok, true)
	assert.equal(hot.tier, 'dm')
	/* 不传 maxTier 时默认 'at' —— 用户没明确允许，就不许发私信 */
	assert.equal(allowNotify({ items: [s(0.95)], searchedRecently: true }).tier, 'at')
	const cold = allowNotify({ items: [s(0.95)], searchedRecently: false, maxTier: 'dm' })
	assert.equal(cold.tier, 'at')
})

test('多条取最高分，ingested 数够线的条数', () => {
	const r = allowNotify({ items: [s(0.2), s(0.45), s(0.78)] })
	assert.equal(r.score, 0.78)
	assert.equal(r.ingested, 2)
	assert.equal(r.tier, 'at')
})

/* ── ③ 用户设置优先 ──────────────────────────────────────── */
test('maxTier=none：分数再高也闭嘴', () => {
	const r = allowNotify({ items: [s(0.99)], maxTier: 'none', searchedRecently: true })
	assert.equal(r.ok, false)
	assert.equal(r.tier, 'none')
})

test('maxTier=at：够私信也压回 @', () => {
	const r = allowNotify({ items: [s(0.99)], maxTier: 'at', searchedRecently: true })
	assert.equal(r.tier, 'at')
})

test('静音时段：分数再高也不弹', () => {
	const r = allowNotify({ items: [s(0.99)], quiet: true, searchedRecently: true })
	assert.equal(r.ok, false)
	assert.match(r.why, /静音/)
})

/* ── ④ 沉默与脏数据 ──────────────────────────────────────── */
test('三天没叫你，照实写一句', () => {
	assert.equal(silentNote({ silentDays: 3, fresh: 46 }), '这三天没有值得叫你的，刷了 46 条')
	assert.equal(silentNote({ silentDays: 2, fresh: 46 }), '')
	assert.equal(silentNote({ silentDays: 3, fresh: 0 }), '')
})

test('score 是脏值不崩，也不算数', () => {
	const r = allowNotify({ items: [{ score: 'abc' }, null, s(0.8)] })
	assert.equal(r.score, 0.8)
	assert.equal(r.ingested, 1)
	assert.equal(r.ok, true)
})
