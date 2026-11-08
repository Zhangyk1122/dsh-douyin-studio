/**
 * tests/health-extra.test.mjs —— health.json 只记"最后一次动作"，不记"最后一次成功"（0.4.5）
 * ============================================================================
 * 补的是派生块：`last`（report / scan / publish 各自最近一次成功）与
 * `took`（最近作业耗时 p50/p95，样本 < 5 不显示）。
 * 关键约束：**只读派生**，不写 health.json，也不改变原有字段。
 * 0.4.8 起派生块带 1 秒读盘缓存：要立刻看到刚写进去的账，传 `{ memoMs: 0 }`。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dys-health-'))
process.env.DOUYIN_STUDIO_HOME = HOME

const { readHealth, writeHealth, healthFile, dropHealthMemo, HEALTH_MEMO_MS } = await import('../lib/roundstate.mjs')
const { jobsFile } = await import('../lib/jobs.mjs')

const monthFile = () => jobsFile()
/** 测试里要"立刻读到刚写的账"，一律绕开缓存 */
const fresh = () => readHealth({ memoMs: 0 })

test('原字段照旧：没账本时只有默认档位，不凭空造 last/took', () => {
	const h = fresh()
	assert.equal(h.level, 'ok')
	assert.equal(h.failures, 0)
	assert.deepEqual(h.last, {})
	assert.equal('took' in h, false)
})

test('last.scan：取最近一条成功的 scan-round', () => {
	writeFileSync(monthFile(), [
		JSON.stringify({ at: '2026-11-07T01:00:00.000Z', name: 'scan-round', ok: false, took: 100 }),
		JSON.stringify({ at: '2026-11-07T02:00:00.000Z', name: 'scan-round', ok: true, took: 200 }),
		JSON.stringify({ at: '2026-11-07T03:00:00.000Z', name: 'scan-round', ok: true, took: 300 }),
	].join('\n') + '\n', 'utf8')
	const h = fresh()
	assert.equal(h.last.scan, '2026-11-07T03:00:00.000Z')
})

test('last.report / last.publish：从 autopilot-state 的 log 里取', () => {
	writeFileSync(join(HOME, 'autopilot-state.json'), JSON.stringify({
		report: { day: '2026-11-07' },
		log: [
			{ at: '2026-11-07T14:49:01.582Z', kind: 'report', ok: true },
			{ at: '2026-11-07T10:00:00.000Z', kind: 'publish', ok: true },
			{ at: '2026-11-07T09:00:00.000Z', kind: 'report', ok: false },
		],
	}), 'utf8')
	const h = fresh()
	assert.equal(h.last.report, '2026-11-07T14:49:01.582Z')
	assert.equal(h.last.publish, '2026-11-07T10:00:00.000Z')
})

test('took：样本够 5 条才给 p50/p95', () => {
	const rows = []
	for (let i = 1; i <= 6; i++) rows.push(JSON.stringify({ at: '2026-11-07T0' + i + ':00:00.000Z', name: 'scan-round', ok: true, took: i * 1000 }))
	writeFileSync(monthFile(), rows.join('\n') + '\n', 'utf8')
	const h = fresh()
	assert.equal(h.took.n, 6)
	assert.equal(h.took.p50, 3000)
	assert.ok(h.took.p95 >= 5000)
})

test('不写盘：读完 health.json 内容一个字节都没变', () => {
	writeHealth({ level: 'warn', failures: 2, reason: '连败' })
	const before = readFileSync(healthFile(), 'utf8')
	fresh()
	const after = readFileSync(healthFile(), 'utf8')
	assert.equal(before, after)
	assert.match(before, /"failures":\s*2/)
})

test('派生块有 1 秒读盘缓存：同一秒内账本变了也先给上一份', () => {
	assert.equal(HEALTH_MEMO_MS, 1000)
	dropHealthMemo()
	writeFileSync(monthFile(), JSON.stringify({ at: '2026-11-08T01:00:00.000Z', name: 'scan-round', ok: true, took: 111 }) + '\n', 'utf8')
	assert.equal(readHealth().last.scan, '2026-11-08T01:00:00.000Z')
	/* 账本变了，但一秒内读到的还是缓存里那份 */
	writeFileSync(monthFile(), [
		JSON.stringify({ at: '2026-11-08T01:00:00.000Z', name: 'scan-round', ok: true, took: 111 }),
		JSON.stringify({ at: '2026-11-08T02:00:00.000Z', name: 'scan-round', ok: true, took: 222 }),
	].join('\n') + '\n', 'utf8')
	assert.equal(readHealth().last.scan, '2026-11-08T01:00:00.000Z', '一秒内应该命中缓存')
	/* 缓存绕开 / 清掉之后，才是新的那份 */
	assert.equal(readHealth({ memoMs: 0 }).last.scan, '2026-11-08T02:00:00.000Z')
	dropHealthMemo()
	assert.equal(readHealth().last.scan, '2026-11-08T02:00:00.000Z')
})

test('写 health / 写轮次会主动清缓存（不用等 TTL 过期）', () => {
	dropHealthMemo()
	readHealth() // 先塞一份进缓存
	writeHealth({ level: 'ok', failures: 0, reason: '清缓存' })
	writeFileSync(monthFile(), JSON.stringify({ at: '2026-11-08T05:00:00.000Z', name: 'scan-round', ok: true, took: 333 }) + '\n', 'utf8')
	assert.equal(readHealth().last.scan, '2026-11-08T05:00:00.000Z')
})
