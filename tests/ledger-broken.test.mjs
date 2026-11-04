/**
 * 账本坏了怎么办 —— lib/ledger.mjs 的「失败关闭」测试。
 *
 * 为什么专门一个文件：这是全套插件里唯一一处**安全相关**的状态文件。
 * 账本一坏，`replies` 就成了空数组，五道闸（cid 去重 / 每日 20 / 同视频同时段 5 /
 * 同作者 2 / 同楼 1）会全部放行，表现是「今天额度全满、同一条评论还能再回一遍」
 * ——正是会被风控盯上的那种行为（2026-10-21 那次整个 web 会话被注销就是这么来的）。
 *
 * 所以这里锁死四条规矩：
 *   ① 坏了 ⇒ checkQuota 一律拒绝（失败关闭），不是放行
 *   ② 坏了 ⇒ recordReply 拒绝写，**不许拿新账本盖掉坏文件**（盖掉 = 毁现场 + 额度清零）
 *   ③ 坏了 ⇒ 坏文件原样留在原地（不像 fsx 那样挪走留证：挪走等于开了个干净账本）
 *   ④ 修好 / 删掉之后立刻恢复正常，不用重启
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'

/* ledgerPath() 每次调用都读 env，但还是先设好再 import，省得 lock/tmp 落到真目录 */
const TMP = mkdtempSync(join(tmpdir(), 'ledger-broken-test-'))
process.env.DOUYIN_STUDIO_HOME = TMP
process.env.DSH_HOME = TMP

const { checkQuota, recordReply, stats, recent, readLedger, LIMITS } = await import('../lib/ledger.mjs')

const LEDGER = join(TMP, 'ledger.json')
const GARBAGE = '{"version":1,"replies":[{,,,' // 半截 JSON：进程被杀在写一半时就长这样

const breakIt = () => writeFileSync(LEDGER, GARBAGE, 'utf8')
const removeIt = () => { try { rmSync(LEDGER) } catch { /* 本来就没有 */ } }
/** 造 n 条「今天」的账目 */
const seedToday = (n, extra = {}) => {
	const now = new Date()
	const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
	writeFileSync(LEDGER, JSON.stringify({
		version: 1,
		replies: Array.from({ length: n }, (_, i) => ({
			at: now.toISOString(), day, window: 'night',
			aweme: 'A' + i, cid: 'C' + i, newCid: '', root: '', author: 'U' + i,
			authorName: '', text: 'x', reason: '', ...extra,
		})),
	}, null, 1), 'utf8')
}

beforeEach(() => removeIt())
after(() => rmSync(TMP, { recursive: true, force: true }))

