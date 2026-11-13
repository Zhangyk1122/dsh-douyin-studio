/**
 * 评论带图：把本地图塞进视频页的评论输入区。
 *
 * 和私信侧同一套做法（`lib/sticker-send.mjs` 的 `stageFile` + 回车），
 * 只是目标页面从 `/chat` 换成 `/video/<id>`，输入框从私信编辑框换成评论区。
 *
 * 不直接调接口的原因：评论带图要先上传到平台的图片服务拿 `uri`，
 * 那个上传口子没有公开文档、也没在真号上验过；而页面上本来就有「图片」按钮，
 * 走它等于替人点，风险最小。
 */

import { existsSync } from 'node:fs'
import { stageFile, pressEnter } from './sticker-send.mjs'

export const videoUrl = (aweme) => `https://www.douyin.com/video/${encodeURIComponent(String(aweme || ''))}`

/** 找评论输入区：优先 `[data-e2e="comment-input"]`，再退到 contenteditable。 */
export const commentBoxJs = `(() => {
  const pick = ['[data-e2e="comment-input"]', '[contenteditable="true"]', 'div[role="textbox"]']
  for (const sel of pick) {
    const el = document.querySelector(sel)
    if (el) {
      const r = el.getBoundingClientRect()
      return JSON.stringify({ found: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), sel })
    }
  }
  return JSON.stringify({ found: false })
})()`

/** 纯函数：这一条评论带图能不能发（文案可空，图必须有）。 */
export function planCommentImage({ aweme, file } = {}) {
	if (!String(aweme || '').trim()) return { ok: false, why: '缺 aweme（要评论哪条视频）' }
	if (!file || !existsSync(String(file))) return { ok: false, why: '图不在磁盘上：' + String(file || '(空)') }
	return { ok: true, aweme: String(aweme), file: String(file) }
}

/**
 * 发一条带图评论。
 * `dry`：塞图 + 打文案，不回车（用来确认图真进了评论框）。
 */
export async function commentWithImage({ aweme, file, text = '', dry = false } = {}) {
	const plan = planCommentImage({ aweme, file })
	if (!plan.ok) return { ok: false, error: plan.why }
	const { openPage, sleep } = await import('./chrome.mjs')
	const log = []
	let c = null
	try {
		c = await openPage({ url: videoUrl(aweme), navigate: true })
		await sleep(2000)
		let box = null
		for (let i = 0; i < 10; i++) {
			const res = await c.send('Runtime.evaluate', { expression: commentBoxJs, returnByValue: true })
			const val = res && res.result ? res.result.value : null
			const j = val ? (typeof val === 'string' ? JSON.parse(val) : val) : null
			if (j && j.found) {
				box = j
				break
			}
			await sleep(600)
		}
		if (!box) return { ok: false, error: '找不到评论输入区（可能要登录，或页面结构变了）', log }
		log.push('评论框已定位：' + box.sel)

		for (const type of ['mousePressed', 'mouseReleased']) {
			await c.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 })
		}
		await sleep(300)

		const staged = await stageFile(c, file)
		if (!staged.ok) return { ok: false, error: staged.error, log }
		log.push('图已塞进评论框')
		await sleep(1200)

		if (text) {
			await c.send('Input.insertText', { text: String(text).slice(0, 120) })
			log.push('文案已写入')
		}
		if (dry) return { ok: true, dry: true, aweme, file, note: '没按回车（dry）', log }

		const sent = await pressEnter(c)
		if (!sent.ok) return { ok: false, error: '回车没发出去：' + sent.error, log }
		await sleep(1500)
		return { ok: true, aweme, file, text, log }
	} catch (e) {
		return { ok: false, error: String((e && e.message) || e), log }
	} finally {
		try { c && c.close && c.close() } catch { /* 已断 */ }
	}
}
