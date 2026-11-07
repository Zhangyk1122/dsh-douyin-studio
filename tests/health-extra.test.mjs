/**
 * tests/health-extra.test.mjs —— health.json 只记"最后一次动作"，不记"最后一次成功"（0.4.5）
 * ============================================================================
 * 补的是派生块：`last`（report / scan / publish 各自最近一次成功）与
 * `took`（最近作业耗时 p50/p95，样本 < 5 不显示）。
 * 关键约束：**只读派生**，不写 health.json，也不改变原有字段。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dys-health-'))
process.env.DOUYIN_STUDIO_HOME = HOME

const { readHealth, writeHealth, healthFile } = await import('../lib/roundstate.mjs')
const { jobsFile } = await import('../lib/jobs.mjs')

const monthFile = () => jobsFile()

test('原字段照旧：没账本时只有默认档位，不凭空造 last/took', () => {
	const h = readHealth()
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
	const h = readHealth()
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
	const h = readHealth()
	assert.equal(h.last.report, '2026-11-07T14:49:01.582Z')
	assert.equal(h.last.publish, '2026-11-07T10:00:00.000Z')
})

test('took：样本够 5 条才给 p50/p95', () => {
	const rows = []
	for (let i = 1; i <= 6; i++) rows.push(JSON.stringify({ at: '2026-11-07T0' + i + ':00:00.000Z', name: 'scan-round', ok: true, took: i * 1000 }))
	writeFileSync(monthFile(), rows.join('\n') + '\n', 'utf8')
	const h = readHealth()
	assert.equal(h.took.n, 6)
	assert.equal(h.took.p50, 3000)
	assert.ok(h.took.p95 >= 5000)
})

test('不写盘：读完 health.json 内容一个字节都没变', () => {
	writeHealth({ level: 'warn', failures: 2, reason: '连败' })
	const before = readFileSync(healthFile(), 'utf8')
	readHealth()
	const after = readFileSync(healthFile(), 'utf8')
	assert.equal(before, after)
	assert.match(before, /"failures":\s*2/)
})


