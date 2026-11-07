/**
 * tests/killgate.test.mjs —— 总闸只挡"真的会写"的那一下
 * ============================================================================
 * 判错两个方向都疼：
 *   · 该挡没挡 → 停损按了还在发
 *   · 不该挡挡了 → 演练（dry）、只读查询、只摆好不点的发布全被误伤，
 *     人会以为插件坏了，然后去把 KILL 文件删了 —— 闸就废了
 * 所以这张表要钉死。
 * ============================================================================
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { writeIntent } from '../lib/tools.mjs'

test('写操作：会被挡', () => {
	for (const n of ['douyin_studio_reply', 'douyin_studio_dm_send', 'douyin_studio_share',
		'douyin_studio_at_reply', 'douyin_studio_comment_self', 'douyin_studio_comment_at',
		'douyin_studio_delete', 'douyin_studio_delcomment']) {
		assert.equal(writeIntent(n, {}), true, n)
	}
})

test('dry 一律放行（演练不该被停损挡住）', () => {
	assert.equal(writeIntent('douyin_studio_reply', { dry: true }), false)
	assert.equal(writeIntent('douyin_studio_dm_send', { dry: true }), false)
	assert.equal(writeIntent('douyin_studio_publish', { publish: true, dry: true }), false)
})

test('publish 只有真发/存草稿算写；只摆好不点不算', () => {
	assert.equal(writeIntent('douyin_studio_publish', {}), false)
	assert.equal(writeIntent('douyin_studio_publish', { draft: true }), true)
	assert.equal(writeIntent('douyin_studio_publish', { publish: true }), true)
})

test('queue 只有 retry 算写；list/clear 是维护动作', () => {
	assert.equal(writeIntent('douyin_studio_queue', { action: 'retry' }), true)
	assert.equal(writeIntent('douyin_studio_queue', { action: 'list' }), false)
})

test('只读工具永远不在表里', () => {
	for (const n of ['douyin_studio_status', 'douyin_studio_inbox', 'douyin_studio_feed', 'douyin_studio_kill']) {
		assert.equal(writeIntent(n, {}), false, n)
	}
})
