/**
 * tools/check.mjs —— 交付前自检：一条命令，一个结论
 * ============================================================================
 * 存在的理由：让人（或另一个模型）**不用读一遍代码**就能知道改动是否安全。
 * 每一条都是一次「跑一下就知道」的判断，而不是「看代码猜」。
 *
 * 用法：
 *   node tools/check.mjs            全套（语法 + 不变量 + 体量 + 全部测试）
 *   node tools/check.mjs --quick    跳过测试，只跑秒级的几条（写代码时反复用）
 *
 * 关于本文件里出现 spawnSync：这是**构建脚本**，有界、可预测、跑完就退，
 * 正是 Node 文档说的「同步 API 适合的场景」。规矩是「请求路径上不许有」，
 * 不是「全仓库不许有」—— index.js 和 lib/ 会被下面第 2 条扫。
 * ============================================================================
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectedCss, inlineCss } from '../lib/panelcss.mjs'
import { contractIssues } from './typecheck.mjs'
import { driftIssues } from './rules-drift.mjs'
import { DEFAULTS } from '../lib/settings.mjs'
import { titleHint } from '../lib/publish-rules.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const QUICK = process.argv.includes('--quick')

/* 体量预算：改代码时「只是加了几行」是最容易失控的地方。
 * 超了不是不许，但要显式改这个数字 —— 让它成为一次有意识的选择。
 *
 * 2026-11-03 第二次放宽（这一条要连起来看）：
 *   · 1150 → 1220：加导出按钮，只剩 5 行余量等于没余量
 *   · 1220 → 1450：新增「机器人设置」和「动作」两张卡（表单引擎 + 两组字段描述）
 *     client.js 是**唯一**的界面入口（宿主只认一个文件，约 215 行 CSS 常量也搬不出去）
 *   · index.js 1120 → 1250：新增 /settings /open /share /publish 四条路由
 *
 * 2026-11-03 第三次放宽（1450 → 1530）：
 *   内联图标系统（20 个图标路径 + Ico 组件）+ 分段控件样式 + 卡片头部的换行规则。
 *   之所以不做成 lib/icons.mjs：图标是**纯展示**，搬出去要在 client.js 里再写一遍
 *   import 与打包假设，反而多一层可能坏的东西；而且它没有可测逻辑。
 *
 * 2026-11-03 第四次放宽（1530 → 1600）：
 *   「动作」卡（让人写话再点执行）整块换成「自主执行」（四行开关 + 展开的规矩 + 它自己干过什么）。
 *   同时删掉了 12 行不再用的分段控件样式 —— 这次不是"只加不减"，但净增仍有 13 行，
 *   因为多了开关/迷你字段/结果摘要三个小组件。判断逻辑全部在 lib/policy.mjs（有 19 例测试），
 *   这里只是画出来。
 *
 * ⚠️ 再往上加之前，先回答一个问题：能不能把这段挪进 lib/（有测试的那种）？
 *    挪不动的才留在这里。数字本身不是目标，**能被测的比例**才是。 */
const BUDGET = {
	// 2026-11-04 视觉层重做（卡片质感、hero、目录条、胶囊状态），临时放到 1700。
	// 这是上限不是目标：下一轮把 CSS 里重复的 formgrid 规则并掉、再把「卡片怎么画」
	// 抽成 lib 里可测的纯数据，就压回来。
	// 2026-11-04 第二次放宽（1700 → 1800）：「挑」卡（候选列表 + 两个动作 + 二次确认态）。
	// 判分、合并、状态机全部在 lib/picks.mjs（22 例测试），这里只负责画和两个点击。
	// 之所以不把这段塞进 lib：它是纯展示，搬出去要在 h() 里再写一遍 import，多一层会坏的东西。
	// 2026-11-04 第三次放宽（1800 → 1880）：PLAN §4 T4 —— 一级 3 区 + 「更多」二级、
	// 内容区定高、卡片按 kind 分三档密度、tab 角标。这四件事都在 client.js 里。
	// 注意：T4 之后界面骨架就定了，再要加东西应该先想"能不能删一个"，而不是继续放宽。
	// 2026-11-04 第四次放宽（1880 → 1940）：封面缩略图 + 点标题在机器人浏览器里打开 +
	// 「已发」标记 + 布尔开关（notifyQuiet 原来只有逻辑、没有入口）。顺手删了两行没人用的 CSS。
	// 这四条都在补"看得见/点得动"，不是加新功能；下一次真该按上面那句先删一个。
	'client.js': 1940,
	'index.js': 1250,
	LIB_FILE: 760,
	TEST_FILE: 400,
}

