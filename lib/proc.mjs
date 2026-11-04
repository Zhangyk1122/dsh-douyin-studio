/**
 * lib/proc.mjs —— 跑一条 CLI 子命令，把 stdout 里的 JSON 取回来（异步）
 * ============================================================================
 * 🔴 为什么从 spawnSync 换成 spawn（2026-11-02）：
 *   面板的所有接口都是「在 async 路由里 await 一个子进程」，但那个子进程是
 *   `spawnSync` 起的 —— 它是**同步**的，会把 Node 的事件循环按住不放。
 *   `/inbox` 的超时给到了 240 秒，README 里也写着「收件箱要跑十几秒」，
 *   也就是说：打开面板的十几秒里，整个 DSH Web 服务是僵住的 ——
 *   别的接口排队、静态资源发不出去、页面看起来就是「卡死」。
 *   Node 官方文档对 spawnSync 的原话：blocks the event loop until the spawned
 *   process either exits or is terminated。请求路径上不该出现它。
 *
 *   换成 spawn 之后，子进程在**它自己的进程**里跑（本来也是），
 *   父进程立刻让出事件循环，于是：
 *     · 面板能真的并发取数（这正是 b13 首屏「先出快卡」的前提）
 *     · 一条慢请求不会拖死整个宿主
 *
 * 语义和原来的 spawnSync 版一字不差（调用方不用改）：
 *   · stdout 里找第一个 '{' 开始解析（前面可能混着日志行）
 *   · 超时 → { ok:false, category:'CDP', error:'命令超时（Nms）' }
 *   · 没吐 JSON → { ok:false, category:'LOCAL', error:'命令没返回 JSON', stderr }
 *   · 解析失败 → { ok:false, category:'LOCAL', error:'返回不是合法 JSON', raw }
 *   · **永远不抛**（resolve 一个错误对象），调用方写法不用变
 * ============================================================================
 */
import { spawn } from 'node:child_process'

/** 单个流最多留这么多字符（对齐原来 spawnSync 的 maxBuffer: 8MB 语义，但不会撑爆内存） */
const MAX_OUT = 8 * 1024 * 1024

/**
 * 把子进程的输出解释成结果对象。抽出来是为了能单独测 —— 它才是「语义」所在。
 * @param {{out?:string, err?:string, code?:number|null, signal?:string|null,
 *          killedByTimeout?:boolean, timeout?:number}} r
 */
export function parseResult(r) {
	const out = String((r && r.out) || '')
	const err = String((r && r.err) || '')
	const killed = Boolean(r && r.killedByTimeout)
	const timeout = Number((r && r.timeout) || 0)
	const raw = out
	const start = raw.indexOf('{')
	if (start < 0) {
		// 一个 JSON 都没吐出来 —— 要么子进程被信号杀了，要么模块加载就崩了。
		// 这两种都不是「页面问题」，别让调用方去刷页面。
		return {
			ok: false,
			category: killed ? 'CDP' : 'LOCAL',
			error: killed ? `命令超时（${timeout}ms）` : '命令没返回 JSON',
			hint: killed ? '浏览器可能卡住了，重开 Chrome 再试' : '多半是模块加载就崩了，看 stderr',
			stderr: err.slice(-600),
			code: r ? r.code : undefined,
		}
	}
	try {
		return JSON.parse(raw.slice(start))
	} catch {
		return { ok: false, category: 'LOCAL', error: '返回不是合法 JSON', raw: raw.slice(-400) }
	}
}

/**
 * 跑子进程，拿解析后的 JSON。**永远 resolve，永远不抛。**
 * @param {string} cli 脚本绝对路径
 * @param {string[]} args 参数表（不经过 shell，别自己拼引号）
 * @param {{timeout?:number, env?:NodeJS.ProcessEnv}} [opts]
 * @returns {Promise<any>}
 */
export function execJson(cli, args, opts = {}) {
	const timeout = Number(opts.timeout) || 120000
	return new Promise((resolve) => {
		let settled = false
		let out = ''
		let err = ''
		let killedByTimeout = false
		const done = (v) => { if (!settled) { settled = true; resolve(v) } }

		let child
		try {
			child = spawn(process.execPath, [cli].concat(args || []), {
				env: opts.env || process.env,
				windowsHide: true,
				stdio: ['ignore', 'pipe', 'pipe'],
			})
		} catch (e) {
			return done({
				ok: false, category: 'LOCAL', error: '起不了子进程',
				hint: String((e && e.message) || e),
			})
		}

		const timer = setTimeout(() => {
			killedByTimeout = true
			// 先礼后兵：SIGTERM 让子进程有机会收拾现场；它要是赖着不走也没关系，
			// 我们只等 close 事件，而且 close 之后 Promise 已经 resolve 了。
			try { child.kill() } catch { /* 已经死了 */ }
		}, timeout)
		// 超时计时器不该拖住宿主退出
		if (typeof timer.unref === 'function') timer.unref()

		const cap = (s, b) => (s.length >= MAX_OUT ? s : s + b.toString('utf8'))
		if (child.stdout) child.stdout.on('data', (b) => { out = cap(out, b) })
		if (child.stderr) child.stderr.on('data', (b) => { err = cap(err, b) })

		child.on('error', (e) => {
			clearTimeout(timer)
			done({
				ok: false, category: 'LOCAL', error: '起不了子进程',
				hint: String((e && e.message) || e), code: e && e.code,
			})
		})

		// close 而不是 exit：close 在 stdio 全部关闭之后才触发，能保证输出收全了
		child.on('close', (code, signal) => {
			clearTimeout(timer)
			done(parseResult({ out, err, code, signal, killedByTimeout, timeout }))
		})
	})
}
