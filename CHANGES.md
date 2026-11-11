# CHANGES

## 0.5.7 — 2026-11-11（@ 不再照搬别人的文案和标签）

真机发出去的是这条：
`@辰辰辰chen 这条我觉得你会喜欢：#丁达尔之境 #Muse强大的Muse，Muse好`
—— 生成失败后退回「模板 + 原文案」，话题标签和别人的句子一起带了上去。

- 新增 `lib/caption.mjs`：`cleanCaption()` 先洗掉话题 / @ / 链接 / 表情；
  `topicsOf()` 把话题词单独摘出来（只当背景，不拼进回复）；
  `looksCopied()` 判「是不是在照抄」；`AT_FALLBACKS` / `DM_FALLBACKS` 是**她自己的话**，一个字都不搬原文。
- 新增 `lib/at-text.mjs`：`composeAtText()` 组装 @ 的那半句 —— 洗完的材料 → 生成 → 剥掉她自己写的 @ 和任何 `#话题` → 再查一遍是否照抄，
  抄了就当没写。生成失败才用兜底，且兜底按秒轮换（`rotate()`），不再天天同一句。
- `index.js`：@ 分支改调 `composeAtText()`（index.js 从 1269 行回到 1198 行）；`notify-state` 多一个 `atWhy`（`gen-failed` / `copied`），
  模板句回潮时能看见，不会再悄悄变回机器。
- `lib/duty.mjs`：评论回复拿到的 `aweme_title` 也走 `cleanCaption`，不再把标签当正文喂进去。

### 从试用过的插件里落下来的做法
- 语义去重（aurabot `one-reply` 的跨轮去重）→ `looksCopied()`：生成的句子和原文案高度重合就不发。
- 失败要能查（`tellOwner` 记账那次的教训）→ `atWhy` 写进 `notify-state`，不再只有一句“发失败了”。
- 轮换取兜底（`lib/tier.mjs` 的轮换思路）→ `rotate()`，兜底文案不再固定。
- 字段归一（`lib/feedapi.mjs` 的 `normalizeItem`）→ 回复材料统一先清洗再进提示词。

## 0.5.6 — 2026-11-11（她记得自己在抖音做过什么；回复前能看见整段文案；角标不再骗人）

- **抖音里做的事进她自己的记忆**：新增 `lib/events.mjs` 的 spool（0.5.4 已有）+ aurabot 侧的消费者。
  dy 只往 `dy-spool.ndjson` 单向追加，aurobot 带游标读、写 `memories.json`——**单写者不变**，
  dy 永远不碰记忆文件。此前「发过作品 / 回过谁」只活在 dy 的 runs.jsonl 里，QQ 那边的小汐完全不知道。
  （消费者在 aurabot 包里：`src/douyin/bridge.js`，每 60s 跑一次，最多 20 条/次。）
- `lib/duty.mjs`：候选的 `aweme_title` 从 `desc` 前 **40 字**放宽到 **160 字**。
  以前她拿到的是被截断的半句文案，回复只能泛泛而谈——不是不会接，是材料被剪了。
- `index.js`：`/inbox/count` 在缓存过期时**顺手补一轮**（仍不等它），返回值多 `stale`。
  以前角标只读缓存、永不刷新，数字会一直停在旧值上。
- 修：`package.json` 带了 BOM，`tests/contract.test.mjs` 解析失败（`Unexpected token '﻿'`）。

## 0.5.3 — 2026-11-11（评论翻页 + 热评进提示 + 选题能走搜索 + 间隔不再固定）

### 补记 0.5.1 / 0.5.2（当时只写了 commit message）

