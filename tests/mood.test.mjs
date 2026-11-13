import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'dys-mood-'))
process.env.DOUYIN_STUDIO_HOME = home

const M = await import('../lib/mood.mjs')

const HOUR = 3600 * 1000
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps

test('默认值落在基线上', () => {
	const m = M.loadMood(Date.now())
	assert.ok(near(m.valence, M.BASELINE.valence))
	assert.ok(near(m.energy, M.BASELINE.energy))
})

test('事件推一下，幅度小且方向对', () => {
	const t0 = Date.now()
	const base = M.loadMood(t0)
	const up = M.bump(base, 'at', { at: t0 })
	assert.ok(up.valence > base.valence, '被 @ 心情应当变好')
	assert.ok(up.valence - base.valence < 0.2, '别一条消息就翻天')
	assert.ok(up.energy <= base.energy, '兴奋要花力气')
})

test('未知事件不抛、原样返回', () => {
	const t0 = Date.now()
	const base = M.loadMood(t0)
	const same = M.bump(base, 'not-a-kind', { at: t0 })
	assert.equal(same.valence, base.valence)
})

test('六小时后心情回到一半', () => {
	const t0 = Date.now()
	const high = M.bump(M.loadMood(t0), 'at', { at: t0 })
	const later = M.decay(high, t0 + 6 * HOUR)
	assert.ok(later.valence < high.valence)
	assert.ok(near(later.valence, M.BASELINE.valence + (high.valence - M.BASELINE.valence) / 2, 0.03))
})

test('放着不管会回基线，不会漂出界', () => {
	const t0 = Date.now()
	const high = M.bump(M.loadMood(t0), 'at', { at: t0 })
	const far = M.decay(high, t0 + 400 * HOUR)
	assert.ok(near(far.valence, M.BASELINE.valence, 0.01))
	assert.ok(far.energy >= 0 && far.energy <= 1)
})

test('时间倒流不放大状态', () => {
	const t0 = Date.now()
	const s = M.bump(M.loadMood(t0), 'at', { at: t0 })
	const back = M.decay(s, t0 - 5 * HOUR)
	assert.equal(back.valence, s.valence)
})

test('note() 落盘，再读回来一致', () => {
	const t0 = Date.now()
	M.saveMood(M.loadMood(t0))
	const a = M.note('reply', { at: t0 })
	const b = M.loadMood(t0)
	assert.equal(a.rev, b.rev)
	assert.ok(near(a.valence, b.valence, 0.001))
	assert.equal(b.last.kind, 'reply')
})

test('moodLine 给的是状态，不是文案', () => {
	const t0 = Date.now()
	const line = M.moodLine(M.bump(M.loadMood(t0), 'rest', { at: t0 }), t0)
	assert.match(line, /^你现在/)
	assert.ok(line.length < 40)
})

test('snapshot 只发两位小数', () => {
	const s = M.moodSnapshot()
	for (const k of ['valence', 'arousal', 'energy', 'affinity']) {
		assert.equal(Number(s[k]), Math.round(Number(s[k]) * 100) / 100)
	}
	assert.match(s.at, /^\d{4}-\d{2}-\d{2}T/)
})

test.after(() => rmSync(home, { recursive: true, force: true }))
