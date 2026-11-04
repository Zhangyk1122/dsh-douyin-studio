/**
 * lib/share.mjs —— 把视频以**分享卡片**发给好友
 * ============================================================================
 * 为什么不能用文字链接代替：卡片（aweType 800 / MessageItemShareAweme）是前端把结构化
 * 消息交给服务端生成的，纯文本永远拼不出来；而且文本链接在抖音里点不开。
 *
 * 链路：视频页 → **真实鼠标轨迹** hover 分享图标 → 面板展开 → 找好友那一行的「分享」
 *      → 点 → 用接口回读核实（最后几条里有没有我发的卡片）。
 *
 * ⚠️ 分享图标是 onMouseEnter 的，`el.click()` 打不开（旧插件踩过，这里沿用真实轨迹）。
 * ⚠️ 面板会重排：算出来的坐标点下去可能已经偏了（点空 = 面板直接关掉、什么都不发）。
 *    所以点之前先用 `elementFromPoint` 复核这个坐标下面确实是「分享」那两个字。
 * ⚠️ 昵称会重名，能拿到 sec_uid 就用它核验；同名多个一律拒发。
 */
import { withPage, sleep } from './cdp.mjs'
import * as im from './im.mjs'
import * as api from './api.mjs'

const J = (s, d = {}) => { try { return JSON.parse(s) } catch { return d } }

/** 页面里扫一遍分享面板：把每个「分享」按钮的坐标 + 该坐标下面到底是谁 一起带回来 */
const SCAN_JS = (nick, secUid) => `(function(){
	var who = ${JSON.stringify(nick)};
	var wantSec = ${JSON.stringify(secUid)};
	var sc = document.querySelector('[data-e2e="video-share-container"]');
	if (!sc) return JSON.stringify({ err: 'no-panel' });
	function secOf(node){
		var fk = Object.keys(node).find(function(k){ return k.indexOf('__reactFiber$') === 0 });
		if (!fk) return '';
		var f = node[fk], d = 0;
		while (f && d < 14) {
			var p = f.memoizedProps;
			if (p && typeof p === 'object') {
				for (var k in p) { var v = p[k]; if (v && typeof v === 'object' && v.sec_uid) return String(v.sec_uid); }
			}
			f = f.return; d++;
		}
		return '';
	}
	var nodes = Array.prototype.slice.call(sc.querySelectorAll('div,span,p')).filter(function(e){
		var t = (e.innerText || '').trim();
		if (!t || t.length > 40) return false;
		if (wantSec) return secOf(e) === wantSec;
		return t === who;
	}).sort(function(a,b){ return a.getBoundingClientRect().width - b.getBoundingClientRect().width });

	var out = [];
	nodes.forEach(function(nameNode){
		var row = nameNode;
		for (var i = 0; i < 6 && row; i++) {
			var btns = Array.prototype.slice.call(row.querySelectorAll('div,span,button')).filter(function(e){
				return (e.innerText || '').trim() === '分享';
			});
			if (btns.length) {
				var b = btns[0], r = b.getBoundingClientRect();
				if (r.width > 16 && r.height > 12) {
					var x = Math.round(r.x + r.width/2), y = Math.round(r.y + r.height/2);
					var under = document.elementFromPoint(x, y);
					out.push({
						nick: who, sec_uid: secOf(row) || secOf(nameNode),
						btn: { x: x, y: y },
						hit: under ? String(under.innerText || '').trim().slice(0, 12) : '',
					});
				}
				break;
			}
			row = row.parentElement;
		}
	});
	var seen = {}, uniq = [];
	out.forEach(function(o){ var k = o.sec_uid || (o.btn.x + ',' + o.btn.y); if (!seen[k]) { seen[k] = 1; uniq.push(o) } });
	return JSON.stringify({ candidates: uniq, panel: (sc.innerText || '').replace(/\\s+/g, ' ').slice(0, 300) });
})()`

