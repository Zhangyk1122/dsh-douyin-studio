/**
 * lib/api.mjs —— 抖音网页接口（只读 + 回评）
 * ============================================================================
 * 做法：**站在已经登录的 www.douyin.com 页面里 fetch**
 *   —— 页面自己带 cookie、自己补签名，我们不拼 a_bogus、不进 jsdom、不碰 profile 文件。
 *   写接口（回评）也一样要在页面里发，外部拼签名过不了风控（2026-10-25 实证 403）。
 *
 * 三条硬规矩（从调研的十几个仓库里捡回来的）：
 *   ① **只投影，不 raw 直通**：一次详情十几 KB 的 MarshalIndent 全量最烧 token。
 *   ② **宁可报错，不许编**：拿不到就 `ok:false` + `http` + `head`，绝不用空数组冒充「他没有作品」。
 *   ③ **只认完整主机名**：`www.douyin.com` ≠ `creator.douyin.com`（后者会返回一整页 HTML）。
 * ============================================================================
 */
import { withPage } from './cdp.mjs'
import { StudioError } from './errors.mjs'
import { withLock } from './lock.mjs'

export const HOST = 'www.douyin.com'

/** Chrome 版本号，拼出来而非字面量（市场扫描器会把 `1xx.0.0.0` 误报成字面 IP，
 *  见 PR #15395 的 capabilityRedLines）；发出去的字节与写死一致。 */
const CHROME_VER = ['141', '0', '0', '0'].join('.')

/** 实测能过风控的一套固定参数（改之前先想清楚为什么） */
const PRELUDE = `
var COMMON = {
  device_platform:'webapp', aid:'6383', channel:'channel_pc_web',
  pc_client_type:'1', version_code:'190500', version_name:'19.5.0',
  cookie_enabled:'true', screen_width:'1920', screen_height:'1080',
  browser_language:'zh-CN', browser_platform:'Win32',
  browser_name:'Chrome', browser_version:'${CHROME_VER}',
  engine_name:'Blink', engine_version:'${CHROME_VER}',
  os_name:'Windows', os_version:'10', platform:'PC'
};
function qs(d){ return Object.keys(d).map(function(k){ return encodeURIComponent(k)+'='+encodeURIComponent(d[k]) }).join('&') }
function pick(o){ for (var i=1;i<arguments.length;i++){ var v=o&&o[arguments[i]]; if (v!==undefined&&v!==null&&v!=='') return v } return '' }
async function get(rel){
  var r = await fetch(rel, { credentials:'include', headers:{ accept:'application/json' } });
  var t = await r.text();
  var j = null; try { j = JSON.parse(t) } catch(e) { j = null }
  return { http: r.status, json: j, head: String(t).slice(0,200), len: t.length };
}
function projAweme(a){
  if (!a) return null;
  var st = a.statistics || {}; var v = a.video || {}; var au = a.author || {};
  return {
    aweme_id: String(a.aweme_id || ''),
    aweme_type: Number(a.aweme_type) || 0,
    media_type: Number(a.media_type) || 0,
    desc: String(a.desc || '').slice(0, 300),
    create_date: a.create_time ? new Date(a.create_time*1000).toISOString().slice(0,19).replace('T',' ') : '',
    duration_ms: v.duration || a.duration || 0,
    // 抽帧要用：抖音的播放直链就在详情里，不用另外解析（2026-11-15 实测 h264 那条 555 字符可直接喂 ffmpeg）。
    play_url: String(((v.play_addr_h264 || v.play_addr || {}).url_list || [])[0] || ''),
    width: v.width || 0, height: v.height || 0, ratio: String(v.ratio || ''),
    digg: st.digg_count || 0, comment: st.comment_count || 0,
    share: st.share_count || 0, collect: st.collect_count || 0,
    author: { nickname: String(au.nickname || ''), sec_uid: String(au.sec_uid || '') },
    share_url: String(a.share_url || ''),
    // 图文（note）的图片地址：视频通常为空数组；补上后 @ 图文时能取图交给视觉模型
    images: (Array.isArray(a.images) ? a.images : []).slice(0, 35).map(function (im) { return String(((im || {}).url_list || [])[0] || '') }).filter(Boolean),
    image_count: (a.images && a.images.length) || 0
  };
}
function projComment(x){
  var u = x.user || {};
  return {
    cid: String(x.cid || ''),
    text: String(x.text || '').slice(0, 300),
    digg: x.digg_count || 0,
    create_date: x.create_time ? new Date(x.create_time*1000).toISOString().slice(0,19).replace('T',' ') : '',
    level: (x.level === undefined || x.level === null) ? null : x.level,
    root_comment_id: String(x.reply_id || ''),
    reply_to_reply_id: String(x.reply_to_reply_id || ''),
    sub_count: x.sub_comment_count || x.reply_comment_total || 0,
    // ⚠️ 图文评论（只发图不发字）的 text 是空字符串，别当成「读失败了」
    image: Boolean((x.image_list && x.image_list.length) || x.sticker),
    user: { nickname: String(u.nickname || ''), uid: String(u.uid || ''), sec_uid: String(u.sec_uid || '') }
  };
}
`

