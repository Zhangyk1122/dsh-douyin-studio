/**
 * tests/contacts.test.mjs —— 评论区的人，记得住，也只记事实。
 *
 * 这几条是钉子：
 *   1. 同一个人的同一句话不重复记（连发两条一样的，算一次）
 *   2. 只记原话，不记推测；长句截到 80 字
 *   3. 第一次来的人不许被说成「来过 N 次」
 *   4. 没记录就返回空串 —— 提示词里绝不出现编出来的「上次你说」
 *   5. 表满了先丢「从没回过、最久没出现」的人
 *   6. 坏文件当空表，不让值班停摆
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let M

before(async () => {
	process.env.DOUYIN_STUDIO_HOME = mkdtempSync(join(tmpdir(), 'dys-contacts-'))
	M = await import('../lib/contacts.mjs')
})

test('同一句不重复记；两句都留', () => {
	M.remember({ uid: 'u1', nick: '阿猫', text: '猫又掉毛了' })
	M.remember({ uid: 'u1', text: '猫又掉毛了' })
	M.remember({ uid: 'u1', text: '加班到两点' })
	const u = M.profileOf('u1')
	assert.equal(u.count, 3, '他确实说了三次')
	assert.deepEqual(u.texts, ['加班到两点', '猫又掉毛了'])
})

test('长句截到 80 字，空白压掉', () => {
	M.remember({ uid: 'u2', text: '  很长  的一句话  '.repeat(20) })
	const u = M.profileOf('u2')
	assert.ok(u.texts[0].length <= 80)
	assert.ok(!u.texts[0].includes('  '))
})

test('第一次来的人不说「来过 N 次」', () => {
	M.remember({ uid: 'u3', nick: '路人', text: '画得好看' })
	const line = M.summaryFor('u3')
	assert.ok(line.startsWith('以前说过'), '首句不该有次数：' + line)
	assert.ok(!line.includes('来过'))
})

test('回过一次就记上；第二句起才说「来过 N 次」', () => {
	M.noteReply('u3')
	let line = M.summaryFor('u3')
	assert.match(line, /回过他 1 次/)
	assert.match(line, /画得好看/)
	assert.ok(!line.includes('来过'), '只来过一次不该说次数：' + line)
	M.remember({ uid: 'u3', text: '又是我' })
	line = M.summaryFor('u3')
	assert.match(line, /来过 2 次/)
})

test('没记录 → 空串（不许编）', () => {
	assert.equal(M.summaryFor('nobody'), '')
	assert.equal(M.summaryFor(''), '')
})

test('表满了先丢没回过、最久没出现的', () => {
	for (let i = 0; i < M.MAX_USERS + 5; i++) {
		M.remember({ uid: 'bulk' + i, text: 'x' + i, at: 1000 + i })
	}
	const db = M.loadContacts()
	assert.ok(Object.keys(db.users).length <= M.MAX_USERS)
	assert.ok(db.users.u1, 'u1 回过/有历史，应保留')
})

test('坏文件当空表，不抛', () => {
	writeFileSync(M.contactsFile(), '{ 这不是 json')
	assert.deepEqual(M.loadContacts().users, {})
	assert.equal(M.summaryFor('u1'), '')
})
