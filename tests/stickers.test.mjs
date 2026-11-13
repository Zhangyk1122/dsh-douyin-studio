import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dy-stickers-'))
process.env.DOUYIN_STUDIO_HOME = HOME

const {
	addSticker,
	listStickers,
	pickSticker,
	rankStickers,
	markStickerUsed,
	removeSticker,
	stickerStats,
	MAX_BYTES
} = await import('../lib/stickers.mjs')

function makePng(name, bytes = 64) {
	const p = join(HOME, name)
	writeFileSync(p, Buffer.alloc(bytes, 7))
	return p
}

test('收一张新图：进库、能查到、带标签', () => {
	const f = makePng('a.png')
	const r = addSticker(f, { tags: ['猫', '懒'], mood: 'shy', name: '懒猫' })
	assert.equal(r.ok, true)
	assert.equal(r.dupe, false)
	assert.match(r.id, /^st_[0-9a-f]{10}$/)
	const items = listStickers({})
	assert.equal(items.length, 1)
	assert.deepEqual(items[0].tags, ['猫', '懒'])
	assert.equal(items[0].mood, 'shy')
	assert.equal(items[0].used, 0)
})

test('同一张图再收一次：不重复存，标签合并', () => {
	const f = makePng('a.png')
	const r = addSticker(f, { tags: ['可爱'] })
	assert.equal(r.ok, true)
	assert.equal(r.dupe, true)
	const items = listStickers({})
	assert.equal(items.length, 1)
	assert.deepEqual(items[0].tags.sort(), ['可爱', '懒', '猫'].sort())
})

test('拒绝不存在的文件 / 不收的格式 / 超大的图', () => {
	assert.equal(addSticker(join(HOME, 'nope.png')).ok, false)
	const txt = join(HOME, 'x.txt')
	writeFileSync(txt, 'hi')
	assert.equal(addSticker(txt).ok, false)
	const big = join(HOME, 'big.png')
	writeFileSync(big, Buffer.alloc(MAX_BYTES + 1, 1))
	const r = addSticker(big)
	assert.equal(r.ok, false)
	assert.match(r.error, /图太大/)
})

test('按心情挑：心情匹配优先于标签与新旧', () => {
	const items = [
		{ id: 'a', used: 0, addedAt: '2026-01-01', mood: 'shy', tags: [] },
		{ id: 'b', used: 0, addedAt: '2026-02-01', mood: 'happy', tags: ['猫'] },
		{ id: 'c', used: 0, addedAt: '2026-03-01', mood: '', tags: ['猫'] }
	]
	assert.equal(rankStickers(items, { mood: 'shy', tags: ['猫'] })[0].id, 'a')
})

test('同等条件下：用得少的先上，其次新的先上', () => {
	const items = [
		{ id: 'a', used: 3, addedAt: '2026-03-01', mood: '', tags: [] },
		{ id: 'b', used: 0, addedAt: '2026-01-01', mood: '', tags: [] },
		{ id: 'c', used: 0, addedAt: '2026-02-01', mood: '', tags: [] }
	]
	assert.deepEqual(rankStickers(items, {}).map((x) => x.id), ['c', 'b', 'a'])
})

test('发一次记一次，下次排到后面', () => {
	const items = listStickers({})
	const first = items[0]
	assert.ok(first)
	assert.equal(markStickerUsed(first.id).ok, true)
	assert.equal(listStickers({}).find((x) => x.id === first.id).used, 1)
	assert.equal(markStickerUsed('st_none').ok, false)
})

test('空库挑不到东西，不抛', () => {
	rmSync(join(HOME, 'stickers'), { recursive: true, force: true })
	assert.equal(pickSticker({ mood: 'happy' }), null)
	assert.equal(listStickers({}).length, 0)
	assert.deepEqual(stickerStats().count, 0)
})

test('删一张：索引和文件都没了', () => {
	const f = makePng('del.png', 32)
	const r = addSticker(f)
	assert.equal(r.ok, true)
	const before = listStickers({}).find((x) => x.id === r.id)
	assert.ok(before && existsSync(before.file))
	assert.equal(removeSticker(r.id).ok, true)
	assert.equal(listStickers({}).some((x) => x.id === r.id), false)
	assert.equal(existsSync(before.file), false)
})