const skipDir = (p) => p === 'node_modules' || p === 'tmp' || p === '.venv' || p === 'publish' || p === '.git'

/* 同步子进程的白名单：**只允许「一次性的本地 CLI 流程」**，而且必须写清理由。
 * 判据不是「在哪个目录」，而是「会不会在宿主的事件循环上跑」：
 *   · index.js 是宿主进程 → 一条都不许有
 *   · 下面这两个只被 `tools/dy.mjs publish` 调用，而 publish 本身已经是 index.js
 *     起的子进程 → 它再同步等待自己的 ffmpeg，卡的也只是那个子进程，卡不到宿主
 * 新加任何一条，都得先想清楚这件事，然后在这里补一行理由。 */
const SYNC_ALLOWED = {
	'lib/check-upload.mjs': 'spawnSync 调 ffprobe 量视频参数，只在发布前的 CLI 流程里跑',
	'lib/publish-cli.mjs': 'execFileSync 调 ffmpeg 混 BGM，只被 publish CLI 调用（本身是子进程）',
	'lib/vision-label.mjs': 'spawnSync 调外部看图命令给表情包打标，只被 `sticker add --vision` 的 CLI 流程调用，不在宿主请求路径上',
}

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name)
		if (skipDir(name)) continue
		let st
		try { st = statSync(p) } catch { continue }
		if (st.isDirectory()) walk(p, out)
		else if (/\.(m?js)$/.test(name)) out.push(p)
	}
	return out
}

const rel = (p) => relative(ROOT, p).split(sep).join('/')
const lines = (p) => readFileSync(p, 'utf8').split('\n').length
const run = (args, timeout = 90000) => spawnSync(process.execPath, args, {
	encoding: 'utf8', timeout, windowsHide: true, cwd: ROOT,
})

const results = []
const add = (ok, name, detail) => results.push({ ok, name, detail })

/* ① 语法：所有 js/mjs 都得能解析 ------------------------------------------ */
{
	const files = walk(ROOT)
	const bad = []
	for (const f of files) {
		const r = run(['--check', f], 30000)
		if (r.status !== 0) bad.push(rel(f) + '：' + String(r.stderr || '').split('\n')[0])
	}
	add(bad.length === 0, '语法', bad.length ? bad.join(' / ') : files.length + ' 个文件都能解析')
}

/* ② 硬规矩：宿主进程上不许有同步子进程（lib 里只放行白名单里的 CLI 流程） ---- */
{
	const targets = [join(ROOT, 'index.js'), ...walk(join(ROOT, 'lib'))]
	const hits = []
	const used = []
	for (const f of targets) {
		const t = readFileSync(f, 'utf8')
		const m = t.match(/\b(spawnSync|execSync|execFileSync)\s*\(/)
		if (!m) continue
		const key = rel(f)
		if (Object.prototype.hasOwnProperty.call(SYNC_ALLOWED, key)) { used.push(key); continue }
		hits.push(key + ' 里有 ' + m[1])
	}
	add(hits.length === 0, '硬规矩',
		hits.length
			? hits.join(' / ') + '（请求路径上不许；真是 CLI 流程就加到 SYNC_ALLOWED 并写理由）'
			: '宿主进程无线程阻塞' + (used.length ? '；白名单 ' + used.length + ' 处 CLI 同步调用已备案' : ''))
}

/* ③ 依赖：仍然零运行时依赖 ------------------------------------------------ */
{
	let pkg = {}
	try { pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) } catch { /* 下面会报 */ }
	const deps = Object.keys(pkg.dependencies || {})
	add(deps.length === 0, '依赖', deps.length ? '多了依赖：' + deps.join(',') : '仍然零依赖')
}