describe('账本坏了：失败关闭', () => {
	it('checkQuota 一律拒绝，并且说清楚为什么、去哪修', () => {
		breakIt()
		const r = checkQuota({ aweme: 'A1', cid: 'C1' })
		assert.equal(r.ok, false, '账本坏了还放行 = 额度闸形同不存在')
		assert.match(String(r.why), /账本读不出来/)
		assert.equal(r.category, 'LOCAL', '这是本地问题，不该被当成抖音风控而进重试队列')
		assert.ok(String(r.hint).length > 0, '要告诉人去哪修，不然只能干瞪眼')
		assert.match(String(r.hint), /ledger\.json/)
	})

	it('stats() 亮 broken，而且那些 0 是「读不出来」不是「真的 0」', () => {
		breakIt()
		const s = stats('A1')
		assert.equal(s.broken, true)
		assert.equal(s.today, 0)
		assert.equal(s.todayLeft, LIMITS.perDay, '数字是假的满额——所以面板必须靠 broken 亮红灯，不能只看 todayLeft')
	})

	it('recordReply 拒绝写，不许拿新账本盖掉坏文件', async () => {
		breakIt()
		const r = await recordReply({ aweme: 'A1', cid: 'C1', text: '嘿嘿' })
		assert.equal(r.ok, false)
		assert.equal(r.category, 'LOCAL')
		assert.match(String(r.error), /不敢覆盖/)
		assert.equal(readFileSync(LEDGER, 'utf8'), GARBAGE, '坏文件必须一字不变地留着')
	})

	it('坏文件留在原地，**不许**被改名隔离（挪走 = 悄悄开了个干净账本）', async () => {
		breakIt()
		checkQuota({ cid: 'C1' })
		stats()
		recent(5)
		await recordReply({ aweme: 'A1', cid: 'C1', text: 'x' })
		assert.equal(existsSync(LEDGER), true, '账本不见了 = 额度清零')
		const moved = readdirSync(TMP).filter((x) => x.includes('.corrupt-'))
		assert.deepEqual(moved, [], '账本不该被 fsx 那套隔离逻辑挪走：' + moved.join(','))
	})

	it('readLedger 回的一定有 replies 数组（不然 stats/recent 直接炸）', () => {
		breakIt()
		const led = readLedger()
		assert.equal(led.broken, true)
		assert.ok(Array.isArray(led.replies))
		assert.deepEqual(recent(5), [], 'recent 不该抛')
	})

	it('带 BOM 的坏账本也一样算坏', () => {
		writeFileSync(LEDGER, '\uFEFF' + GARBAGE, 'utf8')
		assert.equal(checkQuota({ cid: 'C1' }).ok, false)
	})

	it('修好之后立刻恢复放行，不用重启', () => {
		breakIt()
		assert.equal(checkQuota({ cid: 'C1' }).ok, false)
		seedToday(0) // 写成合法的空账本
		assert.equal(checkQuota({ cid: 'C1' }).ok, true)
		assert.equal(stats().broken, false)
	})

	it('删掉坏账本 = 全新安装，放行（这是给哥哥留的逃生门）', () => {
		breakIt()
		removeIt()
		assert.equal(checkQuota({ cid: 'C1' }).ok, true)
		assert.equal(stats().broken, false)
	})
})

describe('五道闸本身没被改坏（回归）', () => {
	it('账本不存在 ≠ 账本坏了：全新安装要放行', () => {
		assert.equal(existsSync(LEDGER), false)
		assert.equal(checkQuota({ aweme: 'A1', cid: 'C1' }).ok, true)
		assert.equal(stats().broken, false)
	})

	it('① 同一个 cid 不许回第二遍', async () => {
		const r = await recordReply({ aweme: 'A1', cid: 'C777', text: '嘿嘿' })
		assert.equal(r.ok, true)
		const q = checkQuota({ aweme: 'A1', cid: 'C777' })
		assert.equal(q.ok, false)
		assert.match(String(q.why), /已经回过/)
	})

	it('② 今天回满了就不许再回', () => {
		seedToday(LIMITS.perDay)
		const q = checkQuota({ aweme: 'A-new', cid: 'C-new' })
		assert.equal(q.ok, false)
		assert.match(String(q.why), /今天回满了/)
		assert.equal(stats().todayLeft, 0)
	})

	it('④ 同一个作者一天最多 2 条', () => {
		seedToday(2, { author: 'U-same' })
		const q = checkQuota({ aweme: 'A-other', cid: 'C-other', authorUid: 'U-same' })
		assert.equal(q.ok, false)
		assert.match(String(q.why), /这个作者今天已经回过/)
	})

	it('⑤ 同一栋楼一天只回一次', () => {
		seedToday(1, { root: 'R1' })
		const q = checkQuota({ aweme: 'A2', cid: 'C2', root: 'R1' })
		assert.equal(q.ok, false)
		assert.match(String(q.why), /这栋楼今天已经回过/)
	})

	it('recordReply 走的是原子写：不留 .tmp 残留', async () => {
		await recordReply({ aweme: 'A1', cid: 'C1', text: 'x' })
		const left = readdirSync(TMP).filter((x) => x.includes('.tmp-'))
		assert.deepEqual(left, [], '临时文件没清：' + left.join(','))
		assert.ok(JSON.parse(readFileSync(LEDGER, 'utf8')).replies.length === 1)
	})
})
