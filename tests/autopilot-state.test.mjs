/**
 * tests/autopilot-state.test.mjs —— 状态文件的读写契约
 * ============================================================================
 * 钉一条规矩：**load() 不许把不认识的字段丢掉。**
 *
 * 背景：2026-11-04 22:33–23:04，插件给主人连发了 13 条视频私信。
 * 真因不是「忘了加 digest」，而是 load() 当时是白名单式重建 —— 只把认识的字段
 * 往回拼，新加的字段读一次就没了，下一次 save 把文件里的真值冲成空。
 * 补字段永远补不完，所以这里测的是**模式**，不是某一个字段。
 * ============================================================================
 */
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, before, after } from 'node:test'

const HOME = await mkdtemp(join(tmpdir(), 'dy-state-'))
process.env.DOUYIN_STUDIO_HOME = HOME
process.env.DSH_HOME = HOME

const auto = await import('../lib/autopilot.mjs')
const STATE = join(HOME, 'autopilot-state.json')

const write = (obj) => writeFile(STATE, JSON.stringify(obj), 'utf8')

after(async () => { try { await rm(HOME, { recursive: true, force: true }) } catch { /* 已经删了 */ } })

describe('autopilot 状态文件', () => {
	it('文件不存在 → 全默认，不抛错', () => {
		const s = auto.readState()
		assert.deepEqual(s.dm, { replied: {}, tries: {} })
		assert.deepEqual(s.digest, { day: '', sent: [] })
		assert.deepEqual(s.log, [])
	})

	it('不认识的字段必须原样带回来（这条就是那次 13 条私信的病根）', async () => {
		await write({
			digest: { day: '2026-11-04', sent: ['a', 'b'] },
			/* 明天新加的字段：今天的代码不认识它，但不许把它弄丢 */
			futureField: { whatever: 1 },
		})
		const s = auto.readState()
		assert.equal(s.digest.day, '2026-11-04')
		assert.deepEqual(s.digest.sent, ['a', 'b'])
		assert.deepEqual(s.futureField, { whatever: 1 }, '未知字段被 load 丢了 —— 下次 save 就会把它从文件里擦掉')
	})

	it('已知字段照常归一化（脏数据不崩、类型不飘）', async () => {
		await write({
			publish: { count: '3', done: { a: 1 } },
			digest: { sent: 'not-an-array' },
			log: 'nope',
		})
		const s = auto.readState()
		assert.equal(s.publish.count, 3)
		assert.deepEqual(s.digest.sent, [])
		assert.deepEqual(s.log, [])
	})

	it('少写子字段 → 用默认补齐，而不是整块丢', async () => {
		await write({ dm: { replied: { u1: '2026-11-01T00:00:00Z' } } })
		const s = auto.readState()
		assert.equal(s.dm.replied.u1, '2026-11-01T00:00:00Z')
		assert.deepEqual(s.dm.tries, {})
		assert.equal(s.digest.day, '')
	})
})
