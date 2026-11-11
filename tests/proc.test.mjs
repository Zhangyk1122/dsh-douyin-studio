/**
 * tests/proc.test.mjs —— 子进程异步化的回归测试
 * ============================================================================
 * 这个文件存在的唯一理由：守住「面板不该把宿主按死」这条线。
 *
 * 背景（2026-11-02）：index.js 原来用 spawnSync 起 tools/dy.mjs，
 * 那是同步的 —— /inbox 一次十几秒，整个 DSH 的事件循环就僵十几秒。
 * 换成了 spawn 之后，必须有一条测试能证明「多请求真的并发」，
 * 否则下次谁手一抖改回 Sync，测试也不会红。
 *
 * 判定方式不写死毫秒数（机器快慢不同会变flaky）：先量一条子进程单独跑多久，
 * 再量三条一起跑多久。并发的话总时长约等于一条，串行的话是三条。
 * ============================================================================
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execJson, parseResult } from '../lib/proc.mjs'

const dir = mkdtempSync(join(tmpdir(), 'dys-proc-'))
const child = join(dir, 'slow.mjs')
writeFileSync(child, `
const ms = Number(process.argv[2] || 0)
const mode = process.argv[3] || 'json'
setTimeout(() => {
  if (mode === 'noise') console.log('日志行：正在连浏览器')
  if (mode === 'plain') { console.log('这不是 JSON'); process.stderr.write('stderr 里的话\\n'); return }
  if (mode === 'badjson') { console.log('{ 坏掉的'); return }
  console.log(JSON.stringify({ ok: true, slept: ms, mode }))
}, ms)
`, 'utf8')

test('并发：三条子进程一起跑，总时长约等于一条（证明没有阻塞事件循环）', { timeout: 30000 }, async () => {
	const t0 = Date.now()
	const one = await execJson(child, ['300', 'json'], { timeout: 10000 })
	const single = Date.now() - t0
	assert.equal(one.ok, true)

	const t1 = Date.now()
	const many = await Promise.all([1, 2, 3].map(() => execJson(child, ['300', 'json'], { timeout: 10000 })))
	const concurrent = Date.now() - t1

	assert.equal(many.filter((r) => r.ok).length, 3)
	// 串行的话 concurrent ≈ single × 3；并发的话 ≈ single。
	// 留 25% 余量，避免机器抖动误报。
	assert.ok(
		concurrent < single * 3 * 0.75,
		`子进程没有并发：单条 ${single}ms，三条共 ${concurrent}ms（串行预期约 ${single * 3}ms）`,
	)
})

test('超时：到点杀掉并归类为 CDP，而不是挂着不动', { timeout: 20000 }, async () => {
	const t0 = Date.now()
	const r = await execJson(child, ['5000', 'json'], { timeout: 200 })
	const dt = Date.now() - t0
	assert.equal(r.ok, false)
	assert.equal(r.category, 'CDP')
	assert.match(r.error, /超时/)
	assert.ok(dt < 3000, `超时没生效，等了 ${dt}ms`)
})

test('没吐 JSON：归类 LOCAL，并带回 stderr 方便排查', { timeout: 20000 }, async () => {
	const r = await execJson(child, ['0', 'plain'], { timeout: 10000 })
	assert.equal(r.ok, false)
	assert.equal(r.category, 'LOCAL')
	assert.equal(r.error, '命令没返回 JSON')
	assert.match(r.stderr, /stderr 里的话/)
})

test('JSON 前面混着日志行也能解析', { timeout: 20000 }, async () => {
	const r = await execJson(child, ['0', 'noise'], { timeout: 10000 })
	assert.equal(r.ok, true)
	assert.equal(r.mode, 'noise')
})

test('坏 JSON 不抛，返回可读错误', { timeout: 20000 }, async () => {
	const r = await execJson(child, ['0', 'badjson'], { timeout: 10000 })
	assert.equal(r.ok, false)
	assert.equal(r.error, '返回不是合法 JSON')
})

test('parseResult：纯函数语义（不依赖真子进程）', () => {
	assert.deepEqual(parseResult({ out: '{"ok":true,"n":1}' }), { ok: true, n: 1 })
	assert.equal(parseResult({ out: '', err: '', killedByTimeout: true, timeout: 5 }).category, 'CDP')
	assert.match(parseResult({ out: '', killedByTimeout: true, timeout: 5 }).error, /5ms/)
	assert.equal(parseResult({ out: 'x', err: 'boom' }).stderr, 'boom')
	// 业务自己的 ok:false 要原样传出去，不能被包一层
	assert.deepEqual(parseResult({ out: '{"ok":false,"stage":"quota"}' }), { ok: false, stage: 'quota' })
	/* 一个 JSON 都没吐出来时，必须给对象（带 stderr），不能给 null/undefined ——
	 * 2026-11-11 那两轮 scan 就是「结果不是对象」把 `.ok` 读炸的。 */
	const none = parseResult({ out: '', err: 'Error: 没登录', code: 1 })
	assert.equal(typeof none, 'object')
	assert.equal(none.ok, false)
	assert.match(none.error, /没返回 JSON/)
	assert.match(none.stderr, /没登录/)
	assert.equal(typeof parseResult({ out: '0' }), 'object')
	assert.equal(parseResult({ out: '0' }).ok, false)
})
