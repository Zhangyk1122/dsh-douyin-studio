import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reusableViewer } from '../lib/tabs.mjs'

const T = (url, id = url) => ({ type: 'page', url, id })
const chat = T('https://www.douyin.com/chat', 'chat')
const feed1 = T('https://www.douyin.com/jingxuan', 'f1')
const feed2 = T('https://www.douyin.com/jingxuan?x=2', 'f2')
const video = T('https://www.douyin.com/video/7500000000000000001', 'v1')
const other = T('https://example.com/', 'o1')

test('reusableViewer：跳过聊天页（聊天页有会话状态，不能拿来导航）', () => {
	const got = reusableViewer([chat, feed1])
	assert.equal(got.id, 'f1')
})

test('reusableViewer：压根没有非聊天页时返回 null（交给 openReuse 去开一张）', () => {
	assert.equal(reusableViewer([chat]), null)
	assert.equal(reusableViewer([]), null)
})

test('reusableViewer：别的站一律不碰', () => {
	assert.equal(reusableViewer([other]), null)
	assert.equal(reusableViewer([other, video]).id, 'v1')
})

test('reusableViewer：prefer 命中的优先（比如「优先复用正在看的那条视频」）', () => {
	const got = reusableViewer([feed1, video, feed2], (t) => /\/video\//.test(t.url))
	assert.equal(got.id, 'v1')
})

test('reusableViewer：prefer 没命中就退回第一张，不是返回 null', () => {
	const got = reusableViewer([feed1, feed2], (t) => /\/video\//.test(t.url))
	assert.equal(got.id, 'f1')
})

test('reusableViewer：type 不是 page（iframe/worker）不算', () => {
	assert.equal(reusableViewer([{ type: 'iframe', url: feed1.url }]), null)
})