/* ④ 不变量：三条硬规矩的实现还在被调用 ------------------------------------ */
{
	const idx = readFileSync(join(ROOT, 'index.js'), 'utf8')
	const need = [
		['跨站守卫', /checkOrigin\s*\(/],
		['缓存先答再改', /serveInbox\s*\(/],
		['子进程异步', /execJson\s*\(/],
	]
	const missing = need.filter(([, re]) => !re.test(idx)).map(([n]) => n)
	add(missing.length === 0, '不变量', missing.length ? '丢了：' + missing.join(',') : '守卫 / 缓存 / 异步 都还在被调用')
}

/* ⑤ 体量：别让「顺手加一点」把文件养成屎山 -------------------------------- */
{
	const over = []
	const note = []
	for (const [name, max] of Object.entries(BUDGET)) {
		if (name === 'LIB_FILE' || name === 'TEST_FILE') continue
		const p = join(ROOT, name)
		try {
			const n = lines(p)
			note.push(name + ' ' + n + '/' + max)
			if (n > max) over.push(name + ' ' + n + ' > ' + max)
		} catch { /* 文件没了就算了 */ }
	}
	const libs = walk(join(ROOT, 'lib')).map((p) => ({ p, n: lines(p) }))
	const tests = walk(join(ROOT, 'tests')).map((p) => ({ p, n: lines(p) }))
	const bigLib = libs.filter((x) => x.n > BUDGET.LIB_FILE)
	const bigTest = tests.filter((x) => x.n > BUDGET.TEST_FILE)
	if (bigLib.length) over.push(...bigLib.map((x) => rel(x.p) + ' ' + x.n + ' > ' + BUDGET.LIB_FILE))
	if (bigTest.length) over.push(...bigTest.map((x) => rel(x.p) + ' ' + x.n + ' > ' + BUDGET.TEST_FILE))
	const maxLib = libs.reduce((a, b) => (b.n > a.n ? b : a), { p: '', n: 0 })
	add(over.length === 0, '体量',
		over.length ? over.join(' / ') : note.join('  ') + '  最大 lib ' + maxLib.n + '/' + BUDGET.LIB_FILE)
}

/* ⑥ 测试：每个文件单独跑（DSH 沙箱里 node --test 会 EPERM） ---------------
 * ⚠️ 报告格式取决于 stdout 是不是 TTY：
 *    · 管道（本脚本就是）→ TAP：`# pass 14` / `ok 1 - …`
 *    · 终端里手跑       → spec：`ℹ pass 14` / `✔ …`
 * 两个都要认。**过不过以退出码为准**，例数只是给人看的；
 * 数不出来就在明细里标一句，不要因为「解析不认识」把绿的判成红的。 */
const countCases = (out) => {
	const m = out.match(/^# pass (\d+)/m) || out.match(/^ℹ pass (\d+)/m)
	if (m) return Number(m[1])
	const okN = (out.match(/^ok \d+/gm) || []).length
	if (okN) return okN
	return (out.match(/^✔ /gm) || []).length
}
if (QUICK) {
	add(true, '测试', '已跳过（--quick）')
} else {
	const files = walk(join(ROOT, 'tests')).filter((p) => p.endsWith('.test.mjs')).sort()
	const fails = []
	const unknown = []
	let pass = 0
	for (const f of files) {
		const r = run([f], 120000)
		const out = String(r.stdout || '')
		const n = countCases(out)
		if (r.status === 0) {
			pass += n
			if (n === 0) unknown.push(rel(f))
		} else {
			const first = out.split('\n').filter((l) => /^(not ok|✖ )/.test(l)).slice(0, 2)
			fails.push(rel(f) + (first.length ? ' → ' + first.join(' ') : ' → 退出码 ' + r.status))
		}
	}
	add(fails.length === 0, '测试',
		fails.length
			? fails.join(' / ')
			: files.length + ' 个文件全绿，共 ' + pass + ' 例'
			+ (unknown.length ? '（' + unknown.length + ' 个文件例数未识别：' + unknown.join(',') + '）' : ''))
}

/* ⑥ 禁改区：不靠自觉，靠哈希 ----------------------------------------------- */
{
	const LOCK = join(HERE, 'protected.json')
	let lock = null
	try {
		lock = JSON.parse(readFileSync(LOCK, 'utf8'))
	} catch {
		lock = null
	}
	if (!lock) {
		add(true, '禁改区', '还没有 protected.json —— 跑一次 node tools/lock-protected.mjs 建基线')
	} else {
		const changed = []
		const missing = []
		for (const rel of Object.keys(lock)) {
			try {
				const sum = createHash('md5').update(readFileSync(join(ROOT, rel))).digest('hex')
				if (sum !== lock[rel]) changed.push(rel)
			} catch {
				missing.push(rel)
			}
		}
		const bad = changed.concat(missing)
		add(bad.length === 0, '禁改区',
			bad.length
				? '被动过：' + bad.join(', ') +
					'（真有必要就改完跑 node tools/lock-protected.mjs，并在 CHANGES 里写理由）'
				: Object.keys(lock).length + ' 个文件哈希未变')
	}
}

/* ⑦ 样式真源：client.js 里那段压缩 CSS 必须等于 assets/panel.css ----------- */
{
	const want = expectedCss(ROOT)
	const got = inlineCss(readFileSync(join(ROOT, 'client.js'), 'utf8'))
	add(Boolean(want) && want === got, '样式真源',
		!want ? 'assets/panel.css 读不到'
			: want === got ? 'client.js 与 assets/panel.css 一致（' + want.length + ' 字符）'
				: '样式分叉了：跑 node tools/build-client.mjs 重新生成')
}

/* ⑧ 类型契约：纯模块的导出必须有 JSDoc，编辑器的 checkJs 才有东西可查 ----- */
{
	const r = contractIssues(ROOT)
	add(r.issues.length === 0, '类型契约',
		r.issues.length ? r.issues[0] + (r.issues.length > 1 ? ' 等 ' + r.issues.length + ' 处' : '')
			: r.checked + ' 个纯模块 / ' + r.exports + ' 个导出都有 JSDoc')
}

/* ⑨ 发布链：两套脚本的标题/定时规则不许分叉 ----------------------------- */
{
	const r = driftIssues(ROOT)
	add(r.ok, '发布规则',
		r.issues.length ? r.issues[0] : r.notes.join('；'))
}

/* ⑩ 工具契约：工具 → SKILL.md → 发布规则，三处说同一件事 -----------------
 * 审计里最便宜的错就是「文档写 55、代码是 30」这类：不跑不知道，跑一次也不报错。
 * 这条检查两件事：每个注册的工具都被 SKILL.md 提到；标题上限只从 publish-rules 来。 */
{
	const src = readFileSync(join(ROOT, 'lib/tools.mjs'), 'utf8')
	/* 第二批工具在 tools-extra.mjs —— 契约检查必须两边都看，不然"加了工具没写文档"照样漏。 */
	const extra = readFileSync(join(ROOT, 'lib/tools-extra.mjs'), 'utf8')
	const srcAll = src + '\n' + extra
	const skill = readFileSync(join(ROOT, 'SKILL.md'), 'utf8')
	const names = [...new Set([...srcAll.matchAll(/name:\s*'(douyin_studio_[a-z_]+)'/g)].map((m) => m[1]))]
	const missing = names.filter((n) => !skill.includes(n))
	const issues = []
	if (names.length < 30) issues.push('只认出 ' + names.length + ' 个工具，注册写法可能变了')
	if (missing.length) issues.push('SKILL.md 没写：' + missing.join(','))
	if (/≤\s*55\s*字/.test(srcAll)) issues.push('工具描述还写着 55 字')
	if (!/titleHint\(\)/.test(src)) issues.push('标题描述没走 publish-rules.titleHint()')
	add(issues.length === 0, '工具契约',
		issues.length ? issues.join(' / ') : names.length + ' 个工具都在 SKILL.md 里，标题上限 = ' + titleHint())
}

/* ⑪ 打包完整：npm 包里别缺运行时要用的东西 -------------------------------
 * files 漏 assets/ 的话，装到别人机器上样式直接空 —— 本地跑着好好的，最难发现。 */
{
	let pkg = {}
	try { pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) } catch { /* ③ 已报 */ }
	const files = Array.isArray(pkg.files) ? pkg.files : []
	const need = ['index.js', 'client.js', 'lib', 'tools', 'assets', 'cordis.patch.yml', 'SKILL.md', 'README.md', 'jsconfig.json']
	const missing = need.filter((n) => !files.some((f) => String(f).replace(/\/$/, '') === n))
	const ghost = files.filter((f) => {
		try { statSync(join(ROOT, String(f).replace(/\/$/, ''))); return false } catch { return true }
	})
	const issues = []
	if (missing.length) issues.push('files 漏了：' + missing.join(','))
	if (ghost.length) issues.push('files 指向不存在的：' + ghost.join(','))
	add(issues.length === 0, '打包完整',
		issues.length ? issues.join(' / ') : files.length + ' 条 files 都在，运行时该带的都带了')
}

/* ⑫ 默认只读：新装的插件不许一上来就在账号里自己跑 -----------------------
 * B2-09 的落地检查。注意只查**默认值**：已经写进 settings.json 的显式配置不受影响。 */
{
	const idx = readFileSync(join(ROOT, 'index.js'), 'utf8')
	const tools = readFileSync(join(ROOT, 'lib', 'tools.mjs'), 'utf8')
	const issues = []
	if (DEFAULTS.scanRounds !== 0) issues.push('settings 默认 scanRounds = ' + DEFAULTS.scanRounds + '（应为 0）')
	if (!/watchOn:\s*z\.boolean\(\)\.default\(false\)/.test(idx)) issues.push('watchOn 默认不是 false')
	if (!/isKilled\(\)/.test(tools)) issues.push('工具层没接总闸（isKilled）')
	if (!/isKilled\(\)/.test(idx)) issues.push('index.js 没读总闸')
	add(issues.length === 0, '默认只读',
		issues.length ? issues.join(' / ') : '新装默认不刷、不盯、写操作过总闸')
}

/* ⑬ 命令行一致：HELP 里列的每条都得真有分支，反之亦然 ----------------------
 * 「README 写了但命令不存在」是最伤信任的一种错：用户照着敲，得到一片错误。 */
{
	const src = readFileSync(join(ROOT, 'tools', 'dy.mjs'), 'utf8')
	const help = (src.match(/commands:\s*\[([^\]]+)\]/) || [, ''])[1]
	const listed = [...new Set([...help.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]))]
	const branches = [...new Set([...src.matchAll(/CMD === '([a-z-]+)'/g)].map((m) => m[1]))].filter((c) => c !== 'help')
	const noBranch = listed.filter((c) => !branches.includes(c))
	const noHelp = branches.filter((c) => !listed.includes(c))
	const issues = []
	if (noBranch.length) issues.push('HELP 有、代码没有：' + noBranch.join(','))
	if (noHelp.length) issues.push('代码有、HELP 没列：' + noHelp.join(','))
	add(issues.length === 0, '命令行一致',
		issues.length ? issues.join(' / ') : branches.length + ' 条命令与 HELP 一致')
}

/* ⑭ 无人值守与互动：新能力默认必须是关的 ---------------------------------
 * 破甲之后"没人盯着也能发"第一次真的成立，所以默认值这件事比别的都重要：
 * 任何一个仓库更新把这两项改成 true，都等于替所有使用者做了决定。 */
{
	const issues = []
	if (DEFAULTS.unattendedPublish !== false) issues.push('unattendedPublish 默认不是 false')
	if (DEFAULTS.engageOn !== false) issues.push('engageOn 默认不是 false')
	const tools = readFileSync(join(ROOT, 'lib', 'tools.mjs'), 'utf8')
	const extra = readFileSync(join(ROOT, 'lib', 'tools-extra.mjs'), 'utf8')
	if (!/checkAuto\(/.test(tools)) issues.push('publish 没接无人值守闸（checkAuto）')
	if (!/isKilled\(\)/.test(extra)) issues.push('新工具没接总闸')
	add(issues.length === 0, '新能力默认关',
		issues.length ? issues.join(' / ') : '无人值守/互动都默认关，开也要过四道闸')
}

/* ⑮ 提示词守则：模型层能看到的规矩，得有一份在仓库里 ---------------------
 * 工具描述管"这一下怎么调"，守则管"这一类事该不该做"。两份都要有，
 * 而且都要能被 diff —— 写在某个人的 prompt-inject.md 里就等于没有。 */
{
	const file = join(ROOT, 'prompts', 'operate.md')
	let md = ''
	try { md = readFileSync(file, 'utf8') } catch { /* 下面统一报 */ }
	const need = ['dry', 'declare', 'stop']
	const missing = need.filter((k) => !new RegExp(k, 'i').test(md))
	const skill = readFileSync(join(ROOT, 'SKILL.md'), 'utf8')
	const issues = []
	if (!md) issues.push('prompts/operate.md 不存在')
	if (missing.length) issues.push('守则缺关键词：' + missing.join(','))
	if (!/操作守则/.test(skill)) issues.push('SKILL.md 没引用守则')
	add(issues.length === 0, '提示词守则',
		issues.length ? issues.join(' / ') : '守则在 prompts/operate.md，SKILL.md 已引用（' + md.length + ' 字符）')
}

/* ── 汇总 ─────────────────────────────────────────────────────────────── */
console.log('抖音工作室 · 交付前自检' + (QUICK ? '（--quick）' : ''))
console.log('─'.repeat(64))
for (const r of results) {
	console.log((r.ok ? '✓ ' : '✗ ') + r.name.padEnd(8, ' ') + '  ' + r.detail)
}
console.log('─'.repeat(64))
const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0
	? 'PASS —— 可以交付'
	: 'FAIL —— ' + failed.map((r) => r.name).join('、') + ' 没过，别交付')
process.exit(failed.length === 0 ? 0 : 1)
