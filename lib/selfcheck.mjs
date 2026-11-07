/**
 * lib/selfcheck.mjs —— 运行期行为自检（纯函数）
 * ============================================================================
 * 和 tools/check.mjs 的分工：
 *   check.mjs     查「代码对不对」——语法、硬规矩、依赖、体量、单测。
 *   selfcheck.mjs 查「规则有没有被真的执行」——账本、额度、静音、去重。
 *
 * 为什么需要它：11-05 一天里抓到四个 bug，全都是 check.mjs 全绿的情况下发生的
 *   （budget 读默认值 / 回评闸参数名写错 / @ 从来没发出去 / 楼中楼看不见）。
 *   代码能跑 ≠ 规矩生效，这两件事必须分开验收。
 *
 * 设计约束：
 *   · 纯函数：不读盘、不发请求、不看时钟（now 由调用方传）。
 *   · 只报事实，不猜原因。每条 issue 都带 evidence（具体哪条记录）。
 *   · 拿不准的一律 warn，不报 error —— 假警报会让自检本身被忽略。
 * ============================================================================
 */

/** 'HH:MM' → 分钟数；非法返回 null（空字符串也算非法，表示"没设"）。 */
export function hhmm2min(s) {
	const m = /^(\d{1,2}):(\d{2})$/.exec(String(s == null ? '' : s).trim())
	if (!m) return null
	const h = Number(m[1])
	const mi = Number(m[2])
	if (!(h >= 0 && h <= 23) || !(mi >= 0 && mi <= 59)) return null
	return h * 60 + mi
}

/** 本地时间 'HH:MM'（按指定时区偏移，默认东八区）。 */
export function localHHMM(ms, tzHours = 8) {
	const d = new Date(Number(ms) + tzHours * 3600000)
	const h = String(d.getUTCHours()).padStart(2, '0')
	const m = String(d.getUTCMinutes()).padStart(2, '0')
	return h + ':' + m
}

/** 落在静音窗口内？跨午夜（22:00→08:00）要能正确判断。 */
export function inQuiet(hhmm, from, to) {
	const a = hhmm2min(from)
	const b = hhmm2min(to)
	const t = hhmm2min(hhmm)
	if (a == null || b == null || t == null) return false
	return a <= b ? t >= a && t < b : t >= a || t < b
}

const arr = (x) => (Array.isArray(x) ? x : [])

/** 一条回复记录的作者 uid（新旧字段名都认）。 */
export const authorOf = (r) => String((r && (r.authorUid || r.author)) || '')

/** 记录发生的那一天（账本里本来就存了 day；没有就从 at 推）。 */
export function dayOf(r, tzHours = 8) {
	if (r && typeof r.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.day)) return r.day
	/* 账本的 at 是 ISO 字符串，额度的 at 是毫秒数字 —— 两种都要认。
	 * 只写 Date.parse(r.at) 的话，数字会被转成 "1793..." 再解析失败，静默返回空。 */
	const raw = r ? r.at : null
	const t = typeof raw === 'number' ? raw : raw ? Date.parse(raw) : NaN
	if (!Number.isFinite(t)) return ''
	return new Date(t + tzHours * 3600000).toISOString().slice(0, 10)
}

const pad2 = (n) => String(n).padStart(2, '0')
/** @param {number} now @param {number} tzHours @returns {string} 本地日历日 */
export const todayKey = (now, tzHours = 8) =>
	new Date(Number(now) + tzHours * 3600000).toISOString().slice(0, 10)

/**
 * 跑一遍全部检查。
 *
 * @param {object}   o
 * @param {object}   o.ledger     { replies: [...] }
 * @param {object}   o.budget     { day, entries: [{ ch, at, peer, thread, note }] }
 * @param {object}   o.settings   面板设置（静音、额度、每轮条数…）
 * @param {string}   o.selfUid    机器人自己的抖音 uid（拿不到就传空，相关检查会跳过并标注）
 * @param {object}   o.limits     { comment, dm, at, own, publish } 各渠道日限；不给就不查超发
 * @param {number}   o.inboxPending 收件箱待处理条数；给了才能把"值班安静"升级成 error
 * @param {number}   o.now        当前毫秒
 * @returns {{ ok:boolean, issues:Array, stats:object }}
 */
