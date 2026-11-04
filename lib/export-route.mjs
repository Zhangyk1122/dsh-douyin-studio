/**
 * lib/export-route.mjs —— `/export` 这条路由的全部逻辑（不碰 res，只回描述）
 * ============================================================================
 * 为什么把它从 index.js 里搬出来：原来那 20 行写在请求处理器里，**没法单独验**。
 * 结果就是「代码看着对、但一次都没跑过」——这正是交接文件里点名要避免的状态。
 *
 * 现在它是个纯函数：给 what + 两个读取器，回 { status, headers, body }。
 * 于是可以：
 *   · 用假读取器跑单测（tests/export-route.test.mjs）
 *   · 挂在真 http 服务器上跑一遍（tmp/smoke-export-http.mjs）
 * index.js 那边只剩下「取参数 → 调用 → 写响应」三行。
 * ============================================================================
 */
import { buildExport, EXPORT_KINDS } from './export-rows.mjs'

const JSON_HEAD = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }

const fail = (status, extra) => ({
	status,
	headers: { ...JSON_HEAD },
	body: JSON.stringify({ ok: false, ...extra }),
})

/**
 * @param {{
 *   what?: string|null,
 *   recentLedger: (n:number)=>any[],
 *   recentPublishes: (n:number)=>{rows?:any[]},
 *   day?: string,
 * }} p
 * @returns {{status:number, headers:Record<string,string>, body:string, count?:number, filename?:string}}
 */
export function handleExport({ what, recentLedger, recentPublishes, day }) {
	const kind = String(what || 'ledger')

	// 白名单先挡：what 会进文件名，不能让 URL 直接决定路径
	if (!EXPORT_KINDS.includes(kind)) {
		return fail(400, { error: '不支持的导出类型：' + kind, kinds: EXPORT_KINDS })
	}

	let out
	try {
		const rows = kind === 'ledger'
			? recentLedger(2000)
			: ((recentPublishes(500) || {}).rows || [])
		out = buildExport(kind, rows, { day })
	} catch (e) {
		// 读不到记录 / 结构不对：回 500 并说清在哪一层，别让异常冒到宿主
		return fail(500, { error: String((e && e.message) || e), stage: 'read' })
	}

	return {
		status: 200,
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			// 中文文件名走 RFC 5987；老浏览器退回 export.csv，不会出现乱码文件名
			'content-disposition': `attachment; filename="export.csv"; filename*=UTF-8''${encodeURIComponent(out.filename)}`,
			'cache-control': 'no-store',
		},
		body: out.csv,
		count: out.count,
		filename: out.filename,
	}
}