- 0.5.1：`lib/tier.mjs` 的 `pickTier()` 让**每天第一轮先 @**（以前 `shareLeft > 0` 恒真，
  `at` 永远轮不到）；`lib/proc.mjs` 只放行对象（CLI 回 `null` 时折成可解释的失败，不再 TypeError）；
  `index.js` 里 `st.ownerSec` 全部改成 `st.ownerSecUid || st.ownerSec` ——
  设置里叫 `ownerSecUid`，代码读 `ownerSec`，所以 sec_uid 从来没进过 CLI，只能靠昵称找会话，
  于是整天「会话没打开（等不到输入框）」。账本同步改成「卡片发了、话没跟上 = `dm-card-only` + ok:false」。
- 0.5.2：`lib/persona.mjs` 让抖音侧读 aurabot 的人格卡（`personas/xiaoxi.md`），
  `personaLine()` 从 520 字摘要变成 4610 字符的本人；@ 的正文也交给她自己写（剥掉她自己加的 @）。

### 改（本轮）

- `lib/duty.mjs`：
  - `collect({ pages = 2 })`：顺着 `api.comments` 的 `cursor / has_more` 翻页（该接口本来就支持，
    以前只取第一页）；页间停 350–850ms；按 `cid` 去重；返回多 `pages / pageFetched`。
  - 每条作品挑**热评前 3**（按 `digg`，排掉自己），挂到候选的 `hot` 上。
  - `PROMPT` 增加「这条下面别人在说：」段（最多 3 条、带赞数），并说明「不是要你逐条回」。
    以前只喂被回的那一句，所以她说不出评论区在聊什么 —— 不是她没看，是没给。
- `lib/settings.mjs`：新增 `scanMode`（`'feed' | 'search'`，默认 `feed`）与 `scanKeywords`（逗号分隔）。
- `index.js` `startPicksCollect`：
  - 扫描间隔由固定秒改成 `scanGap × 0.7–1.3` 的随机值（固定 6 秒滚一整晚更像脚本）；
  - `scanMode === 'search'` 且有词时走 `search --kw`，把 `list` 归一成 `items` 再进 picks，
    `source` 记 `'search'`，关键词记进 `r.keyword`。

### 验证

- `node tools/check.mjs --quick` → PASS（146 文件解析、禁改区 7 个哈希未变、体量未超）。
- 全量 `node --test tests\*.test.mjs` → **533 pass / 0 fail / 40 suites**（新增 `tests/collect-hot.test.mjs` 4 例）。
- 真机 `collect({ worksN: 1, pages: 2, freshHours: 0 })` →
  `{ ok:true, seen:8, cand:8, pages:2, pageFetched:1, worksFailed:0, hot:1 }`；
  那条作品一共只有 8 条评论、`has_more:false`，所以只取到 1 页 —— 翻页逻辑是「有下一页才走」。

---

## 0.5.0 — 2026-11-09（时效口径统一：面板说 3 条、值班扫到 0 条，这件事不再可能）

现象：`/schedule` 的 `hero.pending` 是 3，`/duty` 的 `last` 是 `scanned: 0, picked: 0`。
看起来像「评论区没人说话」，实际上是两边用了两套时效：

- `lib/inbox.mjs` 的 `ownComments` 按 **7 天**算 `worth`；
- `lib/duty.mjs` 的 `collect` 按 `settings.replyFreshHours`（默认 **48 小时**）丢候选。

### 改

- `lib/inbox.mjs`：新增纯函数 `freshness(ageMin, freshHours)` —— 唯一的时效口径。
  `ownComments({..., freshHours})` 用它判 `worth`；超时的不删，`worth:false` +
  `blocked:['已经 N 小时没回了（时效 48 小时），不追了']`，列表里仍看得到。
  `inbox()` 默认从 `settings.replyFreshHours` 取，返回值多一个 `freshHours` 供核对。
- `lib/duty.mjs`：新增纯函数 `withinFresh(createDate, freshHours, now)`，`collect()` 改用它；
  `ageHoursOf(v, now)` 现在接受 `now`（测试可控）。
