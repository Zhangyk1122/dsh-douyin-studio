/**
 * lib/im.mjs —— 私信（读）
 * ============================================================================
 * 这条路是**纯 HTTP**：POST `https://imapi.douyin.com/v1/message/get_message_by_init`，
 * 只带 cookie，不需要 a_bogus、不需要起第二层浏览器、不需要 Python。
 *
 * 为什么站在页面里发：Node 直连拿到的是 200 + 空包（TLS/指纹层看不到的东西我们别猜），
 * 页面里发就天然带着 Chrome 自己的指纹和同一个 cookie 域 —— 一次就通。
 *
 * 协议是 protobuf，包了两层：外层信封（命令号 + kv）+ 内层 body（裸 protobuf）。
 * 字段位置是对着真实请求逐字节比出来的，注释写在下面，别随手改。
 *
 * ⚠️ 踩过的坑：`enc_empty(4)` 必须**连长度字节一起写**（`22 00`），只写 `22` 会让
 *    接收方把下一个字段的 tag 当成长度吃掉，整包解析崩掉 —— 表现是「200，但只有 2 字节」。
 * ============================================================================
 */
import { withPage } from './cdp.mjs'

export const HOST = 'www.douyin.com'
const IM_URL = 'https://imapi.douyin.com/v1/message/get_message_by_init'

