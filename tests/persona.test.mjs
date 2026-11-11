import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { personaForDy, readPersonaCard, defaultPersonaFile, GENERIC } from '../lib/persona.mjs'

test('读得到卡：返回原文，并补一句抖音场景', () => {
	const dir = mkdtempSync(join(tmpdir(), 'dy-persona-'))
	const f = join(dir, 'xiaoxi.md')
	writeFileSync(f, '# 小汐\n\n说话短，一句一件事。\n', 'utf8')
	const out = personaForDy({ personaSource: 'aurabot', personaFile: f })
	assert.match(out, /一句一件事/)
	assert.match(out, /现在这里是抖音/)
	assert.match(out, /不分条/)
})

test('读不到卡：走 fallback，不返回空串', () => {
	const out = personaForDy({ personaSource: 'aurabot', personaFile: 'C:/definitely/not/here.md' }, {
		fallback: () => '旧摘要：你是账号主人',
	})
	assert.equal(out, '旧摘要：你是账号主人')
})

test('读不到卡又没有 fallback：给中性人设，不崩', () => {
	assert.equal(personaForDy({ personaSource: 'aurabot', personaFile: 'C:/nope.md' }), GENERIC)
})

test('personaSource=off 一律中性；手写 persona 优先于卡', () => {
	assert.equal(personaForDy({ personaSource: 'off' }), GENERIC)
	assert.equal(personaForDy({ personaSource: 'aurabot', persona: '我是小汐' }), '我是小汐')
})

test('卡改过就该读到新内容（mtime 缓存不粘住）', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'dy-persona-'))
	const f = join(dir, 'a.md')
	writeFileSync(f, '第一版', 'utf8')
	assert.match(readPersonaCard(f), /第一版/)
	await new Promise((r) => setTimeout(r, 12))
	writeFileSync(f, '第二版', 'utf8')
	assert.match(readPersonaCard(f), /第二版/)
})

test('默认路径指向 aurabot 的人格卡目录', () => {
	assert.match(defaultPersonaFile('xiaoxi'), /plugins-data[\\/]aurabot[\\/]personas[\\/]xiaoxi\.md$/)
})
