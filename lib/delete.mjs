/**
 * lib/delete.mjs —— 删掉自己发的某一条（按标题精确匹配，只允许唯一命中）
 * ============================================================================
 * 为什么要「精确 + 唯一」：删除没有撤销。多命中一条就可能删掉哥哥的作品。
 * 所以：标题必须**完全相等**；命中 0 条或多条都直接退出，让人自己去看。
 *
 * 用法：`node lib/delete.mjs --title "全链路自检"`
 * ============================================================================
 */
import { basename } from 'node:path'
import { ensureBrowser, connect, listTabs, hostOf, port, closeTab, newTab, sleep } from './cdp.mjs'

/* ⚠️ 这是**命令行脚本**，不是可复用模块：整个文件是顺序执行的，末尾还会 process.exit。
 * 谁在代码里 import 它，宿主进程会当场退出（连日志都留不下）。
 * 2026-11-05 全量扫「模块能不能加载」时踩到了这个雷，所以在这里立一道闸。 */
if (basename(process.argv[1] || '') !== 'delete.mjs') {
	throw new Error('lib/delete.mjs 是命令行脚本（node lib/delete.mjs --title ...），不要 import 它')
}

const argv = process.argv.slice(2)
const argOf = (k, d = '') => { const i = argv.indexOf(k); return i >= 0 ? (argv[i + 1] ?? d) : d }
const TITLE = String(argOf('--title') || process.env.DOUYIN_TITLE || '').trim()
/* 2026-11-15：README 一直写着「删之前先 --dry 看一眼」，但 CLI 层把 --dry 丢了、
 * 脚本也不认——dry 名存实亡，传了 dry 照样真点。现在补上。 */
const DRY = argv.includes('--dry')
const out = (o) => { process.stdout.write(JSON.stringify(o, null, 1) + '\n') }

if (!TITLE) { out({ ok: false, error: '缺 --title' }); process.exit(1) }

const MANAGE = 'https://creator.douyin.com/creator-micro/content/manage'
const isCreator = (u) => /^https:\/\/creator\.douyin\.com\//.test(u || '')

const up = await ensureBrowser({ url: MANAGE })
if (!up.up) { out({ ok: false, error: '浏览器起不来：' + (up.why || '') }); process.exit(1) }

let tab = (await listTabs()).find((t) => /\/creator-micro\/content\/manage/.test(t.url || ''))
let created = null
if (!tab) {
	tab = (await listTabs()).find((t) => isCreator(t.url))
	if (!tab) { created = await newTab(MANAGE); tab = created; await sleep(4000) }
}
if (!tab) { out({ ok: false, error: '没有创作者中心页面' }); process.exit(1) }

const c = await connect(tab)
const ev = (expr) => c.evaluate(expr)

/* 2026-11-15 真机踩到：复用已经开着的内容管理标签页时，**列表是旧的**——
 * 刚发布成功（toast 都出了）的作品在这页上不存在，delete 报「0 条命中」，
 * 而作品其实在。根因不是选择器，是「连上旧标签就直接扫，没人刷新」。
 * 修法：连上先强制刷新，**等页面真的换过来**再扫。
 * ⚠️ 第二个坑（同一天踩到）：刷新是异步的——发起后第一轮循环还能在旧 DOM 上
 * 数到 50 张卡从而提前退出，紧接着的扫描却跑在已被清空的 body 上（innerText=null），
 * 症状同样是「0 条命中」且 head 为空。所以等待条件必须是「有卡**且** body 有字」，
 * 不能只数卡；刷新后再给 2.5 秒沉降。 */
try { await c.send('Page.reload', { ignoreCache: true }) } catch { /* 刷新失败就靠下面的等待循环 */ }
await sleep(2500)

// 等作品列表渲染出来（旧 DOM 的数卡会骗人：卡还在、正文已空）
for (let i = 0; i < 30; i++) {
	const ready = await ev(`(() => {
		const cards = document.querySelectorAll('[class*=video-card],[class*=videoCard],[class*=card]').length
		const text = (document.body && document.body.innerText || '').length
		return cards > 3 && text > 100
	})()`)
	if (ready) break
	await sleep(700)
}

/**
 * 找到标题对得上的那张卡。
 * ⚠️ 2026-11-02 实测：内容管理的卡片把「标题 + 空格 + 简介」揉成一段文字，
 *    所以 `innerText === 标题` 一条都命中不了（真跑时连删自己刚发的那条都删不掉）。
 * ⚠️ 2026-11-15 再实测：揉进去的隔断**不一定是空格**——这次是「标题。简介」
 *    （句号，因为简介第一行以句号开头）。所以规则改成：正文以标题开头、
 *    且标题后面那个字符不是单词字符（标点/空白/结尾都算）。
 *    这样「一条鱼的自测。…」中，「一条鱼的自测二」不中。仍然**只认唯一一张卡**。
 */
