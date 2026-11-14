/**
 * tests/settings.test.mjs —— 机器人设置：脏数据不许进、默认值不许改行为
 * ============================================================================
 * 两个必须钉住的点：
 *   ① normalize 对任何垃圾输入都要给出**可用**的值（面板和 CLI 都读它）
 *   ② DEFAULTS 必须等于"今天的行为"（装了不填 = 什么都不变）
 * ============================================================================
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalize, DEFAULTS, settingsEnv, writeSettings, readSettings } from '../lib/settings.mjs'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('空输入 → 全默认（等于不改行为）', () => {
	assert.deepEqual(normalize(undefined), DEFAULTS)
	assert.deepEqual(normalize(null), DEFAULTS)
	assert.deepEqual(normalize({}), DEFAULTS)
})

test('垃圾类型不会崩，全部兜回默认', () => {
	const s = normalize({ minSec: 'abc', maxSec: [], scanPerRound: {}, scanGap: NaN, replyStyle: 123 })
	assert.equal(s.minSec, DEFAULTS.minSec)
	assert.equal(s.maxSec, DEFAULTS.maxSec)
	assert.equal(s.scanPerRound, DEFAULTS.scanPerRound)
	assert.equal(s.scanGap, DEFAULTS.scanGap)
	assert.equal(s.replyStyle, DEFAULTS.replyStyle)
})

test('数字会被夹到合法区间，不会出现 999 轮', () => {
	assert.equal(normalize({ scanPerRound: 999 }).scanPerRound, 50)
	assert.equal(normalize({ scanPerRound: -5 }).scanPerRound, 1)
	assert.equal(normalize({ scanGap: 999 }).scanGap, 60)
	assert.equal(normalize({ replyMaxPerRound: 99 }).replyMaxPerRound, 5)
})

test('时间段只接受 HH:MM，写错了当没填', () => {
	assert.equal(normalize({ quietFrom: '23:00', quietTo: '07:30' }).quietFrom, '23:00')
	assert.equal(normalize({ quietFrom: '25:00' }).quietFrom, '')
	assert.equal(normalize({ quietTo: '7:5' }).quietTo, '')
	assert.equal(normalize({ quietFrom: 'abc' }).quietFrom, '')
})

test('关键词收成一行，多余空白压掉（CLI 是逗号分隔的）', () => {
	assert.equal(normalize({ keywords: '  猫   狗  ' }).keywords, '猫 狗')
})

/* 2026-11-14 审查 D：面板上「静音时段不叫你」能点、能亮，但 normalize 的白名单里没有它，
 * 每次保存都被丢掉 —— index.js 永远读到 undefined，等于开关是装饰品。 */
test('notifyQuiet 必须真的落盘（面板上那个开关不许是装饰品）', () => {
	assert.equal(DEFAULTS.notifyQuiet, false, '默认不额外静音，保持老行为')
	assert.equal(normalize({ notifyQuiet: true }).notifyQuiet, true)
	assert.equal(normalize({ notifyQuiet: false }).notifyQuiet, false)
	assert.equal(normalize({ notifyQuiet: 'yes' }).notifyQuiet, false, '非布尔值不能当成开')
	assert.equal(normalize({}).notifyQuiet, false)
})

test('templates：空数组回默认，超长截断，非数组忽略', () => {
	assert.deepEqual(normalize({ templates: [] }).templates, DEFAULTS.templates)
	assert.equal(normalize({ templates: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] }).templates.length, 8)
	assert.deepEqual(normalize({ templates: '不是数组' }).templates, DEFAULTS.templates)
})

test('env 映射：设置真的会变成 CLI 认的环境变量', () => {
	const e = settingsEnv(normalize({
		keywords: '猫', blockKeywords: '广告', minSec: 8, maxSec: 120, minDigg: 50, scanPerRound: 9, scanGap: 7, replyMaxPerRound: 3,
	}))
	assert.equal(e.DOUYIN_STUDIO_KEYWORDS, '猫')
	assert.equal(e.DOUYIN_STUDIO_BLOCKWORDS, '广告')
	assert.equal(e.DOUYIN_STUDIO_FEED_MIN_SEC, '8')
	assert.equal(e.DOUYIN_STUDIO_FEED_MAX_SEC, '120')
	assert.equal(e.DOUYIN_STUDIO_FEED_MIN_DIGG, '50')
	assert.equal(e.DOUYIN_STUDIO_FEED_COUNT, '9')
	assert.equal(e.DOUYIN_STUDIO_FEED_GAP, '7')
	assert.equal(e.DOUYIN_STUDIO_REPLY_MAX, '3')
})

