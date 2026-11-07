/**
 * tools/preview-check.mjs —— 用真实浏览器渲染一遍面板，确认不是「语法过了但页面崩了」
 * ============================================================================
 * 起一个临时静态服务 → 在机器人 Chrome 里**新开一个标签** → 渲染 → 读 DOM → 关标签。
 * 不复用抖音标签页，验证完不会把值班页面弄丢。
 *
 *   node tools/preview-check.mjs            JSON 结果 + 退出码 0/1
 * ============================================================================
 */
import { startPreview } from './preview.mjs'
import { newTab, closeTab, connect } from '../lib/cdp.mjs'
import { sleep } from '../lib/chrome.mjs'

const PORT = Number(process.env.DOUYIN_PREVIEW_PORT || 52999)
const VIEW = process.env.DOUYIN_PREVIEW_VIEW || 'today'
const W = process.env.DOUYIN_PREVIEW_W || ''
const URL = `http://127.0.0.1:${PORT}/?view=${encodeURIComponent(VIEW)}&t=light${W ? '&w=' + encodeURIComponent(W) : ''}${process.env.DOUYIN_PREVIEW_NOSCHED ? '&noschedule=1' : ''}`

const evaluate = async (c, expr) => {
	const r = await c.send('Runtime.evaluate', {
		expression: `JSON.stringify((() => { try { return (${expr}) } catch (e) { return { __err: String(e && e.message || e) } } })())`,
		returnByValue: true,
	})
	return JSON.parse(String(r && r.result && r.result.value || '{}'))
}

const srv = await startPreview(PORT)
let tab = null
try {
	tab = await newTab(URL)
	if (!tab || !tab.id) throw new Error('开不出预览标签（Chrome CDP 没起？）')
	const c = await connect(tab, { dom: false })
	await sleep(3200)
	/* 设置页「时间」分组曾经溢出卡片：卡片背景在半途结束，看起来像另一个颜色的
	 * 面板把字段截断。这里把「最后一个字段必须落在卡片内」钉成回归检查。 */
	let enclosure = null
	if (VIEW === 'settings') {
		await c.send('Runtime.evaluate', {
			expression: `(() => { const b=[...document.querySelectorAll('[data-dys-tab]')].find(x=>x.innerText.indexOf('时间')===0); if(b)b.click(); return 1 })()`,
			returnByValue: true,
		})
		await sleep(400)
		enclosure = await evaluate(c, `(() => {
			const v=document.querySelector('[data-dys-view]'), card=v && v.querySelector('[data-dys-card]')
			if(!card) return { ok:false, why:'没有卡片' }
			const fs=[...document.querySelectorAll('[data-dys-field]')]
			const over=fs.length ? Math.round(fs[fs.length-1].getBoundingClientRect().bottom - card.getBoundingClientRect().bottom) : 0
			return { ok:over<=0, over, cardH:Math.round(card.getBoundingClientRect().height),
				scrollable:v.scrollHeight>v.clientHeight, fields:fs.length }
		})()`)
	}
	const r = await evaluate(c, `({
		react: typeof React, dom: typeof ReactDOM,
		rootLen: (document.getElementById('root')||{}).innerHTML.length,
		cards: document.querySelectorAll('[data-dys-card]').length,
		stats: Array.from(document.querySelectorAll('[data-dys-stat]')).map(x => x.innerText.replace(/\\n/g,'/')),
		trs: document.querySelectorAll('[data-dys-tr]').length,
		next: (document.querySelector('[data-dys-nexttxt]')||{}).innerText || '',
		log: document.querySelectorAll('[data-dys-logrow]').length,
		version: (document.body.innerText.match(/b\\d+/)||[''])[0],
		text: (document.body.innerText||'').slice(0,120).replace(/\\n/g,' ')
	})`)
	r.enclosure = enclosure
	r.ok = r.react === 'object' && r.rootLen > 1000 && r.cards > 0 && !r.__err
		&& (!enclosure || enclosure.ok)
	console.log(JSON.stringify(r, null, 1))
	process.exitCode = r.ok ? 0 : 1
} catch (e) {
	console.log(JSON.stringify({ ok: false, error: String((e && e.message) || e) }, null, 1))
	process.exitCode = 1
} finally {
	if (tab && tab.id) await closeTab(tab.id)
	srv.close()
}
