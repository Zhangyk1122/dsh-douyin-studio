#!/usr/bin/env node
/**
 * tools/status.mjs —— 生成 docs/STATUS.md（机器写的现状页）
 * ============================================================================
 * 为什么要有它：HANDOFF 第 1 节曾经写「b21 / 1565 行 / 242 例」，而代码已经是
 * b35 / 1937 / 384 —— 数字靠人手抄必然过期。这个脚本每次跑都重新采样，
 * 让"现状"只有一处是真源，别的文档一律引用它。
 *
 * 用法：node tools/status.mjs
 * 产出：docs/STATUS.md（覆盖写）
 * ============================================================================
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRuns, summarize } from '../lib/runlog.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const run = (args) =>
	spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 300000, windowsHide: true })

const lines = (f) => {
	try { return readFileSync(join(ROOT, f), 'utf8').split('\n').length } catch { return 0 }
}
const files = (dir, ext) => {
	const p = join(ROOT, dir)
	if (!existsSync(p)) return 0
	return readdirSync(p).filter((f) => f.endsWith(ext)).length
}

const check = run([join('tools', 'check.mjs'), '--quick'])
const checkOut = String(check.stdout || '').trim()
const checkOk = check.status === 0

const self = run([join('tools', 'selfcheck.mjs'), '--json'])
let selfData = null
try { selfData = JSON.parse(String(self.stdout || '')) } catch { selfData = null }

const runs = readRuns(60)
const s = summarize(runs)
const clientLines = lines('client.js')
const idxLines = lines('index.js')

const badge = (ok) => (ok ? '✅' : '❌')
const md = `# 现状（自动生成）

> 由 \`node tools/status.mjs\` 生成于 ${new Date().toISOString().slice(0, 19).replace('T', ' ')}（UTC）
> **本页数字不要手改** —— 要更新就重跑脚本；其它文档引用这里，不要各写一份。

## 一、体量

| 项 | 值 |
|---|---|
| \`client.js\` | ${clientLines} 行 |
| \`index.js\` | ${idxLines} 行 |
| lib 模块 | ${files('lib', '.mjs')} 个 |
| 测试文件 | ${files('tests', '.mjs')} 个 |
| 受保护文件 | 7 个（\`tools/protected.json\`） |

## 二、验收

${badge(checkOk)} \`node tools/check.mjs --quick\`

\`\`\`
${checkOut}
\`\`\`

## 三、行为自检

${selfData ? `${badge(selfData.ok)} ${selfData.stats ? `回复 ${selfData.stats.todayReplies} 条 / 出口 ${selfData.stats.todayEntries} 次 · 错误 ${selfData.stats.errors} · 提醒 ${selfData.stats.warns}` : ''}` : '（自检没跑成）'}

${selfData && selfData.issues && selfData.issues.length
		? selfData.issues.map((i) => `- ${i.level === 'error' ? '❌' : '⚠️'} \`${i.code}\` ${i.msg}`).join('\n')
		: '- 没有异常'}

## 四、最近动作（runs.jsonl 末 ${runs.length} 条）

- 合计 ${s.total} 次，失败 ${s.fail} 次
${s.lastFail ? `- 最近一次失败：\`${s.lastFail.kind}\` → ${s.lastFail.stage || '-'} / ${s.lastFail.error || '-'}` : '- 最近没有失败记录'}
- 按动作分布：${Object.entries(s.byKind).map(([k, v]) => `${k}×${v}`).join('、') || '（空）'}
`

mkdirSync(join(ROOT, 'docs'), { recursive: true })
writeFileSync(join(ROOT, 'docs', 'STATUS.md'), md, 'utf8')
console.log('已写入 docs/STATUS.md')
console.log(md.split('\n').slice(0, 12).join('\n'))
process.exit(0)
