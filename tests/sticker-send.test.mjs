import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const HOME = mkdtempSync(join(tmpdir(), 'dy-send-'))
process.env.DOUYIN_STUDIO_HOME = HOME

const {
	planStickerMessage,
	stageStickerDm,
	stageFileByReact,
	mimeOf,
	waitSendModal,
	confirmSendModal,
	cancelSendModal,
	UPLOAD_INPUT,
	SEND_MODAL_SURE,
	AWE_TYPE_IMAGE,
} = await import('../lib/sticker-send.mjs')

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

test('mimeOf：按扩展名给 content-type，认不出就 application/octet-stream', () => {
	assert.equal(mimeOf('a.PNG'), 'image/png')
	assert.equal(mimeOf('a.jpeg'), 'image/jpeg')
	assert.equal(mimeOf('a.gif'), 'image/gif')
	assert.equal(mimeOf('a.bin'), 'application/octet-stream')
	assert.equal(mimeOf(''), 'application/octet-stream')
})

test('塞图走 React onFileChange：File 数组、真名与真 MIME 都带上', async () => {
	const f = join(HOME, 'real.png')
	writeFileSync(f, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))
	let expr = ''
	const c = { evaluate: async (e) => { expr = e; return 'ok' } }
	const r = await stageFileByReact(c, f)
	assert.equal(r.ok, true)
	assert.equal(r.via, 'react-onFileChange')
	assert.equal(r.name, 'real.png')
	assert.equal(r.mime, 'image/png')
	assert.equal(r.bytes, 7)
	assert.ok(expr.includes(UPLOAD_INPUT))
	assert.ok(expr.includes('onFileChange'))
	assert.ok(expr.includes('"real.png"'))
	assert.ok(expr.includes('image/png'))
	/* 传的必须是 File 数组，不是 {files:[]} */
	assert.ok(expr.includes('onFileChange([fo])'))
})

test('塞图：会话没打开（没有 input）要说清楚，不能假装成功', async () => {
	const f = join(HOME, 'x.png')
	writeFileSync(f, Buffer.alloc(4, 1))
	const r = await stageFileByReact({ evaluate: async () => 'no-input' }, f)
	assert.equal(r.ok, false)
	assert.match(r.error, /会话没打开/)
})

test('塞图：Semi Upload 结构变了要报出来', async () => {
	const f = join(HOME, 'y.png')
	writeFileSync(f, Buffer.alloc(4, 1))
	const r = await stageFileByReact({ evaluate: async () => 'no-handler' }, f)
	assert.equal(r.ok, false)
	assert.match(r.error, /onFileChange/)
})

test('塞图：onFileChange 自己抛错也带回来（不吞）', async () => {
	const f = join(HOME, 'z.png')
	writeFileSync(f, Buffer.alloc(4, 1))
	const r = await stageFileByReact({ evaluate: async () => 'threw:TypeError: n.filter is not a function' }, f)
	assert.equal(r.ok, false)
	assert.match(r.error, /n\.filter/)
})

test('等确认框：弹出来就回框里的字', async () => {
	let n = 0
	const c = {
		evaluate: async () => {
			n++
			return n < 3 ? '' : '发送给 辰辰辰chen sticker.png 801 B 取消 发送（1）'
		},
	}
	const r = await waitSendModal(c, { timeoutMs: 3000 })
	assert.equal(r.ok, true)
	assert.match(r.text, /发送给 辰辰辰chen/)
	assert.ok(r.text.includes('801 B'))
})

test('等确认框：一直不弹就超时报错，别无限等', async () => {
	const r = await waitSendModal({ evaluate: async () => '' }, { timeoutMs: 300 })
	assert.equal(r.ok, false)
	assert.match(r.error, /没弹出/)
})