export function check({ ledger = {}, budget = {}, settings = {}, selfUid = '', limits = null, inboxPending = null, now = Date.now() } = {}) {
	const issues = []
	const push = (level, code, msg, evidence) => issues.push({ level, code, msg, evidence })

	const replies = arr(ledger && ledger.replies)
	const entries = arr(budget && budget.entries)
	const day = todayKey(now)
	const tz = 8

	/* ① 回错到自己 —— 最伤的一条：她会跟自己对话，而且看不出来。 */
	if (selfUid) {
		const bad = replies.filter((r) => authorOf(r) === String(selfUid))
		if (bad.length) {
			push('error', 'reply-to-self', '账本里有 ' + bad.length + ' 条回复是回给机器人自己的', {
				cid: bad[0].cid, text: bad[0].text,
			})
		}
	} else {
		push('warn', 'self-uid-unknown', '不知道机器人的 uid，跳过「回错到自己」检查（可用 --self-uid 传入）', {})
	}

	/* ② 同一条评论回两次 —— 闸①（cid 点查）应该挡住。 */
	const byCid = new Map()
	for (const r of replies) {
		const cid = String(r.cid || '')
		if (!cid) continue
		byCid.set(cid, (byCid.get(cid) || 0) + 1)
	}
	const dupCid = [...byCid.entries()].filter(([, n]) => n > 1)
	if (dupCid.length) {
		push('error', 'dup-cid', dupCid.length + ' 条评论被回了不止一次', { cid: dupCid[0][0], times: dupCid[0][1] })
	}

	/* ③ 同一栋楼回两次 —— 闸⑤（一栋楼只回一次）。 */
	const byRoot = new Map()
	for (const r of replies) {
		const root = String(r.root || '')
		if (!root) continue
		byRoot.set(root, (byRoot.get(root) || 0) + 1)
	}
	const dupRoot = [...byRoot.entries()].filter(([, n]) => n > 1)
	if (dupRoot.length) {
		push('error', 'dup-root', dupRoot.length + ' 栋楼被回了不止一次', { root: dupRoot[0][0], times: dupRoot[0][1] })
	}

	/* ④ 同一个人当天超限 —— 闸④（每人每天 ≤ N）。 */
	const perAuthor = Number(settings && settings.perAuthorPerDay) > 0 ? Number(settings.perAuthorPerDay) : 2
	const byAuthorDay = new Map()
	for (const r of replies) {
		const au = authorOf(r)
		if (!au) continue
		const k = dayOf(r, tz) + '|' + au
		byAuthorDay.set(k, (byAuthorDay.get(k) || 0) + 1)
	}
	const overAuthor = [...byAuthorDay.entries()].filter(([, n]) => n > perAuthor)
	if (overAuthor.length) {
		const [k, n] = overAuthor[0]
		push('error', 'over-author', '同一个人一天被回了 ' + n + ' 条（上限 ' + perAuthor + '）', {
			day: k.split('|')[0], authorUid: k.split('|')[1],
		})
	}

	/* ⑤ 静音时段还在发 —— 静音只该拦"主动"，但记录了就是记录了。 */
	const qf = settings && settings.quietFrom
	const qt = settings && settings.quietTo
	if (hhmm2min(qf) != null && hhmm2min(qt) != null) {
		const hit = entries.filter((e) => e && e.at && inQuiet(localHHMM(e.at, tz), qf, qt))
		if (hit.length) {
			push('error', 'quiet-hours', '静音时段（' + qf + '–' + qt + '）发出去了 ' + hit.length + ' 条', {
				ch: hit[0].ch, at: localHHMM(hit[0].at, tz), note: hit[0].note,
			})
		}
	}

	/* ⑥ 账本作者字段为空 —— 闸④会静默失效（11-05 抓到的真 bug）。 */
	const noAuthor = replies.filter((r) => !authorOf(r) && dayOf(r, tz) === day)
	if (noAuthor.length) {
		push('warn', 'author-uid-missing', '今天有 ' + noAuthor.length + ' 条回复没记作者 uid，「每人每天 N 条」这道闸对它们无效', {
			cid: noAuthor[0].cid,
		})
	}

	/* ⑦ 未来时间 —— 时钟错了会让所有时间窗判断一起错。 */
	const future = replies.filter((r) => {
		const t = r && r.at ? Date.parse(r.at) : NaN
		return Number.isFinite(t) && t > Number(now) + 5 * 60000
	})
	if (future.length) {
		push('error', 'future-record', '账本里有 ' + future.length + ' 条记录的时间在未来（系统时钟或时区不对）', { at: future[0].at })
	}

	/* ⑧ 额度跨天没重置 —— budget.day 还是昨天，但 entries 里已经有今天的记录。 */
	const bday = String((budget && budget.day) || '')
	const todayEntries = entries.filter((e) => e && e.at && localHHMM(e.at, tz) && dayOf({ at: e.at }, tz) === day)
	if (bday && bday !== day && todayEntries.length) {
		push('error', 'budget-day-stale', '额度账本还停在 ' + bday + '，但今天已经发了 ' + todayEntries.length + ' 条', {
			day: bday,
		})
	}

	/* ⑨ 超发 —— 给了 limits 才查；没给就跳过（不猜上限）。 */
	if (limits && typeof limits === 'object') {
		const used = {}
		for (const e of entries) {
			if (!e || !e.ch) continue
			if (dayOf({ at: e.at }, tz) !== day) continue
			used[e.ch] = (used[e.ch] || 0) + 1
		}
		for (const ch of Object.keys(limits)) {
			const cap = Number(limits[ch])
			if (!(cap >= 0)) continue
			if ((used[ch] || 0) > cap) {
				push('error', 'budget-over', '「' + ch + '」今天发了 ' + used[ch] + ' 条，超过上限 ' + cap, { ch, used: used[ch], cap })
			}
		}
	}

	/* ⑪ 值班安静 —— 「该有却没有」比「有没有做错」更常见。
	 * 定时器没起 / 额度用光 / 账号掉登录，这三种故障在面板上长得一模一样：安静。
	 * 判据：开着自动回，且距最近一次出口已经超过 N 小时（默认 6）。
	 * 知道收件箱有积压时升级成 error；不知道就只 warn（不猜）。 */
	const autoOn = !!(settings && (settings.autoDm === true || settings.autoComment === true || settings.autoAt === true))
	const silentH = Number(settings && settings.dutySilentHours) > 0 ? Number(settings.dutySilentHours) : 6
	if (autoOn) {
		let lastOut = 0
		for (const e of entries) {
			const t = Number(e && e.at) || 0
			if (t > lastOut) lastOut = t
		}
		for (const r of replies) {
			const t = r && r.at ? Date.parse(r.at) : NaN
			if (Number.isFinite(t) && t > lastOut) lastOut = t
		}
		if (lastOut > 0) {
			const gapH = (Number(now) - lastOut) / 3600000
			if (gapH >= silentH) {
				const pending = Number(inboxPending)
				const hasPending = Number.isFinite(pending) && pending > 0
				push(
					hasPending ? 'error' : 'warn',
					'duty-silent',
					'已经 ' + Math.round(gapH) + ' 小时没有任何回复/发送' +
						(hasPending ? '，但收件箱还有 ' + pending + ' 条没处理' : '（可能是定时器没起、额度用光或掉登录）'),
					{ lastOutAt: new Date(lastOut).toISOString(), gapH: Number(gapH.toFixed(1)) },
				)
			}
		}
	}

	/* ⑫ 账本-额度差 —— 对着两个独立计数器找"发出去了但没记账"。
	 * 2026-11-05 的两个真 bug（缺 await / 压根没调）都表现为：额度记了，账本没记。
	 * 单看任何一个文件都正常，只有把它俩并排放才看得见。 */
	const outCh = { comment: 1, at: 1 }
	const budgetToday = entries.filter((e) => e && e.at && dayOf({ at: e.at }, tz) === day && outCh[String(e.ch)])
	const ledgerToday = replies.filter((r) => dayOf(r, tz) === day)
	if (budgetToday.length > ledgerToday.length) {
		push('error', 'ledger-gap',
			'今天额度记了 ' + budgetToday.length + ' 次发送，账本只有 ' + ledgerToday.length + ' 条 —— 有 ' +
				(budgetToday.length - ledgerToday.length) + ' 次发出去了没记账（去重闸会失效）',
			{ budget: budgetToday.length, ledger: ledgerToday.length })
	}

	/* ⑬ 刷视频轮次 —— 只查"配置能不能自洽"，查不到记录不硬报。 */
	const rounds = Number(settings && settings.scanRounds)
	const perRound = Number(settings && settings.scanPerRound)
	if (Number.isFinite(rounds) && rounds > 0 && !(Number(perRound) > 0)) {
		push('warn', 'scan-round-empty', '开着 ' + rounds + ' 轮/天，但每轮条数是 0 —— 跑了也不看东西', {})
	}

	const errors = issues.filter((i) => i.level === 'error').length

	return {
		ok: errors === 0,
		issues,
		stats: {
			day,
			replies: replies.length,
			entries: entries.length,
			todayReplies: replies.filter((r) => dayOf(r, tz) === day).length,
			todayEntries: todayEntries.length,
			errors,
			warns: issues.length - errors,
		},
	}
}

/** 人看的一行一条。 */
export function render(result) {
	const s = result.stats
	const head = (result.ok ? '✓ 自检通过' : '✗ 自检不通过') +
		'　' + s.day + '　回复 ' + s.todayReplies + ' 条 / 出口 ' + s.todayEntries + ' 次' +
		'　错误 ' + s.errors + ' · 提醒 ' + s.warns
	const lines = result.issues.map((i) => (i.level === 'error' ? '  ✗ ' : '  ! ') + i.msg)
	return [head].concat(lines).join('\n')
}
