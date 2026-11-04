/**
 * lib/autopilot.mjs 的 IO 路径（发布 / 报平安）——不真发，只验流程
 * ============================================================================
 * 这两条以前完全没测：`runPublish` 会读写状态文件、`runReport` 会真的发私信，
 * 都「跑一次就动真格」。但它们的**判定**（没设目录、没填昵称、开关没开、
 * 今天发够了、这条失败两次了）全是纯逻辑 —— 用临时目录 + dry 就能钉死。
 * 真的点发布 / 真的发私信不在这一层测（那必须人在旁边）。
 */
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, before, after } from 'node:test'

const HOME = await mkdtemp(join(tmpdir(), 'dy-auto-'))
process.env.DOUYIN_STUDIO_HOME = HOME
process.env.DSH_HOME = HOME

const { writeSettings } = await import('../lib/settings.mjs')
const auto = await import('../lib/autopilot.mjs')

const PUB = join(HOME, 'pub')

before(async () => {
	await mkdir(PUB, { recursive: true })
	await writeFile(join(PUB, 'b.mp4'), 'x')
	await writeFile(join(PUB, 'a.png'), 'x')
	await writeFile(join(PUB, 'c.txt'), 'x')   // 不是媒体，应该被忽略
})

after(async () => { try { await rm(HOME, { recursive: true, force: true }) } catch { /* 已经删了 */ } })

describe('runPublish：判定不靠真发', () => {
	it('没设内容库目录 → 明确报错，不猜', async () => {
		writeSettings({ publishDir: '', autoPublish: true })
		const r = await auto.runPublish({ dry: true })
		assert.equal(r.ok, false)
		assert.match(r.error, /内容库目录/)
	})

	it('dry：挑第一个该发的文件，不真发', async () => {
		writeSettings({ publishDir: PUB, autoPublish: true, publishMode: 'draft', publishWho: 'private' })
		const r = await auto.runPublish({ dry: true })
		assert.equal(r.ok, true)
		assert.equal(r.would.file, 'a.png', '按文件名排序，a.png 在前')
		assert.equal(r.would.kind, 'image')
		assert.equal(r.would.mode, 'draft')
	})

	it('自主发布没开 → 跳过（不是报错）', async () => {
		writeSettings({ publishDir: PUB, autoPublish: false })
		const r = await auto.runPublish({ dry: false })
		assert.equal(r.ok, true)
		assert.match(String(r.skipped), /没开/)
	})

	it('都发过了 → done', async () => {
		await writeFile(join(HOME, 'autopilot-state.json'), JSON.stringify({
			publish: { done: { 'a.png': 'x', 'b.mp4': 'x' }, tries: {}, day: '', count: 0 },
		}))
		writeSettings({ publishDir: PUB, autoPublish: true })
		const r = await auto.runPublish({ dry: true })
		assert.equal(r.ok, true)
		assert.equal(r.done, true)
	})

	it('失败两次的文件 → 真跑时放着不动（dry 仍会给建议）', async () => {
		await writeFile(join(HOME, 'autopilot-state.json'), JSON.stringify({
			publish: { done: {}, tries: { 'a.png': 2 }, day: '', count: 0 },
		}))
		/* 谷时窗口在这个用例里关掉：测的是「失败两次」的判定，不该被时钟挡在门外 */
		writeSettings({ publishDir: PUB, autoPublish: true, publishPerDay: 1, activeFrom: '', activeTo: '' })
		auto.configure({ runCli: async () => { throw new Error('不该真发') } })
		const r = await auto.runPublish({ dry: false })
		assert.equal(r.ok, true)
		assert.match(String(r.skipped), /失败两次/)
	})
})

describe('runAt：回 @ 的开关与判定', () => {
	it('回 @ 没开 → 跳过（不是报错）', async () => {
		writeSettings({ autoAt: false })
		const r = await auto.runAt({ dry: false })
		assert.equal(r.ok, true)
		assert.match(String(r.skipped), /没开/)
	})
})

describe('runReport：日报只报数字', () => {
	it('没填主人昵称 → 明确报错', async () => {
		writeSettings({ ownerNick: '', autoReport: true })
		const r = await auto.runReport({ dry: true })
		assert.equal(r.ok, false)
		assert.match(r.error, /昵称/)
	})

	it('dry：给出要发的话，标题带日期', async () => {
		writeSettings({ ownerNick: 'me-owner', autoReport: true })
		const r = await auto.runReport({ dry: true })
		assert.equal(r.ok, true)
		assert.match(r.would.text, /日报 · \d+\/\d+/)
		assert.equal(r.would.to, 'me-owner')
	})

	it('报平安没开 → 跳过', async () => {
		writeSettings({ ownerNick: 'me-owner', autoReport: false })
		const r = await auto.runReport({ dry: false })
		assert.equal(r.ok, true)
		assert.match(String(r.skipped), /没开/)
	})
})