test('静音时段：只填一个 = 不生效（半个时段没法判断）', () => {
	assert.equal(settingsEnv(normalize({ quietFrom: '23:00' })).DOUYIN_STUDIO_QUIET_FROM, undefined)
	assert.equal(settingsEnv(normalize({ quietFrom: '23:00', quietTo: '07:00' })).DOUYIN_STUDIO_QUIET_FROM, '23:00')
})

test('写入是合并式的：只改一个开关不会把别的清空', () => {
	const home = mkdtempSync(join(tmpdir(), 'dys-set-'))
	process.env.DOUYIN_STUDIO_HOME = home
	writeSettings({ keywords: '猫', scanPerRound: 20 })
	const r = writeSettings({ minDigg: 88 })
	assert.equal(r.ok, true)
	const cur = readSettings()
	assert.equal(cur.keywords, '猫', '关键词被清空了')
	assert.equal(cur.scanPerRound, 20, '每轮条数被清空了')
	assert.equal(cur.minDigg, 88)
	delete process.env.DOUYIN_STUDIO_HOME
})

/* ── 自主执行的开关（2026-11-03） ───────────────────────────────────────
 * 这几个开关的代价最大：开错了它会自己发消息。所以布尔解析必须严格，
 * 不能出现「字符串 'false' 被当成 true」这种反向事故。 */

test('自主开关默认全关 —— 装了不点，它不许自己动', () => {
	const d = normalize({})
	assert.equal(d.autoDm, false)
	assert.equal(d.autoComment, false)
	assert.equal(d.autoPublish, false)
	assert.equal(d.autoReport, false)
})

test("布尔只认 true/false：字符串 'false' 绝不能变成开着", () => {
	assert.equal(normalize({ autoDm: 'false' }).autoDm, false)
	assert.equal(normalize({ autoDm: '0' }).autoDm, false)
	assert.equal(normalize({ autoDm: true }).autoDm, true)
	assert.equal(normalize({ autoDm: 'true' }).autoDm, true)
	assert.equal(normalize({ autoDm: 1 }).autoDm, true)
	assert.equal(normalize({ autoDm: '随便' }).autoDm, false)
	assert.equal(normalize({ autoDm: [] }).autoDm, false)
})

test('发布节奏被夹在 0–5 条/天，模式只认 draft|now', () => {
	assert.equal(normalize({ publishPerDay: 99 }).publishPerDay, 5)
	assert.equal(normalize({ publishPerDay: -1 }).publishPerDay, 0)
	assert.equal(normalize({ publishMode: 'now' }).publishMode, 'now')
	assert.equal(normalize({ publishMode: '直接发' }).publishMode, 'draft')
	assert.equal(normalize({ publishWho: 'xxx' }).publishWho, 'private')
	assert.equal(DEFAULTS.publishWho, 'private', '自主发布默认不公开')
})

test('自主开关默认全关，脏值不会把 @ 回复打开', () => {
	for (const k of ['autoDm', 'autoComment', 'autoAt', 'autoPublish', 'autoReport']) {
		assert.equal(DEFAULTS[k], false, k + ' 默认必须是关的')
	}
	assert.equal(normalize({ autoAt: 'false' }).autoAt, false, '字符串 false 不能变 true')
	assert.equal(normalize({ autoAt: 1 }).autoAt, true)
})

test('报平安时间写错就回默认，不会变成「现在立刻发」', () => {
	assert.equal(normalize({ reportAt: '9:00' }).reportAt, DEFAULTS.reportAt)
	assert.equal(normalize({ reportAt: '' }).reportAt, DEFAULTS.reportAt)
	assert.equal(normalize({ reportAt: '07:05' }).reportAt, '07:05')
})

test('每轮回几条被夹在 1–5（再大就不是「顺手回一句」了）', () => {
	assert.equal(normalize({ replyMaxPerRound: 99 }).replyMaxPerRound, 5)
	assert.equal(normalize({ replyMaxPerRound: 0 }).replyMaxPerRound, 1)
})