/** 页面里的那套工具：protobuf 编解码 + 发请求 + 只投影要用的字段 */
const PRELUDE = `
var IM_URL = ${JSON.stringify(IM_URL)};
var UA = navigator.userAgent;

function b2u(b64){ var s = atob(b64); var u = new Uint8Array(s.length); for (var i=0;i<s.length;i++) u[i]=s.charCodeAt(i); return u }
function ev(n){ var o=[]; var v=BigInt(n); do { var b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; o.push(b) } while (v); return o }
function encV(f,n){ return ev((f<<3)|0).concat(ev(n)) }
function encB(f,bytes){ return ev((f<<3)|2).concat(ev(bytes.length), Array.prototype.slice.call(bytes)) }
function encS(f,s){ return encB(f, new TextEncoder().encode(s)) }
function encEmpty(f){ return ev((f<<3)|2).concat([0]) }

function rv(b,i){ var shift=0n, r=0n; for(;;){ var x=b[i++]; if (x===undefined) throw new RangeError('eof'); r |= BigInt(x & 0x7f) << shift; if (!(x & 0x80)) return [r,i]; shift += 7n } }
function parse(b){
  var m = {}; var i = 0;
  while (i < b.length) {
    var tag; try { tag = rv(b,i) } catch(e) { break }
    var fn = Number(tag[0] >> 3n), wt = Number(tag[0] & 7n); i = tag[1];
    if (!fn) break;
    var val;
    try {
      if (wt === 0) { var t = rv(b,i); val = t[0]; i = t[1] }
      else if (wt === 1) { val = b.subarray(i,i+8); i += 8 }
      else if (wt === 5) { val = b.subarray(i,i+4); i += 4 }
      else if (wt === 2) { var L = rv(b,i); i = L[1]; var n = Number(L[0]); val = b.subarray(i,i+n); i += n }
      else break;
    } catch(e) { break }
    (m[fn] = m[fn] || []).push(val);
  }
  return m
}
/* 只解 keep 集合里的字段，其余跳过 —— 减少不必要的 Uint8Array 切片分配。
 * 用于已知字段布局的场景（envelope/conv/message），通用探索用 parse()。 */
function skip(b, wt, i) {
  if (wt === 0) { while (i < b.length && (b[i] & 0x80)) i++; return i+1 }
  if (wt === 1) return i+8
  if (wt === 5) return i+4
  if (wt === 2) { var Lv=rv(b,i); return Lv[1] + Number(Lv[0]) }
  return b.length
}
function parseOnly(b, keep) {
  var m = {}; var i = 0;
  while (i < b.length) {
    var tag; try { tag = rv(b,i) } catch(e) { break }
    var fn = Number(tag[0] >> 3n), wt = Number(tag[0] & 7n); i = tag[1];
    if (!fn) break;
    if (!keep.has(fn)) { try { i = skip(b, wt, i) } catch(e) { break } continue }
    var val;
    try {
      if (wt === 0) { var t2 = rv(b,i); val = t2[0]; i = t2[1] }
      else if (wt === 1) { val = b.subarray(i,i+8); i += 8 }
      else if (wt === 5) { val = b.subarray(i,i+4); i += 4 }
      else if (wt === 2) { var L2 = rv(b,i); i = L2[1]; var n2 = Number(L2[0]); val = b.subarray(i,i+n2); i += n2 }
      else break;
    } catch(e) { break }
    (m[fn] = m[fn] || []).push(val);
  }
  return m
}
function g1(m,k){ return (m[k]||[])[0] }
function asStr(v){ if (v instanceof Uint8Array) return new TextDecoder().decode(v); return v === undefined ? '' : String(v) }
function iso(ms){ if (!ms || ms <= 0) return ''; var d = new Date(ms); return d.toISOString() }
function peerUidOf(convId, myUid){
  var parts = String(convId||'').split(':');
  var uids = parts.filter(function(p){ return /^[0-9]{8,}$/.test(p) });
  for (var i=0;i<uids.length;i++) if (uids[i] !== myUid) return uids[i];
  return uids.length ? uids[uids.length-1] : '';
}

function envelope(cmd, body){
  var seq = 10000 + (Date.now() % 89);
  function kv(k,v){ return encB(15, encS(1,k).concat(encS(2,v))) }
  var out = []
    .concat(encV(1, cmd), encV(2, seq), encS(3, '0.1.8'), encEmpty(4), encV(5,3), encV(6,1),
            encS(7, '0d50935:feat/pc-im-group'), encB(8, body), encS(9,'0'), encS(11,'douyin_pc'),
            encS(14,'360000'),
            kv('session_aid','6383'), kv('session_did','0'), kv('app_name','douyin_pc'),
            kv('priority_region','cn'), kv('user_agent',UA), kv('cookie_enabled','true'),
            kv('browser_language','zh-CN'), kv('browser_platform','Win32'), kv('browser_name','Mozilla'),
            kv('browser_version', UA.replace(/^Mozilla\\//,'')), kv('browser_online','true'),
            kv('screen_width', String(screen.width)), kv('screen_height', String(screen.height)),
            kv('timezone_name','Asia/Shanghai'), kv('deviceId','0'), kv('is-retry','0'),
            encV(18,1), encS(21,'douyin_web'), encS(22,'web_sdk'));
  return Uint8Array.from(out);
}

async function imFetch(cmd, inner){
  var t0 = Date.now();
  var r = await fetch(IM_URL, {
    method:'POST', credentials:'include',
    headers:{ 'content-type':'application/x-protobuf', 'accept':'application/x-protobuf' },
    body: envelope(cmd, inner),
  });
  var buf = new Uint8Array(await r.arrayBuffer());
  return { http: r.status, ms: Date.now()-t0, buf: buf };
}
`

/** 统一的「在页面里跑一段，拿 JSON 回来」 */
async function run(js) {
	let raw = null
	try {
		raw = await withPage(HOST, async (c) => c.evaluate(`(async () => { ${PRELUDE} ${js} })()`, { timeout: 60000 }))
	} catch (e) {
		return { ok: false, error: String((e && e.message) || e) }
	}
	if (typeof raw !== 'string') return { ok: false, error: '页面没返回内容（可能在导航或没登录）' }
	try { return JSON.parse(raw) } catch { return { ok: false, error: '返回不是 JSON', head: String(raw).slice(0, 200) } }
}

/**
 * 拉全部已建立会话（cmd 2043）。
 * 每条会话带最近 limit 条消息，按时间戳从旧到新排（**不信线序**，实测顺序不稳）。
 */
