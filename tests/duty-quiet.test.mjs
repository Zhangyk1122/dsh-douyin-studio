/**
 * tests/duty-quiet.test.mjs —— 值班必须认静音段
 * ============================================================================
 * 2026-11-13 实证过一条 12:00 的自动回评落在 quietFrom 12:00–18:00 里：
 * 设置页把 quietFrom/quietTo 存下来了，`lib/duty.mjs` 里却一次都没读过（grep `quiet` = 0）。
 * 这条用例钉的就是「读了没有」——不是「逻辑对不对」，那由 inWindow 自己的用例管。
 *
 * 静音检查在 collect() 之前，所以跳过的轮次一次网络请求都不会发。
 * ============================================================================
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* duty.mjs 的 DIR / settings 的 homeDir 都在**模块加载时**算，
 * 所以临时目录必须在 import 之前设好，import 之后改环境变量是白改。 */
const HOME = mkdtempSync(join(tmpdir(), 'dy-duty-quiet-'))
process.env.DSH_HOME = HOME
process.env.DOUYIN_STUDIO_HOME = join(HOME, 'douyin-studio')

const { writeSettings, readSettings, windowWarnings } = await import('../lib/settings.mjs')
const duty = await import('../lib/duty.mjs')

test('静音时段内，自动轮直接跳过（一次网络都不发）', async () => {
	writeSettings({ quietFrom: '00:00', quietTo: '23:59', autoReply: true })
	const r = await duty.run({ autoReply: true })
	assert.equal(r.ok, true)
	assert.match(String(r.skipped || ''), /静音时段/)
	/* 跳过的轮次不该有任何扫描结果 —— 证明它真的在 collect 之前就返回了 */
	assert.equal(Number(r.scanned) || 0, 0)
})

test('静音段和低峰窗口重叠时给一句话（只提示，不改数据）', () => {
	writeSettings({ quietFrom: '12:00', quietTo: '18:00', activeFrom: '12:00', activeTo: '14:00', active2From: '', active2To: '' })
	const s = readSettings()
	assert.deepEqual(s.quietFrom, '12:00')          // 数据没被改
	const w = windowWarnings(s)
	assert.equal(w.length, 1)
	assert.match(w[0], /12:00–18:00/)
	assert.match(w[0], /静音优先/)
	/* 读出来的设置里应该带这句提醒，面板才有得显示 */
	assert.equal(readSettings().warnings.length, 1)
})

test('不重叠就不吵人', () => {
	writeSettings({ quietFrom: '00:00', quietTo: '07:00', activeFrom: '12:00', activeTo: '14:00', active2From: '', active2To: '' })
	assert.deepEqual(windowWarnings(readSettings()), [])
	assert.equal(readSettings().warnings, undefined)
})
