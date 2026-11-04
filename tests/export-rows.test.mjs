/**
 * tests/export-rows.test.mjs —— 「哪种记录该有哪几列」的验收
 * ============================================================================
 * export.mjs 管 CSV 语法，这里管业务语义：列对不对、值翻成人话没有、文件名能不能用。
 * 两个分开测的好处是：改列定义不用动转义测试，改转义不会碰业务。
 * ============================================================================
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildExport, EXPORT_KINDS } from '../lib/export-rows.mjs'

const noBom = (s) => s.replace(/^\uFEFF/, '')
const rowsOf = (csv) => noBom(csv).trimEnd().split('\r\n')

test('ledger：四列固定，值原样带走', () => {
	const r = buildExport('ledger', [
		{ at: '2026-11-02T12:00:00.000Z', author: '狂三酱', text: '有空看下私信', reason: '他问视频要不要插件' },
	], { day: '20261103' })
	const lines = rowsOf(r.csv)
	assert.equal(lines[0], '时间,对象,回了什么,为什么回')
	assert.equal(r.count, 1)
	assert.ok(lines[1].includes('狂三酱'))
	assert.ok(lines[1].includes('有空看下私信'))
	assert.ok(lines[1].includes('他问视频要不要插件'))
})

test('ledger：author 与 who 都认（账本用前者，路由用后者）', () => {
	const a = rowsOf(buildExport('ledger', [{ author: '来自账本' }]).csv)[1]
	const b = rowsOf(buildExport('ledger', [{ who: '来自路由' }]).csv)[1]
	assert.ok(a.includes('来自账本'))
	assert.ok(b.includes('来自路由'))
	assert.ok(!a.includes('undefined'), '缺字段时不能写出 undefined')
})

test('ledger：时间转成本地 YYYY-MM-DD HH:mm（Excel 认这个）', () => {
	const r = buildExport('ledger', [{ at: '2026-11-02T12:00:00.000Z', who: 'a', reason: '' }])
	const cell = rowsOf(r.csv)[1].split(',')[0]
	assert.match(cell, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, '实际是：' + cell)
})

test('ledger：时间坏了不崩，照原样截一段', () => {
	const r = buildExport('ledger', [{ at: '不是时间', who: 'a', reason: '' }])
	assert.ok(rowsOf(r.csv)[1].startsWith('不是时间'))
})

test('ledger：空数组 → 只有表头，count 为 0', () => {
	const r = buildExport('ledger', [], { day: '20261103' })
	assert.equal(r.count, 0)
	assert.deepEqual(rowsOf(r.csv), ['时间,对象,回了什么,为什么回'])
})

test('publishes：六列，可见性翻成中文', () => {
	const r = buildExport('publishes', [
		{ at: '2026-11-02T12:00:00Z', kind: 'image', title: 'T', who: 'private', published: false, draft: false },
	])
	const lines = rowsOf(r.csv)
	assert.equal(lines[0], '时间,类型,标题,可见性,状态,音乐')
	assert.ok(lines[1].includes('图文'))
	assert.ok(lines[1].includes('仅自己可见'))
	assert.ok(lines[1].includes('摆好了没点'))
})

test('publishes：三种可见性都翻对', () => {
	const mk = (who) => rowsOf(buildExport('publishes', [{ who, title: 'x' }]).csv)[1]
	assert.ok(mk('public').includes('公开'))
	assert.ok(mk('friend').includes('好友可见'))
	assert.ok(mk('private').includes('仅自己可见'))
	// 不认识的取值原样保留，别吞掉
	assert.ok(mk('weird').includes('weird'))
})

test('publishes：三种状态互斥，已发布优先', () => {
	const st = (o) => rowsOf(buildExport('publishes', [o]).csv)[1]
	assert.ok(st({ published: true, draft: false }).includes('已发布'))
	assert.ok(st({ published: false, draft: true }).includes('草稿'))
	assert.ok(st({ published: false, draft: false }).includes('摆好了没点'))
	// 真发出去又标草稿这种矛盾数据：以已发布为准，别写个假状态
	assert.ok(st({ published: true, draft: true }).includes('已发布'))
})

test('文件名带日期，且只认 8 位数字的 day', () => {
	assert.equal(buildExport('ledger', [], { day: '20261103' }).filename, '回评记录-20261103.csv')
	assert.notEqual(buildExport('ledger', [], { day: '../evil' }).filename.includes('/'), true)
	assert.match(buildExport('ledger', []).filename, /^回评记录-\d{8}\.csv$/)
})

test('值里的逗号 / 引号仍然走 export.mjs 的转义（两层没打架）', () => {
	const r = buildExport('ledger', [{ at: '', who: 'A,B', reason: '他说"卡住了"' }])
	const line = rowsOf(r.csv)[1]
	assert.ok(line.includes('"A,B"'))
	assert.ok(line.includes('""卡住了""'))
})

test('不认识的 what → RangeError（防止 URL 直接变文件名）', () => {
	assert.throws(() => buildExport('../../../etc/passwd', []), RangeError)
	assert.throws(() => buildExport('', []), RangeError)
})

test('rows 不是数组 → TypeError', () => {
	assert.throws(() => buildExport('ledger', null), TypeError)
})

test('EXPORT_KINDS 是白名单，只有已知两种', () => {
	assert.deepEqual(EXPORT_KINDS.slice().sort(), ['ledger', 'publishes'])
})
