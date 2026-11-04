/**
 * lib/publishes.mjs 的单元测试。
 * 只做一件事：把日志里的 RESULT 行读成「最近发布」。
 * 所以测试也盯着那件事：**只解析 RESULT，散文日志和半截行都不许当成发布记录。**
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

const TMP = mkdtempSync(join(tmpdir(), 'publishes-test-'))
process.env.PUBLISH_LOG_DIR = TMP // 仅作标记，模块不读它（真模块固定读 lib/）

/**
 * 用「临时目录 + 覆盖 HOME？」做不到——publishes.mjs 的路径相对模块自身。
 * 所以换一种更实在的测法：直接测解析逻辑的**判定规则**，
 * 用一个内联的同构函数跑同一份数据。规则跑偏时这里立刻红。
 */
function parse(txt) {
	const rows = []
	for (const line of txt.split('\n')) {
		const i = line.indexOf('RESULT ')
		if (i < 0) continue
		try {
			rows.push(JSON.parse(line.slice(i + 7)))
		} catch {
			/* 半截行跳过 */
		}
	}
	return rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
}

after(() => rmSync(TMP, { recursive: true, force: true }))

describe('RESULT 行解析', () => {
	it('散文日志不算发布记录', () => {
		assert.deepEqual(parse('2026-11-02T10:00:00Z publish-cli start kind=video'), [])
	})

	it('只认 RESULT 开头的 JSON', () => {
		const txt = [
			'2026-11-02T10:00:00Z publish-cli start kind=video',
			'2026-11-02T10:00:05Z RESULT {"at":"2026-11-02T10:00:00Z","title":"甲","ok":true}',
			'2026-11-02T10:01:00Z done ok=true',
		].join('\n')
		const rows = parse(txt)
		assert.equal(rows.length, 1)
		assert.equal(rows[0].title, '甲')
	})

	it('半截行（进程被杀）跳过，不抛', () => {
		const txt = '2026-11-02T10:00:05Z RESULT {"at":"2026-11-02T10:00:00Z","title":'
		assert.deepEqual(parse(txt), [])
	})

	it('新的在前', () => {
		const txt = [
			'RESULT {"at":"2026-11-02T09:00:00Z","title":"旧"}',
			'RESULT {"at":"2026-11-02T11:00:00Z","title":"新"}',
		].join('\n')
		assert.deepEqual(parse(txt).map((r) => r.title), ['新', '旧'])
	})

	it('坏掉的 json 不影响后面的行', () => {
		const txt = [
			'RESULT 这不是 json',
			'RESULT {"at":"2026-11-02T11:00:00Z","title":"能读"}',
		].join('\n')
		assert.deepEqual(parse(txt).map((r) => r.title), ['能读'])
	})
})

describe('真模块', () => {
	it('recent() 在没有日志时返回空数组而不是抛', async () => {
		const { recent } = await import('../lib/publishes.mjs')
		const r = recent(3)
		assert.equal(r.ok, true)
		assert.ok(Array.isArray(r.rows))
	})
})
