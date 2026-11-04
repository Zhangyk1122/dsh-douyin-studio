/**
 * lib/fsx.mjs —— 状态文件读写（原子 + 坏了能查）
 * ============================================================================
 * 为什么单独一个文件：这套插件有六个「活着的状态文件」——queue.json、
 * watch-state.json、dm-read.json、dm-names.json、duty-state.json、trend.jsonl、
 * ledger.json。它们全都在**读的时候包了 try/catch，坏了就返回空**。
 *
 * 那个 catch 是对的（不能让一个坏文件把整个工具炸掉），但它顺手把事故
 * 变成了一件查不出来的事：
 *   · watch-state.json 坏 → seen 表没了 → 所有旧私信都算「新来的」→ 通知炸一遍
 *   · queue.json 坏 → 待重试的活儿凭空消失
 *   · dm-read.json 坏 → 全部私信又变成未读
 * 三种都表现成「插件抽风」，日志里一个字都没有。
 *
 * 所以这里管两件事：
 *   1. **写要原子**：先写同目录的临时文件，再 rename 盖上去。
 *      进程在写一半时被杀，坏的只是那个临时文件，正式文件永远是完整的上一版。
 *   2. **读坏了要留证据**：把坏文件改名成 `<名字>.corrupt-<时间>` 再返回兜底值。
 *      数据照样丢，但至少现场在，能看出来是什么时候坏的、坏成什么样。
 *
 * 注意：rename 覆盖在 Windows 上是可以的（Node 用 MoveFileExW + REPLACE_EXISTING），
 * ledger.mjs 从 2026-10 起就这么写，没出过问题。
 * ============================================================================
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 去掉 BOM。PowerShell 5.1 写出来的 UTF-8 一定带 BOM，JSON.parse 直接炸。 */
const noBom = (s) => String(s == null ? '' : s).replace(/^\uFEFF/, '')

/**
 * 原子写文本：同目录临时文件 → rename。
 * 失败时把临时文件删掉再抛，别在状态目录里留一堆垃圾。
 * @param {string} file 目标路径
 * @param {string} text 内容
 * @returns {{ok:true}|{ok:false,error:string}}
 */
export function atomicWriteText(file, text) {
	const tmp = file + '.tmp-' + process.pid + '-' + Date.now().toString(36)
	try {
		mkdirSync(dirname(file), { recursive: true })
		writeFileSync(tmp, text, 'utf8')
		renameSync(tmp, file)
		return { ok: true }
	} catch (e) {
		try { if (existsSync(tmp)) unlinkSync(tmp) } catch { /* 删不掉就算了，别让清理盖掉真正的错 */ }
		return { ok: false, error: String((e && e.message) || e) }
	}
}

/**
 * 原子写 JSON（缩进 1 格，跟这套插件其它状态文件一致，方便人肉看）。
 * @param {string} file
 * @param {any} data
 */
export function atomicWriteJson(file, data) {
	return atomicWriteText(file, JSON.stringify(data, null, 1))
}

/**
 * 读 JSON，坏了给兜底值，并且**把坏文件挪到一边留证**。
 * @param {string} file
 * @param {any} fallback 文件不存在或读不出来时返回什么
 * @param {(v:any)=>boolean} [validate] 额外校验：返回 false 也当坏文件处理
 * @returns {{value:any, corrupt:string|null}} corrupt 是挪走后的路径，没坏就是 null
 */
export function readJsonChecked(file, fallback, validate) {
	if (!existsSync(file)) return { value: fallback, corrupt: null }
	let raw
	try {
		raw = noBom(readFileSync(file, 'utf8'))
	} catch (e) {
		return { value: fallback, corrupt: quarantine(file, '读不出来:' + String((e && e.message) || e)) }
	}
	if (!raw.trim()) return { value: fallback, corrupt: null } // 空文件不算坏，算还没写过
	let v
	try {
		v = JSON.parse(raw)
	} catch (e) {
		return { value: fallback, corrupt: quarantine(file, '不是合法 JSON:' + String((e && e.message) || e)) }
	}
	if (typeof validate === 'function' && !validate(v)) {
		return { value: fallback, corrupt: quarantine(file, '结构不对') }
	}
	return { value: v, corrupt: null }
}

/**
 * 读 JSON 的简版：只要值，不关心坏没坏（坏的已经被挪走了，现场在目录里）。
 * @param {string} file
 * @param {any} fallback
 * @param {(v:any)=>boolean} [validate]
 */
export function readJsonSafe(file, fallback, validate) {
	return readJsonChecked(file, fallback, validate).value
}

/**
 * 把坏文件改名挪到一边，返回新路径；挪不动就返回 null（别为了留证据把主流程搞挂）。
 * @param {string} file
 * @param {string} why 追加进同目录的 corrupt-why.txt，方便事后看
 * @returns {string|null}
 */
function quarantine(file, why) {
	try {
		const to = file + '.corrupt-' + new Date().toISOString().replace(/[:.]/g, '-')
		renameSync(file, to)
		try {
			appendFileSync(join(dirname(file), 'corrupt-why.txt'),
				new Date().toISOString() + '\t' + file + '\t' + why + '\n', 'utf8')
		} catch { /* 证据文件写不进去不影响主流程 */ }
		return to
	} catch { return null }
}

export { noBom }
