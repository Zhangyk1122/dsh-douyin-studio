/**
 * 后台作业：串行、可重试、带账（2026-11-05，B2-08 之后的第二层）
 * ============================================================================
 * 以前长任务（一轮刷完、一次 reconcile）是"直接 await"：失败就没了，成功也没留痕。
 * 这里只做三件事，别指望它是个调度器：
 *   1. **每一步之前看一眼总闸** —— 停损了就不再开新的一步；
 *   2. **失败退避重试** —— 网络抖一下不该整轮作废，但也不许立刻重打；
 *   3. **每次落一行账** —— `jobs.jsonl`，事后能对上"哪一步、几分钟、为什么失败"。
 * 不并发：同一时刻只跑一个，抖音这套东西并发只会让风控更快找上门。
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isKilled, studioHome } from './killswitch.mjs'

/** 账本路径：`$DOUYIN_STUDIO_HOME/jobs.jsonl` */
export const jobsFile = () => join(studioHome(), 'jobs.jsonl')

/** 退避节奏（毫秒）。三次重试后放弃，别在同一个点上打穿。 */
export const BACKOFF = Object.freeze([3000, 15000])

/**
 * 等一会儿（可被单测替换成 0）。
 * @param {number} ms
 * @returns {Promise<void>}
 */
export const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref() })

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
 * @param {number} n
 * @returns {Array<Record<string, any>>}
 */
export function readJobs(n = 20) {
	try {
		const lines = readFileSync(jobsFile(), 'utf8').split('\n').filter(Boolean)
		return lines.slice(-Math.max(1, n)).map((l) => {
			try { return JSON.parse(l) } catch { return { bad: l } }
		})
	} catch { return [] }
}

/**
 * 跑一个作业：总闸 → 执行 → 失败退避重试 → 记账。
 * @template T
 * @param {string} name 作业名（写进账本，例如 `scan-round`）
 * @param {() => Promise<T>} fn 真正干活的函数
 * @param {{tries?:number, backoff?:number[], now?:()=>number, preflight?:() => Promise<any>}} [opts]
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
		try {
			const v = await fn()
			appendJob({ name, ok: true, tries: i + 1, took: Date.now() - t0, ...(pre === null ? {} : { pre }) })
			return v
		} catch (e) {
			last = String((e && e.message) || e)
			appendJob({ name, ok: false, tries: i + 1, took: Date.now() - t0, error: last, ...(pre === null ? {} : { pre }) })
			/* 0 延迟不许起定时器：sleep 里的 setTimeout 是 unref 的，测试进程里没有别的
			 * ref 句柄时事件循环会直接退出，await 永远悬着（2026-11-06 验收抓到）。
			 * 生产退避是 3000/15000ms，走原来的路径，行为不变。 */
			const delay = backoff[Math.min(i, backoff.length - 1)] || 0
			if (i < tries - 1 && delay > 0) await sleep(delay)
		}
	}
	return { ok: false, name, stage: 'job', error: last }
}
