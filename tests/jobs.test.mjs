/**
 * tests/jobs.test.mjs —— 后台作业只做三件事，别让它顺手变成调度器
 * ============================================================================
 * 钉三件：成功原样返回、失败重试后成功、总闸开着时一步都不跑。
 * 退避时间在测试里传 0，不然一条测试要等 3 秒。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DOUYIN_STUDIO_HOME = mkdtempSync(join(tmpdir(), 'dys-jobs-'))

const { runJob, readJobs, jobsFile, jobsFiles, appendJob } = await import('../lib/jobs.mjs')
const { setKill } = await import('../lib/killswitch.mjs')

test('成功：原样返回，并落一条账', async () => {
	const v = await runJob('demo-ok', async () => ({ ok: true, n: 1 }), { tries: 1, backoff: [0] })
	assert.deepEqual(v, { ok: true, n: 1 })
	const rows = readJobs(5)
	assert.ok(rows.some((r) => r.name === 'demo-ok' && r.ok === true))
})

test('失败一次再成功：重试真的发生了', async () => {
	let n = 0
	const v = await runJob('demo-retry', async () => { n++; if (n === 1) throw new Error('抖了一下'); return 'ok' }, { tries: 2, backoff: [0] })
	assert.equal(v, 'ok')
	assert.equal(n, 2)
	const rows = readJobs(10).filter((r) => r.name === 'demo-retry')
	assert.equal(rows.length, 2)
	assert.equal(rows[0].ok, false)
	assert.equal(rows[1].ok, true)
})

test('一直失败：返回 job 失败，不抛', async () => {
	const v = await runJob('demo-bad', async () => { throw new Error('还是不行') }, { tries: 2, backoff: [0] })
	assert.equal(v.ok, false)
	assert.equal(v.stage, 'job')
	assert.match(String(v.error), /还是不行/)
})

test('总闸开着：一步都不跑', async () => {
	setKill(true, '测试')
	let ran = false
	const v = await runJob('demo-killed', async () => { ran = true }, { tries: 1 })
	assert.equal(ran, false)
	assert.equal(v.stage, 'killswitch')
	setKill(false)
	/* 0.4.5 起账本按月落盘：jobs-YYYY-MM.jsonl */
	assert.match(jobsFile(), /jobs-\d{4}-\d{2}\.jsonl$/)
	assert.ok(jobsFiles().length >= 2, '当月 + 历史，至少两个候选文件')
})

/* ── 2026-11-07：预检耗时（scan-round 的 1.2s / 63.6s 抖动要靠它归因）───────── */

test('preflight：耗时写进 pre，作业本身不被打扰', async () => {
	const v = await runJob('demo-pre', async () => ({ ok: true }), { tries: 1, preflight: async () => { await new Promise((r) => setTimeout(r, 30)) } })
	assert.deepEqual(v, { ok: true })
	const row = readJobs(5).filter((r) => r.name === 'demo-pre').pop()
	assert.equal(row.ok, true)
	assert.equal(typeof row.pre, 'number')
	assert.ok(row.pre >= 25, 'pre 应该量到预检耗时，实际 ' + row.pre)
})

test('preflight 抛错：作业照跑，pre 记 -1（不把预检当业务失败）', async () => {
	let ran = false
	const v = await runJob('demo-pre-bad', async () => { ran = true; return 'ok' }, { tries: 1, preflight: async () => { throw new Error('浏览器没起来') } })
	assert.equal(v, 'ok')
	assert.equal(ran, true)
	const row = readJobs(5).filter((r) => r.name === 'demo-pre-bad').pop()
	assert.equal(row.pre, -1)
	assert.equal(row.ok, true)
})

test('没给 preflight：账里不出现 pre 字段（旧读法不受影响）', async () => {
	await runJob('demo-no-pre', async () => 'ok', { tries: 1 })
	const row = readJobs(5).filter((r) => r.name === 'demo-no-pre').pop()
	assert.equal('pre' in row, false)
})

/* ── 0.4.5：阶段计时（phases）/ 按月轮转 / 老账本兼容 ─────────────────────── */

test('mark()：每按一次记一段，phases 相加≈took', async () => {
    const v = await runJob('demo-phase', async (mark) => {
        await new Promise((r) => setTimeout(r, 20)); mark('feed')
        await new Promise((r) => setTimeout(r, 10)); mark('judge')
        return 'ok'
    }, { tries: 1 })
    assert.equal(v, 'ok')
    const row = readJobs(5).filter((r) => r.name === 'demo-phase').pop()
    assert.equal(row.ok, true)
    assert.ok(row.phases && typeof row.phases === 'object', 'phases 应该落账')
    assert.ok(row.phases.feed >= 15, 'feed 段应量到，实际 ' + row.phases.feed)
    assert.ok(row.phases.judge >= 5, 'judge 段应量到，实际 ' + row.phases.judge)
    assert.ok(row.phases.feed + row.phases.judge <= row.took, '分段不该超过总耗时')
})

test('不调 mark：账里不出现 phases 字段（老作业的账行长一个样）', async () => {
    await runJob('demo-no-phase', async () => 'ok', { tries: 1 })
    const row = readJobs(5).filter((r) => r.name === 'demo-no-phase').pop()
    assert.equal('phases' in row, false)
})

test('按月轮转：当月账本 + 老的 jobs.jsonl 一起读得到', async () => {
    const { appendFileSync } = await import('node:fs')
    appendFileSync(join(process.env.DOUYIN_STUDIO_HOME, 'jobs.jsonl'), JSON.stringify({ at: '2026-10-31T00:00:00.000Z', name: 'legacy-row', ok: true, took: 5 }) + '\n', 'utf8')
    for (let i = 0; i < 8; i++) appendJob({ name: 'many-' + i, ok: true, took: 100 + i })
    const rows = readJobs(50)
    assert.ok(rows.some((r) => r.name === 'legacy-row'), '老 jobs.jsonl 仍要能读到')
    const tail = readJobs(3)
    assert.equal(tail.length, 3)
    assert.equal(tail[2].name, 'many-7', '新的在后')
})
