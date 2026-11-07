/**
 * lib/store.mjs —— 同一份状态文件的「单写者」队列
 * ============================================================================
 * 症状：settings / ledger / budget / notify / picks / self / scan-state 七个文件
 * 各自 read → 改 → write，跨过 await 之后写回，后写的会把先写的覆盖掉
 * （11-05 三次记账事故裡就有一次是这个形状）。
 *
 * 这里不引入数据库、不改文件格式，只保证一件事：
 * **同一个进程里、同一个文件上，read-modify-write 串行执行。**
 * 跨进程仍靠 atomicWriteJson 的原子替换，两边不冲突。
 *
 * 设计取舍：
 *   · 队列按绝对路径分，不同文件互不阻塞
 *   · mutate 抛错不写盘，且队列继续跑（一个坏更新不能卡死后面所有写）
 *   · 写失败返回 null，绝不因为记账把主流程搞挂
 * ============================================================================
 */
import { resolve } from 'node:path'
import { atomicWriteJson, readJsonSafe } from './fsx.mjs'

/** @type {Map<string, Promise<any>>} */
const queues = new Map()

/**
 * 读 → 改 → 写，串行。
 * @param {string} file      文件路径
 * @param {(cur:any)=>any|Promise<any>} mutate 返回要落盘的新值；返回 undefined 表示不写
 * @param {object} [opts]
 * @param {any} [opts.fallback] 读不到时的初值
 * @returns {Promise<any>}     最终落盘的值；不写或写失败返回 null
 */
export function updateJson(file, mutate, { fallback = {} } = {}) {
	const key = resolve(file)
	const prev = queues.get(key) || Promise.resolve()
	const task = prev.catch(() => {}).then(async () => {
		const cur = readJsonSafe(key, fallback)
		const next = await mutate(cur)
		if (next === undefined) return null
		try { atomicWriteJson(key, next); return next } catch { return null }
	})
	// 队列只记"还在飞"的最后一个；完成后把自己摘掉，别让 Map 无限长
	queues.set(key, task)
	task.finally(() => { if (queues.get(key) === task) queues.delete(key) }).catch(() => {})
	return task
}

/** 并发写同一个文件时，只排队、不等待别的路径。 */
export function writeJson(file, value) {
	return updateJson(file, () => value, { fallback: {} })
}

/** 给测试/收尾用：当前有几个文件正在排队。 */
export function pending() {
	return queues.size
}
