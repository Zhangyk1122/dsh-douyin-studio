/**
 * tests/selfcheck.test.mjs —— 运行期自检的验收
 * ============================================================================
 * 钉四件事：
 *   ① 时间窗：跨午夜要算对，非法配置当"没设"
 *   ② 每条规则：脏数据能报出来，干净数据一条不报
 *   ③ 拿不准时降级成 warn（假警报会让自检被忽略）
 *   ④ 没有 selfUid 时跳过而不是误报
 * 全部纯函数，不读盘。
 * ============================================================================
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { hhmm2min, inQuiet, localHHMM, authorOf, dayOf, todayKey, check, render } from '../lib/selfcheck.mjs'

const NOW = Date.UTC(2026, 10, 5, 10, 0, 0) // 本地 18:00
const DAY = todayKey(NOW)
const at = (hUTC = 4, min = 0) => new Date(Date.UTC(2026, 10, 5, hUTC, min, 0)).toISOString()

const rep = (o = {}) => ({ at: at(), day: DAY, cid: 'c1', authorUid: 'u1', text: 'x', ...o })
const base = (o = {}) => check({ ledger: { replies: [] }, budget: { day: DAY, entries: [] }, settings: {}, selfUid: 'me', now: NOW, ...o })

test('hhmm2min：合法/非法/空', () => {
	assert.equal(hhmm2min('08:30'), 510)
	assert.equal(hhmm2min('8:05'), 485)
	assert.equal(hhmm2min('24:00'), null)
	assert.equal(hhmm2min('12:70'), null)
	assert.equal(hhmm2min(''), null)
	assert.equal(hhmm2min(undefined), null)
})

test('inQuiet：跨午夜要算对', () => {
	assert.equal(inQuiet('23:10', '22:00', '08:00'), true)
	assert.equal(inQuiet('03:59', '22:00', '08:00'), true)
	assert.equal(inQuiet('08:00', '22:00', '08:00'), false)
	assert.equal(inQuiet('12:00', '22:00', '08:00'), false)
	assert.equal(inQuiet('09:00', '09:00', '18:00'), true)
})

test('localHHMM：东八区换算', () => {
	assert.equal(localHHMM(Date.UTC(2026, 10, 5, 4, 30, 0)), '12:30')
})

test('authorOf：新旧字段都认，空为串', () => {
	assert.equal(authorOf({ authorUid: 'a' }), 'a')
	assert.equal(authorOf({ author: 'b' }), 'b')
	assert.equal(authorOf({}), '')
	assert.equal(authorOf(null), '')
})

test('dayOf：优先用账本里的 day，没有才从 at 推', () => {
	assert.equal(dayOf({ day: '2026-11-03', at: at() }), '2026-11-03')
	assert.equal(dayOf({ at: Date.UTC(2026, 10, 4, 17, 0, 0) }), '2026-11-05')
	assert.equal(dayOf({}), '')
})

test('干净数据：一条都不报', () => {
	const r = base({ ledger: { replies: [rep()] } })
	assert.equal(r.ok, true)
	assert.equal(r.issues.length, 0)
	assert.equal(r.stats.todayReplies, 1)
})

test('没有 selfUid：降级成 warn，不算失败', () => {
	const r = base({ selfUid: '' })
	assert.equal(r.ok, true)
	assert.equal(r.issues[0].code, 'self-uid-unknown')
	assert.equal(r.issues[0].level, 'warn')
})

test('回错到自己：报 error', () => {
	const r = base({ ledger: { replies: [rep({ authorUid: 'me' })] } })
	assert.equal(r.ok, false)
	assert.ok(r.issues.some((i) => i.code === 'reply-to-self'))
})

test('同一条评论回两次：报 error', () => {
	const r = base({ ledger: { replies: [rep({ cid: 'c9' }), rep({ cid: 'c9', at: at(5) })] } })
	assert.ok(r.issues.some((i) => i.code === 'dup-cid' && i.evidence.times === 2))
})

test('同一栋楼回两次：报 error，顶层（root 空）不算', () => {
	const r1 = base({ ledger: { replies: [rep({ root: 'r1' }), rep({ root: 'r1', at: at(5) })] } })
	assert.ok(r1.issues.some((i) => i.code === 'dup-root'))
	const r2 = base({ ledger: { replies: [rep({ root: '' }), rep({ root: '', at: at(5) })] } })
	assert.equal(r2.issues.some((i) => i.code === 'dup-root'), false)
})

test('同一个人一天超 2 条：报 error', () => {
	const rs = [rep({ cid: 'a' }), rep({ cid: 'b', at: at(5) }), rep({ cid: 'c', at: at(6) })]
	const r = base({ ledger: { replies: rs } })
	assert.ok(r.issues.some((i) => i.code === 'over-author' && i.evidence.authorUid === 'u1'))
})

test('perAuthorPerDay 可调：设成 3 就不报', () => {
	const rs = [rep({ cid: 'a' }), rep({ cid: 'b', at: at(5) }), rep({ cid: 'c', at: at(6) })]
	const r = base({ ledger: { replies: rs }, settings: { perAuthorPerDay: 3 } })
	assert.equal(r.issues.some((i) => i.code === 'over-author'), false)
})

test('静音时段发过东西：报 error', () => {
	const r = base({
		budget: { day: DAY, entries: [{ ch: 'dm', at: Date.UTC(2026, 10, 5, 15, 10, 0) }] }, // 本地 23:10
		settings: { quietFrom: '22:00', quietTo: '08:00' },
	})
	assert.ok(r.issues.some((i) => i.code === 'quiet-hours'))
})

test('未来时间的记录：报 error', () => {
	const r = base({ ledger: { replies: [rep({ at: new Date(NOW + 3600000).toISOString() })] } })
	assert.ok(r.issues.some((i) => i.code === 'future-record'))
})

test('额度账本跨天没重置：报 error', () => {
	const r = base({ budget: { day: '2026-11-04', entries: [{ ch: 'dm', at: at(4) }] } })
	assert.ok(r.issues.some((i) => i.code === 'budget-day-stale'))
})

test('超发：只在给了 limits 时才判', () => {
	const entries = [{ ch: 'dm', at: at(4) }, { ch: 'dm', at: at(5) }]
	assert.equal(base({ budget: { day: DAY, entries } }).issues.some((i) => i.code === 'budget-over'), false)
	const r = base({ budget: { day: DAY, entries }, limits: { dm: 1 } })
	assert.ok(r.issues.some((i) => i.code === 'budget-over' && i.evidence.used === 2))
})

test('账本作者为空：只 warn，不判失败', () => {
	const r = base({ ledger: { replies: [rep({ authorUid: '' })] } })
	assert.equal(r.ok, true)
	assert.ok(r.issues.some((i) => i.code === 'author-uid-missing' && i.level === 'warn'))
})

test('开着轮次但每轮 0 条：warn', () => {
	const r = base({ settings: { scanRounds: 3, scanPerRound: 0 } })
	assert.ok(r.issues.some((i) => i.code === 'scan-round-empty'))
})

test('值班安静：开着自动回却 9 小时没出口 → warn', () => {
	const r = base({
		settings: { autoDm: true },
		budget: { day: DAY, entries: [{ ch: 'dm', at: Date.UTC(2026, 10, 5, 1, 0, 0) }] }, // 本地 09:00，距今 9h
	})
	const hit = r.issues.find((i) => i.code === 'duty-silent')
	assert.ok(hit)
	assert.equal(hit.level, 'warn')
	assert.equal(r.ok, true)
})

test('值班安静：知道收件箱有积压就升级成 error', () => {
	const r = base({
		settings: { autoDm: true },
		budget: { day: DAY, entries: [{ ch: 'dm', at: Date.UTC(2026, 10, 5, 1, 0, 0) }] },
		inboxPending: 3,
	})
	const hit = r.issues.find((i) => i.code === 'duty-silent')
	assert.equal(hit.level, 'error')
	assert.equal(r.ok, false)
})

test('值班安静：刚发过就不报', () => {
	const r = base({
		settings: { autoDm: true },
		budget: { day: DAY, entries: [{ ch: 'dm', at: Date.UTC(2026, 10, 5, 9, 0, 0) }] }, // 距今 1h
	})
	assert.equal(r.issues.some((i) => i.code === 'duty-silent'), false)
})

test('值班安静：自动回全关时不报（只读模式）', () => {
	const r = base({
		settings: { autoDm: false, autoComment: false },
		budget: { day: DAY, entries: [{ ch: 'dm', at: Date.UTC(2026, 10, 5, 1, 0, 0) }] },
	})
	assert.equal(r.issues.some((i) => i.code === 'duty-silent'), false)
})

test('账本-额度差：额度记了 2 次、账本 0 条 → error', () => {
	const r = base({
		ledger: { replies: [] },
		budget: { day: DAY, entries: [{ ch: 'comment', at: at(4) }, { ch: 'at', at: at(5) }] },
	})
	const hit = r.issues.find((i) => i.code === 'ledger-gap')
	assert.ok(hit)
	assert.equal(hit.level, 'error')
	assert.equal(hit.evidence.budget, 2)
	assert.equal(hit.evidence.ledger, 0)
})

test('账本-额度差：私下/发布渠道不参与比对', () => {
	const r = base({
		ledger: { replies: [] },
		budget: { day: DAY, entries: [{ ch: 'dm', at: at(4) }, { ch: 'publish', at: at(5) }] },
	})
	assert.equal(r.issues.some((i) => i.code === 'ledger-gap'), false)
})

test('账本-额度差：两边一样就不报', () => {
	const r = base({
		ledger: { replies: [rep({ cid: 'c1' })] },
		budget: { day: DAY, entries: [{ ch: 'comment', at: at(4) }] },
	})
	assert.equal(r.issues.some((i) => i.code === 'ledger-gap'), false)
})

test('render：通过/不通过都有一行表头', () => {
	assert.match(render(base()), /^✓ 自检通过/)
	assert.match(render(base({ ledger: { replies: [rep({ authorUid: 'me' })] } })), /^✗ 自检不通过/)
})