- `lib/duty.mjs`：`collect()` 多记三笔账 —— `seen`（实际看到多少条评论）、`skippedOld`
  （被时效挡掉的）、`worksFailed`（作品评论读失败的）。以前读失败是静默 `continue`，
  面板只看到 `scanned: 0`，分不清「没评论」和「没读到」。
- `lib/duty.mjs`：`scanned` 语义改为「看到多少条」，新增 `fresh`（过关候选数）、
  `skippedOld`、`worksFailed`，一起写进 `duty-state.json`（只增字段，老面板读不到也不坏）。
- `tests/freshness.test.mjs`（新，6 例）：48 小时边界、`0/空/非法 = 不限`、
  日期读不出来就放行、无时区标记的 UTC 不能按本地算、两侧同一口径。

### 真机对照（2026-11-09 19:5x）

```
改前：/duty last = {scanned: 0, picked: 0}       /schedule hero.pending = 3
改后：collect()   = {seen: 47, skippedOld: 45, candidates: 0, worksFailed: 0}
      /inbox      = counts {dm:0, at:2, own:0}, freshHours 48
```

结论：评论区不是「没有评论」，是 47 条里 45 条已经过了 48 小时，剩下的是自己发的。
以前这两个数字合在一起看不出区别，现在一眼能分清。

### 没改

- `atCandidates` 仍按 72 小时 / 7 天分级（`ageRank`），没并进 `replyFreshHours` ——
  @我 和「我作品下的评论」是两种东西，合并要改语义。`(待补充：@我 是否也按 48 小时)`
- 禁改区未动（7 个哈希复核一致）。

## 0.4.9 — 2026-11-09（工具返回类型：把 16 处字符串收回对象）

起因：`douyin_studio_kill` / `douyin_studio_duty` 实测调用就报 `invalid output: "value" must be an object`。
这两条恰好是「看总闸状态」和「看值班在不在跑」的入口——出事的两个口子一起坏。

### 改

- `lib/tools.mjs`：16 处 `return JSON.stringify({...})` 改成直接返回对象（`kill` / `duty` / `watch` /
  `publish` / `dm` / `queue` 等分支）。根因和 0.4.3 一样：这些分支绕过了本文件 `safe()`，
  而宿主给的是 `type:'object'` 的 `textOutput`。0.4.3 只修了 `lib/tools-extra.mjs` 那三条，
  这一批藏在同一个文件里没被发现。
- `lib/tools.mjs:60`：总闸拦下写操作时返回 `killedReply(...)` 对象（原来 `JSON.stringify` 成字符串，
  停损状态一下，所有写工具都变成 `invalid output`）。
- `tests/tool-output.test.mjs`：+2 例 —— ①静态扫描 `lib/tools.mjs` / `lib/tools-extra.mjs`，
  不许再出现 `return JSON.stringify(`；②用假宿主把 11 条只读分支（kill/duty/watch/status/budget/
  jobs/unattended/engage/queue/ledger/trend）真跑一遍，断言返回值都是可 JSON 往返的普通对象。
  假 `DUTY` / `WATCH` 只提供 status/start/stop，不真的起定时器。

### 没改

- 禁改区未动（`api` / `budget` / `im-send` / `publish*` 四个哈希复核一致）。
- 值班 `scanned: 0` 的归因（`/duty` 的 `last` 停在 18:37）留到下一轮，不在这次改。

## 0.4.8 — 2026-11-08（可观测性收口：定点可查、明细账轮转、派生块读盘缓存）

只做「不改接口、不改筛选语义」的三件事。`/inbox/count` 结构、`worth` 的 72 小时线、
面板默认停在哪个区 —— 这三样会动语义，**只出方案，没动代码**。

### 改

- `lib/autopilot.mjs`：`status()` 多一个 `nextReportAt`（ISO 或 `null`），来源是新增的模块级
  `dailyAt`（`armDaily()` 里算 `Date.now() + wait`，`stop()` 清空）。
  以前"下一次日报几点"只活在 `setTimeout` 里，外面问不到；`rearm()` 成没成只能靠"看明天发没发"。
  只增字段，老调用方读不到也不会坏。