const found = await ev(`(() => {
  const T = ${JSON.stringify(TITLE)};
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const hitText = (s) => {
    const t = norm(s)
    if (!t.startsWith(T)) return false
    const next = t.slice(T.length)
    return next === '' || !/^[0-9a-z\\u4e00-\\u9fff]/i.test(next)
  };
  const all = [...document.querySelectorAll('div,span,p,h3')].filter((e) => e.offsetParent !== null);
  const leaves = all.filter((e) => hitText(e.innerText));
  if (!leaves.length) return { hit: 0 };
  const out = [];
  for (const leaf of leaves) {
    let card = leaf;
    for (let i = 0; i < 8 && card.parentElement; i++) {
      card = card.parentElement;
      if (/删除作品/.test(card.innerText || '')) break;
    }
    if (!/删除作品/.test(card.innerText || '')) continue;
    const r = card.getBoundingClientRect();
    /* 同一张卡会被好几个祖先元素各算一遍，用位置去重 */
    out.push({ key: Math.round(r.x) + ':' + Math.round(r.y) + ':' + Math.round(r.width),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
  }
  /* 同一张卡的祖先会一层层都命中（外层卡、内层容器、文字行），
     只保留「最外层」：被别的矩形包住的都丢掉。 */
  const uniq = [...new Map(out.map((c) => [c.key, c])).values()];
  const outermost = uniq.filter((c) => !uniq.some((o) =>
    o !== c &&
    o.x <= c.x && o.y <= c.y &&
    o.x + o.w >= c.x + c.w && o.y + o.h >= c.y + c.h &&
    (o.w > c.w || o.h > c.h)));
  return { hit: outermost.length, cards: outermost };
})()`)

if (!found || !found.hit) {
	out({ ok: false, error: `没找到标题为「${TITLE}」的作品（0 条命中）`, head: String(await ev('document.body.innerText.slice(0,200)') || '') })
	process.exit(1)
}
if (found.hit > 1) {
	out({ ok: false, error: `命中 ${found.hit} 条，不敢删（请自己看一眼）`, cards: found.cards })
	process.exit(1)
}

/* dry：扫描、报告会点什么，然后一个按钮都不碰。 */
if (DRY) {
	c.close()
	if (created && created.id) closeTab(created.id).catch(() => {})
	out({ ok: true, stage: 'dry', title: TITLE, would: '点这张卡的「删除作品」→ 弹窗里确认', cards: found.cards })
	process.exit(0)
}

/* 点「删除作品」+ 弹窗确认，全部走原生 el.click()：
 * CDP 鼠标事件打不进 Semi 的模态层（2026-11-05 在私信发送框上实测：点击命中但不生效）。
 * 弹窗还要轮询等它出现——Semi 模态层有淡入，点完立刻扫只会看到空。 */
const clicked = await ev(`(() => {
  const T = ${JSON.stringify(TITLE)};
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const hitText = (s) => {
    const t = norm(s)
    if (!t.startsWith(T)) return false
    const next = t.slice(T.length)
    return next === '' || !/^[0-9a-z\\u4e00-\\u9fff]/i.test(next)
  };
  const leaf = [...document.querySelectorAll('div,span,p,h3')].filter((e) => e.offsetParent !== null && hitText(e.innerText))[0];
  if (!leaf) return 'no-card'
  let card = leaf;
  for (let i = 0; i < 8 && card.parentElement; i++) { card = card.parentElement; if (/删除作品/.test(card.innerText || '')) break }
  const btn = [...card.querySelectorAll('div,span,button')].find((e) => (e.innerText || '').trim() === '删除作品');
  if (!btn) return 'no-btn'
  btn.click()
  return 'clicked'
})()`)
if (clicked !== 'clicked') { out({ ok: false, error: `点不到「删除作品」（${clicked}）` }); process.exit(1) }

let label = ''
for (let i = 0; i < 25; i++) {
	label = await ev(`(() => {
		const ds = [...document.querySelectorAll('[role=dialog],[class*=modal],[class*=Modal]')].filter((e) => e.getBoundingClientRect().width > 100)
		const b = ds.flatMap((d) => [...d.querySelectorAll('button,div,span')]).find((e) => /^(确定|确认|删除)$/.test((e.innerText || '').trim()))
		if (!b) return ''
		b.click()
		return (b.innerText || '').trim()
	})()`)
	if (label) break
	await sleep(400)
}
if (!label) { out({ ok: false, error: '弹窗里没等到确定按钮（弹窗没开或换了字样，去创作者中心自己确认）' }); process.exit(1) }
await sleep(2500)

// 核实：标题还在不在（和扫描同一套匹配规则）
const still = await ev(`(() => {
  const T = ${JSON.stringify(TITLE)};
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const hitText = (s) => {
    const t = norm(s)
    if (!t.startsWith(T)) return false
    const next = t.slice(T.length)
    return next === '' || !/^[0-9a-z\\u4e00-\\u9fff]/i.test(next)
  };
  return [...document.querySelectorAll('div,span,p,h3')].some((e) => e.offsetParent !== null && hitText(e.innerText));
})()`)

c.close()
if (created && created.id) closeTab(created.id).catch(() => {})

out({ ok: !still, title: TITLE, confirmed: label, still, note: still ? '点了但列表里还在，去创作者中心看一眼' : '已删除并核实' })
process.exit(still ? 1 : 0)
