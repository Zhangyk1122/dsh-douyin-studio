import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tileFilter, sheetFile, describe, COLS, ROWS, CELL_W } from '../lib/frames.mjs'

test('tileFilter：按秒数算采样，铺满 3×2', () => {
	const f = tileFilter(15)
	assert.match(f, /^fps=/)
	assert.match(f, /scale=320:-1/)
	assert.match(f, /tile=3x2/)
	// 15 秒 6 格 → 每秒 0.4 帧
	assert.match(f, /fps=0\.400/)
})

test('tileFilter：时长为 0 / 负数 / 缺失都退回 15 秒', () => {
	assert.equal(tileFilter(0), tileFilter(15))
	assert.equal(tileFilter(-3), tileFilter(15))
	assert.equal(tileFilter(undefined), tileFilter(15))
})

test('tileFilter：格子大小可配，默认 320', () => {
	assert.match(tileFilter(10, { cellW: 480 }), /scale=480:-1/)
	assert.equal(COLS * ROWS, 6)
	assert.equal(CELL_W, 320)
})

test('sheetFile：文件名带 aweme，非法字符被去掉', () => {
	assert.match(sheetFile('D:/tmp', '7500000000000000001'), /7500000000000000001-sheet\.jpg$/)
	assert.equal(sheetFile('D:/tmp', ''), sheetFile('D:/tmp', 'unknown'))
	assert.equal(/[\\/]a\.\.b/.test(sheetFile('D:/tmp', '../a..b')), false)
})

test('describe：没配视觉通道就明说没有，不编描述', async () => {
	const saved = process.env.DOUYIN_STUDIO_VISION_CMD
	delete process.env.DOUYIN_STUDIO_VISION_CMD
	const r = await describe('whatever.jpg')
	assert.equal(r.ok, false)
	assert.equal(r.reason, 'no-vision')
	if (saved !== undefined) process.env.DOUYIN_STUDIO_VISION_CMD = saved
})