- `lib/autopilot.mjs`：新增 `rotateLog(file, maxBytes)` + `LOG_MAX_BYTES`（5 MB），
  `appendLogLine()` 写之前先过一遍：到顶就把账挪成 `<file>.1`（覆盖旧的一代，不攒 `.2/.3`）。
  0.4.5 的 `autopilot-log.jsonl` 是"永不覆盖"账，永不轮转迟早长成没人敢读的文件。
- `lib/roundstate.mjs`：`healthExtra()` 加 1 秒读盘缓存（`HEALTH_MEMO_MS`），
  `readHealth({ memoMs })` 可绕开（默认 1000，传 0 = 直读）；新增 `dropHealthMemo()`，
  `writeHealth()` / `appendRound()` 写完主动清缓存。
  面板 5 秒轮询一次 `/schedule`，一次要读 jobs（最多 3 × 256 KB）+ `autopilot-state.json`。
- `tests/health-extra.test.mjs`：改成"要立刻读到刚写的账就传 `{memoMs:0}`"，另加 2 例
  —— 同一秒内账本变了仍给缓存、绕开/清缓存后给新值；写 health 会主动清缓存。
- `tests/autopilot-clock.test.mjs`：+2 例 —— `status().nextReportAt`（停着 null、跑起来是本地 22:30 的 ISO）；
  `rotateLog`（没到顶不转、到顶转 `.1`、再超不攒 `.2`）。

### 没动（要改语义，先出方案）

- `/inbox/count` 返回结构、`worth` 的 72 小时线、面板默认 tab：见交付说明的「待确认」列表。

## 0.4.7 — 2026-11-08（收三个尾巴：感想、定点重排、收件箱口径）

三件都是 11-07 验收时挂账的东西，不改功能、不加能力。

### 改

- `index.js`（`tellOwner` 里那段感想）：`String(await generate(...))` → `textOfResult(g)`。
  根因：`lib/duty.mjs` 的 `generate()` 回的是 `{ok, text}`，整个对象被 `String()` 就是
  `[object Object]` —— 11-07T12:59:45Z 那条发给主人的私信正是这么来的（`notify-state.json`
  里的 `say` 也一起被污染）。取不到正文就返回空串，交给下面那句「这条想给你看看：…」兜底。
- `lib/text-guard.mjs`：默认从**观察**翻成**拦截**（`guardMode()`）。非字符串正文现在
  `ok:false` 直接拒发，错误串里带 `rawType`；想退回记账模式设
  `DOUYIN_STUDIO_TEXT_GUARD=observe`（`off` / `0` / `false` / `warn` 同义）。
  新增 `textOfResult(v, {fields})`：从 `{text|say|content|reply}` 里取正文。
- `lib/autopilot.mjs`：新增 `rearm()`。`armDaily()` 以前只在 `start()` 里跑一次，
  面板把 `reportAt` 从 22:30 改成 00:30 得重启宿主才算数；`rearm()` 就地按新时间重排，
  自动巡航没在跑（`timer` 为空）时返回 `running:false`，不会把机器人弄醒。
- `index.js`：`POST /settings` 保存成功后调 `AUTOPILOT.rearm()`，返回值里多一个 `daily`
  （`{at, wait}` 或 `null`），面板能立刻看到「下一次定点在什么时候」。
- `tests/text-guard.test.mjs`：重写。默认拦、`=observe` 退回、`textOfResult` 五种入参、
  外加一条**事故写法不许回潮**的源码检查（跳过注释行，查 `String(await generate(` 与
  `textOfResult(g)`）。
- `tests/autopilot-clock.test.mjs`：+2 例（没在跑不硬拉起来；在跑时改 `reportAt`，`daily.at` 跟着变）。

### 没改

