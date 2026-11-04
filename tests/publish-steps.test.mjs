/**
 * tests/publish-steps.test.mjs — publish-steps.mjs 单元测试
 * 用 node:test 跑：
 *   node --test tests/publish-steps.test.mjs
 *
 * 不起真浏览器：用 mock CdpSession 模拟页面响应。
 */
import { strictEqual, ok, deepStrictEqual } from 'node:assert'
import { describe, it, before } from 'node:test'

import {
	stepWaitReady,
	stepTitle,
	stepDesc,
	stepMusic,
	stepWho,
	stepSchedule,
	stepDraft,
	stepPublish,
} from '../lib/publish-steps.mjs'

// ── Mock CdpSession ───────────────────────────────────────────────────────────

/**
 * 构造一个 mock session：
 *   evalScripts: Map<substring_of_expr → return_value>
 *   waitScripts: Map<substring_of_expr → true/false>
 * 如果 expr 不命中任何键，evalJs 返回 null，waitFor 返回 false。
 */
function mockSession(evalMap = {}, waitMap = {}, sendMap = {}) {
	const evalEntries = Object.entries(evalMap)
	const waitEntries = Object.entries(waitMap)
	const sendEntries = Object.entries(sendMap)

	return {
		_evalLog: [],
		_waitLog: [],
		_sendLog: [],
		_insertLog: [],
		_clickLog: [],
		_pressLog: [],
		_clearLog: [],

		async evalJs(expr) {
			this._evalLog.push(expr)
			for (const [k, v] of evalEntries) {
				if (expr.includes(k)) return typeof v === 'function' ? v(expr) : v
			}
			return null
		},

		async waitFor(expr, opts = {}) {
			this._waitLog.push(expr)
			for (const [k, v] of waitEntries) {
				if (expr.includes(k)) return typeof v === 'function' ? v(expr) : v
			}
			return false
		},

		async send(method, params) {
			this._sendLog.push({ method, params })
			for (const [k, v] of sendEntries) {
				if (method.includes(k)) return typeof v === 'function' ? v(method, params) : v
			}
			return {}
		},

		async insertText(text) { this._insertLog.push(text) },
		async clickAt(x, y) { this._clickLog.push({ x, y }) },
		async pressKey(key) { this._pressLog.push(key) },
		async clearFocused() { this._clearLog.push(true) },

		async fillField({ label, selectorExpr, text, readExpr, verify }) {
			// Simulate successful fill
			this._evalLog.push(`fillField:${label}`)
			const got = text
			const ok = verify ? verify(got) : (got === text)
			return { ok, got, already: false }
		},
	}
}

// ── stepWaitReady ─────────────────────────────────────────────────────────────

describe('stepWaitReady', () => {
	it('returns ok:true when editor appears', async () => {
		const s = mockSession({}, { '标题': true, '我知道了': null })
		const r = await stepWaitReady(s, { kind: 'video' })
		strictEqual(r.ok, true)
	})

	it('returns ok:false when editor never appears', async () => {
		// waitFor returns false for everything
		const s = mockSession({}, {})
		const r = await stepWaitReady(s, { kind: 'video' })
		strictEqual(r.ok, false)
		ok(r.why.includes('超时'))
	})

	it('dismisses 我知道了 bubble', async () => {
		const s = mockSession(
			{ '我知道了': `[{textContent:'我知道了'}]` },
			{ '标题': true },
		)
		// Override evalJs to simulate the bubble dismiss path
		let bubbleClicks = 0
		s.evalJs = async (expr) => {
			s._evalLog.push(expr)
			if (expr.includes('标题') || expr.includes('简介')) return true
			if (expr.includes('我知道了') && expr.includes('find')) {
				// First call: bubble exists; subsequent: gone
				return bubbleClicks++ < 1 ? { textContent: '我知道了' } : null
			}
			if (expr.includes('我知道了') && expr.includes('click')) { return true }
			return null
		}
		s.waitFor = async () => true
		const r = await stepWaitReady(s, { kind: 'image' })
		strictEqual(r.ok, true)
	})
})