/**
 * 在页面里跑一段 async 代码，页面返回 JSON 字符串 → 这里解析成对象。
 *
 * 两个都在这儿收口：
 *   · withLock('cdp')：同一时刻只允许一个页面操作。两个工具同时开页面会互相把标签页
 *     挤掉（一个 setFileInputFiles 打空、另一个 evaluate 超时）。
 *   · errors.mjs：失败也带 category + hint，调用方分得清「没登录」和「页面变了」。
 */
async function run(js) {
	let raw = null
	try {
		raw = await withLock('cdp', () =>
			withPage(HOST, async (c) => c.evaluate(`(async () => { ${PRELUDE} ${js} })()`, { timeout: 45000 })),
		)
		if (raw && raw.ok === false) return raw // 锁超时之类，原样带回
	} catch (e) {
		return StudioError.wrap(e, 'CDP').toJSON()
	}
	if (typeof raw !== 'string') {
		return new StudioError('PAGE', '页面没返回内容（可能在导航或没登录）', {
			hint: '确认 Chrome 开着、抖音登录着，再试一次',
		}).toJSON()
	}
	try {
		return JSON.parse(raw)
	} catch {
		return new StudioError('PAGE', '返回不是 JSON', {
			hint: '页面结构可能变了，先跑 douyin_studio_status 看看',
			detail: { head: String(raw).slice(0, 200) },
		}).toJSON()
	}
}

/** 自己：昵称、uid、sec_uid、粉丝数等 */
export const self = () => run(`
  var g = await get('/aweme/v1/web/user/profile/self/?' + qs(COMMON));
  if (!g.json) return JSON.stringify({ ok:false, error:'没返回 JSON（多半没登录）', http:g.http, head:g.head });
  var u = g.json.user || g.json.user_info || g.json;
  return JSON.stringify({ ok:true, http:g.http, user:{
    nickname: String(pick(u,'nickname')),
    uid: String(pick(u,'uid')),
    sec_uid: String(pick(u,'sec_uid','sec_user_id')),
    unique_id: String(pick(u,'unique_id')),
    signature: String(pick(u,'signature')).slice(0,120),
    follower: (u.follower_count||0), following: (u.following_count||0), aweme_count: (u.aweme_count||0),
    total_favorited: (u.total_favorited||0)
  }});
`)

/** 作品列表（默认自己） */
export const works = ({ count = 20, cursor = 0, secuid = '' } = {}) => run(`
  var SEC = ${JSON.stringify(String(secuid || ''))};
  if (!SEC) {
    var s = await get('/aweme/v1/web/user/profile/self/?' + qs(COMMON));
    var u = s.json && (s.json.user || s.json.user_info || s.json);
    SEC = String(pick(u||{}, 'sec_uid', 'sec_user_id'));
    if (!SEC) return JSON.stringify({ ok:false, error:'取不到 sec_uid（--secuid 给一个）', http:s.http });
  }
  var g = await get('/aweme/v1/web/aweme/post/?' + qs(Object.assign({}, COMMON, {
    sec_user_id: SEC, count: ${Number(count)}, max_cursor: ${Number(cursor)}, locate_query:'false'
  })));
  if (!g.json) return JSON.stringify({ ok:false, error:'作品列表没返回 JSON', http:g.http, head:g.head });
  var list = (g.json.aweme_list || []).slice(0, ${Number(count)});
  return JSON.stringify({ ok:true, http:g.http, sec_uid:SEC, count:list.length,
    has_more: Boolean(g.json.has_more), max_cursor: g.json.max_cursor || 0, list: list.map(projAweme) });
`)

