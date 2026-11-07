/**
 * tools/typecheck.mjs —— 类型边界的「零依赖版本」
 * ============================================================================
 * 原建议是 JSDoc + `tsc --checkJs`。本机没有 tsc，而本项目的硬规矩是零运行时依赖，
 * 所以分两层落地：
 *   ① `jsconfig.json`：编辑器（VS Code 自带 TS）对纯模块开 checkJs，写的时候就有类型提示
 *   ② 本文件：验收时强制「每个导出都带 JSDoc 契约」，没写的直接红
 * ② 不是类型检查本身，但它保证 ① 有东西可检查 —— 没注释的导出，checkJs 也帮不上忙。
 * 将来装了 TypeScript，直接 `npx tsc -p jsconfig.json` 就能升级成完整检查。
 *
 * 用法：node tools/typecheck.mjs [--json]
 * ============================================================================
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 只管纯模块：碰浏览器/宿主的那些文件交给运行时测试和真机验证。 */
export const SCOPE = [
	'store.mjs', 'publish-rules.mjs', 'scheduler.mjs', 'schedule.mjs', 'reltime.mjs', 'roundstate.mjs', 'runlog.mjs',
	'panelcss.mjs', 'viewmodel.mjs', 'dashboard.mjs', 'selfcheck.mjs', 'policy.mjs',
]

const EXPORT_RE = /^export\s+(async\s+)?function\s+\w+|^export\s+const\s+\w+\s*=\s*\(/
const isDocEnd = (line) => /\*\/\s*$/.test(String(line || '').trim())

/**
 * @param {string} root
 * @returns {{checked:number, exports:number, issues:string[], missingConfig:boolean}}
 */
export function contractIssues(root = ROOT) {
	const issues = []
	let checked = 0
	let exports = 0
	if (!existsSync(join(root, 'jsconfig.json'))) issues.push('jsconfig.json 不见了')
	for (const name of SCOPE) {
		const p = join(root, 'lib', name)
		if (!existsSync(p)) { issues.push('缺文件：lib/' + name); continue }
		checked++
		const lines = readFileSync(p, 'utf8').split(/\r?\n/)
		lines.forEach((line, i) => {
			if (!EXPORT_RE.test(line)) return
			exports++
			if (!isDocEnd(lines[i - 1])) issues.push('lib/' + name + ':' + (i + 1) + ' 导出没有 JSDoc 契约')
		})
	}
	return { checked, exports, issues, missingConfig: !existsSync(join(root, 'jsconfig.json')) }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const r = contractIssues()
	if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 1))
	else if (r.issues.length) {
		console.error('✗ 类型契约 ' + r.issues.length + ' 处：')
		for (const x of r.issues) console.error('  ' + x)
	} else {
		console.log('✓ 类型契约 ' + r.checked + ' 个纯模块 / ' + r.exports + ' 个导出都有 JSDoc；编辑器按 jsconfig.json 做 checkJs')
	}
	process.exit(r.issues.length ? 1 : 0)
}
