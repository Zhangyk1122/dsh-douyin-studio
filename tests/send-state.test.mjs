import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifySend, canRetry, sendStateLine } from '../lib/send-state.mjs'

test('classifySend：成功就是 sent', () => {
	assert.equal(classifySend({ ok: true }), 'sent')
	assert.equal(classifySend({ sent: true }), 'sent')
})

test('classifySend：明确的失败算 failed（可重试）', () => {
	assert.equal(classifySend({ ok: false, error: '会话列表里没有「辰辰辰chen」' }), 'failed')
	assert.equal(classifySend({ ok: false, error: '会话没打开（等不到输入框）' }), 'failed')
	assert.equal(classifySend({ ok: false, error: '正文是空的' }), 'failed')
	assert.equal(classifySend({ ok: false, error: 'sec_uid 反查不到数字 uid（不猜人）' }), 'failed')
})

test('classifySend：超时 / 断连 / 进程被杀 = unknown（不重试）', () => {
	assert.equal(classifySend({ ok: false, error: 'Runtime.evaluate 超时' }), 'unknown')
	assert.equal(classifySend({ ok: false, error: 'ETIMEDOUT' }), 'unknown')
	assert.equal(classifySend({ ok: false, error: 'socket hang up' }), 'unknown')
	assert.equal(classifySend({ ok: false, error: 'CLI 没给出结果对象（null）' }), 'unknown')
	assert.equal(classifySend(null), 'unknown')
	assert.equal(classifySend({ ok: false }), 'unknown')
})

test('canRetry：只有 failed 能重试', () => {
	assert.equal(canRetry('failed'), true)
	assert.equal(canRetry('unknown'), false)
	assert.equal(canRetry('sent'), false)
})

test('sendStateLine：给面板一句话', () => {
	assert.equal(sendStateLine('unknown'), '结果不确定，先不重发')
	assert.equal(sendStateLine('failed'), '没发出去')
	assert.equal(sendStateLine('sent'), '')
})
