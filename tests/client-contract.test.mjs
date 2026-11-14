/**
 * 前后端契约：后端要求 `confirm: true` 才真动手的路径，前端每一处调用都必须带上。
 *
 * 0.7.6 的发布卡就是坏在这里 —— 前端做了「点两次」的本地 arm，payload 里却没有
 * confirm，后端永远回 needsConfirm，草稿也发不出去。711 个测试一个都没抓到，
 * 因为它们全在后端。这条测试把「前端发了什么」也纳入检查。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (name) => readFileSync(fileURLToPath(new URL('../' + name, import.meta.url)), 'utf8')
const client = read('client.js')
const server = read('index.js')

const GATED = ['/queue/retry', '/queue/clear', '/publish', '/reply', '/dm/send', '/picks/act']

/** 取真正的调用点（jpost / onPost / post 后面紧跟路径字面量），
 *  路径出现在比较或注释里不算。 */
function sites(path) {
	const out = []
	for (const fn of ['jpost(', 'onPost(', 'post(']) {
		const needle = fn + "'" + path + "'"
		let i = 0
		while ((i = client.indexOf(needle, i)) >= 0) {
			out.push(client.slice(i, i + 420))
			i += needle.length
		}
	}
	return out
}

test('前提：后端确实有「不带 confirm 就只回 needsConfirm」的路径', () => {
	assert.match(server, /body\.confirm !== true/)
})

for (const path of GATED) {
	test('前端调用 ' + path + ' 时必须带 confirm', () => {
		const found = sites(path)
		assert.ok(found.length > 0, path + ' 在 client.js 里找不到调用点')
		for (const w of found) {
			assert.match(w, /confirm/, path + ' 的调用点没带 confirm —— 后端会永远回 needsConfirm，用户只会一直点')
		}
	})
}

test('发布要带 kind，否则视频会被当图文走 --img', () => {
	const found = sites('/publish')
	assert.ok(found.length > 0)
	for (const w of found) assert.match(w, /kind:/, '/publish 的调用点没带 kind')
})