export const conversations = ({ limit = 20 } = {}) => run(`
  var LIMIT = ${Math.max(1, Math.min(Number(limit) || 20, 60))};

  // ① 我是谁：判「谁发的」要用；顺带验登录态
  var meR = await fetch('/aweme/v1/web/user/profile/self/?device_platform=webapp&aid=6383&channel=channel_pc_web', { credentials:'include', headers:{ accept:'application/json' } });
  var me = null; try { me = await meR.json() } catch(e) { me = null }
  var myUid = String((me && me.user && me.user.uid) || '');
  if (!myUid) return JSON.stringify({ ok:false, error:'Cookie 失效或登录态异常', http: meR.status });

  // ② 拉会话
  var resp = await imFetch(2043, Uint8Array.from(encB(2043, new Uint8Array(0))));
  if (resp.http !== 200) return JSON.stringify({ ok:false, error:'IM 接口 HTTP ' + resp.http, my_uid: myUid });
  // 只解必要字段：envelope 只要 status(4) 和 wrap-body(6)
  var env = parseOnly(resp.buf, new Set([4, 6]));
  var status = asStr(g1(env, 4));
  if (status !== 'OK') return JSON.stringify({ ok:false, error:'IM 接口返回: ' + (status || '(空)'), status: status, my_uid: myUid, bytes: resp.buf.length });

  var wrap = parseOnly(g1(env, 6) || new Uint8Array(0), new Set([2043]));
  var sub = parseOnly(g1(wrap, 2043) || new Uint8Array(0), new Set([1]));
  var blobs = sub[1] || [];
  var convs = [];
  for (var bi=0; bi<blobs.length; bi++) {
    if (!(blobs[bi] instanceof Uint8Array)) continue;
    // conv: 1=core-blob 2=message-blobs
    var conv = parseOnly(blobs[bi], new Set([1, 2]));
    // core: 1=conv_id 2=short_id 3=type
    var core = parseOnly(g1(conv, 1) || new Uint8Array(0), new Set([1, 2, 3]));
    var convId = asStr(g1(core, 1));
    var msgs = [];
    var raw = conv[2] || [];
    for (var mi=0; mi<raw.length; mi++) {
      if (!(raw[mi] instanceof Uint8Array)) continue;
      // message: 7=sender_uid 8=body_json 10=timestamp_ms
      var f = parseOnly(raw[mi], new Set([7, 8, 10]));
      var sender = asStr(g1(f, 7));
      var body = asStr(g1(f, 8));
      var at = Number(g1(f, 10) || 0);
      var text = '', kind = 'text', bytes = 0, url = '';
      try {
        var j = JSON.parse(body);
        text = String(j.text || j.content_title || j.title || '').trim();
        /* 分享卡片不一定 aweType=800（2026-11-03 实测：发出去的卡片 aweType 读出来是 0，
         * 只剩 content_title 是视频标题）。所以只要带了 aweType / awe_id / item_id 这类字段，
         * 就按卡片算，别让「发出去了」被回读判成没发。 */
        var awe = Number(j.aweType || 0);
        /* 图片消息（2026-11-14 真机实测）：body 里没有 text，只有
         * { aweType:2702, cover_width, cover_height, md5, from_gallery:1,
         *   resource_url:{ data_size, large_url_list:[...] } }
         * 以前 if (!text) continue 会把整条丢掉 —— 「明明发出去了」因此被回读判成没发。 */
        if (awe === 2702) {
          kind = 'image';
          if (!text) text = '[图片]';
          var ru = j.resource_url || {};
          bytes = Number(ru.data_size || 0) || 0;
          url = String((ru.large_url_list || [])[0] || '');
        } else if (awe === 800 || j.awe_id || j.aweme_id || j.item_id) {
          kind = 'card';
          if (!text) text = '[视频卡片]';
        }
        if (!text && j.comment) { text = String(j.comment); kind = 'comment' }
      } catch(e) { text = body.slice(0, 120) }
      if (!text) continue;
      var msg = { _ts: at, from: sender === myUid ? 'me' : 'them', text: text.slice(0, 200), at: iso(at), kind: kind };
      if (kind === 'image') { msg.bytes = bytes; msg.url = url }
      msgs.push(msg);
    }
    msgs.sort(function(a,b){ return (a._ts||0) - (b._ts||0) });
    for (var k=0;k<msgs.length;k++) delete msgs[k]._ts;
    convs.push({
      conv_id: convId,
      short_id: asStr(g1(core, 2)),
      type: Number(g1(core, 3) || 0),          // 1=私聊 2=群聊
      peer_uid: peerUidOf(convId, myUid),
      count: msgs.length,
      last_at: msgs.length ? msgs[msgs.length-1].at : '',
      messages: msgs.slice(-LIMIT),
    });
  }

  return JSON.stringify({
    ok: true, my_uid: myUid, ms: resp.ms, bytes: resp.buf.length,
    count: convs.length, conversations: convs,
  });
`)

