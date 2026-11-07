/**
 * tests/chrome-tab.test.mjs —— 挑标签页只看域名是不够的（0.4.5）
 * ============================================================================
 * 2026-11-07 实弹：同时开着 4 个 douyin.com（1 个 /chat、3 个 /jingxuan）。
 * `pickTab(host)` 只比域名，于是发私信前拿到的是视频页 —— 视频页的分享面板里
 * 也有 `[data-e2e="conversation-item"]`，于是"找得到行、打不开会话"。
 * 这里钉三件事：不传 want 时行为不变、传 want 时精确命中、命中不到返回 null（不退回同域）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { matchTab } from '../lib/chrome.mjs'

const TABS = [
	{ type: 'page', url: 'https://www.douyin.com/jingxuan?modal_id=1' },
	{ type: 'page', url: 'https://www.douyin.com/chat' },
	{ type: 'page', url: 'https://www.douyin.com/jingxuan?modal_id=2' },
	{ type: 'background_page', url: 'https://www.douyin.com/chat' },
]

test('不传 want：老行为，同域第一张 page', () => {
	const t = matchTab(TABS, 'www.douyin.com')
	assert.equal(t.url, 'https://www.douyin.com/jingxuan?modal_id=1')
})

test('传 want：精确命中 /chat，不再落到视频页', () => {
	const t = matchTab(TABS, 'www.douyin.com', '/chat')
	assert.equal(t.url, 'https://www.douyin.com/chat')
})

test('传 want 但没这张：返回 null（调用方去开新页，不许退回同域）', () => {
	const t = matchTab(TABS, 'www.douyin.com', '/message')
	assert.equal(t, null)
})

test('前缀命中：/user/ 命中 /user/self', () => {
	const t = matchTab([{ type: 'page', url: 'https://www.douyin.com/user/self' }], 'www.douyin.com', '/user')
	assert.equal(t.url, 'https://www.douyin.com/user/self')
})

test('坏 url 不炸：pathname 取不到就当不匹配', () => {
	const t = matchTab([{ type: 'page', url: 'about:blank' }], 'www.douyin.com', '/chat')
	assert.equal(t, null)
})
