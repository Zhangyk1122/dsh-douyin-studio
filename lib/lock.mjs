/**
 * lib/lock.mjs —— 进程内串行锁
 * ============================================================================
 * 问题：多个工具同时被调用时，每个都会开一次 Chrome 标签页，同时操作同一个页面。
 *
 * 解法：同一时刻只允许一个 CDP 操作持有锁。其他调用排队等候，超时返回错误。
 *
 * 用法（直接包整段操作）：
 *   import { withLock } from './lock.mjs'
 *   const r = await withLock('cdp', async () => {
 *     // ... 开页面、做操作、关页面
 *     return result
 *   })
 *
 * 锁名称（namespaces）：
 *   'cdp'     所有 Chrome/CDP 操作（发布、分享、私信发送）
 *   'ledger'  ledger.json 读改写（比 renameSync 原子写更早防冲突）
 *
 * 超时：默认 60s（CDP 操作最长约 45s），可以通过第三个参数覆盖。
 * ============================================================================
 */

/** @type {Map<string, Promise<any>>} */
const queue = new Map()

/**
 * 在指定命名空间内串行执行 fn，保证同一时刻只有一个 fn 在跑。
 * 超时返回 StudioError 格式的 JSON，不抛出。
 *
 * @param {string} ns - 锁命名空间，例如 'cdp'
 * @param {() => Promise<any>} fn - 要串行化的操作
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<any>}
 */
export async function withLock(ns, fn, opts = {}) {
	const timeoutMs = opts.timeoutMs ?? 60_000
	const prev = queue.get(ns) ?? Promise.resolve()

	let resolveTurn
	const myTurn = new Promise((r) => { resolveTurn = r })
	queue.set(ns, prev.then(() => myTurn))

	// 等前一个完成
	const waitDone = await _raceTimeout(prev, timeoutMs)
	if (waitDone === _TIMEOUT) {
		resolveTurn()
		return {
			ok: false,
			category: 'CDP',
			error: `lock '${ns}' 等待超时（${timeoutMs}ms），前一个操作卡住了`,
			hint: '检查 Chrome 是否正常响应（node tools/dy.mjs doctor）',
		}
	}

	// 轮到自己，跑 fn
	try {
		const result = await _raceTimeout(fn(), timeoutMs)
		if (result === _TIMEOUT) {
			return {
				ok: false,
				category: 'CDP',
				error: `lock '${ns}' 操作超时（${timeoutMs}ms）`,
				hint: '重试一次；如果频繁超时，检查页面是否卡住',
			}
		}
		return result
	} catch (e) {
		return {
			ok: false,
			category: 'CDP',
			error: String((e && e.message) || e),
		}
	} finally {
		resolveTurn()
	}
}

/** 读锁状态（主要用于测试） */
export function lockState(ns) {
	return { locked: queue.has(ns) }
}

// ── 内部工具 ──────────────────────────────────────────────────────────────────

const _TIMEOUT = Symbol('timeout')

function _raceTimeout(promise, ms) {
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(_TIMEOUT), ms)
		Promise.resolve(promise).then(
			(v) => { clearTimeout(timer); resolve(v) },
			(e) => { clearTimeout(timer); resolve(Promise.reject(e)) },
		)
	})
}
