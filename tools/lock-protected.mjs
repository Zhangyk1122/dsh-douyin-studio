#!/usr/bin/env node
/**
 * tools/lock-protected.mjs —— 生成/更新「禁改区」的哈希基线
 * ============================================================================
 * 禁改区（budget / api / im-send / publish-*）靠自觉是守不住的：
 * 任何人顺手改一行，tools/check.mjs 照样全绿——它只查"有没有同步子进程"。
 * 这里给每个文件存一份 md5，check 时逐个比对。
 *
 * 真要改禁改区时：
 *   1. 改完跑一次本脚本（基线更新）
 *   2. 在 qq-pet/CHANGES.md 里写清为什么改、风险是什么
 * 不改就更新基线 = 把刹车拆了，请别这么干。
 * ============================================================================
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

/* 只列真·禁改区。可改的（settings/policy/picks…）不要放进来，
 * 否则每改一次业务逻辑就得重刷基线，这个检查会变成噪音。 */
const PROTECTED = [
	'lib/budget.mjs',
	'lib/api.mjs',
	'lib/im-send.mjs',
	'lib/publish.mjs',
	'lib/publish-steps.mjs',
	'lib/publish-cli.mjs',
	'lib/publish-cdp.mjs',
]

const out = {}
for (const rel of PROTECTED) {
	const buf = readFileSync(join(ROOT, rel))
	out[rel] = createHash('md5').update(buf).digest('hex')
}
const file = join(HERE, 'protected.json')
writeFileSync(file, JSON.stringify(out, null, '\t') + '\n', 'utf8')
process.stdout.write('已写入 ' + file + '\n' + Object.keys(out).map((k) => '  ' + out[k] + '  ' + k).join('\n') + '\n')
