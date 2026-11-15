/**
 * tests/rhythm-pace.test.mjs —— 从自己的动作账学回复节奏（调研 D7-A）
 * ============================================================================
 * 钉四件事：
 *   ① 只有「发出去的话」算节奏；发布、只读、巡检不算对话；
 *   ② 睡觉跨度（>4h）和重复记账（<3s）要剔掉——那不是打字停顿；
 *   ③ 样本不够就认输（null），不许拍一个常数冒充「学到的」；
 *   ④ humanDelay 优先用学到的，字数估只是兜底；漏看与「重要的永不漏」不变。
 * ============================================================================
 */
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, after } from 'node:test'

const HOME = await mkdtemp(join(tmpdir(), 'dy-pace-'))
process.env.DOUYIN_STUDIO_HOME = HOME
process.env.DSH_HOME = HOME

const r = await import('../lib/rhythm.mjs')
const RUNS = join(HOME, 'runs.jsonl')

after(async () => { try { await rm(HOME, { recursive: true, force: true }) } catch { /* 已经删了 */ } })

const row = (kind, at) => JSON.stringify({ at: new Date(at).toISOString(), kind })
const T0 = new Date(2026, 10, 15, 20, 0, 0).getTime()
const sec = (n) => T0 + n * 1000

describe('gapsOf：只认对话，剔睡觉与重复记账', () => {
	it('发布/只读/刷视频不计入', () => {
		const gaps = r.gapsOf([
			{ at: new Date(sec(0)).toISOString(), kind: 'publish' },
			{ at: new Date(sec(10)).toISOString(), kind: 'feed' },
			{ at: new Date(sec(30)).toISOString(), kind: 'reply' },
			{ at: new Date(sec(40)).toISOString(), kind: 'status' },
			{ at: new Date(sec(70)).toISOString(), kind: 'dm' },
		])
		assert.deepEqual(gaps, [40000], '只有 reply→dm 这一对算')
	})

	it('3 秒内算重复记账，4 小时以上算睡觉', () => {
		const gaps = r.gapsOf([
			{ at: new Date(sec(0)).toISOString(), kind: 'dm' },
			{ at: new Date(sec(2)).toISOString(), kind: 'dm' },      // 重复记账，剔
			{ at: new Date(sec(30)).toISOString(), kind: 'dm' },
			{ at: new Date(sec(30 + 5 * 3600)).toISOString(), kind: 'dm' }, // 睡觉，剔
		])
		assert.deepEqual(gaps, [28000])
	})

	it('乱序输入也按时间排好', () => {
		const gaps = r.gapsOf([
			{ at: new Date(sec(60)).toISOString(), kind: 'reply' },
			{ at: new Date(sec(0)).toISOString(), kind: 'reply' },
		])
		assert.deepEqual(gaps, [60000])
	})
})

describe('empiricalPace：样本不够就认输', () => {
	it('少于 min 条 → null（不拍常数）', () => {
		const rows = Array.from({ length: 19 }, (_, i) => ({ at: new Date(sec(i * 30)).toISOString(), kind: 'reply' }))
		assert.equal(r.empiricalPace(rows), null)
	})

	it('够 20 条 → 落在 p10–p90 中段里', () => {
		const rows = Array.from({ length: 40 }, (_, i) => ({ at: new Date(sec(i * 20)).toISOString(), kind: 'reply' }))
		const v = r.empiricalPace(rows, { rng: () => 0.5 })
		assert.ok(v >= 20000 && v <= 20000, '等间隔时中段退化成一个点：' + v)
	})

	it('间隔拉开时，取样被钳在 [2s, 90s] 且 rng 可复现', () => {
		const rows = [
			...Array.from({ length: 15 }, (_, i) => ({ at: new Date(sec(i * 5)).toISOString(), kind: 'dm' })),
			...Array.from({ length: 15 }, (_, i) => ({ at: new Date(sec(1000 + i * 60)).toISOString(), kind: 'dm' })),
		]
		const a = r.empiricalPace(rows, { rng: () => 0 })
		const b = r.empiricalPace(rows, { rng: () => 0 })
		assert.equal(a, b, '同一个 rng 必须给出同一个停顿')
		assert.ok(a >= 2000 && a <= 90000, '超出 [2s, 90s] 就不是打字停顿：' + a)
	})
})

describe('learnPace：读自己的账本，带缓存', () => {
	it('有账 → 学到一个数；没账 → null', async () => {
		const rows = Array.from({ length: 30 }, (_, i) => row('reply', sec(i * 25)))
		await writeFile(RUNS, rows.join('\n') + '\n', 'utf8')
		const v = r.learnPace({ now: T0 })
		assert.ok(typeof v === 'number' && v > 0)
	})

	it('缓存期内不重读（文件删了也用旧值）', async () => {
		const rows = Array.from({ length: 30 }, (_, i) => row('reply', sec(i * 25)))
		await writeFile(RUNS, rows.join('\n') + '\n', 'utf8')
		const first = r.learnPace({ now: T0 })
		assert.ok(first > 0)
		await rm(RUNS, { force: true })
		const cached = r.learnPace({ now: T0 + 1000 })
		assert.equal(cached, first, '缓存期内不该重读文件')
		const expired = r.learnPace({ now: T0 + 120000 })
		assert.equal(expired, null, '过了缓存期文件没了 → 认输')
	})
})

describe('humanDelay：学到的优先，兜底不变', () => {
	it('给了 pace 就用 pace', () => {
		const d = r.humanDelay('短', { pace: 42000 })
		assert.equal(d.delayMs, 42000)
		assert.equal(d.reason, 'learned')
		assert.equal(d.skip, false)
	})

	it('没给 pace → 按字数估（旧行为不动）', () => {
		const d = r.humanDelay('一二三四五')
		assert.equal(d.reason, 'typing')
		assert.ok(d.delayMs >= 2000 && d.delayMs <= 6000)
	})

	it('漏看与「重要的永不漏」不变', () => {
		const miss = r.humanDelay('在吗', { rng: () => 0.001, skipRate: 0.5 })
		assert.equal(miss.skip, true)
		assert.equal(miss.reason, 'missed')
		const keep = r.humanDelay('在吗', { rng: () => 0.001, skipRate: 0.5, important: true, pace: 5000 })
		assert.equal(keep.skip, false)
		assert.equal(keep.delayMs, 5000)
	})
})