- 禁改区一个字节没动：`lib/im-send.mjs`、`lib/api.mjs`、`lib/budget.mjs`、`lib/publish*.mjs`。
- `/inbox` 与 `/inbox/count` 的口径**只查清、没动代码**（结论写进交付说明与 `docs/STATUS.md`）：
  同一份缓存里两者是一致的（3 = dm 0 + at 2 + own 1，11-08 00:46 实测）；
  不一致只发生在「两次调用之间刷过一轮」或「面板只看 dm 一个区而角标是三区合计」。

## 0.4.6 — 2026-11-07（出站类型闸，**观察模式**，单独一批）

只做一件事：给"发出去的正文"加一道类型检查。和 0.4.5 分开提交、分开上线，因为这类闸门
一旦误拦，坏的是"该发的没发出去"，比 `[object Object]` 更难在半夜发现。

### 加

- `lib/text-guard.mjs`（新）：`rawTypeOf(v)` / `guardText(v, where)`。
  字符串原样通过；非字符串记 `rawType`（object / number / array / null …）后**仍然照发**
  （观察模式，等于只记账不拦），但 `rawType` 会随返回值一路带回。
  设 `DOUYIN_STUDIO_TEXT_GUARD=block` 才真的拒发，错误串里带 `rawType`。
- `lib/im-report.mjs`：`sendDirect()` 入口先过闸；返回值多一个可选 `rawType`。
- `lib/autopilot.mjs`：`runReport()` 把 `rawType` 一并写进 `autopilot-log.jsonl` 与返回值
  ——下次再出现 `[object Object]`，账里能直接看到"哪条链、原始类型是什么"。
- `tests/text-guard.test.mjs`（新，6 例）：字符串通过、object 记为 object 且放行、
  number/array/null 分得开、开 block 真拦、开 block 不误伤字符串、`where` 带得回去。

### 兼容 / 风险

- 默认（不设环境变量）= 行为与 0.4.5 完全一致，只是多一个返回值字段；
  唯一可见差异是 `rawType !== 'string'` 的调用会多带一个键。
- 观察一天后若 `autopilot-log.jsonl` 里没出现 `rawType`，说明链路本来就是干净的，
  可以直接把开关当默认收紧，或者干脆删掉这一层。

## 0.4.5 — 2026-11-07（可观测 + 定时对齐；不新增能力）

这一版全部来自实弹里"看得见但查不动"的四件事：54s 的 scan 花在哪、11-04 起连挂 11 次的
日报为什么只剩一条记录、22:30 的日报为什么 22:49 才发、同时开 4 个抖音页时为什么"点得着却打不开"。
一条行为都没改，改的是"以后再出这类问题，能不能一次问清楚"。

### 加

- `lib/jobs.mjs`：`runJob(name, fn)` 的 `fn` 现在会收到一个 `mark(名字)`。每按一次记一段耗时，
  账行落成 `phases: { feed: 41000, judge: 900 }`（每段是"距上一个 mark"的毫秒）。
  老作业函数不接参数照跑；没调 `mark` 的作业账行里不会多出这个字段。
- `lib/jobs.mjs`：账本按月轮转 —— `jobs-YYYY-MM.jsonl`（当月）+ 往前读 2 个月；
  0.4.4 之前的 `jobs.jsonl` **仍然会被读到**，历史不用搬家。
- `lib/jobs.mjs`：`readJobs(n)` 改尾部读（最多 256KB / 一次），不再整份读进来。
- `index.js`：`startPicksCollect(mark)` 埋三段 —— `feed`（浏览器 + 滚动 + 网络，这一跳最贵）、
  `judge`（打分）、`save`（写库）。
- `lib/autopilot.mjs`：新增 `autopilot-log.jsonl`。state 里的 `log` 仍然只留 20 条给面板看，
  但每一行同时追加进这个文件，永不覆盖 —— 11-04 到 11-07 那 11 次 report 失败就是被 20 条挤掉的。
