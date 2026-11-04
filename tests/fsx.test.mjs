/**
 * lib/fsx.mjs 的单元测试。
 * 重点不是「能写能读」，而是三件事：
 *   ① 写的时候不会留下半截文件（tmp + rename），失败也不留垃圾
 *   ② 读到坏文件时，**坏文件要被挪走留证**，不是悄悄当空的处理
 *   ③ 空文件 / 带 BOM / 形状不对，这三种要分清
 *
 * 注意 readJsonChecked 回的是 `{value, corrupt}`，corrupt 是**挪走后的路径**或 null，
 * 不是布尔值（要路径才能告诉人「证据在哪」）。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { atomicWriteJson, atomicWriteText, noBom, readJsonChecked, readJsonSafe } from '../lib/fsx.mjs'

const TMP = mkdtempSync(join(tmpdir(), 'fsx-test-'))
const f = (name) => join(TMP, name)

/** 连隔离出来的 `.corrupt-*` 和 `.tmp-*` 一起清，免得上一条的证据影响下一条 */
function clean(name) {
	for (const x of readdirSync(TMP)) {
		if (x === name || x.startsWith(name + '.')) {
			try { rmSync(join(TMP, x), { recursive: true, force: true }) } catch { /* 本来就没有 */ }
		}
	}
}

const corruptOf = (name) => readdirSync(TMP).filter((x) => x.startsWith(name + '.corrupt-'))
const tmpLeft = () => readdirSync(TMP).filter((x) => x.includes('.tmp-'))

before(() => clean('a.json'))
after(() => rmSync(TMP, { recursive: true, force: true }))

describe('fsx 写', () => {
	it('写完能原样读回来', () => {
		clean('a.json')
		const w = atomicWriteJson(f('a.json'), { n: 1, list: ['x'] })
		assert.equal(w.ok, true)
		assert.deepEqual(JSON.parse(readFileSync(f('a.json'), 'utf8')), { n: 1, list: ['x'] })
	})

	it('不留 .tmp 残留', () => {
		clean('a.json')
		atomicWriteJson(f('a.json'), { n: 2 })
		assert.deepEqual(tmpLeft(), [], '目录里还有临时文件：' + tmpLeft().join(','))
	})

	it('目录不存在也能写（自己建）', () => {
		const p = join(TMP, 'deep', 'deeper', 'b.json')
		const w = atomicWriteJson(p, { ok: 1 })
		assert.equal(w.ok, true)
		assert.equal(existsSync(p), true)
	})

	it('atomicWriteText 写的是原文，不多不少', () => {
		clean('t.txt')
		const w = atomicWriteText(f('t.txt'), 'line1\nline2\n')
		assert.equal(w.ok, true)
		assert.equal(readFileSync(f('t.txt'), 'utf8'), 'line1\nline2\n')
	})

	it('写不进去时回 {ok:false,error} 而不是抛', () => {
		/* 拿一个**普通文件**当父目录：mkdirSync 必定失败。
		   （别拿目录当目标试——rename 到已存在目录在不同平台上表现不一致） */
		const asFile = f('iamfile')
		writeFileSync(asFile, 'not a dir', 'utf8')
		const w = atomicWriteJson(join(asFile, 'sub.json'), { n: 1 })
		assert.equal(w.ok, false)
		assert.ok(String(w.error).length > 0, '失败要给 error 原文，不然又是静默')
		assert.deepEqual(tmpLeft(), [], '失败也要把临时文件清掉')
	})
})

