/**
 * tools/rules-drift.mjs —— 两套发布链的规则有没有分叉
 * 只读，不修改任何文件。找得到第二链就核，找不到就明确说"跳过"，不误报。
 * 用法：node tools/rules-drift.mjs [--json]
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { TITLE_MAX, AT_MIN_HOURS, AT_MAX_DAYS, DRIFT_PATTERNS, titleLimitFor } from '../lib/publish-rules.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 第二套链可能在 DSH 桌面 profile，也可能在 E: 工作区；都不在就算跳过。 */
export function externalCandidates() {
	const c = [
		join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', 'desktop', 'qq-pet', 'publish.mjs'),
		'E:/admin/Documents/ds harness/qq-pet/publish.mjs',
	]
	return c.filter((p) => { try { return existsSync(p) } catch { return false } })
}

/**
 * @param {string} root
 * @returns {{ok:boolean, checked:number, issues:string[], notes:string[]}}
 */
export function driftIssues(root = ROOT) {
	const issues = []
	const notes = []
	let checked = 0
	if (titleLimitFor('video') !== TITLE_MAX.video || titleLimitFor('image') !== TITLE_MAX.image) {
		issues.push('共享规则自检没过')
	}
	const plugin = join(root, 'lib', 'publish.mjs')
	if (existsSync(plugin)) {
		checked++
		const t = readFileSync(plugin, 'utf8')
		if (!DRIFT_PATTERNS.plugin.test(t)) issues.push('插件侧发布规则的写法变了，确认是否还是 20/30')
		if (!new RegExp('AT_MAX_DAYS\\s*=\\s*' + AT_MAX_DAYS).test(t)) issues.push('插件侧定时上限与共享规则不一致')
		if (!new RegExp('AT_MIN_HOURS\\s*=\\s*' + AT_MIN_HOURS).test(t)) issues.push('插件侧定时下限与共享规则不一致')
	}
	const ext = externalCandidates()
	if (!ext.length) notes.push('没找到第二套发布链，跳过')
	for (const p of ext) {
		checked++
		const t = readFileSync(p, 'utf8')
		if (!DRIFT_PATTERNS.qqpet.test(t)) issues.push('qq-pet 发布标题上限写法变了：' + p)
	}
	if (!issues.length) notes.push('两条链都是 视频 ' + TITLE_MAX.video + ' / 图文 ' + TITLE_MAX.image + ' 字')
	return { ok: issues.length === 0, checked, issues, notes }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const r = driftIssues()
	if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 1))
	else {
		console.log((r.ok ? '✓ ' : '✗ ') + '发布规则核对 ' + r.checked + ' 条链：' + r.notes.join('；'))
		for (const x of r.issues) console.log('  ! ' + x)
	}
	process.exit(r.ok ? 0 : 1)
}
