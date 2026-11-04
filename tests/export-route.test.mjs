/**
 * tests/export-route.test.mjs —— `/export` 这条路由的验收
 * ============================================================================
 * 这层以前埋在 index.js 的请求处理器里，只能靠"真点一次"来验，于是长期处于
 * 「代码绿但没跑过」的状态。抽成函数之后，下面这些都能在本地一条命令跑完。
 *
 * 注意它不碰 res、不碰文件：读取器是注入的，所以能造任何数据（包括抛异常的那种）。
 * ============================================================================
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { handleExport } from '../lib/export-route.mjs'

const LEDGER = [
	{ at: '2026-11-02T10:00:00.000Z', author: '一点雨', text: '发你了', reason: '他在报错' },
]
const PUBS = {
	rows: [{ at: '2026-11-02T12:00:00Z', kind: 'image', title: 'T', who: 'private', published: true }],
}

const deps = (over = {}) => ({
	recentLedger: () => LEDGER,
	recentPublishes: () => PUBS,
	day: '20261103',
	...over,
})

const noBom = (s) => s.replace(/^\uFEFF/, '')

test('ledger：200 + text/csv + BOM + 四列表头', () => {
	const r = handleExport({ what: 'ledger', ...deps() })
	assert.equal(r.status, 200)
	assert.match(r.headers['content-type'], /text\/csv/)
	assert.equal(r.body[0], '\uFEFF')
	assert.equal(noBom(r.body).split('\r\n')[0], '时间,对象,回了什么,为什么回')
	assert.equal(r.count, 1)
})

test('publishes：六列表头，状态翻译正确', () => {
	const r = handleExport({ what: 'publishes', ...deps() })
	assert.equal(r.status, 200)
	assert.equal(noBom(r.body).split('\r\n')[0], '时间,类型,标题,可见性,状态,音乐')
	assert.ok(noBom(r.body).includes('已发布'))
})

test('不传 what → 默认 ledger', () => {
	const r = handleExport({ ...deps() })
	assert.equal(r.status, 200)
	assert.match(noBom(r.body), /^时间,对象/)
})

test('不支持的 what → 400，且把可选值列出来', () => {
	const r = handleExport({ what: '../../etc/passwd', ...deps() })
	assert.equal(r.status, 400)
	const j = JSON.parse(r.body)
	assert.equal(j.ok, false)
	assert.deepEqual(j.kinds, ['ledger', 'publishes'])
})

test('读取器抛异常 → 500 且标清是哪一层（不冒到宿主）', () => {
	const r = handleExport({
		what: 'ledger',
		...deps({ recentLedger: () => { throw new Error('账本坏了') } }),
	})
	assert.equal(r.status, 500)
	const j = JSON.parse(r.body)
	assert.equal(j.ok, false)
	assert.equal(j.stage, 'read')
	assert.match(j.error, /账本坏了/)
})

test('下载头：带 RFC 5987 文件名 + 老浏览器兜底名', () => {
	const r = handleExport({ what: 'ledger', ...deps() })
	const cd = r.headers['content-disposition']
	assert.match(cd, /filename="export\.csv"/)
	assert.match(cd, /filename\*=UTF-8''/)
	// 中文必须被百分号编码，否则某些浏览器会给出乱码文件名
	assert.ok(!/filename\*=UTF-8''[^%;]*[\u4e00-\u9fa5]/.test(cd), '中文没编码：' + cd)
	assert.equal(decodeURIComponent(cd.split("UTF-8''")[1]), '回评记录-20261103.csv')
})

test('禁缓存：导出结果不能被中间层留住', () => {
	assert.equal(handleExport({ what: 'ledger', ...deps() }).headers['cache-control'], 'no-store')
})

test('上限真的传下去了（防 CSV 撑爆）', () => {
	const seen = {}
	handleExport({
		what: 'ledger',
		recentLedger: (n) => { seen.ledger = n; return [] },
		recentPublishes: (n) => { seen.pub = n; return { rows: [] } },
	})
	assert.equal(seen.ledger, 2000)
})

test('publishes 读取器回 null 也不崩（回空表）', () => {
	const r = handleExport({ what: 'publishes', ...deps({ recentPublishes: () => null }) })
	assert.equal(r.status, 200)
	assert.equal(r.count, 0)
})
