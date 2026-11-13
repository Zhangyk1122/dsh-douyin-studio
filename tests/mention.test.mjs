import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
	normalizeOwner,
	isRealUid,
	canMention,
	hasMention,
	withMention,
	stripMentions,
	mentionExtra,
	planMention
} = await import('../lib/mention.mjs')

const OWNER = { nick: '辰辰辰chen', uid: '110149990088', secUid: 'MS4wLjABAAAAdpyhXsjK' }

test('三个字段从不同写法里都能捞出来', () => {
	assert.deepEqual(normalizeOwner({ nickname: 'A', user_id: 123456, sec_uid: 'S' }), {
		nick: 'A',
		uid: '123456',
		secUid: 'S'
	})
	assert.deepEqual(normalizeOwner({ ownerNick: 'B', ownerUid: '999999', ownerSecUid: 'T' }), {
		nick: 'B',
		uid: '999999',
		secUid: 'T'
	})
})

test('只有纯数字才算真 uid（sec_uid 不算）', () => {
	assert.equal(isRealUid('110149990088'), true)
	assert.equal(isRealUid('123'), false) // 太短，可能是手滑
	assert.equal(isRealUid('MS4wLjABAAAAdpyhXsjK'), false)
	assert.equal(isRealUid(''), false)
})

test('缺 uid 就不能算能 @ —— 昵称可以重名，靠它 @ 会 @ 错人', () => {
	assert.equal(canMention(OWNER), true)
	assert.equal(canMention({ nick: '辰辰辰chen' }), false)
	assert.equal(canMention({ uid: '110149990088' }), false)
	assert.equal(canMention(null), false)
})

test('拼 @：没 @ 就加上，已经有就不叠', () => {
	assert.deepEqual(withMention('这条你会喜欢', OWNER), {
		text: '@辰辰辰chen 这条你会喜欢',
		added: true
	})
	assert.deepEqual(withMention('@辰辰辰chen 这条你会喜欢', OWNER), {
		text: '@辰辰辰chen 这条你会喜欢',
		added: false
	})
	assert.equal(hasMention('@辰辰辰chen 看这个', '辰辰辰chen'), true)
	assert.equal(hasMention('@辰辰 看这个', '辰辰辰chen'), false)
})

test('剥 @：文案里的 @ 全部去掉，空格压成一个', () => {
	assert.equal(stripMentions('@辰辰辰chen  @别人 这条好看'), '这条好看')
	assert.equal(stripMentions('没有 @ 的句子'), '没有 @ 的句子')
})

test('text_extra：能 @ 才给条目，且带数字 uid', () => {
	const e = mentionExtra(OWNER)
	assert.equal(e.length, 1)
	assert.equal(e[0].type, 0)
	assert.equal(e[0].text, '@辰辰辰chen')
	assert.equal(e[0].user_id, '110149990088')
	assert.deepEqual(mentionExtra({ nick: '无数字uid' }), [])
})

test('planMention：四种理由各自说清楚', () => {
	assert.equal(planMention({ text: 'x', owner: OWNER, want: false }).why, 'off')
	assert.equal(planMention({ text: 'x', owner: {} }).why, 'no-owner')
	assert.equal(planMention({ text: 'x', owner: { nick: 'n' } }).why, 'no-uid')

	const already = planMention({ text: '@辰辰辰chen 看这个', owner: OWNER })
	assert.equal(already.why, 'already-in-text')
	assert.equal(already.extra.length, 1)

	const prefixed = planMention({ text: '看这个', owner: OWNER })
	assert.equal(prefixed.why, 'prefixed')
	assert.equal(prefixed.text, '@辰辰辰chen 看这个')
	assert.equal(prefixed.extra.length, 1)
})
