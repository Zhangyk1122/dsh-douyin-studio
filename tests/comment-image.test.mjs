import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planCommentImage, videoUrl, commentBoxJs } from '../lib/comment-image.mjs'

const tmp = mkdtempSync(join(tmpdir(), 'ci-'))
const png = join(tmp, 'a.png')
writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

test('评论带图：视频地址按 id 拼', () => {
	assert.equal(videoUrl('123'), 'https://www.douyin.com/video/123')
	assert.equal(videoUrl(''), 'https://www.douyin.com/video/')
})

test('评论带图：缺 aweme 不放行', () => {
	const r = planCommentImage({ aweme: '', file: png })
	assert.equal(r.ok, false)
	assert.match(r.why, /aweme/)
})

test('评论带图：图不在磁盘不放行', () => {
	const r = planCommentImage({ aweme: '1', file: join(tmp, 'nope.png') })
	assert.equal(r.ok, false)
	assert.match(r.why, /图不在磁盘/)
})

test('评论带图：图有、id 有才放行', () => {
	const r = planCommentImage({ aweme: '7685', file: png })
	assert.deepEqual(r, { ok: true, aweme: '7685', file: png })
})

test('评论带图：定位脚本优先 data-e2e 再退 contenteditable', () => {
	assert.match(commentBoxJs, /data-e2e="comment-input"/)
	assert.match(commentBoxJs, /contenteditable="true"/)
	assert.match(commentBoxJs, /JSON\.stringify/)
})

test('评论带图：定位脚本不抛错（选择器语法合法）', () => {
	const sels = [...commentBoxJs.matchAll(/'([^']*\[[^']*)'/g)].map((m) => m[1])
	assert.ok(sels.length >= 2)
	for (const s of sels) assert.doesNotThrow(() => new RegExp(s.replace(/\[/g, '\\[').replace(/\]/g, '\\]')))
})
