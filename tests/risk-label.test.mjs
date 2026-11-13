import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLabel, labelSticker } from '../lib/vision-label.mjs'
import { checkSettings, hasBlocker } from '../lib/settings-check.mjs'
import { rankStickers, pickForContext, CONTEXT_MOOD } from '../lib/stickers.mjs'

test('打标：JSON 输出被拆成四个字段', () => {
	const r = parseLabel('{"name":"歪头猫","mood":"soft","tags":["猫","歪头"],"when":"想撒娇的时候"}')
	assert.equal(r.ok, true)
	assert.equal(r.name, '歪头猫')
	assert.equal(r.mood, 'soft')
	assert.deepEqual(r.tags, ['猫', '歪头'])
	assert.equal(r.when, '想撒娇的时候')
})

test('打标：纯文字不编名字，只当「什么时候用」', () => {
	const r = parseLabel('一只猫在窗台上打哈欠，适合早上用', 'a.png')
	assert.equal(r.ok, true)
	assert.equal(r.name, 'a.png')
	assert.deepEqual(r.tags, [])
	assert.match(r.when, /猫/)
})

test('打标：空输出返回 empty，不猜', () => {
	assert.deepEqual(parseLabel('   '), { ok: false, reason: 'empty' })
})

test('打标：没配命令就明说 no-vision', () => {
	const r = labelSticker('x.png', { cmd: '' })
	assert.equal(r.ok, false)
	assert.equal(r.reason, 'no-vision')
})

test('设置校验：日上限吃不到时给 warn', () => {
	const w = checkSettings({ perDay: 20, replyMaxPerRound: 2, scanRounds: 2 })
	assert.equal(w[0].level, 'warn')
	assert.match(w[0].msg, /20/)
})

test('设置校验：高于 24 条/天给 warn；静音同名给 error', () => {
	const w = checkSettings({ perDay: 40, replyMaxPerRound: 2, scanRounds: 30, quietFrom: 3, quietTo: 3 })
	assert.ok(w.some((x) => /偏多/.test(x.msg)))
	assert.ok(w.some((x) => x.level === 'error'))
	assert.equal(hasBlocker(w), true)
})

test('设置校验：正常配置不报警', () => {
	assert.deepEqual(checkSettings({ perDay: 6, replyMaxPerRound: 2, scanRounds: 4, dutyEveryMin: 60 }), [])
})

test('表情挑选：刚发过的降权，换一张', () => {
	const now = Date.UTC(2026, 10, 13, 12)
	const items = [
		{ id: 'a', mood: 'soft', tags: [], used: 0, addedAt: '2026-01-02', lastUsedAt: new Date(now - 60000).toISOString() },
		{ id: 'b', mood: 'soft', tags: [], used: 0, addedAt: '2026-01-01', lastUsedAt: '' },
	]
	assert.equal(rankStickers(items, { mood: 'soft', now })[0].id, 'b')
	assert.equal(rankStickers(items, { mood: 'soft', now, cooldownH: 0 })[0].id, 'a')
})

test('表情挑选：场景映射到情绪', () => {
	assert.equal(CONTEXT_MOOD.at, 'share')
	assert.equal(CONTEXT_MOOD.dm, 'soft')
	assert.equal(CONTEXT_MOOD.reply, 'reply')
	assert.equal(typeof pickForContext, 'function')
	/* pickForContext 要读磁盘库，这里只验映射；读库行为在 sticker 相关测试里覆盖 */
})
