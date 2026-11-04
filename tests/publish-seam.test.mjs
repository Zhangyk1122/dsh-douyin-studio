/**
 * tests/publish-seam.test.mjs —— 「接缝」测试：模块拼在一起才出的那些 bug
 * ============================================================================
 * 为什么单独一份：
 *   publish-steps.test.mjs 用的是假 session，它只能证明「单个步骤逻辑对」。
 *   2026-11-01 那批 bug **全都不在那儿**——它们发生在：
 *     · import 阶段（`import { WebSocket } from 'ws'`，包不在插件目录 → 一启动就死）
 *     · 参数解析（`.map(resolve)` → map 把数组当第 3 个参数塞给 path.resolve）
 *     · 路径（日志/混流指向不存在的 ../douyin-duty/）
 *     · 常量（页面原话被「改写成人话」，精确匹配一个都选不中）
 *   这些跑单测一个都发现不了，只能靠「真的把子进程拉起来」+「对着源码断言」。
 *
 * 跑：node --test tests/publish-seam.test.mjs
 * ============================================================================
 */
import { strictEqual, ok } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(ROOT, 'lib', 'publish-cli.mjs')
const read = (p) => readFileSync(join(ROOT, 'lib', p), 'utf8')

/**
 * 去掉注释行再断言。
 * 这些文件的注释里**故意**写着「别写 import ... from 'ws'」「别写 .map(resolve)」，
 * 直接对着全文匹配会把警告本身当成犯规。
 */
const code = (p) =>
	read(p)
		.split(/\r?\n/)
		.filter((l) => {
			const t = l.trim()
			return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')
		})
		.join('\n')

/** 起一次 publish-cli，返回 { out(JSON或null), stderr, code } */
function runCli(args, env = {}) {
	const r = spawnSync(process.execPath, [CLI, ...args], {
		encoding: 'utf8',
		timeout: 30000,
		env: { ...process.env, CDP_PORT: '59998', ...env }, // 故意给个连不上的端口
		windowsHide: true,
	})
	const raw = String(r.stdout || '')
	const start = raw.indexOf('{')
	let out = null
	if (start >= 0) {
		try { out = JSON.parse(raw.slice(start)) } catch { out = null }
	}
	return { out, raw, stderr: String(r.stderr || ''), code: r.status }
}

// ── 1. 不能依赖解析不到的包 ───────────────────────────────────────────────────

