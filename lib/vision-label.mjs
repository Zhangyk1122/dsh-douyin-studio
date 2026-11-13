/**
 * 入库时给表情包打标：名字 / 情绪 / 什么时候用。
 *
 * 平台的「添加到我的表情」没有公开接口，本地库能做的就是把图**看懂一次**，
 * 之后靠文字检索。看图这一步走外部命令（`DOUYIN_STUDIO_VISION_CMD`），
 * 没配就返回 `{ok:false, reason:'no-vision'}`，不猜。
 *
 * 输出约定：命令 stdout 里第一段 JSON（`{name,mood,tags,when}`）优先；
 * 没有 JSON 就把整段文字当 `when`，名字留空 —— 宁可少标，不要编。
 */

import { spawnSync } from 'node:child_process'

export const MAX_TEXT = 120

const pickJson = (s) => {
	const i = String(s || '').indexOf('{')
	if (i < 0) return null
	const j = String(s).lastIndexOf('}')
	if (j <= i) return null
	try {
		return JSON.parse(String(s).slice(i, j + 1))
	} catch {
		return null
	}
}

const words = (v, max = 6) =>
	String(v || '')
		.split(/[\s,，、;；]+/)
		.map((x) => x.trim())
		.filter(Boolean)
		.slice(0, max)

/** 纯函数：把命令输出折成标签。 */
export function parseLabel(raw, fallbackName = '') {
	const text = String(raw || '').trim()
	if (!text) return { ok: false, reason: 'empty' }
	const j = pickJson(text)
	if (j) {
		const tags = Array.isArray(j.tags) ? words(j.tags.join(' ')) : words(j.tags)
		return {
			ok: true,
			name: String(j.name || fallbackName).slice(0, 30),
			mood: String(j.mood || '').slice(0, 12),
			tags,
			when: String(j.when || j.usage || '').slice(0, MAX_TEXT),
		}
	}
	return { ok: true, name: fallbackName.slice(0, 30), mood: '', tags: [], when: text.slice(0, MAX_TEXT) }
}

/** 跑一次看图命令。 */
export function labelSticker(file, { cmd = process.env.DOUYIN_STUDIO_VISION_CMD || '', fallbackName = '', timeoutMs = 30000 } = {}) {
	if (!cmd) return { ok: false, reason: 'no-vision' }
	const parts = cmd.trim().split(/\s+/)
	const bin = parts[0]
	const args = [...parts.slice(1), String(file)]
	const r = spawnSync(bin, args, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true })
	if (r.error) return { ok: false, reason: String(r.error.message || r.error) }
	if (r.status !== 0) return { ok: false, reason: 'exit ' + r.status, stderr: String(r.stderr || '').slice(-400) }
	return parseLabel(r.stdout, fallbackName)
}
