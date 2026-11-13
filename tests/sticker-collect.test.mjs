import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const HOME = mkdtempSync(join(tmpdir(), 'dy-collect-'))
process.env.DOUYIN_STUDIO_HOME = HOME

const { imageUrlsOf, planCollect, collectStickers } = await import('../lib/sticker-collect.mjs')
const { listStickers } = await import('../lib/stickers.mjs')

test('从评论里捞图：image_list / images / sticker 三种位置都认', () => {
	assert.deepEqual(imageUrlsOf({ image_list: [{ url_list: ['https://a/1.jpg'] }] }), ['https://a/1.jpg'])
	assert.deepEqual(imageUrlsOf({ images: ['https://b/2.png'] }), ['https://b/2.png'])
	assert.deepEqual(imageUrlsOf({ sticker: { url: 'https://c/3.gif' } }), ['https://c/3.gif'])
	assert.deepEqual(imageUrlsOf({ text: '没有图' }), [])
})

test('非 http 的地址一律丢掉（别把 data: / 相对路径当图）', () => {
	assert.deepEqual(imageUrlsOf({ image_list: [{ url_list: ['//x/y.jpg', 'data:image/png;base64,AA', 'https://ok/1.jpg'] }] }), ['https://ok/1.jpg'])
})

test('排重与限量：同一张不重复下，超过上限就停', () => {
	const items = [
		{ nick: 'A', image_list: [{ url_list: ['https://a/1.jpg', 'https://a/2.jpg'] }] },
		{ nick: 'B', image_list: [{ url_list: ['https://a/1.jpg', 'https://a/3.jpg'] }] }
	]
	const r = planCollect(items, { max: 2 })
	assert.equal(r.picked.length, 2)
	assert.deepEqual(r.picked.map((x) => x.url), ['https://a/1.jpg', 'https://a/2.jpg'])
	assert.equal(r.skipped[0].why, 'already-had')
})

test('已经收过的（seen）不再下', () => {
	const r = planCollect([{ image_list: [{ url_list: ['https://a/9.jpg'] }] }], { seen: ['https://a/9.jpg'] })
	assert.equal(r.picked.length, 0)
	assert.equal(r.skipped.length, 1)
})

test('collectStickers：下到图就入库，下不到只记 failed 不炸', async () => {
	const okB64 = Buffer.from('fake-jpeg-bytes').toString('base64')
	const fakeEval = async (js) => {
		if (js.includes('bad/1.jpg')) return JSON.stringify({ ok: false, http: 404 })
		return JSON.stringify({ ok: true, type: 'image/jpeg', size: 1234, b64: okB64 })
	}
	const items = [{ nick: '路人', image_list: [{ url_list: ['https://good/1.jpg', 'https://bad/1.jpg'] }] }]
	const r = await collectStickers(items, { evaluate: fakeEval, dir: HOME, tags: ['评论收的'] })
	assert.equal(r.ok, true)
	assert.equal(r.added.length, 1)
	assert.equal(r.failed.length, 1)
	assert.match(r.failed[0].why, /404/)
	const lib = listStickers({})
	assert.equal(lib.length, 1)
	assert.ok(lib[0].tags.includes('路人'))
	assert.ok(lib[0].tags.includes('评论收的'))
})

test('没有 evaluate 时不假装成功', async () => {
	const r = await collectStickers([], {})
	assert.equal(r.ok, false)
	assert.match(r.error, /evaluate/)
})
