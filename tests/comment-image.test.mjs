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
	/* 只挑「长得像选择器」的字符串：以 # [ . 开头、且不含括号/花括号。
	 * 之前把整段 JS 里的 `') || [` 也当选择器，正则编译直接炸。 */
	const sels = [...commentBoxJs.matchAll(/'([^']*\[[^']*)'/g)]
		.map((m) => m[1])
		.filter((s) => /^[#\[.]/.test(s) && !/[(){}]/.test(s))
	assert.ok(sels.length >= 1)
	assert.ok(sels.some((s) => s.includes('comment-input-container')), '定位脚本里要留评论框容器')
	for (const s of sels) assert.doesNotThrow(() => new RegExp(s.replace(/\[/g, '\\[').replace(/\]/g, '\\]')))
})
