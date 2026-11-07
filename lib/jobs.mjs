/**
 * 后台作业：串行、可重试、带账（2026-11-05，B2-08 之后的第二层）
 * ============================================================================
 * 以前长任务（一轮刷完、一次 reconcile）是"直接 await"：失败就没了，成功也没留痕。
 * 这里只做三件事，别指望它是个调度器：
 *   1. **每一步之前看一眼总闸** —— 停损了就不再开新的一步；
 *   2. **失败退避重试** —— 网络抖一下不该整轮作废，但也不许立刻重打；
 *   3. **每次落一行账** —— 按月一个文件，事后能对上"哪一步、几分钟、为什么失败"。
 * 不并发：同一时刻只跑一个，抖音这套东西并发只会让风控更快找上门。
 *
 * 2026-11-07（0.4.5）两处改动，都是"只增不改"：
 *   - **账本按月轮转**：`jobs-YYYY-MM.jsonl`；老的 `jobs.jsonl` 仍然会被读到，
 *     所以历史不用搬家，也不用一次性重写。
 *   - **阶段计时**：作业函数会收到一个 `mark(名字)`，每按一次记一段耗时，
 *     账户里落成 `phases: { feed: 41000, judge: 900 }`。`pre` 保留不动
 *     （它量的是"预检这一跳"，仍然在 phases 之前）。
 *   - **尾部读**：`readJobs(n)` 只从文件末尾读最多 256KB，不再整份读进来。
 */
import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isKilled, studioHome } from './killswitch.mjs'

/** 读账时往回看几个月（当月 + 前两个月）。更老的还在盘上，只是不再参与"最近几条"。 */
export const KEEP_MONTHS = 3

/** 尾部读的上限：一次最多读这么多字节，够放几千行作业账。 */
const TAIL_CAP = 256 * 1024

/** `2026-11` */
const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

/** 当月账本：`$DOUYIN_STUDIO_HOME/jobs-YYYY-MM.jsonl` */
export const jobsFile = (d = new Date()) => join(studioHome(), `jobs-${monthKey(d)}.jsonl`)

/** 0.4.4 之前的单一账本，只读兼容用。 */
export const legacyJobsFile = () => join(studioHome(), 'jobs.jsonl')

/** 退避节奏（毫秒）。三次重试后放弃，别在同一个点上打穿。 */
export const BACKOFF = Object.freeze([3000, 15000])

/**
 * 等一会儿（可被单测替换成 0）。
 * @param {number} ms
 * @returns {Promise<void>}
 */
export const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref() })

/**
 * 从文件末尾读最多 n 行（不整份读）。
 * 起点落在行中间时丢掉那半行 —— 半行 JSON 解析出来只会变成噪音。
 * @param {string} file
 * @param {number} n
 * @returns {string[]}
 */
function tailLines(file, n) {
	try {
		if (!existsSync(file)) return []
		const fd = openSync(file, 'r')
		try {
			const size = fstatSync(fd).size
			if (!size) return []
			const len = Math.min(size, TAIL_CAP)
			const from = size - len
			const buf = Buffer.alloc(len)
			readSync(fd, buf, 0, len, from)
			let text = buf.toString('utf8')
			if (from > 0) {
				const i = text.indexOf('\n')
				text = i >= 0 ? text.slice(i + 1) : ''
			}
			return text.split('\n').filter(Boolean).slice(-Math.max(1, n))
		} finally { closeSync(fd) }
	} catch { return [] }
}

/**
 * 参与"最近 n 条"的文件，按时间从旧到新：
 * 老的 `jobs.jsonl` 在最前，然后是当月及往前数 KEEP_MONTHS 个月。
 * @param {Date} [now]
 * @returns {string[]}
 */
export function jobsFiles(now = new Date()) {
	const out = [legacyJobsFile()]
	const list = []
	for (let i = 0; i < KEEP_MONTHS; i++) {
		const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
		list.push(jobsFile(d))
	}
	return out.concat(list.reverse())
}

/**
 * 落一行作业账。写不进去就算了 —— 记账失败不该让业务跟着失败。
 * @param {Record<string, unknown>} rec
 * @returns {boolean} 写成功
 */
export function appendJob(rec) {
	try {
		const file = jobsFile()
		mkdirSync(dirname(file), { recursive: true })
		appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...rec }) + '\n', 'utf8')
		return true
	} catch { return false }
}

