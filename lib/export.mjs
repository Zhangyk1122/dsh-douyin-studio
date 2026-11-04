/**
 * lib/export.mjs —— CSV 导出（纯函数，不碰文件、不碰网络、不碰浏览器）
 * ============================================================================
 * 三个决定写死在这里，别各写一套：
 *
 * 1. **默认带 UTF-8 BOM。** 抖音里的昵称和内容一定是中文，而 Windows 上的 Excel
 *    打开无 BOM 的 UTF-8 CSV 时按 ANSI 解码 → 整列乱码。这不是"风格选择"，是能不能用。
 *    要纯 UTF-8（比如喂给程序）就显式传 `bom: false`。
 * 2. **行尾统一 CRLF。** 同上，Excel 的行尾约定。
 * 3. **绝不 trim 用户字段。** 前后空格是数据，不是脏数据。
 *    "清理一下"这种顺手操作，在导出里等于丢数据。
 *
 * 转义按 RFC 4180：字段含分隔符 / 双引号 / 换行 / 回车 → 整字段加双引号，
 * 内部的双引号双写。空值、NaN、Infinity 一律输出空字段（而不是字符串 "null"/"NaN"）。
 * ============================================================================
 */

/** 把一个值变成可以写进单元格的文本 */
function toText(v) {
	if (v === null || v === undefined) return ''
	if (v instanceof Date) return Number.isNaN(+v) ? '' : v.toISOString()
	const t = typeof v
	if (t === 'number') return Number.isFinite(v) ? String(v) : '' // NaN / Infinity 不写进表格
	if (t === 'bigint') return String(v)
	if (t === 'boolean') return v ? 'true' : 'false'
	if (t === 'string') return v
	if (t === 'object') {
		// 数组 / 对象：JSON 化保住信息，逗号会被下面的引号处理掉
		try { return JSON.stringify(v) } catch { return '' }
	}
	return '' // function / symbol：这种值写进表格没有意义，别输出 "function..."
}

/** RFC 4180 转义 */
function quote(text, separator) {
	const s = String(text)
	const need = s.includes(separator) || s.includes('"') || s.includes('\n') || s.includes('\r')
	return need ? '"' + s.replace(/"/g, '""') + '"' : s
}

/**
 * 行数组 → CSV 文本
 * @param {Array<object>} rows 每行一个对象（不是数组就抛 TypeError —— 宁可报错也别给一份假表格）
 * @param {Array<{key:string,label?:string}|string>} columns 列定义，支持 `['a','b']` 简写
 * @param {{separator?:string, bom?:boolean}} [options]
 * @returns {string}
 */
export function toCsv(rows, columns, options = {}) {
	if (!Array.isArray(rows)) throw new TypeError('rows 必须是数组')
	if (!Array.isArray(columns) || columns.length === 0) throw new TypeError('columns 不能为空')

	const separator = typeof options.separator === 'string' && options.separator ? options.separator : ','
	const bom = options.bom !== false

	const cols = columns.map((c) => (typeof c === 'string'
		? { key: c, label: c }
		: { key: c.key, label: c.label === undefined ? c.key : c.label }))

	const lines = [cols.map((c) => quote(String(c.label), separator)).join(separator)]
	for (const row of rows) {
		lines.push(cols.map((c) => quote(toText(row == null ? undefined : row[c.key]), separator)).join(separator))
	}

	// 用转义写法，别在这里放一个不可见的字面 BOM 字符 —— 那种东西被编辑器/格式化工具
	// 顺手删掉之后，表现是「Excel 里中文乱码」而不是报错，最难查。
	return (bom ? '\uFEFF' : '') + lines.join('\r\n') + '\r\n'
}
