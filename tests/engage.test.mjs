/**
 * tests/engage.test.mjs —— 主动互动只出清单，不出手
 * ============================================================================
 * 这一版是灰度：允许开的只是"今天会碰谁"的规划。所以测试也钉两件事：
 *   1. 白名单为空 → 一条都不碰；
 *   2. 同一作者一天只碰一次、总额度是硬顶。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DOUYIN_STUDIO_HOME = mkdtempSync(join(tmpdir(), 'dys-engage-'))

const { planEngage, authorsOf, recordEngage, usedToday, waitGap } = await import('../lib/engage.mjs')

const S = { engageOn: true, engageAuthors: '小A, 小B', engagePerDay: 2, engageGapSec: 90 }
const items = [
	{ aweme: '1', author: '小A', desc: 'a1' },
	{ aweme: '2', author: '小A', desc: 'a2' },
	{ aweme: '3', author: '小C', desc: 'c1' },
	{ aweme: '4', author: '小B', desc: 'b1' },
]

test('白名单解析：中英文逗号、空格都认，去重', () => {
	assert.deepEqual(authorsOf({ engageAuthors: 'A，B, A  C' }), ['A', 'B', 'C'])
	assert.deepEqual(authorsOf({}), [])
})

test('关着 / 没白名单：不出清单', () => {
	assert.equal(planEngage({ ...S, engageOn: false }, { items }).stage, 'engage-off')
	assert.equal(planEngage({ ...S, engageAuthors: '' }, { items }).stage, 'no-whitelist')
})

test('只挑白名单，同一个人只出现一次', () => {
	const r = planEngage(S, { items })
	assert.equal(r.ok, true)
	assert.deepEqual(r.list.map((x) => x.author), ['小A', '小B'])
	assert.equal(r.list.length, 2)
})

test('额度是硬顶：已用过一条，只剩一条', () => {
	recordEngage({ author: '小A', aweme: '1' })
	const r = planEngage(S, { items })
	assert.equal(r.list.length, 1)
	assert.equal(r.list[0].author, '小B')
	assert.equal(usedToday().count, 1)
})

test('额度用完 → quota', () => {
	recordEngage({ author: '小B', aweme: '4' })
	assert.equal(planEngage(S, { items }).stage, 'quota')
})

test('间隔：刚记过就要等', () => {
	recordEngage({ author: '小A', aweme: '9' })
	assert.ok(waitGap(new Date(), 90) > 0)
	assert.equal(waitGap(new Date(), 0), 0)
})
