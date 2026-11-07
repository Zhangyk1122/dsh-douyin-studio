/**
 * tests/killswitch.test.mjs —— 全局停损总闸
 * ============================================================================
 * 这条闸是出事时唯一能立刻按下的东西，所以它自己必须简单到不需要信任：
 * 文件在 = 停，文件不在 = 放行。这里钉住四件事：
 *   1. 没 KILL 文件时 isKilled() 是 false（不然正常功能全被误伤）
 *   2. on 之后立刻为 true，且原因能读回来
 *   3. 被挡时的拒绝形状带 killed/stage，调用方不用猜
 *   4. off 之后干净地回到 false
 * ============================================================================
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const home = mkdtempSync(join(tmpdir(), 'dys-kill-'))
process.env.DOUYIN_STUDIO_HOME = home

const { isKilled, killFile, killInfo, killedReply, setKill } = await import('../lib/killswitch.mjs')

test('没有 KILL 文件 = 放行', () => {
	assert.equal(killFile(), join(home, 'KILL'))
	assert.equal(existsSync(killFile()), false)
	assert.equal(isKilled(), false)
	assert.equal(killInfo(), null)
})

test('on 之后立刻停，原因能读回来', () => {
	const r = setKill(true, '  风控提示 1200  ')
	assert.equal(r.killed, true)
	assert.equal(isKilled(), true)
	const info = killInfo()
	assert.equal(info.reason, '风控提示 1200')
	assert.ok(info.at)
})

test('拒绝形状：killed / stage / error 都在', () => {
	const reply = killedReply('douyin_studio_reply')
	assert.equal(reply.ok, false)
	assert.equal(reply.killed, true)
	assert.equal(reply.stage, 'killswitch')
	assert.match(reply.error, /停损/)
	assert.match(reply.error, /风控提示 1200/)
})

test('off 之后回到放行，且文件真的没了', () => {
	const r = setKill(false)
	assert.equal(r.killed, false)
	assert.equal(isKilled(), false)
	assert.equal(existsSync(killFile()), false)
})

test('KILL 文件内容坏了也照样算停（宁可多停一次）', async () => {
	const { writeFileSync } = await import('node:fs')
	writeFileSync(killFile(), '{ 坏掉的 json', 'utf8')
	assert.equal(isKilled(), true)
	assert.deepEqual(killInfo(), { at: '', reason: '' })
	setKill(false)
})