// ── stepTitle ─────────────────────────────────────────────────────────────────

describe('stepTitle', () => {
	it('returns ok:true on successful fill', async () => {
		const s = mockSession()
		s.fillField = async ({ text }) => ({ ok: true, got: text })
		const r = await stepTitle(s, { title: '测试标题', titleMax: 30 })
		strictEqual(r.ok, true)
	})

	it('truncates title to titleMax', async () => {
		const s = mockSession()
		let capturedText = ''
		s.fillField = async ({ text }) => { capturedText = text; return { ok: true, got: text } }
		await stepTitle(s, { title: 'a'.repeat(50), titleMax: 20 })
		strictEqual(capturedText.length, 20)
	})

	it('returns ok:false when fill fails', async () => {
		const s = mockSession()
		s.fillField = async () => ({ ok: false, got: '', why: '回读不匹配' })
		const r = await stepTitle(s, { title: '标题', titleMax: 30 })
		strictEqual(r.ok, false)
	})
})

// ── stepDesc ──────────────────────────────────────────────────────────────────

describe('stepDesc', () => {
	it('appends space after trailing #tag', async () => {
		const s = mockSession()
		let capturedText = ''
		s.fillField = async ({ text }) => { capturedText = text; return { ok: true, got: text } }
		await stepDesc(s, { desc: '这是简介 #话题' })
		ok(capturedText.endsWith(' '), `expected trailing space, got: "${capturedText}"`)
	})

	it('does not append space when no trailing #tag', async () => {
		const s = mockSession()
		let capturedText = ''
		s.fillField = async ({ text }) => { capturedText = text; return { ok: true, got: text } }
		await stepDesc(s, { desc: '普通简介' })
		strictEqual(capturedText, '普通简介')
	})
})

// ── stepWho ───────────────────────────────────────────────────────────────────

describe('stepWho', () => {
	it('returns ok:true when radio is found and checked', async () => {
		const s = mockSession()
		// _pickRadio 现在走两步：① 取坐标（getBoundingClientRect）② 真点击 ③ 回读 data-checked/inp.checked
		s.evalJs = async (expr) => {
			if (expr.includes('getBoundingClientRect') && expr.includes('公开')) return { x: 100, y: 200 }
			if (expr.includes('data-checked') || expr.includes('inp.checked')) return true
			return null
		}
		const r = await stepWho(s, { who: '公开' })
		strictEqual(r.ok, true)
		// 必须真的用鼠标点过（el.click() 抖音不认）
		strictEqual(s._clickLog.length, 1)
	})

	it('returns ok:false when radio not found', async () => {
		const s = mockSession()
		s.evalJs = async () => null // 找不到坐标
		const r = await stepWho(s, { who: '不存在的选项' })
		strictEqual(r.ok, false)
		ok(r.why.includes('未能选中'))
		strictEqual(s._clickLog.length, 0)
	})
})

// ── stepSchedule ──────────────────────────────────────────────────────────────

describe('stepSchedule', () => {
	it('returns ok:true when date is read back correctly', async () => {
		const s = mockSession()
		s.evalJs = async (expr) => {
			// _pickRadio ①：取坐标
			if (expr.includes('getBoundingClientRect') && expr.includes('定时发布')) return { x: 10, y: 20 }
			// _pickRadio ③：回读选中
			if (expr.includes('data-checked') || expr.includes('inp.checked')) return true
			// stepSchedule：回读输入框的值（含 value，要排在 find 之前判）
			if (expr.includes('日期和时间') && expr.includes('value')) return '2026-11-10 20:00'
			// stepSchedule：找输入框
			if (expr.includes('日期和时间') && expr.includes('find')) return { placeholder: '日期和时间' }
			// focus
			if (expr.includes('日期和时间') && expr.includes('focus')) return true
			return null
		}
		s.waitFor = async (expr) => {
			if (expr.includes('日期和时间')) return true
			return true
		}
		s.clearFocused = async () => {}
		s.insertText = async () => {}
		s.pressKey = async () => {}
		const r = await stepSchedule(s, { at: '2026-11-10 20:00' })
		strictEqual(r.ok, true)
	})

	it('returns ok:false when date input never appears', async () => {
		const s = mockSession()
		s.evalJs = async (expr) => {
			if (expr.includes('getBoundingClientRect')) return { x: 10, y: 20 }
			if (expr.includes('data-checked') || expr.includes('inp.checked')) return true
			return null
		}
		s.waitFor = async (expr) => {
			// 定时发布 radio wait passes, date input wait fails
			if (expr.includes('日期和时间')) return false
			return true
		}
		const r = await stepSchedule(s, { at: '2026-11-10 20:00' })
		strictEqual(r.ok, false)
		ok(r.why?.includes('日期输入框'))
	})
})

