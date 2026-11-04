/* 「主人这个号，我到底认不认得」——面板上那个红绿灯就是这个在答。
 *
 * 为什么单独一个文件：这件事要开浏览器、要抄页面，慢，而且答错了后果不小
 * （认错人 = 把内容发给陌生人）。所以判定顺序写死、理由要说出来：
 *
 *   ① 一个都没填          → 红：「还没填」
 *   ② 填了 uid，会话里有  → 绿：uid 是硬身份，会话存在就说明这个人真实、且能发得出去
 *   ③ 填了昵称           → 抄一遍 /chat 的昵称表，唯一对上才算；重名/对不上 → 红
 *   ④ 什么都没有          → 红，并说明是「没聊过」还是「没对上」
 *
 * 绝不按昵称模糊匹配：同名的人多，认错比认不出更糟。
 */
import * as names from './names.mjs'
import { conversations } from './im.mjs'

const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase()

export async function verify({ nick = '', uid = '' } = {}) {
	const n = String(nick || '').trim()
	const u = String(uid || '').trim()
	if (!n && !u) return { level: 'red', why: '还没填主人昵称和抖音号', nick: '', uid: '' }
	if (u && !/^\d{5,}$/.test(u)) return { level: 'red', why: '抖音号得是一串数字（现在填的是「' + u + '」）', nick: n, uid: u }

	const r = await conversations({ limit: 60 })
	if (!r || r.ok === false) {
		return { level: 'red', why: '读不到会话：' + ((r && r.error) || '未知原因') + '（可能是浏览器没登录）', nick: n, uid: u }
	}
	const list = r.conversations || []
	const myUid = String(r.my_uid || '')

	if (u) {
		if (u === myUid) return { level: 'red', why: '这是机器人自己的号，填错了？', nick: n, uid: u }
		const hit = list.find((c) => String(c.peer_uid) === u)
		if (hit) {
			const known = names.nameOf(u)
			return {
				level: 'green', why: '认到了：会话里就是这个号', nick: known || n, uid: u,
				conv_id: hit.conv_id, my_uid: myUid, verified_by: 'uid',
				warn: n && known && norm(known) !== norm(n) ? '会话里的昵称是「' + known + '」，跟填的「' + n + '」不一样' : '',
			}
		}
	}

	if (n) {
		/* 昵称得先抄一遍才有 —— 接口里没有名字，只在页面上。 */
		const fresh = await names.refresh({ limit: 60 }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }))
		const map = names.allNames()
		const hits = Object.entries(map).filter(([, v]) => v && norm(v.nick) === norm(n))
		const uniq = [...new Set(hits.map(([k]) => k))]
		if (uniq.length === 1) {
			const uidHit = uniq[0]
			const conv = list.find((c) => String(c.peer_uid) === uidHit)
			if (u && u !== uidHit) {
				return { level: 'red', why: '昵称对上了，但抖音号对不上（昵称 → ' + uidHit + '）', nick: n, uid: u, found_uid: uidHit }
			}
			return {
				level: 'green', why: conv ? '认到了：昵称唯一对上，而且有会话' : '认到了昵称，但**还没聊过**——发得出去，只是会新建会话',
				nick: n, uid: uidHit, conv_id: conv ? conv.conv_id : '', my_uid: myUid, verified_by: 'nick',
			}
		}
		if (uniq.length > 1) return { level: 'red', why: '有 ' + uniq.length + ' 个人都叫这个昵称，认不准——请填抖音号', nick: n, uid: u, candidates: uniq }
		return {
			level: 'red', why: '最近 ' + list.length + ' 个会话里没有这个昵称' + (fresh && fresh.ok ? '' : '（抄昵称表失败）'),
			nick: n, uid: u, scanned: list.length,
		}
	}

	return { level: 'red', why: '只填了抖音号，但会话里没有这个人——先给他发一条，或者填上昵称', nick: n, uid: u }
}
