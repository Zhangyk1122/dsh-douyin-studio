/**
 * tests/guard.test.mjs —— 跨站守卫的回归测试
 * ============================================================================
 * 为什么要有：这套本地接口没有 token，一旦被判成「只有本机页面会调」就完事了，
 * 那任意网页都能 POST /dm/send 让插件以你的身份发私信。
 * 守卫本身是纯函数，用真请求头形状喂它就行，不用起服务器。
 * ============================================================================
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkOrigin } from '../lib/guard.mjs'

const HOST = '127.0.0.1:3080'
const opts = { allow: [] } // 关掉白名单环境变量，测试结果不受本机配置影响

test('别的站发来的（Sec-Fetch-Site: cross-site）→ 拒', () => {
	const r = checkOrigin({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example', host: HOST }, opts)
	assert.equal(r.ok, false)
	assert.match(r.why, /cross-site/)
})

test('同源页面自己调的 → 放行', () => {
	const r = checkOrigin({ 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:3080', host: HOST }, opts)
	assert.equal(r.ok, true)
})

test('用户直接打开页面（none）→ 放行', () => {
	const r = checkOrigin({ 'sec-fetch-site': 'none', origin: 'http://127.0.0.1:3080', host: HOST }, opts)
	assert.equal(r.ok, true)
})

test('curl / 命令行：一个头都没有 → 放行（别误伤非浏览器调用）', () => {
	assert.equal(checkOrigin({ host: HOST }, opts).ok, true)
	assert.equal(checkOrigin({}, opts).ok, true)
})

test('老浏览器不发光 Sec-Fetch-Site，但 Origin 对得上 → 放行', () => {
	const r = checkOrigin({ origin: 'http://127.0.0.1:3080', host: HOST }, opts)
	assert.equal(r.ok, true)
})

test('Origin 与 Host 对不上 → 拒', () => {
	const r = checkOrigin({ origin: 'http://127.0.0.1:9999', host: HOST }, opts)
	assert.equal(r.ok, false)
	assert.match(r.why, /不一致/)
})

test('Origin: null（file:// 或沙箱 iframe）→ 拒', () => {
	const r = checkOrigin({ origin: 'null', host: HOST }, opts)
	assert.equal(r.ok, false)
	assert.match(r.why, /null/)
})

test('Origin 写坏了 → 拒，不许抛', () => {
	const r = checkOrigin({ origin: '不是个 URL', host: HOST }, opts)
	assert.equal(r.ok, false)
	assert.match(r.why, /解析不了/)
})

test('白名单里的源 → 放行（给反代 / 自定义域名留的口子）', () => {
	const r = checkOrigin(
		{ 'sec-fetch-site': 'same-site', origin: 'https://dy.example.com', host: 'internal:3080' },
		{ allow: ['https://dy.example.com'] },
	)
	assert.equal(r.ok, true)
	assert.match(r.why, /白名单/)
})

test('白名单只认完整 origin（端口不同不算）', () => {
	const r = checkOrigin(
		{ origin: 'https://dy.example.com:8443', host: 'internal:3080' },
		{ allow: ['https://dy.example.com'] },
	)
	assert.equal(r.ok, false)
})
