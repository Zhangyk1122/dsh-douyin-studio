/**
 * tests/firstrun.test.mjs —— 首跑必先 dry
 * ============================================================================
 * 拦的是一次不可逆的动作：新机器上第一次点发布。所以判定要偏保守：
 * 状态文件读不到 / 坏了，都当"没跑过"，宁可多拦一次。
 * ============================================================================
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const home = mkdtempSync(join(tmpdir(), 'dys-first-'))
process.env.DOUYIN_STUDIO_HOME = home

const { firstRunFile, readFirstRun, needsFirstRunDry, markDryRun, markPublished } =
	await import('../lib/firstrun.mjs')

test('全新机器：需要先 dry', () => {
	assert.equal(firstRunFile(), join(home, 'first-run.json'))
	assert.equal(needsFirstRunDry(), true)
	assert.deepEqual(readFirstRun(), { dryDone: false, dryAt: '', publishedAt: '' })
})

test('dry 通过后解锁，并记下时间', () => {
	const r = markDryRun('publish --dry')
	assert.equal(r.dryDone, true)
	assert.ok(r.dryAt)
	assert.equal(needsFirstRunDry(), false)
	assert.equal(readFirstRun().dryDone, true)
})

test('真发成功也会解锁（状态丢了不会又拦一次）', () => {
	const r = markPublished()
	assert.ok(r.publishedAt)
	assert.equal(needsFirstRunDry(), false)
})

test('状态文件坏了：当没跑过', () => {
	writeFileSync(firstRunFile(), 'not json', 'utf8')
	assert.equal(needsFirstRunDry(), true)
	markDryRun('again')
	assert.equal(needsFirstRunDry(), false)
})