// ── stepDraft ─────────────────────────────────────────────────────────────────

describe('stepDraft', () => {
	it('returns ok:true when success signal appears', async () => {
		const s = mockSession()
		s.waitFor = async (expr) => {
			if (expr.includes('暂存离开')) return true
			if (expr.includes('未发布') || expr.includes('content/upload')) return true
			return false
		}
		s.evalJs = async (expr) => {
			if (expr.includes('click')) return true
			if (expr.includes('确认') || expr.includes('保存')) return false
			return null
		}
		const r = await stepDraft(s)
		strictEqual(r.ok, true)
	})

	it('returns ok:false when 暂存离开 button never found', async () => {
		const s = mockSession()
		s.waitFor = async () => false
		const r = await stepDraft(s)
		strictEqual(r.ok, false)
		ok(r.why?.includes('暂存离开'))
	})
})

// ── stepPublish ───────────────────────────────────────────────────────────────

describe('stepPublish', () => {
	it('returns ok:true, published:true on success text', async () => {
		const s = mockSession()
		let clickCount = 0
		s.waitFor = async (expr) => {
			if (expr.includes('上传中')) return true  // button ready
			return false
		}
		s.evalJs = async (expr) => {
			if (expr.includes('getBoundingClientRect')) return { top: 100, bottom: 200, x: 100, y: 150, width: 80, height: 40 }
			if (expr.includes('window.innerHeight')) return 800
			if (expr.includes('elementFromPoint')) return '发布'
			if (expr.includes('click')) { clickCount++; return true }
			if (expr.includes('body.innerText')) return '发布成功！内容已提交审核'
			if (expr.includes('location.pathname')) return '/creator-micro/content/manage'
			return null
		}
		const r = await stepPublish(s)
		strictEqual(r.ok, true)
		strictEqual(r.published, true)
	})

	it('returns ok:false, captcha:true on captcha detection', async () => {
		const s = mockSession()
		s.waitFor = async () => true
		s.evalJs = async (expr) => {
			if (expr.includes('getBoundingClientRect')) return { top: 100, bottom: 200, x: 100, y: 150, width: 80, height: 40 }
			if (expr.includes('window.innerHeight')) return 800
			if (expr.includes('elementFromPoint')) return '发布'
			if (expr.includes('click')) return true
			if (expr.includes('body.innerText')) return '请完成验证码'
			return null
		}
		const r = await stepPublish(s)
		strictEqual(r.ok, false)
		strictEqual(r.captcha, true)
	})

	it('returns abnormal:true when timeout with no clear result', async () => {
		const s = mockSession()
		s.waitFor = async () => true
		s.evalJs = async (expr) => {
			if (expr.includes('getBoundingClientRect')) return { top: 100, bottom: 200, x: 100, y: 150, width: 80, height: 40 }
			if (expr.includes('window.innerHeight')) return 800
			if (expr.includes('elementFromPoint')) return '发布'
			if (expr.includes('click')) return true
			// Keep returning neutral body text so it times out
			if (expr.includes('body.innerText')) return '上传中…'
			return null
		}
		// Stub Date.now to immediately expire the 90s loop
		const _now = Date.now
		let call = 0
		global.Date.now = () => call++ === 0 ? _now() : _now() + 91000
		const r = await stepPublish(s)
		global.Date.now = _now
		strictEqual(r.ok, false)
		strictEqual(r.abnormal, true)
	})
})