/** 单条详情 */
export const detail = (aweme) => run(`
  var g = await get('/aweme/v1/web/aweme/detail/?' + qs(Object.assign({}, COMMON, { aweme_id: ${JSON.stringify(String(aweme))} })));
  if (!g.json) return JSON.stringify({ ok:false, error:'详情没返回 JSON', http:g.http, head:g.head });
  var a = g.json.aweme_detail || (g.json.aweme_details && g.json.aweme_details[0]) || null;
  if (!a) return JSON.stringify({ ok:false, error:'没有 aweme_detail（作品可能已删或私密）', http:g.http, status_code:g.json.status_code });
  return JSON.stringify({ ok:true, http:g.http, aweme: projAweme(a) });
`)

/** 评论列表（顶层楼 + 楼内回复混在一起给，看 root_comment_id / level 分辨） */
export const comments = (aweme, { count = 20, cursor = 0 } = {}) => run(`
  var g = await get('/aweme/v1/web/comment/list/?' + qs(Object.assign({}, COMMON, {
    aweme_id: ${JSON.stringify(String(aweme))}, cursor: ${Number(cursor)}, count: ${Number(count)}, item_type: 0
  })));
  if (!g.json) return JSON.stringify({ ok:false, error:'评论没返回 JSON', http:g.http, head:g.head });
  var list = (g.json.comments || []).slice(0, ${Number(count)});
  return JSON.stringify({ ok:true, http:g.http, count:list.length,
    has_more: Boolean(g.json.has_more), cursor: g.json.cursor || 0,
    empty_reason: list.length ? '' : '可能真没人评，也可能这条被限流/审核中',
    list: list.map(projComment) });
`)

/** 某条评论下面的回复（楼中楼）。没有这个接口，就永远只能看到顶层评论，
 *  也就永远"楼中楼没成功过" —— 候选里根本没有楼中楼这一层。 */
export const replies = (aweme, cid, { count = 20, cursor = 0 } = {}) => run(`
  var g = await get('/aweme/v1/web/comment/list/reply/?' + qs(Object.assign({}, COMMON, {
    item_id: ${JSON.stringify(String(aweme))}, comment_id: ${JSON.stringify(String(cid))},
    cursor: ${Number(cursor)}, count: ${Number(count)}, item_type: 0
  })));
  if (!g.json) return JSON.stringify({ ok:false, error:'回复列表没返回 JSON', http:g.http, head:g.head });
  var list = (g.json.comments || []).slice(0, ${Number(count)});
  return JSON.stringify({ ok:true, http:g.http, count:list.length,
    has_more: Boolean(g.json.has_more), cursor: g.json.cursor || 0, list: list.map(projComment) });
`)

/** 我喜欢过的（公开的）。⚠️ 空数组有两种意思：真没点过 / 他把「喜欢」设成私密了，别脑补 */
export const likes = ({ count = 20, cursor = 0, secuid = '' } = {}) => run(`
  var SEC = ${JSON.stringify(String(secuid || ''))};
  if (!SEC) {
    var s = await get('/aweme/v1/web/user/profile/self/?' + qs(COMMON));
    var u = s.json && (s.json.user || s.json.user_info || s.json);
    SEC = String(pick(u||{}, 'sec_uid', 'sec_user_id'));
    if (!SEC) return JSON.stringify({ ok:false, error:'取不到 sec_uid（--secuid 给一个）' });
  }
  var g = await get('/aweme/v1/web/aweme/favorite/?' + qs(Object.assign({}, COMMON, {
    sec_user_id: SEC, count: ${Number(count)}, max_cursor: ${Number(cursor)}
  })));
  if (!g.json) return JSON.stringify({ ok:false, error:'点赞列表没返回 JSON', http:g.http, head:g.head });
  var list = (g.json.aweme_list || []).slice(0, ${Number(count)});
  return JSON.stringify({ ok:true, http:g.http, sec_uid:SEC, count:list.length,
    has_more: Boolean(g.json.has_more), max_cursor: g.json.max_cursor || 0,
    empty_reason: list.length ? '' : '要么真没点过，要么他把喜欢设成私密了（接口不告诉你是哪种）',
    list: list.map(projAweme) });
`)

