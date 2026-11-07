#!/usr/bin/env node
/**
 * tools/selfcheck.mjs —— 运行期行为自检的入口
 * ============================================================================
 * 用法：
 *   node tools/selfcheck.mjs                     # 查今天
 *   node tools/selfcheck.mjs --self-uid 123456   # 带上机器人 uid（能查「回错到自己」）
 *   node tools/selfcheck.mjs --online            # 再加一步：拿线上评论核账本（会联网，慢十几秒）
 *   node tools/selfcheck.mjs --json              # 机器可读，给面板/CI 用
 *
 * 退出码：0 = 通过（可能有 warn），1 = 有 error。
 * 它只读盘，不发请求、不写任何文件 —— 可以在值班间隙随便跑。
 * ============================================================================
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { check, render, todayKey } from '../lib/selfcheck.mjs'
import { LIMITS } from '../lib/budget.mjs'
import { selfUid as storedSelfUid } from '../lib/selfid.mjs'

const argv = process.argv.slice(2)
const argOf = (k) => {
	const i = argv.indexOf(k)
	return i >= 0 ? argv[i + 1] : ''
}
const has = (k) => argv.includes(k)

const HOME = process.env.DOUYIN_STUDIO_HOME || join(homedir(), '.dsh', 'douyin-studio')

function readJson(name, dflt) {
	try {
		return JSON.parse(readFileSync(join(HOME, name), 'utf8'))
	} catch {
		return dflt
	}
}

const settings = readJson('settings.json', {})
const ledger = readJson('ledger.json', { replies: [] })
const budget = readJson('budget.json', { day: '', entries: [] })
const state = readJson('autopilot-state.json', {})

/* 机器人 uid：命令行 > self.json（面板读 /status 时落的）> 旧状态字段 > 放弃 */
const selfUid =
	argOf('--self-uid') ||
	storedSelfUid() ||
	String(state.selfUid || state.uid || (state.self && state.self.uid) || '')

let limits = null
try {
	limits = LIMITS()
} catch {
	limits = null
}

const result = check({
	ledger,
	budget,
	settings,
	selfUid,
	limits,
	now: Date.now(),
})

/* --online：再拿线上去核一遍账本。
 * 为什么不塞进 lib/selfcheck.mjs：那边是纯函数（不读盘、不联网），
 * 一旦加了网络就会变成"自检自己会失败"，反而没人信它。
 * 这里用子进程跑 reconcile，把它的结论折成一条 issue。 */
if (has('--online')) {
	const HERE = dirname(fileURLToPath(import.meta.url))
	const r = spawnSync(
		process.execPath,
		[join(HERE, 'reconcile.mjs'), '--json', '--works', String(argOf('--works') || '2')],
		{ encoding: 'utf8', timeout: 180000, windowsHide: true },
	)
	let parsed = null
	try {
		parsed = JSON.parse(String(r.stdout || ''))
	} catch {
		parsed = null
	}
	if (!parsed) {
		result.issues.push({
			level: 'warn',
			code: 'online-check-failed',
			msg: '线上核对没跑成（可能是没登录 / 网络 / 超时），本次只跑了本地自检',
			evidence: {},
		})
	} else {
		const missing = parsed.missing || []
		const n = missing.length
		if (n) {
			/* 区分「今天漏的」和「历史欠账」：
			 * 今天漏 = 去重闸此刻是坏的 → error；
			 * 历史漏 = 老评论，风险低但账不干净 → warn（否则天天红，没人再看）。 */
			const today = todayKey(Date.now())
			const fresh = missing.filter((m) => String(m.created || '').startsWith(today)).length
			result.issues.push({
				level: fresh ? 'error' : 'warn',
				code: fresh ? 'online-gap' : 'online-gap-old',
				msg: fresh
					? '线上有 ' + n + ' 条不在账本里，其中 ' + fresh + ' 条是今天的（去重闸现在是坏的）'
					: '线上有 ' + n + ' 条历史评论不在账本里（老账，不影响今天的去重）',
				evidence: { first: missing[0].cid, fresh },
			})
		} else if (!has('--json')) {
			process.stdout.write('线上核对：扫了 ' + (parsed.works || 0) + ' 条作品，账本一致\n')
		}
	}
	result.ok = !result.issues.some((i) => i.level === 'error')
	result.stats.errors = result.issues.filter((i) => i.level === 'error').length
	result.stats.warns = result.issues.length - result.stats.errors
}

if (has('--json')) {
	process.stdout.write(JSON.stringify({ home: HOME, ...result }, null, 2) + '\n')
} else {
	process.stdout.write('自检目录：' + HOME + '\n')
	process.stdout.write(render(result) + '\n')
	if (result.issues.length) {
		process.stdout.write('\n明细：\n')
		for (const i of result.issues) {
			process.stdout.write('  [' + i.level + '] ' + i.code + ' — ' + i.msg + '\n')
			if (i.evidence && Object.keys(i.evidence).length) {
				process.stdout.write('        ' + JSON.stringify(i.evidence) + '\n')
			}
		}
	}
}

process.exit(result.ok ? 0 : 1)
