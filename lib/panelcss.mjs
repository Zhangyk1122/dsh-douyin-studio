/**
 * lib/panelcss.mjs —— 面板样式的唯一真源与压缩口径
 * ============================================================================
 * 宿主只认一个 client.js（package.json 的 exports["./client"]），所以样式最终
 * 必须内联进那个文件。但把 350 行 CSS 原文留在 client.js 里，会吃掉整个行数预算：
 * 1938/1940，任何新卡片都加不进去。
 *
 * 于是：assets/panel.css 是可读的源文件，tools/build-client.mjs 把它压成一行写回
 * client.js。压缩口径放在这里，构建脚本和 check.mjs 共用同一份 —— 检查的不是
 * "有没有改过样式"，而是"client.js 里的样式和源文件是不是同一份"。
 * ============================================================================
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const CSS_START = '    /* CSS-GENERATED: 改样式请编辑 assets/panel.css，再跑 node tools/build-client.mjs */'
export const CSS_END = '    /* CSS-GENERATED-END */'

/** @param {string} root 插件根目录 @returns {string} */
export const cssSourceFile = (root) => join(root, 'assets', 'panel.css')

/** 保守压缩：去注释、换行折成空格、连续空白并一。不用激进规则，避免改坏 calc()/选择器。 */
export function minifyCss(css) {
	return String(css || '')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/\s*\n\s*/g, ' ')
		.replace(/[ \t]{2,}/g, ' ')
		.replace(/\s*([{}:;,>])\s*/g, '$1')
		.trim()
}

/** 读源文件并压缩。check.mjs 与 build-client.mjs 都调它，口径不会分叉。 */
export function expectedCss(root) {
	try { return minifyCss(readFileSync(cssSourceFile(root), 'utf8')) } catch { return '' }
}

/** 从 client.js 里取出当前内联的 CSS（找不到标记就返回空串）。 */
export function inlineCss(clientText) {
	const s = String(clientText || '')
	const i = s.indexOf(CSS_START)
	const j = s.indexOf(CSS_END, i + 1)
	if (i < 0 || j < 0) return ''
	const m = /const CSS = ("(?:[^"\\]|\\.)*")/.exec(s.slice(i, j))
	if (!m) return ''
	try { return JSON.parse(m[1]) } catch { return '' }
}