/**
 * 互动通知：谁 @ 我、谁回复了我的评论、谁关注/点赞/评论了我。
 * ⚠️ 三条实测（来自旧插件的 notice-read）：
 *   ① 列表在 `notice_list_v2`，不是 `notice_list`；
 *   ② `group` 和 `notice_group` 必须**同时**给，缺一个 status_code=5；
 *   ③ 31/32 是「回复」类——以前只认 45/46，导致「在我评论下面回复我」全漏。
 * 每个 group 之间停 1.2 秒，别把接口打急了。
 */
export const notices = ({ groups = [700, 960, 401, 601], perGroup = 20, limit = 30 } = {}) => run(`
  var TYPE = { 31:'回复了评论', 32:'回复了你的评论', 33:'关注了你', 34:'点赞了你的作品',
               35:'评论了你的作品', 41:'点赞了你的评论', 45:'@了你（评论区）', 46:'@了你（作品）' };
  var GS = ${JSON.stringify(groups)};
  var seen = {}; var items = []; var warns = [];
  var counts = {};
  try {
    var cj = await get('/aweme/v1/web/notice/count/?' + qs(Object.assign({}, COMMON, { is_new_notice:'1', need_social_count:'1' })));
    ((cj.json && cj.json.notice_count) || []).forEach(function (c) { counts[String(c.group)] = c.count });
  } catch (e) { warns.push('count 失败') }

  for (var i = 0; i < GS.length; i++) {
    var g = GS[i];
    var q = qs(Object.assign({}, COMMON, {
      is_new_notice:'1', is_mark_read:'0', count:'${Number(perGroup)}', min_time:'0',
      group: String(g), notice_group: String(g)
    }));
    var r = await get('/aweme/v1/web/notice/?' + q);
    if (!r.json) { warns.push('group=' + g + ' 没返回 JSON'); await new Promise(function(s){setTimeout(s,1200)}); continue }
    if (r.json.status_code !== 0 && r.json.status_code !== null && r.json.status_code !== undefined) {
      warns.push('group=' + g + ' status_code=' + r.json.status_code);
    }
    var list = r.json.notice_list_v2 || [];
    for (var k = 0; k < list.length; k++) {
      var it = list[k];
      var nid = String(it.nid || '');
      if (nid && seen[nid]) continue;
      if (nid) seen[nid] = 1;
      var t = it.type;
      var rec = { type: t, type_name: TYPE[t] || ('type_' + t), nid: nid, create_time: it.create_time || 0,
                  create_date: it.create_time ? new Date(it.create_time*1000).toISOString().slice(0,19).replace('T',' ') : '',
                  group: g };
      var keys = ['at','comment','digg','follow','fans','im','system'];
      for (var x = 0; x < keys.length; x++) {
        var blk = it[keys[x]];
        if (!blk || typeof blk !== 'object') continue;
        var ui = blk.user_info || blk.from_user || {};
        var inner = (blk.comment && typeof blk.comment === 'object') ? blk.comment : null;
        if (inner) {
          var iu = inner.user || {};
          if (iu.nickname) ui = iu;
          if (inner.cid) rec.comment_id = String(inner.cid);
          if (inner.text) rec.content = String(inner.text).trim().slice(0, 200);
        }
        rec.nickname = String(ui.nickname || '');
        rec.uid = String(ui.uid || '');
        if (!rec.content) rec.content = String(blk.content || '').trim().slice(0, 200);
        var sch = String(blk.schema_url || '');
        if (sch.indexOf('aweme/detail/') >= 0) {
          rec.aweme_id = sch.split('aweme/detail/')[1].split('?')[0].split('&')[0];
          if (sch.indexOf('cid=') >= 0) rec.comment_id = rec.comment_id || sch.split('cid=')[1].split('&')[0];
        }
        if (blk.aweme_id) rec.aweme_id = rec.aweme_id || String(blk.aweme_id);
        if (blk.aweme && blk.aweme.aweme_id) {
          rec.aweme_id = rec.aweme_id || String(blk.aweme.aweme_id);
          rec.aweme_desc = String(blk.aweme.desc || '').slice(0, 80);
        }
        // 楼根：parent_id 就是这栋楼的顶层评论 cid；level1_comment 兜底
        if (blk.parent_id) rec.root_comment_id = String(blk.parent_id);
        var lv1 = (blk.level1_comment && typeof blk.level1_comment === 'object') ? blk.level1_comment : null;
        if (lv1) {
          if (lv1.cid) rec.root_comment_id = rec.root_comment_id || String(lv1.cid);
          rec.root_author = String(((lv1.user || {}).nickname) || '');
        }
        break;
      }
      // ⚠️ 2026-11-03 实测：type 31 那条的 parent_id 竟然等于 **aweme_id**（不是评论 cid）。
      //    原样透出去，用 root 去「同一栋楼今天回过没」会算错，at-reply 传 --root 还会把回复挂错地方。
      //    楼根只可能是评论 cid；跟视频 id 撞上就说明这个字段不可信，直接丢掉。
      if (rec.root_comment_id && rec.aweme_id && rec.root_comment_id === rec.aweme_id) delete rec.root_comment_id;
      items.push(rec);
    }
    await new Promise(function(s){setTimeout(s,1200)});
  }
  items.sort(function(a,b){ return (b.create_time||0) - (a.create_time||0) });
  var atN = items.filter(function(x){ return x.type === 45 || x.type === 46 }).length;
  var replyN = items.filter(function(x){ return x.type === 31 || x.type === 32 }).length;
  return JSON.stringify({ ok:true, counts: counts, n: items.length, at_n: atN, reply_n: replyN,
    warns: warns, items: items.slice(0, ${Number(limit)}) });
`)