- `lib/autopilot.mjs`：`reportAt` 单独对表。`start()` 里多一个 `armDaily()`：按 `reportAt`
  排一个 `setTimeout`（跨零点自动 +24h），到点就跑；30 分钟的 tick 保留，只当"睡醒补跑"。
  新增纯函数 `clockMinutes()` / `msToNextClock()`（读不出来返回 null，不猜时间）。
- `lib/chrome.mjs`：`openPage({ want })` 与 `matchTab(tabs, host, want)`。
  传了 `want`（如 `'/chat'`）就先按 pathname 精确命中、再按前缀命中，命中不到**返回 null 去开新页**，
  不再退回"同域随便一张"。不传 `want` = 老行为，一个字节没变。
- `lib/im-report.mjs`：发日报改 `openPage({ url: CHAT_URL, navigate: true, want: '/chat' })`。
- `lib/roundstate.mjs`：`readHealth()` 多返回两块**派生**字段（读时算，不写盘）：
  `last: {scan, report, publish}` 最近一次成功的时间；`took: {n, p50, p95}`（样本 < 5 不出现）。
- 测试 +20 例：`tests/jobs.test.mjs` +3（phases 落账 / 无 mark 不写字段 / 跨月与老账本一起读）、
  新增 `tests/chrome-tab.test.mjs`（5 例：老行为不变、精确命中、命中不到返 null、前缀、坏 url）、
  新增 `tests/autopilot-clock.test.mjs`（7 例：对表纯函数 + 明细账追加）、
  新增 `tests/health-extra.test.mjs`（5 例：last/took 派生 + 不写盘）。
- `docs/STATUS.md`：重新生成（client.js 1740、index.js 1151）。

### 没做（有意）

- `lib/api.mjs`、`lib/budget.mjs`、`publish*` 三件套：一个字节没动（禁改区）。
- `picks.json` 48KB 全量读：先只改 `jobs`，picks 的结构动到面板读法，单独一批再议。
- `settings.json` 单写者：**暂缓**。查了实现，`writeSettings()` 是 `readSettings → normalize → atomicWriteJson`
  全同步、单进程内无 await 断点，同进程的并发写不可能发生；只有两个插件实例共用同一个
  `DOUYIN_STUDIO_HOME` 才会撞（那是 11-07 修掉的双实例问题）。真再现再加 `rev`。
- 反检测 / 浏览器启动参数：登录风险，照旧不碰。

## 0.4.4 — 2026-11-07（只加观察项，不改行为）

这一版的目的是**让下一次改动有证据**：scan-round 出现过 1.2s 和 63.6s 两种耗时，
账里只有 `took` 一个数，分不清是逻辑慢还是浏览器那一跳慢。

### 加

- `lib/jobs.mjs`：`runJob(name, fn, { preflight })`。预检耗时记进 `pre`（毫秒），
  预检抛错记 `-1` 且**不影响作业本身**；没给 `preflight` 时账里不出现该字段（旧读法不变）。
- `index.js:1099`：`scan-round` 传入 `preflight: listTabs` —— 只量「CDP 还活着吗、回多慢」。
- `tests/jobs.test.mjs`：3 例（pre 量到、预检抛错不影响、无 preflight 不写字段）。
- `tests/tool-output.test.mjs`：+2 例，把契约扩到**全部 36 条工具**
  （名字前缀、对象 schema、有描述、无重名）。
- `docs/STATUS.md`：重新生成（index.js 1146 行）。

### 没做（有意）

- 发布链、`api.mjs`、`budget.mjs` 一个字节没动（禁改区）。
- 没有按 `took` 里的 63.6s 下结论：等 `pre` 攒够 3 天再判断要不要改等待逻辑。

## 0.4.3 — 2026-11-07（P0：三条新工具全废 + 日报连挂 11 次）

这一版只修「已经坏掉、而且没人发现」的东西，没加新能力，也没碰禁改区。