/**
 * 读某一个人的会话。
 * ⚠️ 身份核验：把 sec_uid **当场反查**成数字 uid，与会话里的 peer_uid 严格相等才算数 ——
 *    绝不按昵称或「第几条」猜人（猜错就是把不该给的东西发给别人）。
 */
export const read = ({ secUid = '', uid = '', limit = 30 } = {}) => run(`
  var SEC = ${JSON.stringify(String(secUid || ''))};
  var UID = ${JSON.stringify(String(uid || ''))};
  var LIMIT = ${Math.max(1, Math.min(Number(limit) || 30, 60))};

  var meR = await fetch('/aweme/v1/web/user/profile/self/?device_platform=webapp&aid=6383&channel=channel_pc_web', { credentials:'include', headers:{ accept:'application/json' } });
  var me = null; try { me = await meR.json() } catch(e) { me = null }
  var myUid = String((me && me.user && me.user.uid) || '');
  if (!myUid) return JSON.stringify({ ok:false, error:'Cookie 失效或登录态异常', http: meR.status });

  if (!UID && SEC) {
    var pR = await fetch('/aweme/v1/web/user/profile/other/?device_platform=webapp&aid=6383&channel=channel_pc_web&sec_user_id=' + encodeURIComponent(SEC), { credentials:'include', headers:{ accept:'application/json' } });
    var p = null; try { p = await pR.json() } catch(e) { p = null }
    UID = String((p && p.user && p.user.uid) || '');
    if (!UID) return JSON.stringify({ ok:false, error:'sec_uid 反查不到数字 uid（不猜人）', sec_uid: SEC });
  }
  if (!UID) return JSON.stringify({ ok:false, error:'要给 sec_uid 或 uid' });

  var resp = await imFetch(2043, Uint8Array.from(encB(2043, new Uint8Array(0))));
  if (resp.http !== 200) return JSON.stringify({ ok:false, error:'IM 接口 HTTP ' + resp.http });
  var env = parseOnly(resp.buf, new Set([4, 6]));
  var status = asStr(g1(env, 4));
  if (status !== 'OK') return JSON.stringify({ ok:false, error:'IM 接口返回: ' + (status || '(空)'), status: status });

  var wrap = parseOnly(g1(env, 6) || new Uint8Array(0), new Set([2043]));
  var sub = parseOnly(g1(wrap, 2043) || new Uint8Array(0), new Set([1]));
  var blobs = sub[1] || [];
  var hit = null, seen = [];
  for (var bi=0; bi<blobs.length; bi++) {
    if (!(blobs[bi] instanceof Uint8Array)) continue;
    var conv = parseOnly(blobs[bi], new Set([1, 2]));
    var core = parseOnly(g1(conv, 1) || new Uint8Array(0), new Set([1, 3]));
    var convId = asStr(g1(core, 1));
    var type = Number(g1(core, 3) || 0);
    var peer = peerUidOf(convId, myUid);
    seen.push({ conv_id: convId, type: type, peer_uid: peer });
    if (type === 1 && peer === UID) { hit = blobs[bi]; break }
  }
  if (!hit) return JSON.stringify({ ok:false, error:'这个人不在已建立会话里（陌生人消息走别的接口，本工具不覆盖）', uid: UID, seen: seen });

  var conv2 = parseOnly(hit, new Set([1, 2]));
  var core2 = parseOnly(g1(conv2, 1) || new Uint8Array(0), new Set([1]));
  var msgs = [];
  var raws = conv2[2] || [];
  for (var mi=0; mi<raws.length; mi++) {
    if (!(raws[mi] instanceof Uint8Array)) continue;
    var f = parseOnly(raws[mi], new Set([7, 8, 10]));
    var sender = asStr(g1(f, 7));
    var body = asStr(g1(f, 8));
    var at = Number(g1(f, 10) || 0);
    var text = '', kind = 'text', bytes = 0, url = '';
    try {
      var j = JSON.parse(body);
      text = String(j.text || j.content_title || j.title || '').trim();
      /* 图片消息：aweType 2702（见上方 conversations 里的实测注释）。删掉这条会
       * 让「表情图发出去了」永远回读不到 —— 2026-11-14 就是这样误判成没发的。 */
      if (Number(j.aweType || 0) === 2702) {
        kind = 'image';
        if (!text) text = '[图片]';
        var ru = j.resource_url || {};
        bytes = Number(ru.data_size || 0) || 0;
        url = String((ru.large_url_list || [])[0] || '');
      } else if (Number(j.aweType || 0) === 800) { kind = 'card'; if (!text) text = '[视频卡片]'; }
      if (!text && j.comment) { text = String(j.comment); kind = 'comment' }
    } catch(e) { text = body.slice(0, 120) }
    if (!text) continue;
    var msg = { _ts: at, from: sender === myUid ? 'me' : 'them', text: text.slice(0, 300), at: iso(at), kind: kind };
    if (kind === 'image') { msg.bytes = bytes; msg.url = url }
    msgs.push(msg);
  }
  msgs.sort(function(a,b){ return (a._ts||0) - (b._ts||0) });
  for (var k=0;k<msgs.length;k++) delete msgs[k]._ts;

  return JSON.stringify({
    ok: true, via: 'http', my_uid: myUid, conv_id: asStr(g1(core2,1)), uid: UID,
    count: msgs.length,
    mine: msgs.filter(function(m){ return m.from==='me' }).length,
    them: msgs.filter(function(m){ return m.from==='them' }).length,
    messages: msgs.slice(-LIMIT),
  });
`)
/**
 * ��˽�ţ�д������������ tools/im-send.mjs ����ҳ������
 * Ϊʲô���ýӿڣ�����Ϣ�� cmd �����û���壬ֻ�� UI ����·���淢��֤����
 * ?? ��֮ǰ���÷��������õ��û���ͷ�����߲��� confirm ������
 */