describe('import 接缝', () => {
	it('publish-cdp.mjs 不 import 外部的 ws 包（插件目录解析不到，一 import 就崩）', () => {
		const src = read('publish-cdp.mjs')
		ok(!/from\s+['"]ws['"]/.test(code('publish-cdp.mjs')), "publish-cdp.mjs 又写回 import ... from 'ws' 了；用 Node 全局 WebSocket")
	})

	it('Node 自带全局 WebSocket（publish-cdp.mjs 靠它）', () => {
		strictEqual(typeof WebSocket, 'function')
	})
})

// ── 2. 子进程真的能起来 ────────────────────────────────────────────────────────

describe('子进程启动', () => {
	it('不带参数启动时输出 JSON 参数错误，而不是崩溃', () => {
		const r = runCli([])
		const crashed = /ERR_MODULE_NOT_FOUND|ERR_INVALID_ARG_TYPE|Cannot find package/.test(r.stderr)
		ok(!crashed, '启动就崩了：' + r.stderr.slice(0, 400))
		ok(r.out, '没输出 JSON：' + r.raw.slice(0, 200))
		strictEqual(r.out.ok, false)
		ok(String(r.out.why).includes('--title'), 'why 应该是缺标题，实际：' + r.out.why)
	})

	it('标题超长时本地就拒掉（不再先跑两分钟）', () => {
		const r = runCli(['--img', 'x.png', '--title', 'x'.repeat(40)])
		ok(r.out, '没输出 JSON')
		strictEqual(r.out.ok, false)
		ok(/标题超出/.test(r.out.why), 'why 应该是标题超长，实际：' + r.out.why)
	})
})

// ── 3. 页面上是「仅自己可见」，不是「仅自己」 ──────────────────────────────────

describe('页面原话', () => {
	it('WHO_MAP 的 private 必须是「仅自己可见」', () => {
		const src = read('publish-cli.mjs')
		ok(/private:\s*'仅自己可见'/.test(src), 'private 被改成「仅自己」了；pickRadio 精确匹配，少两个字就选不中')
	})

	it('DECLARE_MAP 的六条必须是抖音页面上的原话（一字不差）', () => {
		const src = read('publish-cli.mjs')
		const must = [
			'内容由AI生成',
			'内容为个人观点或见解',
			'内容为转载信息',
			'内容含营销推广信息',
			'虚构演绎，仅供娱乐',
			'无需添加自主声明',
		]
		for (const s of must) ok(src.includes(s), `DECLARE_MAP 少了页面原话「${s}」——被改写成人话就选不中`)
	})

	it('声明 key 同时认 view/market（工具层）和 opinion/ad（旧版）', () => {
		const src = read('publish-cli.mjs')
		for (const k of ['view:', 'opinion:', 'market:', 'ad:']) {
			ok(src.includes(k), `DECLARE_MAP 少了别名 ${k}`)
		}
	})
})

// ── 4. 路径不能指向不存在的目录 ────────────────────────────────────────────────

describe('路径接缝', () => {
	it('duty 目录以外的输出不许写到 ../douyin-duty/（插件下没这个目录）', () => {
		const src = read('publish-cli.mjs')
		ok(!/'\.\.'\s*,\s*'douyin-duty'/.test(src), '又写到 ../douyin-duty/ 了，那个目录不存在')
	})

	it('日志目录/文件是可写的（logLine 不抛）', () => {
		const r = runCli([]) // 这一次会把日志写出来
		ok(!/ENOENT/.test(r.stderr), '日志写失败：' + r.stderr.slice(0, 300))
		ok(existsSync(join(ROOT, 'lib', 'publish-log.jsonl')), '日志文件没生成')
	})
})

// ── 5. map 回调的经典坑 ───────────────────────────────────────────────────────

describe('参数解析接缝', () => {
	it('不许写 .map(resolve)（map 会多传 index/array 两个参数）', () => {
		const src = read('publish-cli.mjs')
		ok(!/\.map\(resolve\)/.test(code('publish-cli.mjs')), '.map(resolve) 会让 path.resolve 收到数组 → ERR_INVALID_ARG_TYPE')
	})

	it('--reupload / --no-shot 两个开关还在（publish.mjs 一直在传）', () => {
		const src = read('publish-cli.mjs')
		ok(/flag\('reupload'\)/.test(src), '--reupload 丢了')
		ok(/flag\('no-shot'\)/.test(src), '--no-shot 丢了')
	})
})

// ── 6. 本地校验和发布页的上限要一致 ──────────────────────────────────────────

describe('标题上限一致性', () => {
	it('publish.mjs 的视频标题上限也是 30（不是 55）', async () => {
		const { validate } = await import('../lib/publish.mjs')
		const img = join(ROOT, 'tmp', 'preview', 'panel-b6.png')
		const r = validate({ files: [img], title: 'x'.repeat(40), titleMax: 30 })
		// 图文上限 20，视频上限 30 —— 40 字两种都该被挡
		strictEqual(r.ok, false)
		ok(r.errors.some((e) => /标题/.test(e)), '40 字没被标题限制挡住：' + JSON.stringify(r.errors))
		const src = read('publish.mjs')
		ok(!/kind === 'image' \? 20 : 55/.test(src), 'publish.mjs 视频标题上限又回到 55 了（应该是 30）')
	})
})

// ────────────────────────────────────────────────────────────────────────────
// 封面（2026-11-02 真跑通后补的守卫）
// ────────────────────────────────────────────────────────────────────────────
describe('封面流程的三个坑（都是真机上踩出来的）', () => {
	const steps = read('publish-steps.mjs')
	const cli = read('publish-cli.mjs')

	it('封面不许用 srcChanged 当成功判据（它会骗人）', () => {
		ok(!/!stillMissing\s*\|\|\s*srcChanged/.test(steps), '封面判据又变回「srcChanged 也算成功」了 —— 图换了但双封面仍缺失，会报假 true')
		ok(/const ok = !stillMissing/.test(steps), '封面判据应该是只看 stillMissing')
	})

	it('点完「完成」不许立刻 Esc（会把刚设好的封面取消掉）', () => {
		const idx = steps.indexOf("await clickByText(/^完成$/, 15000)")
		ok(idx > 0, '找不到点「完成」那行，测试需要跟着改')
		const after = steps.slice(idx, idx + 1200)
		const escEarly = /clickByText\(\/\^完成\$\/[^)]*\)\s*\n\s*await _clearModals/.test(after)
		ok(!escEarly, '点完「完成」紧接着就 _clearModals（Esc）—— 会取消掉封面，必须先等面板自己收')
		ok(/await s\.waitFor\(`!\(\$\{MODAL\}\)`/.test(after), '点完「完成」应该先等面板自己收（waitFor !MODAL）')
	})

	it('封面必须排在 who / declare 之后（它会把整页盖住）', () => {
		const who = cli.indexOf('results.who = await stepWho')
		const dec = cli.indexOf('results.declare = await stepDeclare')
		const cov = cli.indexOf('results.cover = await stepCover')
		ok(who > 0 && dec > 0 && cov > 0, '三个 step 的调用位置都得找得到')
		ok(cov > who && cov > dec, '封面又排到 who/declare 前面了 —— 它一卡就把后面两个 step 全挡住（级联假失败）')
	})

	it('封面失败必须让整次发布 ok=false（2026-11-02 的假 ok=true）', () => {
		ok(
			/\(!COVER \|\| results\.cover\?\.ok\)/.test(cli),
			'ok 计算里没带封面 —— 会出现 cover: ok=false 但 done ok=true',
		)
		ok(/const coverBlocked =/.test(cli), '封面没设成时要先中止发布（coverBlocked）')
		ok(/--allow-cover-fail|allow-cover-fail/.test(cli), '要留一个明确的强制开关 --allow-cover-fail')
	})

	it('拿不到判据（页面上没有「横/竖双封面缺失」）要报 false，不许猜成功', () => {
		ok(/const ok = !stillMissing && !!missingBefore/.test(steps), '判据被改回去了：没有 hint 的页面会报假 true')
	})
})
describe('删除：标题匹配（2026-11-02 真跑踩到的）', () => {
	it('卡片是「标题 + 空格 + 简介」，所以不能再只认完全相等', () => {
		const del = code('delete.mjs')
		ok(/startsWith\(T \+ ' '\)/.test(del), 'delete.mjs 又只认 innerText === 标题了 —— 真实卡片是「标题 简介」拼起来的，一条都命中不了')
	})

	it('嵌套矩形要收敛成最外层一张卡，否则会误报「命中多条」', () => {
		const del = code('delete.mjs')
		ok(/outermost/.test(del), '缺最外层收敛：卡片里外三层祖先都会命中，会被当成 3 条不同作品而拒绝删除')
	})

	it('仍然只许唯一命中才删（删除没有撤销）', () => {
		const del = code('delete.mjs')
		ok(/hit > 1/.test(del), '唯一命中这条闸没了 —— 删除不可撤销，不能放宽')
	})
})