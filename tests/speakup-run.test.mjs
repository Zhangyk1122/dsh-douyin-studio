/**
 * tests/speakup-run.test.mjs —— 主动开口：闸门、状态、以及「不该说的时候别说」
 * ============================================================================
 * 钉三件事：
 *   ① speakupGates 把 HH:MM 的静音段换成小时，**没配就不能变成 0 点**（null 当 0 是全夜静音的反面）；
 *   ② speakup 的状态段必须 survives load()——0.4.5 那次 13 条私信就是这么来的；
 *   ③ 不该说的时候（没开/额度 0/没主人/闸门挡了）一个字节的网络都不发。
 * ============================================================================
 */
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, after } from 'node:test'

const HOME = await mkdtemp(join(tmpdir(), 'dy-speakup-'))
process.env.DOUYIN_STUDIO_HOME = HOME
process.env.DSH_HOME = HOME

const auto = await import('../lib/autopilot.mjs')
const sp = await import('../lib/speakup.mjs')
const { writeSettings } = await import('../lib/settings.mjs')
const STATE = join(HOME, 'autopilot-state.json')

after(async () => { try { await rm(HOME, { recursive: true, force: true }) } catch { /* 已经删了 */ } })

describe('speakupGates：设置 → 闸门', () => {
	it('HH:MM 取小时；没配就是没配，不是 0 点', () => {
		const g = auto.speakupGates({ quietFrom: '12:00', quietTo: '18:00', speakPerDay: 2, speakCoolMin: 90 })
		assert.equal(g.quietFrom, 12)
		assert.equal(g.quietTo, 18)
		assert.equal(g.maxPerDay, 2)
		assert.equal(g.coolMin, 90)
		const none = auto.speakupGates({})
		assert.equal(none.quietFrom, undefined, '没配静音不能退化成 0 点')
		assert.equal(none.quietTo, undefined)
		const junk = auto.speakupGates({ quietFrom: 'abc', quietTo: '25:99' })
		assert.equal(junk.quietFrom, undefined)
		assert.equal(junk.quietTo, undefined)
	})

	it('跨午夜的静音段原样转换（23→8 由 decide 自己解释）', () => {
		const g = auto.speakupGates({ quietFrom: '23:30', quietTo: '08:00' })
		assert.equal(g.quietFrom, 23)
		assert.equal(g.quietTo, 8)
	})
})

describe('speakup 状态段', () => {
	it('load() 认得 speakup 段，坏值兜底成空账', async () => {
		await writeFile(STATE, JSON.stringify({
			speakup: { day: '2026-11-15', count: 2, lastAt: 1760000000000 },
		}), 'utf8')
		const s = auto.readState()
		assert.equal(s.speakup.day, '2026-11-15')
		assert.equal(s.speakup.count, 2)
		assert.equal(s.speakup.lastAt, 1760000000000)
	})

	it('没有 speakup 段 → 空账，不抛', async () => {
		await rm(STATE, { force: true })
		const s = auto.readState()
		assert.deepEqual(s.speakup, { day: '', count: 0, lastAt: 0 })
	})

	it('speakup 段被写坏 → 读出来仍是可用形状', async () => {
		await writeFile(STATE, JSON.stringify({ speakup: { day: 5, count: 'x', lastAt: null } }), 'utf8')
		const s = auto.readState()
		assert.equal(s.speakup.count, 0)
		assert.equal(s.speakup.lastAt, 0)
	})
})

describe('不该说的时候，一个字节都不发', () => {
	const at1300 = new Date(2026, 10, 15, 13, 0, 0).getTime()

	it('没开 autoSpeakup → 直接跳过', async () => {
		writeSettings({ autoSpeakup: false, ownerUid: '110149990088' })
		const r = await auto.runSpeakup({})
		assert.equal(r.ok, true)
		assert.match(r.skipped, /没开/)
	})

	it('每天几句设成 0 → 今天闭嘴（0 不是「说一句」）', async () => {
		writeSettings({ autoSpeakup: true, speakPerDay: 0, ownerUid: '110149990088' })
		const r = await auto.runSpeakup({})
		assert.match(r.skipped, /设成 0/)
	})

	it('没填主人 → 明确报错，不猜收件人', async () => {
		writeSettings({ autoSpeakup: true, speakPerDay: 2, ownerUid: '', ownerNick: '' })
		const r = await auto.runSpeakup({})
		assert.equal(r.ok, false)
		assert.match(r.error, /主人/)
	})

	it('静音时段 → 跳过，且说的是哪段', async () => {
		writeSettings({
			autoSpeakup: true, speakPerDay: 2, ownerUid: '110149990088',
			quietFrom: '12:00', quietTo: '18:00',
		})
		const d = sp.decide({ now: at1300, gates: auto.speakupGates({ quietFrom: '12:00', quietTo: '18:00' }) })
		assert.equal(d.ok, false)
		assert.equal(d.reason, 'quiet')
	})

	it('今天说满了 / 刚说过 → 都由头尽失', () => {
		const gates = { maxPerDay: 2, coolMin: 90 }
		assert.equal(sp.decide({ now: at1300, today: 2, gates }).reason, 'quota')
		assert.equal(sp.decide({ now: at1300, lastAt: at1300 - 10 * 60000, gates }).reason, 'cooldown')
	})

	it('有由头才说：心情激动 / 今日打算没做', () => {
		const gates = { maxPerDay: 2, coolMin: 90 }
		const a = sp.decide({ now: at1300, mood: { arousal: 0.7 }, gates })
		assert.equal(a.ok, true)
		assert.equal(a.reason, 'excited')
		const b = sp.decide({ now: at1300, intent: { text: '想跟人说说话', done: false }, gates })
		assert.equal(b.ok, true)
		assert.equal(b.reason, 'intent')
		const c = sp.decide({ now: at1300, intent: { text: '想跟人说说话', done: true }, gates })
		assert.equal(c.ok, false)
		assert.equal(c.reason, 'no-reason')
	})
})
