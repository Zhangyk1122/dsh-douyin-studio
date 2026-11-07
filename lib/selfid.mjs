/**
 * lib/selfid.mjs —— 机器人自己的抖音 uid（落盘）
 * ============================================================================
 * 为什么要单独存一个文件：
 *   `settings.json` 里的 ownerUid 是**主人**的 uid，不是机器人自己的。
 *   而「有没有回错到自己」必须知道机器人自己的 uid —— 以前这个值只活在
 *   `/status` 的响应里，面板关掉就没了，自检只能跳过这条。
 *
 * 为什么不写进 autopilot-state.json：
 *   那个文件归 lib/autopilot.mjs 所有，它整份读改写；别人往里塞字段，
 *   下一次 save 就可能被冲掉（11-05 watch/queue 踩过同款坑）。
 *   所以给它一个独立的、只有本模块写的小文件。
 * ============================================================================
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import { atomicWriteJson, readJsonSafe } from './fsx.mjs'

const DIR = () => process.env.DOUYIN_STUDIO_HOME || join(homedir(), '.dsh', 'douyin-studio')
const FILE = () => join(DIR(), 'self.json')

/** 已记录的机器人 uid；没有返回空串（调用方自己决定降级）。 */
export function selfUid() {
	const j = readJsonSafe(FILE(), {}, (v) => v && typeof v === 'object')
	return String((j && j.uid) || '')
}

/**
 * 从 `/status` 的返回里取 uid 并落盘。取不到就原样返回空串，不抛。
 * 只在值变化时写盘 —— 免得每打开一次面板就摸一次文件。
 */
export function remember(status) {
	try {
		const s = (status && status.self) || {}
		const u = s.user || {}
		const uid = String(u.uid || u.sec_uid || s.uid || '')
		if (!uid) return ''
		if (selfUid() === uid) return uid
		atomicWriteJson(FILE(), {
			uid,
			nick: String(u.nickname || ''),
			at: new Date().toISOString(),
		})
		return uid
	} catch {
		return ''
	}
}