export async function share({ awemeId = '', nick = '', secUid = '', dry = false } = {}) {
	if (!awemeId) return { ok: false, error: '要给视频 id（aweme_id）' }
	if (!nick && !secUid) return { ok: false, error: '要给好友昵称或 sec_uid' }

	const t0 = Date.now()
	const r = await withPage('www.douyin.com', async (c) => {
		const { send, evaluate: ev } = c
		const mv = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
		const clickAt = async (x, y) => {
			await mv(x, y); await sleep(150)
			await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
			await sleep(60)
			await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
		}

		/* ⚠️ 别用 Page.navigate：这个站长连接不断，等 load 会超时。改 location 然后等。 */
		/* ⚠️ 后台标签会被节流：页面只剩个壳、分享图标永远不出现（2026-11-03 实测）。
		 *    先把标签提到前台，再导航。 */
		await send('Page.bringToFront').catch(() => 1)
		await ev('location.href = ' + JSON.stringify(`https://www.douyin.com/video/${awemeId}`))
		await sleep(6000)

		/* ⚠️ 一次问不到别判死：视频页渲染慢时第 8 秒才出现分享图标（2026-11-01 实测）。
		 * ⚠️ 选择器有两代：老版 `video-share-icon-container`，现在（2026-11-03 实测，图文也算）
		 *    是 `video-player-share`。两个都试，别只认一个。 */
		const ICON_SEL = '[data-e2e="video-player-share"],[data-e2e="video-share-icon-container"]'
		let pos = {}
		for (let i = 0; i < 24; i++) {
			pos = J(await ev(`(function(){
				var ic = document.querySelector(${JSON.stringify(ICON_SEL)});
				if (!ic) return '{}';
				var r = ic.getBoundingClientRect();
				if (r.width < 8) return '{}';
				return JSON.stringify({ x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) });
			})()`))
			if (pos.x) break
			await sleep(700)
		}
		if (!pos.x) return { ok: false, stage: 'page', error: '找不到分享图标（视频页没加载好，或这条视频要登录才能看）' }

		// 真实轨迹：从左上角一点点挪过去（一次 jump 打不开面板）
		await mv(20, 20); await sleep(250)
		for (let i = 1; i <= 8; i++) {
			await mv(Math.round(20 + (pos.x - 20) * i / 8), Math.round(20 + (pos.y - 20) * i / 8))
			await sleep(70)
		}
		await mv(pos.x, pos.y)
		await sleep(2000)

		const panelText = await ev(`(function(){
			var sc = document.querySelector('[data-e2e="video-share-container"]');
			return sc ? (sc.innerText || '').replace(/\\s+/g, ' ').slice(0, 400) : '';
		})()`)
		if (!panelText) return { ok: false, stage: 'panel', error: '分享面板没展开（hover 到了但面板没出来）' }

		/* 面板会重排，所以「扫 → 复核坐标 → 还不稳就再来一次」，最多 6 轮 */
		let cands = []
		let lastScan = {}
		for (let i = 0; i < 6; i++) {
			lastScan = J(await ev(SCAN_JS(nick, secUid)))
			if (lastScan.err) return { ok: false, stage: 'find', error: '找不到该好友那一行', panel: panelText }
			cands = (lastScan.candidates || []).filter((x) => x.hit && x.hit.indexOf('分享') >= 0)
			if (cands.length) break
			await sleep(400)
		}
		if (!cands.length) {
			return {
				ok: false, stage: 'find',
				error: '没找到「点下去真的是分享按钮」的那一行（面板可能还在动）',
				seen: (lastScan.candidates || []).map((x) => ({ nick: x.nick, sec_uid: x.sec_uid, hit: x.hit })),
				panel: panelText,
			}
		}
		if (cands.length > 1) {
			return {
				ok: false, stage: 'find',
				error: '分享面板里有多个同名的人，不敢猜（猜错就是把视频发给陌生人）',
				nick, candidates: cands.map((x) => ({ sec_uid: x.sec_uid })),
				hint: '改用 sec_uid 指定',
			}
		}

		const pick = cands[0]
		if (dry) return { ok: true, dry: true, stage: 'ready', panel: panelText, target: { nick: pick.nick, sec_uid: pick.sec_uid }, btn: pick.btn, hit: pick.hit }

		/* ⚠️ 关键一步（2026-11-01 踩了三回）：**不能用 CDP 坐标点子元素**。
		 *    面板在 hover 之后还会重排，坐标算得再准，点下去也常常变成「点空 → 面板关掉、啥都没发」。
		 *    真正生效的是在页面里对这个按钮派发 mousedown/mouseup/click ——
		 *    和分享图标（必须真鼠标 hover）不同，这个按钮是普通 React onClick，DOM 事件就够。 */
		const clicked = await ev(`(function(){
			var who = ${JSON.stringify(String(pick.nick || nick || ''))};
			var wantSec = ${JSON.stringify(String(pick.sec_uid || secUid || ''))};
			var sc = document.querySelector('[data-e2e="video-share-container"]');
			if (!sc) return 'no-panel';
			function secOf(node){
				var fk = Object.keys(node).find(function(k){ return k.indexOf('__reactFiber$') === 0 });
				if (!fk) return '';
				var f = node[fk], d = 0;
				while (f && d < 14) {
					var p = f.memoizedProps;
					if (p && typeof p === 'object') { for (var k in p) { var v = p[k]; if (v && typeof v === 'object' && v.sec_uid) return String(v.sec_uid) } }
					f = f.return; d++;
				}
				return '';
			}
			var nodes = Array.prototype.slice.call(sc.querySelectorAll('div,span,p')).filter(function(e){
				var t = (e.innerText || '').trim();
				if (!t || t.length > 40) return false;
				if (wantSec) return secOf(e) === wantSec;
				return t === who;
			}).sort(function(a,b){ return a.getBoundingClientRect().width - b.getBoundingClientRect().width });
			if (!nodes.length) return 'no-name';
			var row = nodes[0];
			for (var i = 0; i < 6 && row; i++) {
				var b = Array.prototype.slice.call(row.querySelectorAll('div,span,button')).filter(function(e){
					return (e.innerText || '').trim() === '分享';
				})[0];
				if (b) {
					b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
					b.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
					b.click();
					return 'clicked';
				}
				row = row.parentElement;
			}
			return 'no-btn';
		})()`)
		if (clicked !== 'clicked') return { ok: false, stage: 'click', error: '分享按钮点不到（' + String(clicked) + '）' }
		await sleep(3000)

		const after = J(await ev(`(function(){
			var sc = document.querySelector('[data-e2e="video-share-container"]');
			var t = document.body.innerText || '';
			return JSON.stringify({
				panelStillOpen: sc ? sc.getBoundingClientRect().height > 10 : false,
				toast: t.indexOf('已发送') >= 0 || t.indexOf('发送成功') >= 0,
			});
		})()`))
		return { ok: true, stage: 'sent', target: { nick: pick.nick, sec_uid: pick.sec_uid }, btn: pick.btn, after }
	})

	if (!r || !r.ok || dry) return r

	/* 回读核实：接口里最近几条要有「我发的卡片」。UI 说发了只算一半。 */
	try {
		/* 分享卡片在会话里不一定被标成 kind:'card'（2026-11-03 实测：body 里只有 content_title，
		 * aweType 读出来是 0），所以再用「视频标题」当第二条证据。 */
		let title = ''
		try {
			const d = await api.detail(awemeId)
			title = String((d && d.aweme && d.aweme.desc) || '').slice(0, 24)
		} catch { /* 拿不到标题就只认 kind */ }
		const list = await im.conversations({ limit: 10 })
		/* ⚠️ 别只盯「最新的那个会话」：分享完别人可能刚好又发来一条，最上面就不是他了
		 *    （2026-11-03 差点因此把发成功的卡片判成失败）。把所有会话里这次之后的我发消息扫一遍。 */
		const rows = (list.conversations || []).slice()
		const mine = []
		for (const c of rows) {
			for (const m of (c && c.messages ? c.messages : [])) {
				if (!m || m.from !== 'me') continue
				if (!(Date.parse(m.at || '') >= t0 - 5000)) continue
				if (!(m.kind === 'card' || (title && String(m.text || '').indexOf(title) >= 0))) continue
				mine.push({ peer_uid: c.peer_uid, at: m.at, text: String(m.text || '').slice(0, 40) })
			}
		}
		mine.sort((a, b) => String(b.at).localeCompare(String(a.at)))
		const card = mine[0]
		r.verified_http = Boolean(card)
		if (card) r.http_seen = card
		if (!r.verified_http) r.note = 'UI 点完了，但接口里没看到新卡片——多半没真发出去，去页面确认一下，别急着重试'
	} catch { /* 回读失败不改结论，但不会标 verified */ }
	return r
}