### 修

- `lib/tools-extra.mjs:19`：`ok()` 原来返回 `JSON.stringify(v)`（**字符串**），
  而三条工具的 `output` 用的是 `index.js:178` 的 `textOutput`，schema 是 `type:'object'`。
  宿主校验不过 ⇒ `unattended` / `engage` / `jobs` 一律报
  `invalid output: "value" must be an object`（v0.4.2 上线即全废）。
  现在统一返回对象，和 `lib/tools.mjs:48` 的 `safe()` 同语义。
- `lib/autopilot.mjs`：日报不再靠昵称找会话。`runReport()` 改走 `sendDirect()`：
  **uid 优先**（`settings.ownerUid`），昵称只做兜底；发送前先 `Page.navigate` 到 `/chat`。
- `lib/im-locate.mjs`（新）：会话定位。sec_uid 从会话项的 React fiber
  （`conversation.toParticipantSecUserId`）读，再反查成数字 uid 比对；
  点开后用消息区 fiber 校验「当前会话的对端」，对不上就不发。
- `lib/im-report.mjs`（新）：日报发送链。①落到 `/chat` ②按 uid 找人 ③校验目标
  ④写文字并回读 ⑤Enter ⑥接口回读（`read({uid})`）确认「我发的」那条真的存在。
- `lib/settings.mjs`：新增 `ownerSecUid`（可选）。填了之后昵称彻底不参与定位。
- `tests/tool-output.test.mjs`（新，4 例）：钉死「声明 `type:'object'` 的工具，execute
  必须真的返回对象」。已用回滚验证：把 `ok()` 改回 `JSON.stringify` 时这 4 例会红。
- `docs/STATUS.md`：重新用 `node tools/status.mjs` 生成（client.js 1740 行、lib 65 模块）。

### 没做（有意）

- **禁改区一个字节没动**：`lib/im-send.mjs` 仍按昵称找会话（它的哈希还在 `tools/protected.json` 里）。
  新流程另开 `im-locate` / `im-report` 两个文件，旧路径（手动私信、`dy.mjs im`）行为不变。
- 反检测 / Chrome 启动参数：属登录风险，没动。
- 没引依赖：`puppeteer-core`、`node:sqlite`、`croner` 都评估过，
  但这一版的目标是"修坏掉的"，不是换栈；换栈要单开一版并配回归。

## 0.4.2 — 2026-11-06（把"没人盯着"那一半补上）

上一版解决"出事能停、第一次不闯祸"，这一版加的是**没人点也能跑**的骨架。
三样都默认关：`unattendedPublish`、`engageOn`，以及任何自动执行。

### 加

- `lib/jobs.mjs`：后台作业（串行、退避重试 2 次、每一步先看总闸、账在 `jobs.jsonl`）。
  一轮刷视频现在是一个作业，失败不再整轮作废。
- `lib/unattended.mjs`：无人值守发布的四道闸（开关 / 窗口 / 额度 / 首跑 dry + 总闸），
  账在 `autopublish.jsonl`，按本地日期数额度。
- `lib/engage.mjs`：主动互动规划器（白名单 + 每人每天 1 次 + 总额度 + 间隔），
  **只出清单不执行**，账在 `engage.jsonl`。
- `lib/tools-extra.mjs`：`douyin_studio_unattended` / `douyin_studio_engage` / `douyin_studio_jobs`。
  单独一个文件是为了不让 `tools.mjs` 撞 760 行体量闸。
- `prompts/operate.md`：模型层守则（首跑必 dry、declare 必填、stop 就是停手），
  SKILL.md 首段引用；check 里新增一条保证它不被删。
- CLI：`unattended`、`engage` 两条命令；`publish --auto`。
- 测试：`jobs`(4) / `unattended`(7) / `engage`(6)。

### 改

