/**
 * tests/contract.test.mjs —— 文档 / 代码 / 打包三处说同一件事
 * ============================================================================
 * 这些都是"看起来对、用起来错"的错：工具描述写 55 字（代码 30）、
 * SKILL.md 漏一个写操作工具、npm 包漏 assets（装到别人机器上样式空白）。
 * 它们不会让任何单元测试变红，只会让人在真机上踩。所以单独拿静态检查钉住。
 * ============================================================================
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULTS } from '../lib/settings.mjs'
import { TITLE_MAX, titleHint, DECLARE_VALUES } from '../lib/publish-rules.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

test('发布规则只有一份真源', () => {
	assert.equal(TITLE_MAX.video, 30)
	assert.equal(TITLE_MAX.image, 20)
	assert.equal(titleHint(), '图文 ≤20 字，视频 ≤30 字')
	assert.deepEqual(DECLARE_VALUES, ['ai', 'view', 'repost', 'market', 'fiction', 'none'])
})

test('工具描述里没有手写的错误上限', () => {
	const src = read('lib/tools.mjs')
	assert.doesNotMatch(src, /≤\s*55\s*字/)
	assert.match(src, /titleHint\(\)/)
})

test('每个注册的工具都在 SKILL.md 里', () => {
	const src = read('lib/tools.mjs')
	const skill = read('SKILL.md')
	const names = [...new Set([...src.matchAll(/name:\s*'(douyin_studio_[a-z_]+)'/g)].map((m) => m[1]))]
	assert.ok(names.length >= 30, '只认出 ' + names.length + ' 个工具')
	const missing = names.filter((n) => !skill.includes(n))
	assert.deepEqual(missing, [])
})

test('package.json files 覆盖运行时与文档资产', () => {
	const pkg = JSON.parse(read('package.json'))
	const files = (pkg.files || []).map((f) => String(f).replace(/\/$/, ''))
	for (const need of ['index.js', 'client.js', 'lib', 'tools', 'assets', 'cordis.patch.yml', 'SKILL.md', 'README.md']) {
		assert.ok(files.includes(need), 'files 漏了 ' + need)
	}
	for (const f of files) {
		assert.doesNotThrow(() => statSync(join(ROOT, f)), f + ' 不存在')
	}
})

test('新装默认只读：不刷、不盯、写操作过总闸', () => {
	assert.equal(DEFAULTS.scanRounds, 0)
	assert.match(read('index.js'), /watchOn:\s*z\.boolean\(\)\.default\(false\)/)
	assert.match(read('index.js'), /isKilled\(\)/)
	assert.match(read('lib/tools.mjs'), /isKilled\(\)/)
})
