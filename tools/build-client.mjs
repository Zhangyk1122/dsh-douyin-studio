/**
 * tools/build-client.mjs —— 把 assets/panel.css 压进 client.js
 * ============================================================================
 * 用法：node tools/build-client.mjs [--check]
 *   --check  只比较，不写盘；不一致退出码 1（check.mjs 也做同一份校验）
 *
 * 为什么需要构建：宿主只加载 package.json 里 exports["./client"] 指向的单个文件，
 * 没有打包器，也没法在浏览器里 import 一个 .css。但样式有 350 行，留在
 * client.js 里会把行数预算吃光 —— 于是源文件独立、生成物内联。
 *
 * 幂等：重复跑不会改变 client.js。压缩口径在 lib/panelcss.mjs，和验收共用。
 * ============================================================================
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CSS_START, CSS_END, expectedCss, inlineCss } from '../lib/panelcss.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = join(ROOT, 'client.js')
const checkOnly = process.argv.includes('--check')

const css = expectedCss(ROOT)
if (!css) {
	console.error('读不到 assets/panel.css，或它是空的')
	process.exit(1)
}
const src = readFileSync(CLIENT, 'utf8')
const cur = inlineCss(src)

if (cur === css) {
	console.log('client.js 样式已是最新（' + css.length + ' 字符）')
	process.exit(0)
}
if (checkOnly) {
	console.error('✗ client.js 里的样式和 assets/panel.css 不一致，跑 node tools/build-client.mjs')
	process.exit(1)
}

/* 仓库里 client.js 是 CRLF；构建产物要保持原行尾，别把整个文件刷成另一种。 */
const NL = src.includes('\r\n') ? '\r\n' : '\n'
const block = CSS_START + NL + '    const CSS = ' + JSON.stringify(css) + NL + CSS_END

let out
if (cur) {
	const i = src.indexOf(CSS_START)
	const j = src.indexOf(CSS_END, i) + CSS_END.length
	out = src.slice(0, i) + block + src.slice(j)
} else {
	// 首次迁移：从旧的模板字符串整块替换
	const start = src.indexOf('    /* ── 样式')
	const cs = src.indexOf('    const CSS = `', start)
	const m = /`\r?\n/.exec(src.slice(cs + 20))
	if (start < 0 || cs < 0 || !m) {
		console.error('找不到旧的 CSS 模板块，拒绝盲改 client.js')
		process.exit(1)
	}
	const ce = cs + 20 + m.index + m[0].length
	out = src.slice(0, start) + block + NL + src.slice(ce)
}
writeFileSync(CLIENT, out, 'utf8')
const before = src.split('\n').length - 1
const after = out.split('\n').length - 1
console.log('已重建 client.js：' + before + ' → ' + after + ' 行（省下 ' + (before - after) + ' 行）')
