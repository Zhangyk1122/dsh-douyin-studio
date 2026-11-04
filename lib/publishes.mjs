/**
 * lib/publishes.mjs —— 最近发布过什么（给面板那张卡用）
 * ============================================================================
 * 数据只来自一件事：`lib/publish-log.jsonl` 里以 `RESULT ` 开头的那几行。
 * 那些行是 publish-cli 自己写的结构化摘要（一行 JSON），
 * 剩下的日志是给人读的散文，解析它等于猜——**别猜**，猜错的账比没账更糟。
 *
 * 轮转规则：超过 2MB 时 publish-cli 会把日志改名成 `.1`，所以这里两个都读。
 * ============================================================================
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LOG = join(HERE, 'publish-log.jsonl')
const LOG_1 = LOG + '.1'

/**
 * 读一个日志文件里的 RESULT 行。
 * @param {string} p
 * @returns {Array<object>}
 */
function readOne(p) {
	let txt = ''
	try {
		txt = readFileSync(p, 'utf8').replace(/^\uFEFF/, '')
	} catch {
		return []
	}
	const rows = []
	for (const line of txt.split('\n')) {
		const i = line.indexOf('RESULT ')
		if (i < 0) continue
		try {
			rows.push(JSON.parse(line.slice(i + 7)))
		} catch {
			/* 半截行（进程被杀时）直接跳过，不算错 */
		}
	}
	return rows
}

/**
 * 最近 n 条发布记录，新的在前。
 * @param {number} [n=10]
 * @returns {{ok:boolean, rows:Array<object>}}
 */
export function recent(n = 10) {
	const lim = Math.max(1, Math.min(50, Number(n) || 10))
	const all = [...readOne(LOG_1), ...readOne(LOG)]
	all.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
	return { ok: true, rows: all.slice(0, lim) }
}

export { LOG as PUBLISH_LOG }
