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

/* 2026-11-15：checkSettings 重写过 —— 旧版按 perDay/commentPerDay 算，而真实设置里
 * 根本没有这两个字段，`Number('03:00')` 又是 NaN，所以它对着真的 settings.json 一条都
 * 报不出来。下面三条改成按真实字段验（replyMaxPerRound / dutyEveryMin / scanPerRound）。 */
test('设置校验：轮次给不了那么多条，日上限就是空头支票', () => {
	/* 每轮 2 条 × 每 12 小时 1 轮 = 4 条，上限却写 20 → 那 20 条永远吃不到 */
	const w = checkSettings({ replyMaxPerRound: 2, dutyEveryMin: 720 }, { perDay: 20 })
	assert.equal(w[0].level, 'warn')
	assert.match(w[0].msg, /吃不到/)
})

test('设置校验：轮次够给、日上限先断——不报（这是正常设计，别虚惊）', () => {
	/* 每轮 2 条 × 每 30 分钟 1 轮 = 96 条，上限 20 → 20 先断，不是矛盾 */
	assert.deepEqual(checkSettings({ replyMaxPerRound: 2, dutyEveryMin: 30 }, { perDay: 20 }), [])
})

test('设置校验：静音同名给 error；刷着轮但每轮 0 个也报', () => {
	const w = checkSettings({ replyMaxPerRound: 1, dutyEveryMin: 120, quietFrom: '03:00', quietTo: '03:00', scanRounds: 4, scanPerRound: 0 })
	assert.ok(w.some((x) => x.level === 'error' && x.field === 'quiet'), '静音开始=结束必须是 error')
	assert.ok(w.some((x) => x.level === 'error' && x.field === 'scanPerRound'), '每轮 0 个等于空转')
	assert.equal(hasBlocker(w), true)
})

test('设置校验：正常配置不报警', () => {
	assert.deepEqual(
		checkSettings({ replyMaxPerRound: 1, dutyEveryMin: 120, sharePerDay: 1, atPerDay: 1, scanRounds: 0, ownerUid: '1' }, { perDay: 6 }),
		[],
	)
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
