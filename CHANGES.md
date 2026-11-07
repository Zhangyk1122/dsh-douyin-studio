# CHANGES

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
