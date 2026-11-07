# CHANGES

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
