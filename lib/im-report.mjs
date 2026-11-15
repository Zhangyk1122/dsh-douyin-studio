/**
 * lib/im-report.mjs —— 发一条私信（给主人的日报走这条）
 * ============================================================================
 * 与 lib/im-send.mjs 的区别（那个在禁改区，不动它）：
 *   1. **先把标签页落到 /chat**（`openPage({navigate:true})`）。老路径只按域名挑标签页，
 *      上一步「分享视频」留下的视频页也有 `[data-e2e="conversation-item"]`（分享面板里的好友行），
 *      于是"找得到行、点不开会话" —— 日报连挂 11 次里的一大半是这个。
 *   2. **按 uid 找人**（lib/im-locate.mjs），昵称只做兜底，且命中后还要反查 uid 对账。
 *   3. 点开后再校验「当前会话的对端 sec_uid」，对不上就不发。
 *   4. 发完用 IM 接口回读（`read({uid})`），接口里真出现这条才算数。
 * ============================================================================
 */
import { openPage, sleep } from './chrome.mjs'
import { read } from './im.mjs'
import { CHAT_URL, locate, openRow, editorInfoJs } from './im-locate.mjs'
import { guardText } from './text-guard.mjs'
import { isKilled, killInfo } from './killswitch.mjs'

const stripZw = (s) => String(s || '').replace(/[\s\u200b-\u200d\ufeff]+/g, '')

/**
 * 发一条私信。
 * @param {{uid?:string, secUid?:string, nick?:string, text?:string, dry?:boolean}} o
 * @returns {Promise<{ok:boolean, error?:string, to?:string, sec_uid?:string, how?:string, verified_http?:boolean, rawType?:string, log?:string[]}>}
 */
export async function sendDirect({ uid = '', secUid = '', nick = '', text = '', dry = false } = {}) {
	/* 🔴 总闸：这里是**所有**私信的出口（日报 / 主动开口 / dm-send 都汇进来）。
	 * 闸门必须装在出口上，不能指望每个调用点都记得查 —— `lib/autopilot.mjs` 的
	 * runSpeakup 就曾经绕过总闸直发（2026-11-15 发现）。dry 不拦（它不发）。 */
	if (!dry && isKilled()) {
		const info = killInfo() || {}
		return { ok: false, killed: true, error: '总闸开着（KILL）：' + String(info.reason || '没写原因') }
	}
	/* 出站类型闸（0.4.6，观察模式）：`[object Object]` 那条消息就是从这里漏出去的。
	 * 非字符串照旧转成字符串发，但 `rawType` 会一路带回返回值与明细账；真拦要开
	 * `DOUYIN_STUDIO_TEXT_GUARD=block`。 */
	const g = guardText(text, 'im-report')
	if (!g.ok) return { ok: false, error: g.error, rawType: g.rawType }
	const body = String(g.text || '').trim()
	if (!body) return { ok: false, error: '正文是空的', rawType: g.rawType }
	if (!uid && !secUid && !nick) return { ok: false, error: '发私信要给 uid（稳）、sec_uid 或昵称' }

	const log = []
	let c = null
	try {
		/* ① 落到 /chat —— 这一步是老路径缺的 */
		c = await openPage({ url: CHAT_URL, navigate: true, want: '/chat' })
		await sleep(1500)
		try { await c.send('Page.bringToFront') } catch { /* 老浏览器没有 */ }
		await sleep(300)

		/* ② 找人：uid 优先 */
		const found = await locate(c, { uid, secUid, nick })
		if (!found.ok) {
			return {
				ok: false, error: found.error, to: nick || uid || secUid,
				rows: (found.rows || []).slice(0, 10).map((r) => ({ nick: r.nick, sec_uid: r.sec_uid, left: r.left })),
				log,
			}
		}
		const row = found.row
		log.push(`找到行 ${row.nick || row.sec_uid}（by ${found.how}）`)

		/* ③ 点开 + 校验目标 */
		const opened = await openRow(c, row, { wantSec: row.sec_uid })
		if (!opened.ok) return { ok: false, error: opened.error, want: opened.want, to: row.nick, log }
		log.push(opened.verified ? '点开并校验通过' : '点开（无可校验 sec_uid）')

		/* ④ 等输入框 */
		let ed = ''
		for (let i = 0; i < 20; i++) {
			await sleep(600)
			ed = (await c.ev(editorInfoJs)) || ''
			if (ed) break
		}
		if (!ed) return { ok: false, error: '会话没打开（等不到输入框）', to: row.nick, sec_uid: row.sec_uid, log }
		const box = JSON.parse(ed)
		log.push('输入框出现')

		/* ⑤ 写文字 + 回读 */
		for (const type of ['mousePressed', 'mouseReleased']) {
			await c.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 })
		}
		await sleep(250)
		await c.send('Input.insertText', { text: body })
		let got = ''
		for (let i = 0; i < 10; i++) {
			await sleep(300)
			got = (JSON.parse((await c.ev(editorInfoJs)) || '{"text":""}').text || '')
			if (stripZw(got).includes(stripZw(body).slice(0, 12))) break
		}
		if (!stripZw(got).includes(stripZw(body).slice(0, 12))) {
			return { ok: false, error: '文字没写进输入框', want: body.slice(0, 40), got: got.slice(0, 40), to: row.nick, log }
		}
		log.push('文字已写入')

		if (dry) return { ok: true, dry: true, to: row.nick, sec_uid: row.sec_uid, how: found.how, typed: got.slice(0, 60), note: '没按发送（dry）', log }

		/* ⑥ Enter 发送（这个站没有可见发送按钮） */
		for (const t of ['rawKeyDown', 'keyUp']) {
			await c.send('Input.dispatchKeyEvent', { type: t, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
		}
		let cleared = false
		for (let i = 0; i < 10; i++) {
			await sleep(500)
			const now = stripZw((JSON.parse((await c.ev(editorInfoJs)) || '{"text":""}').text || ''))
			if (!now.includes(stripZw(body).slice(0, 12))) { cleared = true; break }
		}
		log.push(cleared ? '输入框已清空' : '输入框没清空（可能没发出去）')

		/* ⑦ 接口回读：只有「我发的、含这句话」出现在会话里才算数 */
		let verified = false
		if (uid) {
			for (let attempt = 0; attempt < 3 && !verified; attempt++) {
				if (attempt) await sleep(1500)
				try {
					const r = await read({ uid, limit: 6 })
					const mine = (r && r.messages ? r.messages : []).filter((m) => m.from === 'me').slice(-3)
					verified = mine.some((m) => stripZw(m.text).includes(stripZw(body).slice(0, 8)))
				} catch { /* 回读失败不影响"已发出"的事实，但不会标 verified */ }
			}
		}
		return { ok: cleared, to: row.nick, sec_uid: row.sec_uid, uid: uid || undefined, how: found.how, verified_http: verified, log }
	} finally {
		try { if (c) c.close() } catch { /* 关不上不算错 */ }
	}
}