/**
 * 读最近 n 条作业账（新的在后）。
 * 跨月时自动把上个月的文件接上；老 `jobs.jsonl` 里那几行也照读。
 * @param {number} n
 * @returns {Array<Record<string, any>>}
 */
export function readJobs(n = 20) {
	const want = Math.max(1, Number(n) || 1)
	const files = jobsFiles()
	const picked = []
	for (let i = files.length - 1; i >= 0 && picked.length < want; i--) {
		const lines = tailLines(files[i], want - picked.length)
		for (let j = lines.length - 1; j >= 0; j--) picked.push(lines[j])
	}
	return picked.reverse().map((l) => {
		try { return JSON.parse(l) } catch { return { bad: l } }
	})
}

/**
 * 跑一个作业：总闸 → 执行 → 失败退避重试 → 记账。
 * @template T
 * @param {string} name 作业名（写进账本，例如 `scan-round`）
 * @param {(mark?: (phase: string) => number) => Promise<T>} fn 真正干活的函数
 *   可选接收 `mark(phase)`：调用它就把"从上一个 mark 到现在"的毫秒数记进 `phases`。
 *   老函数不接参数也照跑（多余的实参会被忽略）。
 * @param {{tries?:number, backoff?:number[], now?:()=>number, preflight?: () => Promise<any>}} [opts]
 * @returns {Promise<T | {ok:false, name:string, stage:string, error:string}>} 成功原样返回
 */
export async function runJob(name, fn, opts = {}) {
	const tries = Math.max(1, Math.min(5, Number(opts.tries) || 2))
	const backoff = Array.isArray(opts.backoff) ? opts.backoff : BACKOFF
	let last = ''
	for (let i = 0; i < tries; i++) {
		if (isKilled()) {
			appendJob({ name, ok: false, killed: true, tries: i, error: 'killswitch' })
			return { ok: false, name, stage: 'killswitch', error: '停损开着，这一步没跑' }
		}
		const t0 = Date.now()
		/* 2026-11-07：可选预检（目前只用来量「Chrome/CDP 还活不活、回多慢」）。
		 * 为什么记账里要留这个数：scan-round 实测 1.2s 和 63.6s 都出现过，只有总耗时分不清
		 * 是逻辑慢还是浏览器冷/被系统挂起。pre 只量浏览器这一跳，且失败不影响作业（-1 记账）。 */
		let pre = null
		if (typeof opts.preflight === 'function') {
			const p0 = Date.now()
			try { await opts.preflight(); pre = Date.now() - p0 } catch { pre = -1 }
		}
		/* 阶段计时：`phases` 里每一段是"距上一个 mark 的毫秒数"，加总≈`took - pre`。
		 * 只在真的有 mark 时记账，老作业的账行不会平白多一个空对象。 */
		const phases = {}
		let lastAt = Date.now()
		const mark = (phase) => {
			const now = Date.now()
			if (phase) phases[String(phase)] = now - lastAt
			lastAt = now
			return now
		}
		const phaseField = () => (Object.keys(phases).length ? { phases: { ...phases } } : {})
		try {
			const v = await fn(mark)
			appendJob({ name, ok: true, tries: i + 1, took: Date.now() - t0, ...(pre === null ? {} : { pre }), ...phaseField() })
			return v
		} catch (e) {
			last = String((e && e.message) || e)
			appendJob({ name, ok: false, tries: i + 1, took: Date.now() - t0, error: last, ...(pre === null ? {} : { pre }), ...phaseField() })
			/* 0 延迟不许起定时器：sleep 里的 setTimeout 是 unref 的，测试进程里没有别的
			 * ref 句柄时事件循环会直接退出，await 永远悬着（2026-11-06 验收抓到）。
			 * 生产退避是 3000/15000ms，走原来的路径，行为不变。 */
			const delay = backoff[Math.min(i, backoff.length - 1)] || 0
			if (i < tries - 1 && delay > 0) await sleep(delay)
		}
	}
	return { ok: false, name, stage: 'job', error: last }
}

/** 只读地看一眼老账本有多大（诊断用；不参与业务）。 */
export function legacySize() {
	try { return readFileSync(legacyJobsFile(), 'utf8').length } catch { return 0 }
}
