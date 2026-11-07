/**
 * tests/tool-output.test.mjs —— 工具返回值必须过得了自己的 output schema
 * ============================================================================
 * 2026-11-07 的 P0：v0.4.2 那三条新工具（unattended / engage / jobs）一律返回
 * `invalid output: "value" must be an object` —— 因为包装层 `ok()` 返回的是
 * `JSON.stringify(v)`（字符串），而 index.js 给它们的 schema 是 `type:'object'`。
 *
 * 老工具没暴露，是因为它们走 `lib/tools.mjs` 的 `safe()`（返回对象）。
 * 也就是说：**「返回类型」这件事一直没人测**，跑完 474 个用例照样漏。
 *
 * 这组用例把那条契约钉死：定义里声明 type:'object' 的工具，execute 必须真的返回对象，
 * 而且能被 JSON 往返（宿主序列化的时候不会炸）。
 * ============================================================================
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerExtraTools } from '../lib/tools-extra.mjs'

/** 和 index.js:178 保持一致的输出定义（schema 是 object，不是 string） */
const textOutput = {
	schema: { type: 'object', properties: {}, additionalProperties: true },
	render: (_a, v) => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }],
}

/** 把注册器拦下来，拿到三条工具的 spec（真工具、假宿主） */
function captureExtraSpecs() {
	const specs = []
	const ctx = { tools: { register: (spec) => { specs.push(spec); return spec } } }
	const defineTool = (spec) => spec
	registerExtraTools({ ctx, defineTool, textOutput })
	return specs
}

test('三条新工具注册了，且 output 指向对象 schema', () => {
	const specs = captureExtraSpecs()
	assert.deepEqual(specs.map((s) => s.name).sort(), ['douyin_studio_engage', 'douyin_studio_jobs', 'douyin_studio_unattended'])
	for (const s of specs) {
		assert.equal(s.output, textOutput, `${s.name} 没有用 textOutput`)
		assert.equal(s.output.schema.type, 'object', `${s.name} 的 schema 不是 object`)
	}
})

test('每条工具的 execute 返回对象（不许返回 JSON 字符串）', async () => {
	const specs = captureExtraSpecs()
	for (const s of specs) {
		/* 只跑「看」的分支：默认 action=status / count 缺省，不写设置、不发东西 */
		const out = await s.execute({})
		assert.notEqual(typeof out, 'string', `${s.name} 返回了字符串（宿主会报 "value" must be an object）`)
		assert.equal(typeof out, 'object', `${s.name} 的返回值不是对象：${typeof out}`)
		assert.ok(out && !Array.isArray(out), `${s.name} 的返回值必须是普通对象`)
		assert.doesNotThrow(() => JSON.parse(JSON.stringify(out)), `${s.name} 的返回值不能 JSON 往返`)
	}
})

test('jobs 的载荷形状稳定（ok / killed / file／jobs 数组）', async () => {
	const specs = captureExtraSpecs()
	const jobs = specs.find((s) => s.name === 'douyin_studio_jobs')
	const out = await jobs.execute({ count: 3 })
	assert.equal(out.ok, true)
	assert.equal(typeof out.killed, 'boolean')
	assert.equal(typeof out.file, 'string')
	assert.ok(Array.isArray(out.jobs))
	assert.ok(out.jobs.length <= 3, 'count 上限没生效')
})

test('无人值守 / 互动灰度：默认只读，不因为「看一眼」就改设置', async () => {
	const specs = captureExtraSpecs()
	const un = specs.find((s) => s.name === 'douyin_studio_unattended')
	const en = specs.find((s) => s.name === 'douyin_studio_engage')
	const a = await un.execute({})
	const b = await en.execute({})
	assert.equal(a.ok, true)
	assert.equal(b.ok, true)
	/* 两个 status 分支都该带 file 路径，方便排查「开关到底写哪了」 */
	assert.equal(typeof a.file, 'string')
	assert.equal(typeof b.file, 'string')
})
