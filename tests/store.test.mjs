import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { updateJson, writeJson, pending } from '../lib/store.mjs'

const dir = mkdtempSync(join(tmpdir(), 'dys-store-'))
const file = join(dir, 'state.json')

test('并发 read-modify-write 不丢更新（这正是三次记账事故的形状）', async () => {
	const ups = []
	for (let i = 0; i < 12; i++) {
		ups.push(updateJson(file, async (cur) => {
			await new Promise((r) => setTimeout(r, (i % 3) * 2))
			return { ...cur, n: (Number(cur.n) || 0) + 1 }
		}, { fallback: { n: 0 } }))
	}
	await Promise.all(ups)
	const j = JSON.parse(readFileSync(file, 'utf8'))
	assert.equal(j.n, 12, '12 次并发自增必须一次不少')
})

test('mutate 抛错不写盘，也不卡死后面的队列', async () => {
	const before = readFileSync(file, 'utf8')
	await assert.rejects(() => updateJson(file, () => { throw new Error('boom') }))
	assert.equal(readFileSync(file, 'utf8'), before)
	const ok = await updateJson(file, (cur) => ({ ...cur, after: true }))
	assert.equal(ok.after, true)
})

test('返回 undefined = 不写；writeJson 是整份覆盖', async () => {
	const before = readFileSync(file, 'utf8')
	assert.equal(await updateJson(file, () => undefined), null)
	assert.equal(readFileSync(file, 'utf8'), before)
	await writeJson(file, { only: 1 })
	assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { only: 1 })
})

test('不同文件互不阻塞，队列会清空', async () => {
	const other = join(dir, 'other.json')
	await Promise.all([writeJson(file, { a: 1 }), writeJson(other, { b: 2 })])
	assert.equal(JSON.parse(readFileSync(other, 'utf8')).b, 2)
	assert.equal(pending(), 0)
})

test('收尾：删临时目录', () => {
	rmSync(dir, { recursive: true, force: true })
	assert.equal(true, true)
})
