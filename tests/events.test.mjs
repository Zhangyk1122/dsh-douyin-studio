import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'dy-events-'))
const spool = join(home, 'spool.ndjson')
process.env.DOUYIN_STUDIO_HOME = home
process.env.DOUYIN_STUDIO_SPOOL = spool

const { eventId, normalizeEvent, appendEvent, readEvents, eventsFile, monthKey } = await import('../lib/events.mjs')
const { logRun } = await import('../lib/runlog.mjs')

test('eventId：dy:<kind>:<target>:<cid|10 分钟桶>', () => {
	assert.equal(eventId({ kind: 'dm', target: '770', cid: 'c1', at: 1 }), 'dy:dm:770:c1')
	const a = eventId({ kind: 'at', target: '770', at: 0 })
	const b = eventId({ kind: 'at', target: '770', at: 599999 })
	assert.equal(a, b, '同一个 10 分钟桶里算一条')
	assert.notEqual(a, eventId({ kind: 'at', target: '770', at: 600000 }))
})

test('normalizeEvent：补 id / day / result 默认值', () => {
	const e = normalizeEvent({ kind: 'publish', target: { aweme: '1' }, at: Date.UTC(2026, 10, 11, 3) }, 0)
	assert.match(e.id, /^dy:publish:1:/)
	assert.equal(e.day, '2026-11-11', 'day 按本地日历日')
	assert.deepEqual(e.result, { ok: true, stage: '', error: '', took: 0, verified: false })
})

test('appendEvent：主账按月分文件，spool 同步一行', () => {
	const row = appendEvent({ kind: 'scan', target: { nick: 'x' }, result: { ok: true, took: 12 } })
	assert.ok(row && row.id)
	const f = eventsFile()
	assert.match(f, /events-\d{4}-\d{2}\.jsonl$/)
	assert.ok(existsSync(f))
	assert.ok(existsSync(spool))
	const lines = readFileSync(f, 'utf8').trim().split('\n')
	assert.equal(lines.length, 1)
	assert.equal(JSON.parse(lines[0]).id, row.id)
	assert.equal(readFileSync(spool, 'utf8').trim().split('\n').length, 1)
})

test('readEvents：尾部读、新的在后、坏行跳过', () => {
	for (let i = 0; i < 5; i += 1) appendEvent({ kind: 'dm', target: { aweme: String(i) } })
	const last2 = readEvents(2)
	assert.equal(last2.length, 2)
	assert.equal(last2[1].target.aweme, '4', '最后一条是最新的')
})

test('logRun 会同时进事件账，stage 决定 kind', () => {
	const before = readEvents(200).length
	logRun({ kind: 'tellOwner', target: '770', ok: false, stage: 'dm-card-only', error: '会话没打开' })
	const rows = readEvents(200)
	assert.equal(rows.length, before + 1)
	const e = rows[rows.length - 1]
	assert.equal(e.kind, 'dm')
	assert.equal(e.result.ok, false)
	assert.equal(e.result.stage, 'dm-card-only')
	assert.equal(e.ref.from, 'runlog')
})

test('monthKey 用本地时间，不进位到 UTC 的年月', () => {
	assert.equal(monthKey(new Date(2026, 0, 1)), '2026-01')
	assert.equal(monthKey(new Date(2026, 11, 31)), '2026-12')
})
