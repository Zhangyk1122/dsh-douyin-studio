/**
 * lib/killswitch.mjs —— 一键全局停损（KILL）
 * ============================================================================
 * 风控异常、发错人、账号被限流的时候，第一件事不是"再试一次"，是**先止血**。
 * 之前只有「暂停刷视频」(STOP) 一个口子，回评 / 私信 / 发布 / 分享全都照跑。
 *
 * 这里用一个文件当总闸：`$DOUYIN_STUDIO_HOME/KILL` 存在 = 所有写操作立刻拒。
 * 为什么用文件而不是设置项：
 *   · CLI 子进程也能看见（tools/dy.mjs 走的是同一个 home）
 *   · 人可以直接手建/手删，不需要进面板
 *   · 面板、工具、调度器读的是同一份事实，不会出现"面板关了、后台还在发"
 *
 * 只挡**写**。status / inbox / feed 这些只读动作照常可用 —— 出事时更需要看现场。
 * ============================================================================
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteJson } from './fsx.mjs'

/** 插件数据目录（和 settings.mjs 同一口径，允许测试用 DOUYIN_STUDIO_HOME 覆盖）。 */
export function studioHome() {
	return process.env.DOUYIN_STUDIO_HOME
		|| join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'douyin-studio')
}

/** KILL 文件路径。 */
export function killFile() {
	return join(studioHome(), 'KILL')
}

/**
 * 现在是不是停损状态。
 * 读不到（权限、文件坏了）一律当「没停」—— 停损开关自己坏掉，不该把正常功能一起关死。
 * @returns {boolean}
 */
export function isKilled() {
	try { return existsSync(killFile()) } catch { return false }
}

/**
 * 停损原因（给面板和工具回显）。
 * @returns {{ at: string, reason: string } | null}
 */
export function killInfo() {
	if (!isKilled()) return null
	try {
		const v = JSON.parse(readFileSync(killFile(), 'utf8'))
		return {
			at: String((v && v.at) || ''),
			reason: String((v && v.reason) || '').slice(0, 200),
		}
	} catch {
		/* 文件在、但内容坏了：仍然算停，只是没有原因可回显 */
		return { at: '', reason: '' }
	}
}

/**
 * 开 / 关总闸。
 * @param {boolean} on true = 停
 * @param {string} [reason] 为什么停（写进 KILL 文件，事后能对上）
 * @returns {{ ok: boolean, killed: boolean, at?: string, reason?: string }}
 */
export function setKill(on, reason = '') {
	if (!on) {
		try { rmSync(killFile(), { force: true }) } catch { /* 已经不在了 */ }
		return { ok: true, killed: false }
	}
	const at = new Date().toISOString()
	const why = String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 200)
	atomicWriteJson(killFile(), { at, reason: why })
	return { ok: true, killed: true, at, reason: why }
}

/**
 * 写操作被总闸挡住时，统一的拒绝形状（工具层直接 return 这个）。
 * @param {string} action
 * @returns {{ ok: false, killed: true, stage: string, error: string, action: string }}
 */
export function killedReply(action) {
	const info = killInfo() || {}
	return {
		ok: false,
		killed: true,
		stage: 'killswitch',
		action: String(action || ''),
		error: '全局停损开着（' + killFile() + '）：所有会发出去的动作都停'
			+ (info.reason ? '；原因：' + info.reason : '')
			+ '。确认安全后解除（工具 douyin_studio_kill action=off，或命令行 dy.mjs kill off），只想演练就传 dry:true。',
	}
}