export async function send({ secUid = '', nick = '', text = '', dry = false } = {}) {
	const { sendByUi } = await import('./im-send.mjs')
	if (!secUid && !nick) return { ok: false, error: '发私信要给 sec_uid（稳）或昵称' }
	if (!String(text || '').trim()) return { ok: false, error: '正文是空的' }
	/* ⚠️ 2026-11-05 实弹：发私信前必须先把标签页落到 /chat。
	 *    openPage 只按域名挑标签页，上一步「分享视频」留下的是视频页；
	 *    而视频页的分享面板里好友行也带 conversation-item，
	 *    于是 im-send 会"找得到行、双击没反应、等不到输入框" —— 表现就是只收到视频没有文字。 */
	try {
		const { openPage, sleep } = await import('./chrome.mjs')
		const p = await openPage({ url: 'https://www.douyin.com/chat', navigate: true })
		await sleep(1200)
		p.close()
	} catch { /* 导航失败就交给 sendByUi 报错，绝不在这里假装成功 */ }
	const r = await sendByUi({ nick, secUid, text, dry })
	/* ⭐ 发完再用**接口**回读一遍：UI 说「发出去了」只算一半证据，
	 *    接口里真出现这条、而且是 me 发的，才算数（和发作品一个标准）。 */
	if (r && r.ok && !dry) {
		/* ⚠️ 2026-11-02 真机：发出去那一刻接口列表还没刷新（缓存），
		 *    一次回读会误判成 unverified。重试三次、每次隔 1.5 秒。 */
		const wait = (ms) => new Promise((res) => setTimeout(res, ms))
		for (let attempt = 0; attempt < 3 && !r.verified_http; attempt++) {
			if (attempt) await wait(1500)
			try {
				const list = await conversations({ limit: 2 })
				const top = (list.conversations || [])
					.slice()
					.sort((a, b) => String(b.last_at).localeCompare(String(a.last_at)))[0]
				/* ⚠️ 别只比「最后一条」：对方手快，回个「ok」就把我们那条挤下去了（真踩过）。
				 *    在最近 3 条里找「我发的、含这句话」的那条。 */
				const strip = (x) => String(x || '').replace(/[\s\u200b-\u200d\ufeff]+/g, '')
				const mine = (top && top.messages ? top.messages : []).filter((m) => m && m.from === 'me').slice(-3)
				const hit = mine.find((m) => strip(m.text).includes(strip(text).slice(0, 8)))
				r.verified_http = Boolean(hit)
				if (hit) r.http_seen = { peer_uid: top.peer_uid, at: hit.at }
			} catch { /* 回读失败不影响已经发出的事实，但不会标 verified */ }
		}
	}
	return r
}

