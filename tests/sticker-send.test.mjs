import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const HOME = mkdtempSync(join(tmpdir(), 'dy-send-'))
process.env.DOUYIN_STUDIO_HOME = HOME

const { planStickerMessage, stageStickerDm, stageFile } = await import('../lib/sticker-send.mjs')

test('没挑到图就说清楚，而不是发个空', () => {
	const r = planStickerMessage({})
	assert.equal(r.ok, false)
	assert.match(r.why, /没有挑到表情/)
})

test('图不在磁盘上：不发', () => {
	const r = planStickerMessage({ sticker: { file: join(HOME, 'gone.png') } })
	assert.equal(r.ok, false)
	assert.match(r.why, /图不在/)
})

test('正常一张图 + 文案：压空白、截断到上限', () => {
	const f = join(HOME, 'ok.png')
	writeFileSync(f, Buffer.alloc(128, 3))
	const r = planStickerMessage({ sticker: { id: 'st_x', file: f }, caption: '  这张   像你  ', maxText: 300 })
	assert.equal(r.ok, true)
	assert.equal(r.text, '这张 像你')
	assert.equal(r.bytes, 128)
	assert.equal(r.id, 'st_x')
})

test('文案超长按 maxText 截', () => {
	const f = join(HOME, 'ok2.png')
	writeFileSync(f, Buffer.alloc(16, 1))
	const r = planStickerMessage({ sticker: { file: f }, caption: 'a'.repeat(500), maxText: 40 })
	assert.equal(r.text.length, 40)
})

test('stageFile：有 input 就直接塞', async () => {
	let setFiles = null
	const c = {
		send: async (m, p) => {
			if (m === 'DOM.getDocument') return { root: { nodeId: 1 } }
			if (m === 'DOM.querySelector') return { nodeId: 7 }
			if (m === 'DOM.setFileInputFiles') { setFiles = p.files; return {} }
			return {}
		},
		evaluate: async () => 'no-button'
	}
	const r = await stageFile(c, 'C:/x/a.png')
	assert.equal(r.ok, true)
	assert.deepEqual(setFiles, ['C:/x/a.png'])
})

test('stageFile：没 input 时点一次图片按钮再试，仍没有就报错', async () => {
	let clicks = 0
	const c = {
		send: async (m) => {
			if (m === 'DOM.getDocument') return { root: { nodeId: 1 } }
			if (m === 'DOM.querySelector') return { nodeId: 0 }
			return {}
		},
		evaluate: async () => { clicks++; return 'no-button' }
	}
	const r = await stageFile(c, 'C:/x/a.png')
	assert.equal(r.ok, false)
	assert.match(r.error, /没找到图片按钮/)
	assert.equal(clicks, 1)
})

test('stageStickerDm：会话打不开就停，不塞图', async () => {
	const calls = []
	const c = { send: async (m) => { calls.push(m); return {} }, evaluate: async () => '' }
	const r = await stageStickerDm({ c, plan: { ok: true, file: 'C:/x/a.png', text: '' }, openChat: async () => ({ ok: false, error: '会话没打开（等不到输入框）' }) })
	assert.equal(r.ok, false)
	assert.match(r.error, /会话没打开/)
	assert.equal(calls.length, 0)
})

test('stageStickerDm：plan 不 ok 直接返回理由', async () => {
	const r = await stageStickerDm({ c: {}, plan: { ok: false, why: '图太大' } })
	assert.equal(r.ok, false)
	assert.equal(r.error, '图太大')
})
