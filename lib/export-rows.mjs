/**
 * lib/export-rows.mjs —— 把插件里的三种记录映射成 CSV（纯函数）
 * ============================================================================
 * 和 lib/export.mjs 的分工：
 *   · export.mjs      只管「怎么把二维数据写成合法 CSV」（转义、BOM、CRLF）
 *   · export-rows.mjs 只管「哪种记录该有哪几列、值怎么翻译成人话」
 * 分开是为了能分别测：前者的正确性由 RFC 决定，后者的正确性由业务决定。
 *
 * 不做的事：不读文件、不碰网络、不生成下载。路由和按钮是别人的事。
 * ============================================================================
 */
import { toCsv } from './export.mjs'

const pad2 = (n) => String(n).padStart(2, '0')

/** ISO → 本地「YYYY-MM-DD HH:mm」，Excel 里认这个格式；坏的照原样截一段，别丢信息 */
function fmtTime(v) {
	const d = new Date(v)
	if (Number.isNaN(+d)) return String(v == null ? '' : v).slice(0, 19)
	return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
		+ ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

const WHO_CN = { public: '公开', friend: '好友可见', private: '仅自己可见' }

/** 每种导出长什么样：文件名前缀、列定义、行映射 */
const SPECS = {
	ledger: {
		file: '回评记录',
		columns: [
			{ key: 'at', label: '时间' },
			{ key: 'who', label: '对象' },
			{ key: 'text', label: '回了什么' },
			{ key: 'reason', label: '为什么回' },
		],
		map: (r) => ({
			at: fmtTime(r.at),
			// 账本里字段叫 author；/ledger 路由转出来叫 who。两个都收，别因为换个入口就空一列。
			who: r.author || r.who || '',
			text: r.text || '',
			// 账本里 reason 本来就是一句人话，不改写，原样带走
			reason: r.reason || '',
		}),
	},
	publishes: {
		file: '发布记录',
		columns: [
			{ key: 'at', label: '时间' },
			{ key: 'kind', label: '类型' },
			{ key: 'title', label: '标题' },
			{ key: 'who', label: '可见性' },
			{ key: 'status', label: '状态' },
			{ key: 'music', label: '音乐' },
		],
		map: (r) => ({
			at: fmtTime(r.at),
			kind: r.kind === 'video' ? '视频' : r.kind === 'image' ? '图文' : (r.kind || ''),
			title: r.title || '',
			who: WHO_CN[r.who] || r.who || '',
			status: r.published ? '已发布' : r.draft ? '草稿' : '摆好了没点',
			music: r.music || '',
		}),
	},
}

/** 支持哪些 what（给路由做白名单，别让 URL 直接变成文件名） */
export const EXPORT_KINDS = Object.keys(SPECS)

/**
 * @param {'ledger'|'publishes'} what
 * @param {Array<object>} rows 原始记录（就是 /ledger、/publishes 返回的那个数组）
 * @param {{bom?:boolean, day?:string}} [opts] day 只影响文件名，格式 YYYYMMDD
 * @returns {{what:string, count:number, filename:string, csv:string}}
 */
export function buildExport(what, rows, opts = {}) {
	const spec = SPECS[what]
	if (!spec) throw new RangeError('不认识的导出类型：' + what)
	if (!Array.isArray(rows)) throw new TypeError('rows 必须是数组')

	const mapped = rows.map((r) => spec.map(r || {}))
	const day = /^\d{8}$/.test(String(opts.day || ''))
		? String(opts.day)
		: (() => { const d = new Date(); return '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) })()

	return {
		what,
		count: mapped.length,
		filename: spec.file + '-' + day + '.csv',
		csv: toCsv(mapped, spec.columns, { bom: opts.bom }),
	}
}
