/**
 * tests/export.test.mjs —— CSV 导出的验收（A2）
 * ============================================================================
 * 先写这份测试、再写实现。验收标准就是下面这些输入输出对，
 * 不存在「看起来差不多对了」这种中间态。
 *
 * 判据清单（照 HANDOFF.md A2）：
 *   逗号 / 双引号 / 换行 / 中文 / BOM，再加两个容易漏的：
 *   · CRLF —— Windows 上 Excel 打开才不乱
 *   · 不许偷偷 trim —— 前后空格是用户数据，丢空格就是丢数据
 * ============================================================================
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { toCsv } from '../lib/export.mjs'

const COLS = [
	{ key: 'who', label: '昵称' },
	{ key: 'note', label: '内容' },
]
const flat = (rows) => rows.map((r) => ({ who: r[0], note: r[1] }))
const noBom = (s) => s.replace(/^\uFEFF/, '')
const body = (rows, cols = COLS, opts = {}) => noBom(toCsv(rows, cols, opts))

test('基本导出：表头用 label，行序不变', () => {
	const out = body(flat([['狂三酱', '在吗'], ['一点雨', '怎么装']]))
	assert.equal(out, '昵称,内容\r\n狂三酱,在吗\r\n一点雨,怎么装\r\n')
})

test('默认带 UTF-8 BOM（否则中文在 Excel 里是乱码）', () => {
	assert.equal(toCsv(flat([['狂三酱', '在吗']]), COLS)[0], '\uFEFF')
})

test('bom:false 可以关掉', () => {
	assert.notEqual(toCsv(flat([['a', 'b']]), COLS, { bom: false })[0], '\uFEFF')
})

test('行尾统一 CRLF（不是 LF）', () => {
	const out = body(flat([['a', 'b']]))
	assert.ok(out.includes('\r\n'))
	assert.ok(!/(?<!\r)\n/.test(out), '出现了单独的 LF')
})

test('字段含逗号 → 整字段加双引号', () => {
	assert.equal(body(flat([['a', '有,逗号']])), '昵称,内容\r\na,"有,逗号"\r\n')
})

test('字段含双引号 → 双写转义，且整字段加引号', () => {
	assert.equal(body(flat([['a', '他说"嗯"']])), '昵称,内容\r\na,"他说""嗯"""\r\n')
})

test('字段含换行 → 加引号且**原样保留**换行', () => {
	const out = body(flat([['a', '第一行\n第二行']]))
	assert.equal(out, '昵称,内容\r\na,"第一行\n第二行"\r\n')
	// 换行被吃掉了就会变成一行，那样导入 Excel 是错的
	assert.ok(out.includes('第一行\n第二行'))
})

test('字段含 CR+LF → 同样加引号', () => {
	assert.equal(body(flat([['a', 'x\r\ny']])), '昵称,内容\r\na,"x\r\ny"\r\n')
})

test('中文原样输出，不被转义、不被问号替换', () => {
	const out = body(flat([['小肥鱼（陈汐）', '今天回了 3 条']]))
	assert.ok(out.includes('小肥鱼（陈汐）'))
	assert.ok(out.includes('今天回了 3 条'))
	assert.ok(!out.includes('???'))
})

test('不许偷偷 trim：前后空格是用户数据', () => {
	const out = body(flat([['a', '  前后都有空格  ']]))
	assert.ok(out.includes('  前后都有空格  '), '空格被吃掉了')
})

test('null / undefined → 空字段，不是 "null" 字符串', () => {
	const out = body([{ who: 'a', note: null }, { who: 'b' }])
	assert.equal(out, '昵称,内容\r\na,\r\nb,\r\n')
})

test('数字与布尔 → 字符串化；0 和 false 不能被当成空', () => {
	const out = body([{ who: 0, note: false }, { who: 12.5, note: true }])
	assert.equal(out, '昵称,内容\r\n0,false\r\n12.5,true\r\n')
})

test('NaN / Infinity → 空字段（这种值不该写进表格里骗人）', () => {
	assert.equal(body([{ who: NaN, note: Infinity }]), '昵称,内容\r\n,\r\n')
})

test('Date → ISO 字符串', () => {
	const d = new Date('2026-11-02T23:00:00.000Z')
	assert.equal(body([{ who: d, note: 'x' }]), '昵称,内容\r\n' + d.toISOString() + ',x\r\n')
})

test('对象 / 数组 → JSON 化，并因含逗号被引号包住', () => {
	const out = body([{ who: { a: 1, b: 2 }, note: [1, 2] }])
	assert.ok(out.includes('"{""a"":1,""b"":2}"'), '对象没被正确转义：' + out)
	assert.ok(out.includes('"[1,2]"'), '数组没被正确转义：' + out)
})

test('空 rows → 只剩表头', () => {
	assert.equal(body([]), '昵称,内容\r\n')
})

test('columns 可以用字符串简写（key 与 label 同名）', () => {
	const out = noBom(toCsv([{ a: 1, b: 2 }], ['a', 'b']))
	assert.equal(out, 'a,b\r\n1,2\r\n')
})

test('自定义分隔符（TSV）→ 用分隔符判是否加引号', () => {
	const out = noBom(toCsv([{ a: 'x,y', b: 'p\tq' }], ['a', 'b'], { separator: '\t', bom: false }))
	assert.equal(out, 'a\tb\r\nx,y\t"p\tq"\r\n')
})

test('rows 不是数组 → 抛 TypeError（宁可报错也别输出一份假表格）', () => {
	assert.throws(() => toCsv(null, COLS), TypeError)
	assert.throws(() => toCsv({ a: 1 }, COLS), TypeError)
})

test('往返一致：导出去再按规则读回来，字段数不变', () => {
	const rows = flat([['a,逗号', '带"引号"'], ['多行\n换行', '普通']])
	const out = noBom(toCsv(rows, COLS, { bom: false }))
	const lines = out.trimEnd().split('\r\n')
	assert.equal(lines.length, 3, '表头 + 2 行（含换行的那行被引号保住了）')
})