export function pickJson(text) {
	const s = String(text || '')
	const whole = s.trim()
	if (whole.startsWith('{')) {
		try { return JSON.parse(whole) } catch { /* 后面还有日志，继续捞 */ }
	}
	for (let i = s.length - 1; i >= 0; i--) {
		if (s[i] !== '{') continue
		try {
			const j = JSON.parse(s.slice(i))
			if (j && typeof j === 'object') return j
		} catch { /* 这个 { 不是起点 */ }
	}
	return null
}

/**
 * 调试用：把会话 blob 里的字符串都吐出来，看昵称到底在不在里面。
 * 只读，不改任何东西。
 */
export const debugStrings = () => run(`
  var resp = await imFetch(2043, Uint8Array.from(encB(2043, new Uint8Array(0))));
  if (resp.http !== 200) return JSON.stringify({ ok:false, http: resp.http });
  var env = parse(resp.buf);
  var wrap = parse(g1(env, 6) || new Uint8Array(0));
  var sub = parse(g1(wrap, 2043) || new Uint8Array(0));
  var blobs = sub[1] || [];
  var out = [];
  for (var bi = 0; bi < Math.min(blobs.length, 4); bi++) {
    var conv = parse(blobs[bi]);
    var fields = [];
    for (var k in conv) {
      if (k === '1' || k === '2') continue;
      var arr = conv[k] || [];
      for (var i = 0; i < arr.length; i++) {
        var v = arr[i];
        if (v instanceof Uint8Array) {
          var s = '';
          try { s = new TextDecoder().decode(v) } catch (e) { s = '' }
          var printable = /^[\\p{L}\\p{N} _\\.\\-#@:：，。！？~～]{1,40}$/u.test(s);
          fields.push({ f: k, len: v.length, text: printable ? s : '(bin ' + v.length + ')' });
        }
      }
    }
    out.push({ i: bi, fields: fields.slice(0, 14) });
  }
  return JSON.stringify({ ok: true, convs: out });
`)
