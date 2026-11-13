import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'dys-ep-'))
process.env.DOUYIN_STUDIO_HOME = home

const E = await import('../lib/episodes.mjs')

const NOW = new Date(2026, 11, 13, 20).getTime()
const ev = (i, kind, extra = {}) => ({
	id: `dy:${kind}:x:${i}`,
	kind,
	at: NOW - i * 3600e3,
	ok: true,
	...extra,
})

test('周一算一周的开始', () => {
	assert.equal(E.weekKey(new Date(2026, 11, 13, 10).getTime()), '2026-12-07')
	assert.equal(E.weekKey(new Date(2026, 11, 14, 10).getTime()), '2026-12-14')
})

test('产出那条把次数说对', () => {
	const ep = E.buildEpisode({
		events: [ev(1, 'comment'), ev(2, 'comment'), ev(3, 'at'), ev(4, 'scan')],
		week: 'w',
		now: NOW,
	})
	const line = ep.lines.map((x) => x.text).join(' | ')
	assert.match(line, /回了评论 2 次/)
	assert.match(line, /@ 了哥哥 1 次/)
	assert.ok(!/刷了一轮/.test(ep.lines[0].text), '刷一轮不该当成产出')
})

test('每条情节都带证据 id', () => {
	const ep = E.buildEpisode({ events: [ev(1, 'comment'), ev(2, 'dm')], week: 'w', now: NOW })
	for (const l of ep.lines) {
		assert.ok(Array.isArray(l.refs) && l.refs.length > 0, `缺证据：${l.text}`)
		for (const r of l.refs) assert.match(r, /^dy:/)
	}
})

test('同一个人碰过两次才提他', () => {
	const one = E.buildEpisode({
		events: [ev(1, 'comment', { target: { nick: '阿猫' } })],
		week: 'w',
		now: NOW,
	})
	assert.ok(!one.lines.some((l) => l.text.includes('阿猫')))
	const two = E.buildEpisode({
		events: [ev(1, 'comment', { target: { nick: '阿猫' } }), ev(2, 'comment', { target: { nick: '阿猫' } })],
		week: 'w',
		now: NOW,
	})
	assert.ok(two.lines.some((l) => l.text.includes('阿猫')))
})

test('有失败就写失败，不装作一切正常', () => {
	const ep = E.buildEpisode({
		events: [ev(1, 'dm', { result: { ok: false, error: '会话没打开（等不到输入框）' } })],
		week: 'w',
		now: NOW,
	})
	assert.ok(ep.lines.some((l) => /没成/.test(l.text)))
})

test('最多三条', () => {
	const events = []
	for (let i = 1; i <= 20; i++) events.push(ev(i, ['comment', 'dm', 'at'][i % 3], { target: { nick: 'n' + (i % 4) } }))
	const ep = E.buildEpisode({ events, week: 'w', now: NOW })
	assert.ok(ep.lines.length <= 3)
})

test('同一周只生成一次，落盘后原样读回', () => {
	const a = E.weeklyEpisode({ now: NOW, events: [ev(1, 'comment')] })
	const b = E.weeklyEpisode({ now: NOW + 3600e3, events: [ev(2, 'dm')] })
	assert.deepEqual(b.lines, a.lines)
	assert.equal(b.week, a.week)
})

test('没事件时 episodeLine 返回空串，不编', () => {
	rmSync(join(home, 'episodes.json'), { force: true })
	assert.equal(E.episodeLine({ now: NOW + 86400000 }), '')
})

test.after(() => rmSync(home, { recursive: true, force: true }))