describe('fsx 读', () => {
	it('文件不存在 → 回 fallback，corrupt 是 null', () => {
		clean('nope.json')
		const r = readJsonChecked(f('nope.json'), { empty: true })
		assert.deepEqual(r.value, { empty: true })
		assert.equal(r.corrupt, null)
	})

	it('空文件 → 回 fallback，**不算坏**（还没写过而已）', () => {
		clean('empty.json')
		writeFileSync(f('empty.json'), '', 'utf8')
		const r = readJsonChecked(f('empty.json'), { empty: true })
		assert.deepEqual(r.value, { empty: true })
		assert.equal(r.corrupt, null, '空文件被当成损坏 = 会白白隔离一个新装的文件')
		assert.equal(existsSync(f('empty.json')), true, '空文件不许被挪走')
	})

	it('只有空白的文件也一样不算坏', () => {
		clean('ws.json')
		writeFileSync(f('ws.json'), '  \n\t ', 'utf8')
		assert.equal(readJsonChecked(f('ws.json'), null).corrupt, null)
	})

	it('带 BOM 也能读', () => {
		clean('bom.json')
		writeFileSync(f('bom.json'), '\uFEFF{"a":1}', 'utf8')
		assert.deepEqual(readJsonSafe(f('bom.json'), null), { a: 1 })
	})

	it('noBom 只削开头那一个', () => {
		assert.equal(noBom('\uFEFF{"a":1}'), '{"a":1}')
		assert.equal(noBom('{"a":"\uFEFF"}'), '{"a":"\uFEFF"}')
		assert.equal(noBom(null), '')
	})

	it('坏 JSON → 回 fallback，把坏文件挪走留证，并写一行为什么', () => {
		clean('bad.json')
		writeFileSync(f('bad.json'), '{"a":1,,,', 'utf8')
		const r = readJsonChecked(f('bad.json'), { fb: 1 })
		assert.deepEqual(r.value, { fb: 1 })
		assert.ok(r.corrupt, '应该回一个证据路径')
		assert.equal(existsSync(f('bad.json')), false, '坏文件应该已经被挪走')
		const kept = corruptOf('bad.json')
		assert.equal(kept.length, 1, '应该正好留一份证据，实际：' + kept.join(','))
		assert.equal(readFileSync(join(TMP, kept[0]), 'utf8'), '{"a":1,,,', '证据内容要和原文件一模一样')
		assert.ok(existsSync(join(TMP, 'corrupt-why.txt')), '要写一行为什么')
		assert.match(readFileSync(join(TMP, 'corrupt-why.txt'), 'utf8'), /bad\.json/)
		assert.equal(String(r.corrupt), join(TMP, kept[0]), 'corrupt 要指向那份证据')
	})

	it('形状不对（validate 说不行）→ 一样算坏', () => {
		clean('shape.json')
		writeFileSync(f('shape.json'), '[1,2,3]', 'utf8')
		const v = (x) => x && typeof x === 'object' && !Array.isArray(x)
		const r = readJsonChecked(f('shape.json'), {}, v)
		assert.ok(r.corrupt, '数组能 parse，但这个文件只该是对象')
		assert.deepEqual(r.value, {})
	})

	it('形状对的时候 validate 不误伤', () => {
		clean('shape2.json')
		writeFileSync(f('shape2.json'), '{"a":1}', 'utf8')
		const v = (x) => x && typeof x === 'object' && !Array.isArray(x)
		const r = readJsonChecked(f('shape2.json'), {}, v)
		assert.equal(r.corrupt, null)
		assert.deepEqual(r.value, { a: 1 })
	})

	it('readJsonSafe 只给值，不啰嗦', () => {
		clean('safe.json')
		writeFileSync(f('safe.json'), '{"k":"v"}', 'utf8')
		assert.deepEqual(readJsonSafe(f('safe.json'), null), { k: 'v' })
	})

	it('隔离只发生一次：文件已经没了，再读不产生第二份证据', () => {
		clean('bad2.json')
		writeFileSync(f('bad2.json'), 'not json at all', 'utf8')
		readJsonSafe(f('bad2.json'), null)
		const first = corruptOf('bad2.json').length
		assert.equal(readJsonSafe(f('bad2.json'), 'fallback'), 'fallback')
		assert.equal(corruptOf('bad2.json').length, first, '不该越读越多')
		assert.equal(first, 1)
	})
})
