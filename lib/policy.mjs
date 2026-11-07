/**
 * lib/policy.mjs —— 自主执行的判断（纯函数，无 IO）
 * ============================================================================
 * 「它自己回私信 / 自己发作品」这件事里，最容易出错的是判断，不是发送。
 * 所以判断全部搬到这里：输入是设置 + 状态 + 现在几点，输出是「该不该做、为什么」。
 * 好处是这些边界能被测试钉住，而不是等真的把话发给陌生人之后才发现。
 *
 * 约定：**所有"跳过"都要给得出人话的理由**（why），面板上要能看见。
 * ============================================================================
 */

/** 'HH:MM' → 当天第几分钟；格式不对返回 null（不是 0 —— 0 是午夜，会误判） */
export function minutesOf(hhmm) {
	const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || '').trim())
	return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** 现在是不是落在 [from, to) 里；跨午夜（23:00→07:30）也对。 */
export function inWindow(nowMin, from, to) {
	const a = minutesOf(from)
	const b = minutesOf(to)
	// 只有一个端点 = 没设；两个相同 = 不静音（否则等于全天静音，没人会想要这个）
	if (a == null || b == null || a === b) return false
	return a < b ? (nowMin >= a && nowMin < b) : (nowMin >= a || nowMin < b)
}

/** 本机日期键：2026-11-03。按本地时区算，跟人看到的"今天"一致。 */
export function dayKey(d = new Date()) {
	const p = (n) => String(n).padStart(2, '0')
	return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

/**
 * 每天一次的任务（比如给主人报平安）现在该不该跑。
 * graceMin：过了点但没过太久才补跑。不然晚上十点开机会补发一条"早上好"。
 */
export function dueDaily({ lastDay = '', today, nowMin, at, graceMin = 180 }) {
	if (lastDay === today) return false
	const a = minutesOf(at)
	if (a == null) return false
	if (nowMin < a) return false
	return nowMin - a <= graceMin
}

/**
 * 私信里哪些该回。
 * 只认最后一条是「对方发的」，并且比上次回过的更新；
 * 同一个人的连续失败会累加 tries，超过 maxTries 就放弃 —— 避免对着一个发不出的人死磕。
 */
export function dmCandidates(convs, { replied = {}, tries = {}, maxTries = 2 } = {}) {
	const out = []
	for (const c of Array.isArray(convs) ? convs : []) {
		if (Number(c.type) !== 1) continue                 // 2 = 群聊，不碰
		const ms = Array.isArray(c.messages) ? c.messages : []
		const last = ms[ms.length - 1]
		if (!last || last.from !== 'them' || !last.at) continue
		const peer = String(c.peer_uid || '')
		if (!peer) continue
		if (replied[peer] && String(last.at) <= String(replied[peer])) continue
		if ((Number(tries[peer]) || 0) >= maxTries) continue
		const text = String(last.text || '').trim()
		out.push({
			peer, at: String(last.at), kind: last.kind || 'text',
			text: text.slice(0, 160),
			// 卡片 / 图片没有正文：不是不能回，是不知道该回什么，交给调用方决定
			empty: !text,
		})
	}
	return out
}

/** 能发的内容类型（发作品只认这些；`.txt` 混进目录会被跳过而不是报错） */
const MEDIA = {
	'.mp4': 'video', '.mov': 'video', '.webm': 'video', '.m4v': 'video',
	'.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.webp': 'image',
}

/** 按扩展名判图片还是视频；未知后缀按视频处理。 */
export function mediaKind(name) {
	const m = /(\.[^.\\/]+)$/.exec(String(name || '').toLowerCase())
	return (m && MEDIA[m[1]]) || ''
}

/**
 * 文件名 → 标题。
 * 只做「去扩展名 + 下划线/连字符变空格 + 截 20 字」，**不猜内容**：
 * 猜出来的标题比文件名更像真的，错了更难发现。
 */
export function titleOf(name) {
	return String(name || '')
		.replace(/\.[^.\\/]+$/, '')
		.replace(/[_-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 20)
}

/** 内容库里下一条没发过的（按文件名排序 = 人可以靠改名调顺序） */
export function nextFile(files, done = {}) {
	return (Array.isArray(files) ? files : []).find((f) => !done[f]) || null
}

/** 今天还能发几条 */
export function publishLeft({ day, today, count = 0, perDay = 0 }) {
	const used = day === today ? Number(count) || 0 : 0
	return Math.max(0, (Number(perDay) || 0) - used)
}

/**
 * 回一条评论时的落点（纯函数，方便测）。
 * - 顶层评论（root 空）：reply_id = 被回的那条 → 挂在他评论下面
 * - 楼中楼（root 有值）：reply_id = 楼根、reply_to_reply_id = 被回的那条 → 挂到具体那个人
 * ⚠️ 2026-11-02 踩过：root='' 直接发，结果变成视频下一条新的顶层评论。
 */
export function planAtReply({ cid = '', root = '' }) {
	const c = String(cid || '').trim()
	const r = String(root || '').trim()
	if (!c && !r) return { thread: '', replyTo: '', level: 0 }
	if (!r) return { thread: c, replyTo: '', level: 1 }
	if (r === c) return { thread: r, replyTo: '', level: 1 }
	return { thread: r, replyTo: c, level: 2 }
}
