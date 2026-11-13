import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isInvite, isRefusal, isNoise, planSpeak } from '../lib/invite.mjs'
import { pickReplies } from '../lib/watchback.mjs'

test('邀请：点名 + 动作才算', () => {
	assert.equal(isInvite('小汐快来'), true)
	assert.equal(isInvite('小肥鱼过来看看'), true)
	assert.equal(isInvite('今天天气不错'), false)
})

test('拒绝词优先：说了别来就不算邀请', () => {
	assert.equal(isInvite('小汐别来'), false)
	assert.equal(isRefusal('别刷了'), true)
	assert.equal(planSpeak({ text: '小汐别来', mode: 'invite' }).ok, false)
})

test('纯起哄不接', () => {
	assert.equal(isNoise('666'), true)
	assert.equal(isNoise('哈哈哈哈'), true)
	assert.equal(planSpeak({ text: '666' }).ok, false)
})

test('invite 模式：没邀请就不插话', () => {
	assert.deepEqual(planSpeak({ text: '这条好看', mode: 'invite' }), { ok: false, why: '没人邀请，不插话' })
	assert.equal(planSpeak({ text: '小汐来一句', mode: 'invite' }).ok, true)
})

test('all 模式：叫到我或话题相关才开口', () => {
	assert.equal(planSpeak({ text: '随便说说', addressed: true }).ok, true)
	assert.equal(planSpeak({ text: '随便说说', relevant: true }).ok, true)
	assert.equal(planSpeak({ text: '随便说说' }).ok, false)
})

test('回评闭环：认「回复了评论」，主人优先、去重、限时效', () => {
	const now = Date.UTC(2026, 10, 13, 14)
	const items = [
		{ type: 41, type_name: '点赞了你的评论', comment_id: 'a', create_time: now / 1000 },
		{ type: 31, type_name: '回复了评论', comment_id: 'b', nickname: '辰辰辰chen', uid: '110149990088', content: '表演下呗小汐', aweme_id: '9', root_comment_id: 'r1', create_time: now / 1000 - 60 },
		{ type: 32, type_name: '回复了评论', comment_id: 'c', nickname: '路人', uid: '2', content: '哈哈', aweme_id: '8', create_time: now / 1000 - 120 },
		{ type: 32, type_name: '回复了评论', comment_id: 'c', nickname: '路人', uid: '2', content: '重复', aweme_id: '8', create_time: now / 1000 - 120 },
		{ type: 32, type_name: '回复了评论', comment_id: 'd', nickname: '旧人', uid: '3', content: '很久以前', aweme_id: '7', create_time: now / 1000 - 400 * 3600 },
	]
	const got = pickReplies(items, { ownerUid: '110149990088', now })
	assert.equal(got.length, 2)
	assert.equal(got[0].cid, 'b')
	assert.equal(got[0].fromOwner, true)
	assert.equal(got[0].root, 'r1')
	assert.equal(got.every((x) => x.cid !== 'd'), true)
})