- `lib/tools.mjs`：publish 加 `auto` 参数，只有显式给了才走无人值守；成功落一条自动发账。
- `lib/settings.mjs`：新增 8 个字段（4 个无人值守、4 个互动），全部默认关。
- `index.js`：`scanTick` 里那一轮刷改成 `runJob('scan-round', …)`。
- `tools/check.mjs`：14 → **16** 条（新能力默认关、提示词守则），工具契约同时看两个注册文件。
- `SKILL.md` / `README.md`：三条新工具的姿势、"四条闸"与"只出清单"的边界。
- `package.json`：0.4.2；`files` 加 `prompts`。

### 没做（有意）

- 自动执行互动：这一版只规划。让模型自己决定"给谁评论"，一次判断错就是公开事故。
- 面板按钮：`unattended`/`engage` 目前只在工具与 CLI 里，先看几天清单再加界面。
- 禁改区照旧未动；反检测参数没加（要动 `lib/chrome.mjs` 的启动参数，属于登录风险）。

## 0.4.1 — 2026-11-05（按 `docs/汇总-项目理解与改进全集-2026-11-05.md` 落地）

只做了一件事：**把审计里"不做就不该继续对外用"的那几条，从文档变成代码**。
没动禁改区（7 个文件哈希未变），没加依赖，没改客户端构建产物以外的样式真源。

### 加

- `lib/killswitch.mjs`：全局停损。`$DOUYIN_STUDIO_HOME/KILL` 存在即停，
  只挡写操作（回评/私信/@/分享/发布/删除/队列重试），dry 与只读一律放行。
  工具层（`lib/tools.mjs` 的 `writeIntent`）、CLI（`tools/dy.mjs` 的启动闸）、
  HTTP（`GET/POST /kill`）三条入口读同一个文件。
- `lib/firstrun.mjs`：首跑必先 dry。没成功 dry 过就不许 `publish: true`；
  dry 通过或真发成功都会解锁（`$DOUYIN_STUDIO_HOME/first-run.json`）。
- 工具 `douyin_studio_kill`（`status` / `on` / `off`）；CLI `dy.mjs kill on|off|status`。
- 面板：顶部「停损 / 解除停损」按钮 + 已停损红标；收件箱顶部停损横幅。
- 测试：`tests/killswitch.test.mjs`、`tests/firstrun.test.mjs`、
  `tests/killgate.test.mjs`、`tests/contract.test.mjs`（共 19 例新增）。
- 自检：`工具契约`、`打包完整`、`默认只读`、`命令行一致` 四条（check 从 10 条到 14 条）。

### 改

- `lib/tools.mjs`：发布标题描述改为 `titleHint()`（原来手写「视频 ≤55」，实际 30）；
  `declare` 在真发/存草稿时必填，真发不许 `none`；publish 成功后落首跑状态。
- `lib/settings.mjs`：`DEFAULTS.scanRounds` 3 → 0（新装不自己刷）。
- `index.js`：`watchOn` 默认 false；盯私信/值班/自主执行/刷轮次都先看总闸；
  `/inbox` 回包里带 `kill` 状态。
- `SKILL.md`：补 `replies` / `detail` / `digest` / `comment_at` / `kill`；
  发布段写清 declare 必填与首跑 dry。
- `README.md`：首屏风险与定位；停损用法；安全边界补三条。
- `package.json`：`files` 补 `assets` / `tests` / `docs` / `jsconfig.json`；版本 0.4.1。
- `tools/dy.mjs`：`doctor` 回显停损状态；publish 分支加 declare / 首跑两道闸。

### 没做（有意留在文档里）

- 禁改区（`budget` / `api` / `im-send` / `publish` / `publish-steps` / `publish-cli` / `publish-cdp`）一律未动。
- 工具风险注解（readOnlyHint 等）：当前宿主 `defineTool` 不认这些字段，做在工具层只是自欺，改为"写清单 + 总闸"。
- 自动对账、告警通道、SLO 面板等 P1：需要新数据源，留到下一轮。