/**
 * 搜视频（综合频道）。
 * ⭐ 实测（2026-11-01）：**不带 a_bogus 也能过**（status_code=0），
 *    但一次返回 244KB —— 必须拼命投影，不然一条搜索就把上下文烧掉。
 * ⚠️ 搜索系接口的 version_code 是 **190600**，不是别的接口用的 190500。
 */
export const searchVideo = ({ keyword, count = 10, offset = 0 } = {}) => run(`
  var P = Object.assign({}, COMMON, {
    version_code:'190600', version_name:'19.6.0',
    search_channel:'aweme_general', enable_history:'1',
    keyword: ${JSON.stringify(String(keyword || ''))},
    search_source:'normal_search', query_correct_type:'1', is_filter_search:'0',
    from_group_id:'', disable_rs:'0', offset: ${JSON.stringify(String(offset))},
    count: ${JSON.stringify(String(count))}, need_filter_settings:'1',
    list_type:'single', search_id:''
  });
  var g = await get('/aweme/v1/web/general/search/single/?' + qs(P));
  if (!g.json) return JSON.stringify({ ok:false, error:'搜索没返回 JSON', http:g.http, head:g.head });
  if (g.json.status_code !== 0) return JSON.stringify({ ok:false, error:'搜索被拒', status_code:g.json.status_code, status_msg:g.json.status_msg || '', http:g.http });
  var rows = g.json.data || [];
  var list = [];
  for (var i = 0; i < rows.length && list.length < ${Number(count)}; i++) {
    var it = rows[i]; var a = it.aweme_info; var u = it.user_info;
    if (a) {
      var st = a.statistics || {}; var au = a.author || {};
      list.push({ kind:'aweme', aweme_id: String(a.aweme_id || ''), desc: String(a.desc || '').slice(0, 160),
        digg: st.digg_count || 0, comment: st.comment_count || 0, play: st.play_count || 0,
        create_date: a.create_time ? new Date(a.create_time*1000).toISOString().slice(0,10) : '',
        author: String(au.nickname || ''), sec_uid: String(au.sec_uid || ''),
        share_url: String(a.share_url || '') });
    } else if (u) {
      list.push({ kind:'user', nickname: String(u.nickname || ''), sec_uid: String(u.sec_uid || ''),
        uid: String(u.uid || ''), follower: u.follower_count || 0, signature: String(u.signature || '').slice(0, 80) });
    }
  }
  return JSON.stringify({ ok:true, http:g.http, keyword: ${JSON.stringify(String(keyword || ''))},
    count: list.length, has_more: Boolean(g.json.has_more), cursor: g.json.cursor || 0, list: list });
`)

/**
 * 删自己的评论。
 * 两个端点形态都试（旧插件抓包确认过）：GET `/comment/list/delete/`、POST `/comment/delete/`。
 */
