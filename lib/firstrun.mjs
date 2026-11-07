/**
 * lib/firstrun.mjs —— 首跑必先 dry
 * ============================================================================
 * 新装、或者删掉状态文件之后，第一次真发布会直接落到活账号上：封面、标签、声明、
 * 定时任何一个填错，都是不可逆的公开动作。HANDOFF 第 10 节把这条记成遗留项。
 *
 * 规矩：**没跑过一次成功的 dry 发布，就不许 publish:true**。
 *   · dry 通过 → 落 first-run.json（dryDone=true）→ 之后正常放行
 *   · 真发成功 → 落 publishedAt，永不再拦（不会因为状态文件丢了又拦一次）
 * 只拦 publish，不拦 draft：存草稿本身就是可回退的。
 * ============================================================================
 */
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { atomicWriteJson } from './fsx.mjs'
import { studioHome } from './killswitch.mjs'

/** 首跑状态文件。 */
export function firstRunFile() {
	return join(studioHome(), 'first-run.json')
}

/**
 * 读首跑状态（坏文件当没跑过，宁可多拦一次，也不放一次不可逆的发布）。
 * @returns {{ dryDone: boolean, dryAt: string, publishedAt: string }}
 */
export function readFirstRun() {
	try {
		const v = JSON.parse(readFileSync(firstRunFile(), 'utf8'))
		return {
			dryDone: Boolean(v && v.dryDone),
			dryAt: String((v && v.dryAt) || ''),
			publishedAt: String((v && v.publishedAt) || ''),
		}
	} catch {
		return { dryDone: false, dryAt: '', publishedAt: '' }
	}
}

/**
 * 还需要先 dry 吗。
 * @returns {boolean}
 */
export function needsFirstRunDry() {
	const s = readFirstRun()
	return !s.dryDone && !s.publishedAt
}

/**
 * 记一次 dry 通过。
 * @param {string} [note]
 * @returns {{ dryDone: true, dryAt: string, publishedAt: string }}
 */
export function markDryRun(note = '') {
	const prev = readFirstRun()
	const next = {
		...prev,
		dryDone: true,
		dryAt: new Date().toISOString(),
		dryNote: String(note || '').slice(0, 200),
	}
	atomicWriteJson(firstRunFile(), next)
	return { dryDone: true, dryAt: next.dryAt, publishedAt: next.publishedAt }
}

/**
 * 记一次真发成功（之后不再要求首跑 dry）。
 * @returns {{ dryDone: boolean, dryAt: string, publishedAt: string }}
 */
export function markPublished() {
	const prev = readFirstRun()
	const next = { ...prev, dryDone: true, publishedAt: new Date().toISOString() }
	atomicWriteJson(firstRunFile(), next)
	return { dryDone: true, dryAt: next.dryAt, publishedAt: next.publishedAt }
}