test('点发送：原生 click 打到 Sure 按钮上（CDP 鼠标进不了模态层）', async () => {
	let expr = ''
	const c = { evaluate: async (e) => { expr = e; return 'clicked' } }
	const r = await confirmSendModal(c, {})
	assert.equal(r.ok, true)
	/* JSON.stringify 进来会带转义反斜杠，所以只认类名本身 */
	assert.ok(expr.includes('MsgInputSendFileModalbtnSure'))
	assert.ok(expr.includes('.click()'))
	assert.ok(!expr.includes('dispatchMouseEvent'))
	assert.equal(SEND_MODAL_SURE.includes('MsgInputSendFileModalbtnSure'), true)
})

test('点发送：按钮不在了就当失败', async () => {
	const r = await confirmSendModal({ evaluate: async () => 'gone' }, {})
	assert.equal(r.ok, false)
	assert.match(r.error, /发送按钮不在了/)
})

test('dry：只取消，不点发送', async () => {
	let expr = ''
	const c = { evaluate: async (e) => { expr = e; return 'clicked' } }
	const r = await confirmSendModal(c, { dry: true })
	assert.equal(r.ok, true)
	assert.equal(r.dry, true)
	assert.ok(expr.includes('btnCancle'))
	assert.ok(!expr.includes('btnSure'))
})

test('dry 带附言：写进去、读回来、再取消（不发）', async () => {
	const seen = []
	const c = {
		send: async (m) => { seen.push(m); return {} },
		evaluate: async (e) => {
			if (e.includes('btnCancle')) return 'clicked'
			if (e.includes('innerText')) return '就这个'
			if (e.includes('getBoundingClientRect')) return JSON.stringify({ x: 10, y: 20 })
			return ''
		},
	}
	const r = await confirmSendModal(c, { dry: true, text: '就这个', sleep: async () => {} })
	assert.equal(r.ok, true)
	assert.equal(r.dry, true)
	assert.equal(r.captioned, 'verified')
	assert.ok(seen.includes('Input.dispatchMouseEvent'))
	assert.ok(seen.includes('Input.insertText'))
})

test('dry 带附言但框不在：captioned=no-box，照样取消', async () => {
	const c = {
		send: async () => ({}),
		evaluate: async (e) => (e.includes('btnCancle') ? 'clicked' : ''),
	}
	const r = await confirmSendModal(c, { dry: true, text: '嗯', sleep: async () => {} })
	assert.equal(r.ok, true)
	assert.equal(r.captioned, 'no-box')
})

test('cancelSendModal：取消按钮没了也说清楚', async () => {
	const r = await cancelSendModal({ evaluate: async () => 'gone' })
	assert.equal(r.ok, false)
	assert.match(r.error, /取消按钮不在了/)
})

test('stageStickerDm：会话打不开就停，不塞图', async () => {
	let touched = false
	const c = { send: async () => ({}), evaluate: async () => { touched = true; return '' } }
	const r = await stageStickerDm({ c, plan: { ok: true, file: 'C:/x/a.png', text: '' }, openChat: async () => ({ ok: false, error: '会话没打开（等不到输入框）' }) })
	assert.equal(r.ok, false)
	assert.match(r.error, /会话没打开/)
	assert.equal(touched, false)
})

test('stageStickerDm：plan 不 ok 直接返回理由', async () => {
	const r = await stageStickerDm({ c: {}, plan: { ok: false, why: '图太大' } })
	assert.equal(r.ok, false)
	assert.equal(r.error, '图太大')
})

test('图片消息的 aweType 常量和 im.mjs 认的是同一个', async () => {
	const im = await import('../lib/im.mjs')
	/* im.mjs 里没导出常量，就断言「代码里确实写了 2702」—— 防手滑改成 2701/2702 不一致 */
	const { readFileSync } = await import('node:fs')
	const src = readFileSync(new URL('../lib/im.mjs', import.meta.url), 'utf8')
	assert.ok(src.includes(String(AWE_TYPE_IMAGE)), 'im.mjs 必须认 aweType ' + AWE_TYPE_IMAGE)
	assert.ok(src.includes("kind = 'image'"), 'im.mjs 必须给出 kind:image')
	assert.ok(src.includes('data_size'), 'im.mjs 必须带回图片字节数，回读才对得上')
})