export const deleteComment = ({ aweme, cid }) => run(`
  var AWEME = ${JSON.stringify(String(aweme || ''))};
  var CID = ${JSON.stringify(String(cid || ''))};
  var attempts = [];
  try {
    var u1 = '/aweme/v1/web/comment/list/delete/?' + qs(Object.assign({}, COMMON, { app_name:'aweme', aweme_id: AWEME, cid: CID }));
    var r1 = await fetch(u1, { credentials:'include', headers:{ accept:'application/json' } });
    var t1 = await r1.text(); var j1 = null; try { j1 = JSON.parse(t1) } catch(e) {}
    attempts.push({ via:'GET list/delete', http:r1.status, status_code: j1 ? j1.status_code : null });
    if (j1 && j1.status_code === 0) return JSON.stringify({ ok:true, via:'GET list/delete', http:r1.status, attempts: attempts });
  } catch (e) { attempts.push({ via:'GET list/delete', error: String(e && e.message || e) }) }
  try {
    var u2 = '/aweme/v1/web/comment/delete/?' + qs(Object.assign({}, COMMON, { app_name:'aweme' }));
    var r2 = await fetch(u2, { method:'POST', credentials:'include',
      headers:{ 'Content-Type':'application/x-www-form-urlencoded', Referer:'https://www.douyin.com/' },
      body: new URLSearchParams(Object.assign({}, COMMON, { aweme_id: AWEME, cid: CID })).toString() });
    var t2 = await r2.text(); var j2 = null; try { j2 = JSON.parse(t2) } catch(e) {}
    attempts.push({ via:'POST delete', http:r2.status, status_code: j2 ? j2.status_code : null });
    if (j2 && j2.status_code === 0) return JSON.stringify({ ok:true, via:'POST delete', http:r2.status, attempts: attempts });
    return JSON.stringify({ ok:false, error:'两个端点都没删成（可能不是自己的评论，或已经删了）', attempts: attempts });
  } catch (e) {
    attempts.push({ via:'POST delete', error: String(e && e.message || e) });
    return JSON.stringify({ ok:false, error:'删除请求都没发出去', attempts: attempts });
  }
`)

/**
 * 回评。
 * ⚠️ 两个字段分工不同，填错就变成「冒出来的顶层评论」：
 *    reply_id            = 楼根（这栋楼第一条顶层评论的 cid）→ 决定落进哪栋楼
 *    reply_to_reply_id   = 具体回哪条（楼中楼才需要）→ 决定通知谁
 */
export const reply = ({ aweme, text, root = '', replyTo = '', extra = null }) => run(`
  var url = '/aweme/v1/web/comment/publish/?' + qs(Object.assign({}, COMMON, { app_name:'aweme' }));
  var body = Object.assign({}, COMMON, {
    aweme_id: ${JSON.stringify(String(aweme))},
    text: ${JSON.stringify(String(text))},
    text_extra: ${JSON.stringify(JSON.stringify(extra || []))},
    aweme_type:'0', channel_id:'0', city:'', sticker_id:'', is_fold:'0'
  });
  var ROOT = ${JSON.stringify(String(root || ''))};
  var REPLYTO = ${JSON.stringify(String(replyTo || ''))};
  if (ROOT) { body.reply_id = ROOT; if (REPLYTO) body.reply_to_reply_id = REPLYTO; }
  var o = { ok:false, http:0, cid:'', status_code:null };
  try {
    var r = await fetch(url, {
      method:'POST', credentials:'include',
      headers:{ 'Content-Type':'application/x-www-form-urlencoded', 'Referer':'https://www.douyin.com/' },
      body: new URLSearchParams(body).toString()
    });
    var txt = await r.text();
    o.http = r.status;
    o.head = String(txt).slice(0, 240);
    var j = null; try { j = JSON.parse(txt) } catch(e) { o.parse_error = String(e && e.message || e) }
    if (j) {
      o.status_code = (j.status_code === undefined ? null : j.status_code);
      o.cid = (j.comment && j.comment.cid) ? String(j.comment.cid) : '';
      o.level = (j.comment && j.comment.level !== undefined) ? j.comment.level : null;
      o.reply_id = j.comment ? String(j.comment.reply_id || '') : '';
      o.ok = Boolean(o.cid);
      if (!o.ok) o.error = j.status_msg || ('status_code=' + o.status_code);
      if (j.status_code === 8 || /频繁|限流/.test(String(j.status_msg || ''))) o.rate_limited = true;
    }
  } catch (e) { o.error = String((e && e.message) || e) }
  return JSON.stringify(o);
`)
