# HANDOFF —— 交给下一个模型（Kimi）时先读这一页

> 维护者：WorkBuddy（b16，2026-11-02 23:45）
> 读者：要在这个仓库里改代码的**另一个模型**，以及给它派活的人。
> 读法：第 1—4 节必读（约 3 分钟），第 5 节挑你要做的那个任务看，其余按需。

---

## 1. 这是什么

`dsh-douyin-studio` —— 一个跑在 DSH 里的抖音工作台插件。两层入口：**DSH 工具**（`douyin_studio_*`）
和 **设置页面板**。引擎全在 `lib/`，`index.js` 只管配置 + HTTP 路由 + 生命周期，`lib/tools.mjs` 管工具注册
（2026-11-03 从 index.js 拆出来的，工具只做参数整形），`client.js` 只管画界面。

**当前状态**：`PANEL_BUILD = 35`（页面底部「诊断与版本 · b35」），`node tools/check.mjs` 全绿，
27 个测试文件 362 例，81 个文件可解析，禁改区 7 个哈希未变。
面板现在是 8 张卡：收件箱 / 今天做了什么 / 自主执行 / 机器人设置 / 刷视频 / 消息额度 / 后台 / 粉丝趋势。

> ⚠️ **这一页的数字会过期。** 版本以 `client.js` 的 `PANEL_BUILD` 为准，体量以 `check.mjs` 的输出为准；
> 两者对不上时，信代码，然后把这里改掉（2026-11-05 修过一次：原来写的是 b21 / 242 例）。
卡片标题都带内联 SVG 图标（`Ico`）；「自主执行」是四行开关（回私信 / 回评论 / 发作品 / 报平安），
**没有任何让人写话的输入框**——回什么、发哪个由它自己判断，人只定边界。

**核心设计取舍**：宁可给 2 分钟前的列表，也不让人盯着转圈。所有"慢"的地方都靠缓存 + 后台补，不靠优化那十几秒本身。

**活实例怎么验**（2026-11-03 查清，别再试错）：
- 插件真正跑在 **DSH 桌面端**（进程 `DeepSeek Harness`）。
  ⚠️ **端口每次启动都可能变**：2026-11-05 是 51549，重启后变成 58337。
  别抄死数字，先 `Get-NetTCPConnection -State Listen` 找 `DeepSeek Harness` 的监听端口，
  再用 `GET /api/douyin-studio/config` 试 200/404 确认哪一个加载了本插件。
  `GET /api/douyin-studio/config` 直接 200，**不需要令牌**（插件路由绕过宿主鉴权）。
- `127.0.0.1:3080 / 3081` 是 `dsh web`（web profile），**没加载本插件**，打过去全是 404。
- **`client.js` 刷新页面即生效**（按需读盘）；**`index.js` 必须重启 DSH**（启动时加载）。
  所以"新界面看不到"= 缓存/没刷新；"新接口 404"= 没重启。两件事别混。
- 2026-11-03 11:30 实测：活实例进程起于 10:12，`/settings`、`/export` 都是 404，`/config /status /budget /ledger /inbox` 都 200。

---

## 2. 地图：哪些能动，哪些别碰

```
index.js        1029 行  HTTP 路由 + 配置 + 生命周期 ── 可改，但只在「路由壳」层
lib/tools.mjs    570 行  douyin_studio_* 工具注册（只整形参数、起 CLI）── 加工具改这里
client.js       1937 行  设置页（无构建，手写 h()）── 可改，改完必须跑预览
lib/             47 个    引擎
  ├─ proc.mjs            子进程（异步，唯一入口）        ← 可改
  ├─ guard.mjs           跨站守卫（纯函数）              ← 可改
  ├─ cache.mjs           缓存策略（纯函数）              ← 可改
  ├─ settings.mjs        面板设置（写文件 + 变环境变量） ← 可改
  ├─ policy.mjs          自主执行的判断（纯函数，19 例） ← 可改
  ├─ autopilot.mjs       自己回私信 / 发作品 / 报平安    ← 可改（默认全关）
  ├─ export.mjs          CSV 语法（转义/BOM/CRLF）       ← 可改
  ├─ export-rows.mjs     记录 → CSV 列定义（纯函数）     ← 可改
  ├─ export-route.mjs    /export 的全部逻辑（可挂真服务器跑） ← 可改
  ├─ feed.mjs            刷视频（源选择 + 四道筛子）     ← 可改
  ├─ inbox.mjs           收件箱打分（纯函数，有测试）    ← 可改
  ├─ fsx.mjs             原子写 + 坏文件隔离             ← 只读，别动
  ├─ budget.mjs          额度表                          ← 禁改（影响账号存续）
  ├─ api.mjs             请求签名/频率                   ← 禁改
  ├─ im-send.mjs         真发私信                        ← 禁改（不可逆）
  ├─ selfid.mjs           机器人自己的 uid（落盘，自检要用）
  ├─ selfcheck.mjs        运行期行为自检（纯函数，10 条规则）← 2026-11-05 新增
  └─ publish-*.mjs       发布链路                        ← 禁改（见 6.1）
tests/           27 个    纯本地逻辑测试（362 例）
tools/check.mjs           交付前自检（唯一验收入口）
tools/selfcheck.mjs       行为自检（只读盘，查规则有没有被真的执行）
tools/lock-protected.mjs  更新禁改区哈希基线（+ protected.json）
tmp/preview/              面板沙盘（假数据，真样式）
tmp/smoke-autopilot.mjs   自主执行演练（临时 HOME + dry，不真发）
```

---

## 3. 三条硬规矩（违反任何一条，`check.mjs` 会红）

1. **宿主进程上不许有同步子进程。** `index.js` 里出现 `spawnSync/execSync` 就是事故：
   `/inbox` 十几秒会按住整个 DSH 的事件循环，页面直接卡死。子进程一律走 `lib/proc.mjs`。
   `lib/` 里只有两处备案的例外（ffprobe / ffmpeg，见 `check.mjs` 的 `SYNC_ALLOWED`），新加要有理由。
2. **所有 HTTP 请求先过 `lib/guard.mjs`。** 这套接口没有 token，靠的是"只有本机页面会调"。
   删掉它 = 任意网页都能让插件以你的身份发私信。
3. **慢接口先给缓存再后台补。** `/inbox` 的 `stale` 分支**不许 `await`**。
   加一个 `await` 就退回"干等十几秒"，`tests/cache.test.mjs` 里有一条专门钉这个。

---

## 4. 唯一的验收命令

```bash
node tools/check.mjs          # 全套：语法 / 硬规矩 / 依赖 / 不变量 / 体量 / 测试
node tools/check.mjs --quick  # 跳过测试，秒级（写代码过程中反复用这个）
```

**它查的是"代码对不对"。规则有没有被真的执行，用另一条：**

```bash
node tools/selfcheck.mjs                    # 查今天的账本/额度/静音/去重
node tools/selfcheck.mjs --self-uid 123456  # 带上机器人 uid，能查"回错到自己"
```

两者分工要记牢：`check.mjs` 全绿而线上出事，是 11-05 那天发生过的事（四个 bug 同时存在，
验收一路 PASS）。改完代码跑 `check`，怀疑行为跑 `selfcheck`。

输出长这样，**只认最后一行**：

```
✓ 语法        58 个文件都能解析
✓ 硬规矩      宿主进程无线程阻塞；白名单 2 处 CLI 同步调用已备案
✓ 依赖        仍然零依赖
✓ 不变量      守卫 / 缓存 / 异步 都还在被调用
✓ 体量        client.js 1458/1530  index.js 1188/1250  最大 lib 742/760
✓ 测试        16 个文件全绿，共 200 例
PASS —— 可以交付
```

六道闸门分别防什么：

| 闸门 | 防的问题 |
|---|---|
| 语法 | 文件根本跑不起来 |
| 硬规矩 | 把事件循环按住 / 把守卫摘掉 |
| 依赖 | 悄悄引入新包（体积 + 供应链） |
| 不变量 | 守卫、缓存、异步被重构掉但测试没覆盖 |
| 体量 | "只加了几行"的累积失控（超了要显式改预算数字） |
| 测试 | 行为回归 |

**"没变复杂"的四个客观信号**：新增依赖 0 个、新增文件 ≤ 2 个、体量在预算内、`check.mjs` 的六行全绿。
拿不准的时候，把改前改后的 `check.mjs` 输出并排放，多出来的东西必须能解释。

---

## 5. 可以交给 Kimi 的活（按放心程度排序）

> 每项都写明：落在哪 / 产出什么 / 怎么算过 / 大概多贵 / 有什么坑。
> **一次只派一项。** 派 A1 就别说"顺便把 A2 也做了"。

### A1 · 收件箱打分规则可配置 ★最推荐

- **落在**：`lib/inbox.mjs`（239 行，函数 `judgeDm`）
- **产出**：新建 `lib/inboxrules.mjs`（≤120 行）放权重表；`judgeDm` 改成读它，默认值 = 现在的硬编码值
- **算过**：`check.mjs` PASS；**且 `tests/inbox.test.mjs` 一行断言都不许改仍然全绿**
  （这是这条任务的真正难点：改结构不改行为）
- **还必须新增一条等价性断言**：把旧硬编码权重抄进测试当期望值，断言
  「新的默认权重表逐字段等于它」。**允许新增断言，不允许改旧断言。**
  没有这一条，A1 的验收就只是「旧的 8 例还绿」，而旧的 8 例**根本不覆盖「权重从文件读出来」这条新路径**。
- **成本**：中。要读 1 个文件、写 1 个文件、补 1 条等价性断言、跑测试
- **坑**：别顺手"优化"打分逻辑本身。这轮只搬位置，行为必须一模一样。
  另外记住：A1 最大的风险不是写错，而是**绿测试把行为漂移盖住了** —— 等价性断言就是为了堵这个口子。

### A2 · CSV 导出 ✅ 已完成（2026-11-03）

- **落地**：`lib/export.mjs`（CSV 语法）+ `lib/export-rows.mjs`（记录 → 列定义）
  + `lib/export-route.mjs`（`/export` 的全部逻辑，可挂真服务器跑）
  + `tests/export.test.mjs`(20) + `tests/export-rows.test.mjs`(13) + `tests/export-route.test.mjs`(9)
- **顺手接上了**：`index.js` 的 `GET /export?what=ledger|publishes`（唯一一条回 `text/csv` 的接口）
  + `client.js` 里「今天做了什么」卡上的两个下载链接。
- **算过**：`check.mjs` PASS；`tmp/smoke-export-http.mjs` 在**真 HTTP 服务器**上 10/10
  （BOM 在字节流里、Content-Disposition 中文编码、非法 what 回 400）。
- **仍未覆盖的一格**：这台机器的 `127.0.0.1:3080` 上 `/api/douyin-studio/*` 全是 404
  ——那个实例**没加载本插件**。所以"在浏览器里点一下下载"这件事没人做过。
  换到真正跑插件的宿主后，点一次 `回评 CSV`、用 Excel 打开确认中文不乱码，这条才算完全闭环。
- **教训**：写这个功能时发现 `/ledger` 路由一直在读一个没人写的文件
  （`douyin-duty/reply-ledger.json`，真实账本在 `douyin-studio/ledger.json`）——
  所以「回评记录」一直是空的。已改成走 `lib/ledger.mjs` 的 `recent()`。

### A3 · 文案与术语一致性（只出清单，不许直接改）

- **落在**：`client.js` 里的中文字符串
- **产出**：一份 `改前 → 改后` 的清单（表格），由人确认
- **算过**：清单提交即完成；改由人手动做
- **成本**：低
- **坑**：文案是产品语言，"顺手润色"很容易把克制的语气改得油腻。所以要清单不要补丁。

### A4 · 边界审查（`==` / `NaN` / `undefined` / 空数组）

- **落在**：`lib/*.mjs`，**排除 `publish-*`**
- **产出**：问题清单，每条附一个**能复现的输入**；外加最小补丁
- **算过**：每条都能用一段 `node -e` 复现；修完 `check.mjs` PASS
- **成本**：中低
- **坑**：一次只改一处。这类任务最容易滑成"顺手重构"。

### B1 · 面板样式微调（要人看截图）

- **落在**：`client.js` 的 CSS 块 + `tmp/preview/`
- **产出**：改完的样式 + 三张截图（深色 / 浅色 / 窄屏）
- **算过**：`node tmp/preview/probe-ui.mjs` 里 `textBugs` 与 `overflow` 都为空 + 人眼看图
- **成本**：中（每轮要跑截图）
- **坑**：视觉是主观的，容易越改越多。先把要改的**一处**说清楚再动手。

### B2 · 新增一张只读卡片

- **落在**：`client.js` + `tmp/preview/index.html` 的 MOCK
- **产出**：卡片 + 对应假数据
- **算过**：预览能出图、`check.mjs` PASS
- **成本**：中
- **坑**：不许新增 HTTP 接口。只读卡片必须能从 `/ledger` `/budget` `/trend` `/queue` 已有的数据里算出来。

---

## 5.1 面板现在能干什么（b20）

| 卡片 | 干什么 | 背后 |
|---|---|---|
| 收件箱 | 私信 / @我 / 自己评论区，三档筛选 + 就地回复 | `/inbox` `/dm/send` `/reply` |
| 今天做了什么 | 回评 + 发布 + 出错合成一条时间线，可导出 CSV | `/ledger` `/publishes` `/errors` `/export` |
| **自主执行** | 四个开关：回私信 / 回评论 / 发作品 / 报平安。**没有输入框**——只定边界 | `/autopilot` `/settings` `/duty` |
| **机器人设置** | 主人昵称、关键词、屏蔽词、时长、点赞门槛、说话语气、静音时段 | `/settings` |
| 刷视频 | 按关键词搜 / 推荐流；点标题在**机器人的浏览器**里打开 | `/feed` `/open` |
| 消息额度 | 五个出口的日限与总闸 | `/budget` |
| 后台 | 值班 / 盯私信 / 重试队列 / 清死信 | `/duty` `/watch` `/queue/*` |
| 粉丝趋势 | 每天一笔，看涨跌 | `/trend` |

**b20 改的是概念，不是样式**：原来那张「动作」卡是**让人写一句话再点执行**（发给主人 / 发私信 /
分享视频 / 发布作品）。但实际用法是它自己判断、自己发，人只定规矩。所以整块换成「自主执行」：

| 开关 | 它自己做什么 | 实现 |
|---|---|---|
| 回私信 | 读会话 → 挑「最后一句是对方、且比上次回过的更新」的 → 生成一句 → 过额度 → 发 → 记账 | `lib/autopilot.mjs` `runDm()` |
| 回评论 | 值班每轮挑该接的评论，四道闸（人 / 楼 / 次数 / 额度） | `lib/duty.mjs`（原有） |
| 发作品 | 扫内容库目录，按文件名顺序发没发过的；记 `done`，不会重复发 | `runPublish()` → CLI `publish` |
| 报平安 | 到点给主人发一条今天的账（数字来自额度账本） | `runReport()` |

硬护栏（写死，面板改不了）：
- **默认全关**；开关是 `settings.json` 里的布尔，`'false'` 字符串不会被当成 true。
- 每条都过 `lib/budget.mjs`；额度没了整轮停。
- 同一条私信只回一次：`replied[peer]` 存最后回过的消息时间，**每发一条就落盘**。
- 连续失败 2 次的人先放弃（`tries`），不对着发不出去的人死磕。
- 静音时段不主动发；回评论仍然只在 09:00–23:00。
- 认不出昵称就**不发**（先抄一次 `/chat` 补名字，补不到就跳过）——绝不按 uid 猜人。
- 「演练一轮」是 dry：不生成、不发送、不记账，只列出它会怎么做。

**设置是怎么真的生效的**：面板写 `~/.dsh/douyin-studio/settings.json` →
`index.js` 的 `env()` 合并成 `DOUYIN_STUDIO_*` 环境变量 → CLI 在 `dy.mjs` 里用 `envNum()`
读回来。三段都接通了才算数，少一段面板上的开关就是装饰品。
（自主执行那四个开关不走 env：`lib/autopilot.mjs` 每轮直接读 settings，所以开了立刻生效。）

### 验证边界（别把它当成"全都跑过了"）

| 东西 | 验到哪一步 |
|---|---|
| `lib/feed.mjs` 的源选择与筛子 | ✅ 单测 10 例 |
| `lib/settings.mjs` 归一/合并/env 映射 | ✅ 单测 14 例（含"字符串 'false' 不能变成开"） |
| `lib/policy.mjs` 时间窗 / 去重 / 内容库选择 | ✅ 单测 19 例 |
| 自主执行的**读链路** | ✅ `tmp/smoke-autopilot.mjs`：真读会话挑出 1 个待回私信、真扫临时内容库、真拼日报；全程 dry，没发任何消息 |
| 面板 8 张卡的渲染 | ✅ 预览沙盘 900/1080/640/420 四档 + `probe-ui` 无溢出无文案硬伤 |
| `/settings` `/autopilot` 路由 | ⚠️ 逻辑在 lib 里被覆盖，路由本身只做了语法检查 |
| **真发出去这一步** | ❌ 没做过。`sendByUi` 与手动 `/dm/send` 是同一条路，但"自动回私信 / 自动发布"从没在活账号上真跑过 —— 第一次建议先开「回私信」、把每轮设 1 条，看它回给谁 |
| `/open` `/share` `/publish` | ❌ 一次都没在活浏览器上跑过（旧实例没加载新路由） |

---

## 6. 明确不要交给 Kimi 的（附原因）

### 6.1 `lib/publish-*.mjs` —— 双重理由

① 它要**真 Chrome + 真抖音页面**才能验证。模型跑不了，只能靠读代码猜，最后会给你一份"已修复"的报告，
而实际上一次都没跑过。这套插件的发布链路踩过的坑（`el.click()` 无效、封面「完成」按钮不在弹层里、
点完不能立刻按 Esc）**全部是只在真机上才看得见的**。

② ⚠️ **现在有另一个会话正在改这两个文件**（2026-11-02 23:39—23:40 连续两次写入，行数在 502 与 460 之间跳动）。
两边同时改必定冲突。**在本文件写下的这一刻，这两块地盘不归本轮管。**

### 6.2 会真发出去的东西

`lib/im-send.mjs`、`/dm/send`、`/reply`、`/comment-self`、`/queue/retry`。
模型没有"手滑了撤不回来"的概念，让它改这些等于把不可逆操作交给一个看不见后果的人。

### 6.3 风控相关

`lib/budget.mjs` 的额度表、`lib/api.mjs` 的请求间隔、`schedule`/峰谷时段。
改错不是"不好用"，是**掉登录或封号**。

### 6.4 DSH 宿主相关

`index.js` 里的 `loadHostDeps()`、`ctx.tools.register()`、`ctx.webServer.register()`。
宿主 API 没有公开文档，`hostdeps.mjs` 那一整套是踩了无数次才试出来的。模型只能猜，猜错的表现是"插件整个不激活"。

### 6.5 任何 > 200 行的重构

上下文成本最高、回归面最大、收益最不确定。三样都不划算。

---

## 7. 已知坑（我踩过，别重踩）

| 坑 | 表现 | 已经怎么处理 |
|---|---|---|
| `node --test` 在 DSH 沙箱里 EPERM | 一跑就挂，看不出原因 | 逐文件跑，`check.mjs` 已内置 |
| 后台标签页不出新帧 | 点完再截图，拿到的还是点之前那帧（**字节数都一样**） | `shot.mjs` 用 metrics override + DPR2 强制重栅格 |
| `Math.random()` 当 React key | 整行被卸载重建，展开状态和输入内容一起丢 | 已改成行号兜底 |
| PowerShell 5.1 `Get-Content` 默认 ANSI | 读 UTF-8 的 `package.json` 会报 JSON 语法错 | 一律加 `-Encoding UTF8`，或直接用 node 读 |
| 缓存 `stale` 分支加了 `await` | 秒开退回干等，但**功能看起来完全正常** | `tests/cache.test.mjs` 有一条计时断言钉住 |
| `check.mjs` 的用例计数认死格式 | 管道下是 TAP（`# pass 14`），终端里是 spec（`ℹ pass 14`）；只认一种就会「数出 0 例」并把绿的判成红的 | 两种都认，且**以退出码为准**，例数只做展示 |

---

## 8. 派活给 Kimi 时，怎么最省钱

1. **一次一项。** 给 A1 就只给 A1，别列五个。它会把五个都读一遍再动手。
2. **给锚点，别给全文。** 写"改 `lib/inbox.mjs` 的 `judgeDm`，权重表在第 54—87 行"，比"看看这个项目"省一个数量级的 token。
3. **让它先跑 `--quick`。** 改一行跑一次，比改完跑全套再返工便宜。
4. **要求先写测试再改实现。** 返工次数是最贵的成本。
5. **禁止它跑需要真浏览器的命令**：`node tools/dy.mjs publish / status / inbox / feed`。
   这些会超时、会重试、会烧掉大量额度，而且它无从判断"这是正常的慢还是真挂了"。
6. **只认 `check.mjs` 的 PASS，不认它的自述。** 模型说"已修复"是零信息量的。

---

## 9. 开工前 / 收工前

**开工前**
- [ ] `node tools/check.mjs` 是 PASS 的（拿到的基线必须是绿的，否则分不清是谁弄坏的）
- [ ] 确认 `lib/publish-*.mjs` 现在没有别人在改（看 `LastWriteTime` 是不是刚刚）
- [ ] 只读你这次要动的那一两个文件，**不要通读整个仓库**

**收工前**
- [ ] `node tools/check.mjs` 仍是 PASS
- [ ] 交改动说明：改了什么文件、为什么、`check.mjs` 前后输出各贴一遍
- [ ] 如果超了体量预算：说明理由，并显式改 `BUDGET` 的数字（不要偷偷加行）
- [ ] 如果是 `client.js`：附三张截图

---

## 10. 还没做的（等排期，不是遗漏）

- 告警通道（出错之后谁通知你）
- 熔断自停（连续失败自动停值班）
- 首跑 dry-run（第一次只列不真发）
- 收件箱打分规则可配（= 上面的 A1）

这四样都改**后端行为**，不是界面。改它们之前先想清楚"出错了怎么退回来"。

---

## 11. 异常核查记录（2026-11-02，已逐条比对过，不是猜测）

**结论：这是第三方有意的安全收紧，不是误操作。已按禁改区处理，未覆盖、未回滚。**

### 时间线

| 时刻 | 发生了什么 | 证据 |
|---|---|---|
| 18:09 / 18:25 | 两个文件的原始内容 | `.bak` 保留了原 `LastWriteTime` |
| 22:57 | 本轮开工，确认仍是原始内容 | 目录快照：`publish-cli.mjs` 19.2KB，改于 18:25:54 |
| 23:39:26 | 生成两份 `.bak-20261102-233926`，随后文件被改写 | 两份备份同一秒出现 |
| 23:40:05 | 第二次改写 | 现行文件的 `LastWriteTime` |
| 23:40:23 | `tests/publish-seam.test.mjs` 也在同一时段被修改 | 该文件的 `LastWriteTime` |
| 23:40:05 之后 | 稳定，未再变动 | 连续两次 `check.mjs` 结果一致 |

### 真实功能差异（LCS 逐行比对，见 `tmp/audit-publish.mjs`）

**`lib/publish-cli.mjs`** — 472 → 503 行（+34 / -3，其中注释 9 行）

1. 新增 CLI 开关 **`--allow-cover-fail`**。
2. 封面失败后**自动重试一次**：`sleep(1500)` → 再调一次 `stepCover`，结果记 `attempt: 2`，保留 `firstWhy`。
3. **默认行为反转**：封面没设成时，从「继续往下发」改成「**中止发布，不点发布按钮**」：
   ```js
   const coverBlocked = !!COVER && !results.cover?.ok && !ALLOW_COVER_FAIL && !DRAFT
   // → logLine('ABORT 封面没设成，未点发布（加 --allow-cover-fail 可强行发）')
   ```
4. 结尾提示按三种结局分开写：已中止 / 草稿已存但封面没进去 / 已按默认封面发出（要人工核对）。

**`lib/publish-steps.mjs`** — 733 → 742 行（+20 / -11，其中注释 5 行）

1. 封面成功判据收紧：`ok = !stillMissing` → **`ok = !stillMissing && !!missingBefore`**。
   必须先能看到「横/竖双封面缺失」这条提示，才有资格判它"消失了"。
2. 拿不到判据时返回 `uncertain: true` + `hintBefore`，why 写明「没法判定封面」，**不再假装成功**。
3. 这直接修掉了「图根本没塞进去，却 `done ok=true`」的假成功。

**性质判定**：这是把发布链路改成 fail-closed 的安全加固，方向正确。
**但它发生在本轮工作之外，且未经我验证过真实页面** —— 所以标为禁改区，
既不回滚，也不为它的行为背书。

---

## 12. 首项建议：先 A2，再 A1

**选 A2 打底，别一上来就上 A1。**

| | A2 CSV 导出 | A1 打分规则可配置 |
|---|---|---|
| 回归面 | **零**（纯新增文件，不碰任何现有函数） | 中（动了 `judgeDm` 的内部实现） |
| 验收成本 | 低：转义规则可以完整枚举 | 中高：旧 8 例之外，**还必须新增等价性断言** |
| 最容易出事的地方 | 双引号 / 换行转义 | **绿测试掩盖行为漂移**（旧 8 例不覆盖"权重从文件读出来"这条新路径） |
| 失败时的代价 | 导出乱码，改一行就好 | 判定逻辑悄悄变了，没人看得出来 |
| 需要读多少现有代码 | **零** | 一整个文件 |

顺序的理由：**先用 A2 验证「它能按验收标准交付、不会顺手多改」**，再上 A1 这种"改结构不改行为"的活。
A1 的正确性只能靠**证明**，不能靠感觉 —— 所以它比 A2 多一条强制要求。

如果这一趟只能派一项，就派 A2：它是唯一一个**不需要读任何现有代码就能做对**的任务，
而读代码恰恰是积分最贵的那一步。

---

## 11. 2026-11-03 夜间变更（接手上一个模型之后）

- **自主发布计数跨天不归零**（真 bug）：成功分支先写 `st.publish.day = today` 再比较，永远相等 →
  昨天的条数累加到今天，`publishLeft` 逐日缩水到永远 0。现用纯函数 `nextPublishCount({day,today,count})`，
  先算 count 再写 day（`tests/autopilot.test.mjs` 覆盖）。
- **自主回私信不看「该不该回」**（真 bug）：原来是「最后一条是对方发的就回」，十几天前的老话、
  官方号通知、只有卡片的会话都会被生成回复。现在走 `pickDm()` + `inbox.judgeDm`，
  并且**先抄昵称再判**（系统通知要靠名字认）。
- **`DEFAULTS.publishWho` 从 `public` 改成 `private`**：自主发布是无人值守路径，默认公开等于让模型替你决定什么能上推荐。
- **收件箱过滤空壳会话**：接口会返回「会话在、但一条消息都没有」的老会话，不再占列表。
- **`/budget` 附带评论细账**（`ledger.limits`）：面板「消息额度」卡下面多一行，写明同一视频每时段 ≤5 / 同一人 ≤2 / 同一楼 ≤1。
- **工具从 `index.js` 拆到 `lib/tools.mjs`**：index.js 从 1223 行降到 680 行，加工具只碰 tools.mjs。
- 测试新增 `tests/autopilot.test.mjs`（10 例）与 `tests/autopilot-io.test.mjs`（8 例）：
  后者用临时 HOME + dry 覆盖 `runPublish` / `runReport` 的判定（没设目录、没填昵称、开关没开、发够了、失败两次）。
- **新增「回 @我」自主开关**（`autoAt`，默认关）：`runAt()` 走 `pickAt()`，只挑 7 天内、worth 为真、且带 aweme + 评论 id 的通知；生成后走 `at-reply`（at 通道额度、进楼）。面板「自主执行」现在是五个开关。
- **回 @ 去重**（2026-11-03 12:46 / 12:51 同一条被回了两遍）：`autopilot-state.json` 新增
  `at.replied`，键是 `aweme:cid`；`pickAt(items,{replied})` 过滤掉回过的，成功后再记一笔。
- **谷时窗口**（`settings.activeFrom/activeTo`，默认 `00:30`–`08:30`）：`inActive()` 在
  `runDm` / `runAt` / `runPublish` 开头拦一道 —— 这些动作每一步都要过模型，白天跑等于按原价
  买一套没人看的流程。两个都置空 = 不限制；跨午夜窗口（`22:00`–`06:00`）也认。
- **`tools/dy.mjs` 新增两条**：`quick`（一段文案 + 文件，标题取第一行并自动截到 20/30 字，
  简介用原文，默认 `private` + 草稿，走 publish 预算通道）和 `latest`（列出 `$DSH_HOME/media/onebot`
  里最近 N 分钟落地的 QQ 媒体，给「哥哥在 QQ 发视频 → 这边接手发」这条链用）。
- **过期 @ 不再自动回**（2026-11-03 13:15）：那条反复被回的 @ 其实是 **10-30 17:59** 的老通知
  （`age_min` 5473、`status:stale`），`worth` 一直是 true，于是每 5 分钟被捡起来重发一遍。
  `pickAt(items, { replied, freshMin = 72*60 })` 现在额外要求 `status !== 'stale'` 且 `age_min <= 72h`。
- **回评落点抽成纯函数**：`lib/policy.mjs` 的 `planAtReply({cid,root})` → `{thread, replyTo, level}`；
  顶层评论（root 空）`thread=cid`，楼中楼 `thread=root, replyTo=cid`，root 与 cid 相同按顶层处理。
  `at-reply` 现在用它决定 `reply_id` / `reply_to_reply_id`，dry 时把两个值一起打出来。
- **分享卡片的入口选择器换了一代**（2026-11-03 13:20）：现在作品页是 `[data-e2e="video-player-share"]`
  （旧版 `video-share-icon-container` 已不存在，图文 note 页同样用前者）；并且必须先
  `Page.bringToFront` —— 后台标签会被节流，页面只剩一个壳，分享图标永远不出现。
  `share --dry` 实测：面板展开、候选人 `辰辰辰chen` 的 sec_uid 对得上、`hit:"分享"`。

---

## 13. 2026-11-04 夜间：候选库（「挑」）

**新界面 b28。** 9 个区，默认停在「挑」。

### 加了什么

| 落点 | 内容 |
|---|---|
| `lib/picks.mjs`（新，~190 行） | 归一化 / 判 / 打分 / 合并 / 排序 / 状态机。**全纯函数** |
| `tests/picks.test.mjs`（新，22 例） | 挡（广告/超长/过短/屏蔽词/赞数）· 打分可解释 · 合并保状态 · 淘汰顺序 |
| `index.js` `GET /picks` `POST /picks/collect` `POST /picks/act` | collect 在后台跑，前端轮询（和 `/inbox` 同一套） |
| `client.js` `Picks` 组件 | 一屏最多 8 条，每条两个动作：发我 / × |

### 三个必须知道的取舍

1. **`/picks/collect` 不许 await。** 一轮要真浏览器、十几秒到几分钟。请求里等它 = 面板卡死，
   和 `/inbox` 的 `stale` 分支是同一条规矩。前端靠 `refreshing` 每 4 秒拉一次。
2. **「发我」是真发**（`lib/share.mjs` 把视频卡片分享到你自己的私信），撤不回来。
   所以两次点击 + 走 `budget` 的 `dm` 池；第一次点击只返回 `needsConfirm`。
3. **赞 / 收藏 / 关注 仍然没有。** `lib/api.mjs` 里没有这三个写动作。
   要做就得先给 `lib/budget.mjs` 加三个出口（禁改区，得由人点头）。

### 打分口径（改之前先读）

权重表 `WEIGHTS` 加起来正好 1.00，测试里钉着。命中顺序：
关键词 0.33 / 作者重合 0.27 / 话题 0.13 / 互动量 0.15 / 时长 0.07 / 新鲜度 0.05。
**`why` 是返回值的一部分**：没有任何特征命中时必须坦白「平台在推的」，不许编。
（`tests/picks.test.mjs` 有一条专门钉这个 —— 它当时真的抓到我把「刚发不久」当成最大贡献。）

### 还没接的两处

- `ctx.authors` / `ctx.tags` 现在传空数组 → 作者/话题重合永远是 0。
  等 `lib/taste.mjs`（从 likes / publishes / ledger 反推）落地再打开。
- 面板「挑」卡里的分数只是排序用的元数据，不参与任何判断。

### 体量

`client.js` 1700 → **1800**（理由写在 `tools/check.mjs` 的 `BUDGET` 注释里）。
`node tools/check.mjs` 仍是 PASS：66 文件解析通过，20 个测试文件 283 例全绿。

---

## 14. 2026-11-04 深夜：按 PLAN 做 T1 / T2 / T4

施工图是 `docs/PLAN-for-dsh.md`（303 行）。这一夜完成三件，顺序 T1 → T2 → T4；
T3（点赞/收藏/关注）跳过了 —— 它要人批准，而且改的是 `budget.mjs` 的额度数字。

### T1 · 口味画像 `lib/taste.mjs`（147 行，新）

- 纯读：likes / publishes / ledger / picks(saved·liked)，不新增任何采集。
- `evidence < 20` 直接返回空结构 —— **样本不够就不许有结论**，有测试钉着。
- 身份只认 `sec_uid`；`ledger` 没有 sec_uid，所以它只贡献 hours 与 evidence，不贡献作者。
  这不是偷懒：拿昵称当 key，改名就断，比不认更糟。
- 半衰期 14 天（`0.5 ** (days/14)`）；权重：自己发 1.5 > 存 1.2 > 赞 1.1 > 赞过 1.0。
- 已接进 `index.js` 的 `tasteNow()`：每次「挑」收集时重算（几十毫秒，不起浏览器），
  `judge()` 的 `ctx.authors` / `ctx.tags` 终于有内容了。**b28 里"还没接的两处"第一处已关。**

### T2 · 通知预算 `lib/notify.mjs`（新，约 75 行）

- 三档：入库 0.4（不打扰）/ @ 0.75 / 私信 0.9 且"最近 24h 搜过同类"。
- `calledToday >= perDay` 必拒 —— `tests/notify.test.mjs` 有硬验收。
- `maxTier` 默认 `at`：**用户没明确允许，就不发私信**。测试里专门钉了这条。
- ⚠️ 命名冲突已解决：原来的 `lib/notify.mjs` 是 Windows Toast，已 `git mv` 成 `lib/toast.mjs`
  （只有 `lib/watch.mjs` 引用，已同步改）。
- `settings.mjs` 加了三个字段：`notifyPerDay`(2) / `notifyTier`('at') / `notifyQuiet`(true)。
  **还没接线**：面板上没有这三个输入框，`allowNotify()` 目前只有测试在调。

### T4 · 界面骨架（b29）

- 一级 3 区（挑 / 待办 / 今天）+「更多」二级（自主·设置·刷视频·额度·后台·趋势）。**只有两层。**
- `[data-dys-view]` 改成 `height:clamp(320px,46vh,480px); overflow:auto`，去掉卡片内滚 ——
  切 tab 页面不跳，全页只有一个滚动条。上限没用 58vh：内容短时底下会空一大片。
- 卡片按 `data-kind` 分三档密度：list（默认）/ form（设置、自主）/ metric（额度、趋势）。
- tab 角标：挑 = 新候选数，待办 = 收件箱条数。拉不到就空着 —— 不显示假数字。
- 体量：`client.js` 1800 → **1880**（理由在 `check.mjs` 的 BUDGET 注释里）。

### 现在的数

`node tools/check.mjs` PASS：70 文件、22 个测试文件、**309 例**全绿；
`client.js 1789/1880`、`index.js 804/1250`、最大 lib 742/760。

### 下一步（按 PLAN 顺序）

T5 · `lib/schedule.mjs`（≤80 行，跨午夜窗口要有测试）→ T6 · 事件驱动 → 最后 T3（要人批准）。

---

## 14.1 2026-11-04 晚：b29 视觉收口（复查后改的六处）

T1/T2/T4 落地后按「四张截图 + probe-ui」复查，改了六处。都很小，但都是「看着别扭」的来源：

| 改了什么 | 为什么 |
|---|---|
| `[data-dys-seg]` 加 `width:fit-content` | 只剩 4 个片段却铺满整行，右边空一大片，像没做完 |
| 底部淡出改成**只有真溢出才出现**（`ResizeObserver`） | 原来无条件淡出，把卡片的底边框一起擦掉，不滚动时看着像缺一条边 |
| 内容区 `clamp(300px,44vh,460px)` + `卡片 min-height:100%` | 短内容会在卡**外面**留一块"洞"；撑满后留白在卡里，读起来是留白不是缺失 |
| 表单/数字类（设置·额度·趋势·后台）不封顶 | 它们本来就短，硬撑到 300px 只是给卡里塞空白 |
| 「挑」行里的匹配度分数撤掉，收进 `title` | 0–1 对"要不要看"没帮助，列表已按它排过序；留着只会把右半边撑空 |
| 「×」调到 14px、透明度 .70 | 默认 ghost 太淡，它在这一屏是个真实选项 |

**测量位置放了 ResizeObserver，不是每次渲染读 scrollHeight** —— 后者会让设置页每敲一个字强制一次布局。

验收：`node tools/check.mjs` PASS（client.js 1833/1880，309 例）；四张截图（900 / 430 / 浅色 / 待办）。

## 14.2 同晚：两处「读错意思」的修

- **收件箱行首：竖条 → 圆点**（3px 拉满行高 → 6px 圆点，`align-self:start; margin-top:6px` 对到标题那一行）。
  一屏三根竖条等于没标记，还抢标题。
- **设置子页的角标：`内容 4` → `内容 4 项`**。原来那个数字是**字段数**，但挨着 tab 名看像页码。
  收件箱的 `私信 3` 不动 —— 那个真的是条数。

📌 顺手踩到一次自己挖的坑：改 `h('i', ...)` 那行漏了一个右括号，整页白屏、截图只有 27KB。
`check.mjs` 的语法闸门一秒抓到。**先 `--quick` 再截图**，别反过来。

---

## 15. 2026-11-05 收口（b35 之后，一次把遗留项清完）

> 这一轮的原则：**只改「明显不对」的，改完全部有测试或可复现验证**。功能口味类不动。

### 修掉的 bug

| 问题 | 根因 | 落点 |
|---|---|---|
| 同一条候选一天内被重复「叫」 | 每轮都取分数最高的那条，发完不落账 | `index.js tellOwner`：`notify-state.json` 加 `sent[]`，先过滤再排序 |
| 手动「发我」可重复发 | `/picks/act` 没有状态守卫 | `index.js`：`state === 'sent'` 直接回「已经发给你了」 |
| `create_date` 差 8 小时 | feed 给的是无时区标记的 UTC，picks 按本地时间解析 | `lib/picks.mjs ageHours`：无标记按 UTC；`tests/picks.test.mjs` 有钉 |
| 过了结束时间还补刷 | `dueAt` 只看「有没有没刷的点」 | `lib/schedule.mjs`：窗口后 30 分钟宽限，之后不补。**旧测试改为窗口内才补** |
| 重启后当天轮次归零 | `scan` 是内存对象 | `index.js`：落 `scan-state.json`，先记账再刷 |
| 打开面板触发收件箱扫描 | 角标打 `/inbox`，缓存过期就起一轮浏览器 | 新增 `GET /inbox/count`（只读缓存，绝不刷新）；`client.js` 改用它 |
| `watch` / `queue` 状态文件的同款雷 | 白名单式重建，新字段会被下一次 save 冲掉 | `lib/watch.mjs` 展开合并；`lib/queue.mjs` 记住 META 再写回 |

### 补上的「差一点」

- **挑卡能点开了**：点标题在机器人的浏览器里打开（和刷视频卡同一个入口）。
- **挑卡有封面了**：`lib/feed.mjs` 取 `dynamic_cover/origin_cover/cover`，`picks` 存 `cover`；加载失败自动隐藏，不留破图标；没有封面的行补 66px 左内距，保证一条左边缘。
- **「已发」看得见了**：状态 `sent` 的条目按钮变灰、文案变「已发」。
- **`notifyQuiet` 有开关了**：设置 › 时间 里新增布尔字段；`Field` 组件新增 `bool` 类型（勾完立刻落盘）。

### 新增的护栏

- `tests/ledger.test.mjs`（8 例）：`checkQuota` 的六道闸（cid 去重 / 日总量 / 同视频同段 5 条 / off 段不卡视频 / 同人 2 条 / 同楼 1 次 / 账本坏了 fail-closed）。
  这个文件之前一条测试都没有，而它错了的代价是**重复回评**。

### 体量

`client.js` 1880 → **1940**（封面 + 点开 + 已发态 + 布尔字段，四条都是「补看得见的」，不是新功能）。

### 验收

```
node tools/check.mjs
✓ 语法 76 个文件  ✓ 体量 client.js 1917/1940  index.js 976/1250
✓ 测试 26 个文件全绿，共 336 例        PASS —— 可以交付
```

---

## 16. 2026-11-05 上午：按作者的六条反馈改（b35 之后）

> 作者原话拆成六条：①时间页看着怪 ②要两个低峰、高峰别装死 ③发视频私信不带话
> ④@ 视频到底发不发 ⑤以前回过的又回了一遍 ⑥楼中楼从没成功过。逐条对应：

### ① 时间页「看着怪」——原因是两列网格把成对的字段拆开了

`SETTING_FIELDS` 是按数组顺序铺进两列网格的。上一版顺序是
`静音开关 / 静音从 静音到 / 谷时从 谷时到 …`，于是「静音从」和「静音到」被拆到两行，
「静音到」和「谷时从」并排 —— 四对时间输入框看起来像四个不相干的东西。

**改法**：字段顺序改成「相邻两个一定是一对」；两个布尔开关移到组末尾并占整行
（`w: 2` + `[data-dys-field][data-wide]`），否则勾选框和旁边输入框高度对不齐。

### ② 两个低峰 + 高峰照常回

- 新增 `active2From / active2To`（第二段低峰），`inActive()` 改成 `some(wins)`。
- 新增 `peakReply`（默认开）。语义：**低峰决定"贵的动作"（自主发布 / 自动刷视频）什么时候跑；
  回消息在 09:00–23:00 照常**。只有把 `peakReply` 关掉，才回到「只在低峰回」。
- 值班、`runDm`、`runAt` 三处同步改。睡眠段（09:00–23:00 之外）永远不打扰。

### ③ 发视频私信不带话

`tellOwner` 里原来是 `if (say) { 发 DM }`：模型一抖、`generate` 返回空，就只发一张卡片，
收件人只看见视频。**改成**：`say` 为空时兜底为「这条想给你看看：<标题前 24 字>」，然后照发；
发送失败才置空，并把 `say` 记进 `notify-state.json`（面板/诊断能看到）。

### ④ @ 视频到底发不发 —— 以前**从来没发出去过**

`comment-at` 要求 `--to`（昵称）+ `--uid` + `--sec` 三个参数，而 `tellOwner` 只传了 `--uid`，
所以每一次都在参数校验那一步 `die` 掉。**已补齐三个参数**，缺任何一个时返回明确原因（不再静默）。

### ⑤ 以前回过的又回一遍

两层原因：
1. `duty` 调 `checkQuota({ authorId })`，而 ledger 收的是 `authorUid` —— 参数名错了，
   「同一个人一天最多 2 条」这道闸**从未生效**；`recordReply` 也写成了 `author/author_id`，
   账本里的作者字段一直是空的（实测：20 条记录，0 条有 authorUid）。
2. 账本只是**本地记忆**：装上之前的、账本清过的，它一概不知道。

**改法**：①参数名对齐；②回评前真去问一次 `api.replies(aweme, cid)`，
只要底下已经有一条是我发的就跳过（一次请求，换掉重复回评）。

### ⑥ 楼中楼从来没成功过

发的那一侧其实是对的（`reply_id = 楼根`、`reply_to_reply_id = 被回的那条`），
**缺的是"看见楼中楼"**：`api.comments()` 只返回顶层评论，候选里根本没有楼中楼这一层。

**改法**：新增 `api.replies()`（`/aweme/v1/web/comment/list/reply/`）+ CLI `replies`
+ 工具 `douyin_studio_replies`。用法：
`dy.mjs replies --aweme <id> --cid <楼根>` 拿到下面每条的 cid，
再 `reply --aweme <id> --cid <那人的 cid> --root <楼根>` 就是精准回某个人。

### 验收

`node tools/check.mjs` → PASS（76 文件 / 26 测试文件 / 339 例）。
`tests/autopilot.test.mjs` 新增 3 例：两段低峰任一命中、只配一段、两段都空。

---

## 17. 2026-11-05 中午：三项收口 + 全流程实跑

### 改了什么

| 项 | 落点 | 语义 |
|---|---|---|
| 评论时效窗 | `lib/settings.mjs` `replyFreshHours`（默认 48h，0=不限）+ `duty.collect({freshHours})` | 只回 N 小时内的评论；老评论不再被翻出来回。`create_date` 是**无时区标记的 UTC**，按 UTC 解析 |
| 主人豁免 + 额度注入 | `lib/budget.mjs configure({limits, ownerUid})`；`index.js syncBudget()` 启动与每次存设置时调用 | 面板里查额度（发私信、挑卡「发我」）以前用的是**默认值**：改了额度不生效、主人也会被「同一人 2 条」拦住。现在宿主注入，设置一改立刻生效 |
| 新私信即时回 | `watch.tick({onFresh})` → `index.js replyDmNow()` → `AUTOPILOT.runDm` | 90 秒发现、30 分钟才回的延迟没了。两道锁：watch 的 `busy` 重入闸 + autopilot 的 `DM_RUNNING` 单飞锁 |

### 实跑发现并修掉的问题

1. **`budget` 在宿主里读的是默认值** —— 见上表第二行。不是"没实现"，是"注入了但只给了子进程"。
2. **盯私信 tick 可重入** —— `setInterval` + 现在要等一次回私信（十几秒），到点会叠着跑。加了 `busy` 闸。
3. **回私信并发** —— 定时器和即时回可能同时各发一条。加了 `DM_RUNNING` 单飞锁。
4. **`lib/delete.mjs` 被 import 会杀进程** —— 它是顺序执行的脚本，末尾 `process.exit`。
   全量扫「模块能不能加载」时踩到。加了 import 闸（明确报错，不是静默退出）。
   ⚠️ `lib/publish-cli.mjs` 是同一个形状，但它在禁改区，只在文档里记一笔。

### 验证记录（可复现）

```
node tools/check.mjs                 → PASS  76 文件 / 26 测试文件 / 339 例
逐个 import 45 个 lib 模块            → 除 delete.mjs（已加闸）/ publish-cli.mjs（脚本）全部 OK
node tools/dy.mjs reply --dry …       → ok, stage=dry, 落点打印正常
node tools/dy.mjs at-reply --dry --root … → reply_id=楼根, reply_to_reply_id=被回那条 ✅
node tools/dy.mjs comment-at --dry …  → text 自动加 @昵称，extra 正确
node tools/dy.mjs replies（缺参）      → 明确报「缺 --aweme / --cid」
设置归一化（active2 / peakReply / replyFreshHours）→ 通过
UI 四个区截图 + probe-ui              → textBugs 0 / overflow 0，唯一 console 是 favicon 404
```

**没验证的**：真实账号上的"点发送"。评论区 @ 和楼中楼都要真页面，建议先 `--dry` 看一眼落点，再放一条真发。

## 18. 2026-11-05 下午：输入框「两个框颜色不一样」

**现象**：时间页里，填了值的输入框看着是浅灰底，空的（占位符「留空 = 不设」）看着是一块更暗的洞。

**根因**：`[data-dys-in]{background:transparent}` —— 输入框没有自己的表面，和卡片同色。
空的框只靠一条 1px 边线撑着，和填了字的框不是同一种物体。
（预览沙盘里两种状态计算样式完全一样，所以差异来自宿主：DSH 很可能对 `input:not(:placeholder-shown)`
加了底色。我们原来的选择器权重只有 0,1,0，压不住。）

**改法**：
1. 输入框/多行框给一个自己的表面：`color-mix(currentColor 6%)`（深 #2f3135 / 浅 #f1f2f2，比卡片高 1.12–1.15 档）。
2. 选择器改成 `input[data-dys-in]`（0,1,1）—— 和宿主的 `input:not(:placeholder-shown)` 同权重，
   而插件样式是后插入的，同权重下我们赢。这样空框和有值框**一定**同色。
3. 聚焦：边框 62% 蓝 + 3px 16% 蓝光环（原来只换边框颜色，在深色下几乎看不出）。
4. 占位符回到 `--dys-dim`：深 #919398（5.5:1）/ 浅 #727272（4.9:1），两边都过 WCAG AA。
5. 卡片边线 11% → 13%：深色下对比 1.3:1 → 1.44:1，边框终于能看见了。

**验证**：`input[data-dys-in]` 与空框的计算背景现在都是 `oklab(... / 0.06)`，完全一致；
深/浅两套截图各一张；`check.mjs` PASS（client.js 1939/1940）。

---

## 19. 2026-11-05 傍晚：行为自检 + 禁改区哈希 + 文档校正

> 这一轮**没有改任何发送逻辑**，只加"看得见"的东西。四个套餐里的 A 部分。

### 新增

| 文件 | 干什么 |
|---|---|
| `lib/selfcheck.mjs` | 运行期行为自检，纯函数，10 条规则（回错到自己 / 重复 cid / 重复楼根 / 同人超限 / 静音时段 / 作者字段缺失 / 未来时间 / 额度跨天 / 超发 / 值班安静） |
| `tools/selfcheck.mjs` | 入口，只读盘，`--json` / `--self-uid`；退出码 0/1 |
| `tests/selfcheck.test.mjs` | 23 例 |
| `lib/selfid.mjs` | 机器人自己的 uid 落 `self.json`（ownerUid 是主人的，不是她的） |
| `tools/lock-protected.mjs` + `protected.json` | 禁改区 7 个文件的 md5 基线 |

`check.mjs` 新增第 ⑥ 条：禁改区哈希变了就红。**以后要改 `budget/api/im-send/publish-*`，
必须先跑 `node tools/lock-protected.mjs` 更新基线并在 CHANGES 里写理由** —— 否则等于拆刹车。

### 实测发现（都不是猜的）

1. **账本 20 条记录，`authorUid` 有值的 0 条** —— 闸④「每人每天 2 条」对这批历史记录完全无效。
   11-05 的修复只对新记录生效，旧账补不回来。
2. **她自己的 uid = `4237967833704249`（小肥鱼（陈汐））**。作品 `7700573957753228559` 下第一条评论
   就是她自己发的，楼中楼里也有她自己的回复 —— 这些都会进候选池。
   **以前没有 selfUid，"回错到自己"根本无从判断。现在能了。**
3. **值班安静 19 小时**（最近一次出口 11-04 23:09），而 `picks.json` 17:10 还在更新。
   刷视频在跑、出口没动 —— 这正是新加的 `duty-silent` 第一条真实报警。
4. 楼中楼 dry 落点正确：`reply_id=7701086319522906918`（楼根）、
   `reply_to_reply_id=7701225645871842057`（被回那条），quota 0/20、0/10。

### 验收

```
node tools/check.mjs   → PASS  81 文件 / 27 测试文件 / 362 例 / 禁改区 7 个哈希未变
node tools/selfcheck.mjs → ✓ 通过（1 warn：值班安静 19 小时）
```

### 19.1 实弹验证时抓到的真 bug：记账被 process.exit 掐掉

**现象**：`dy.mjs reply` 真发一条楼中楼，抖音侧返回 200、评论确实出现了（新 cid `7704629910287549210`），
但 `ledger.json` **一条没多**（还停在 11-04 的 20 条）。

**根因**：`recordReply` 是 `async`，`dy.mjs` 里没 `await` 就走到下一行 `process.exit(...)`。
`budget.record` 是同步函数所以记上了 —— 于是表现为**额度扣了、去重没记**，这是最坏的组合：
- 闸①（同 cid 只回一次）失效 → 同一条评论可以无限重复回
- 闸④（同人每天 N 条）失效 → 同一个人可以被连着回
- 而且账本看起来"很干净"，因为根本没写进去

**两处修复**（`tools/dy.mjs`，reply 分支 + at-reply 分支）：`await recordReply(...)`。

**验证**：补记那条真实发送 → 再跑同一条 `--dry` → 返回
`"why": "这条评论已经回过了（同一个 cid）"`。去重闸活了。

> 这条同时解释了 11-05 上午"参数名对齐了但重复回评还在发生"——参数是第二层原因，
> 这是第一层：那笔账压根没落盘。

---

## 20. 2026-11-05 晚：把"记账"收敛成一条路 + 对账工具

> 依据：幂等键 / transactional outbox / reconciliation 这一套（Stripe 的 idempotency key、
> n8n 的"非幂等节点不许自动重试"、以及"对账是标准控制手段而不是补救"）。

### 20.1 三个改动

| 文件 | 干什么 | 治的是哪个病 |
|---|---|---|
| `lib/sendlog.mjs`（新） | `recordOutbound()`：写账本 + 记额度合成一次调用，内部 `await`、按 cid/newCid 幂等，`bill:false` 可只补账不占额度 | 三个发送分支各写各的，忘一个就漏一次 |
| `tools/dy.mjs`（改 3 处） | reply / at-reply / comment-at 全部改走 `recordOutbound` | comment-at 以前**压根不写账本**，只记额度 |
| `lib/selfcheck.mjs` +3 例（改） | 新增 `ledger-gap`：今天额度记了 N 次、账本只有 M 条就报 error | 这类 bug 单看任一文件都正常，只有并排才看得见 |

### 20.2 对账工具 `tools/reconcile.mjs`（新）

```bash
node tools/reconcile.mjs --aweme <id>   # 只报告
node tools/reconcile.mjs --works 5      # 扫最近 5 条作品
node tools/reconcile.mjs --fix          # 补账（不补额度）
```

**首次跑就抓到 14 条**：作品 `7700573957753228559` 下，线上她自己发的评论有 14 条账本里没有
（1 条顶层 @ + 13 条楼中楼）。也就是说账本**从来不是"她说过什么"的完整记录**，
过去所有去重闸都只对"值班自动回的 20 条"有效。

> ⚠️ `--fix` 的时间戳是"现在"，历史评论会被算进今天。只建议补当天的漏账。

### 20.3 验收

```
node tools/check.mjs      → PASS  83 文件 / 27 测试文件 / 365 例 / 禁改区 7 个未变
node tools/selfcheck.mjs  → ✓ 通过  回复 2 条 / 出口 2 次 / 错误 0 · 提醒 0
```

---

## 21. 2026-11-05 夜：人设接真源 + 线上对账接进自检

### 21.1 人设不再有第二份（`lib/settings.mjs`）

**改之前**：`settings.json` 里 `persona: ""`，注释写着"空 = 通用助手口吻"，
而真正的人设卡在 `~/.dsh/profiles/desktop/qq-pet/identity.md`（5.7KB）+ `style.md`（7KB）。
**同一个人在 QQ 和抖音说话不像，根因不是模型，是两份人设只有一份在喂。**

**改之后**：新增设置 `personaSource`（`card` 默认 / `custom` / `off`）：

| 值 | 行为 |
|---|---|
| `card` | 读人设卡的「我这个人」前 3 条 + 「唯一不动的底线」那一句（实测 248 字） |
| `custom` | 只用面板里手写的 `persona` |
| `off` | 通用口吻 |

优先级：`off` → 手写 persona → 卡 → 通用。按 `mtime` 缓存，不会每轮 stat 两次。

**取舍**：只取 3 条 + 底线，不塞全文。每轮都在付费，420 字是预算不是客套。
`personaSource` 暂时**面板上没有输入框**（client.js 顶到 1940 行上限），改法：
直接编辑 `~/.dsh/douyin-studio/settings.json`。

⚠️ `personaLine` 由 `lib/autopilot.mjs` 在**宿主进程内**调用 ⇒ **要重启 DSH 才生效**。

### 21.2 对账接进自检（`tools/selfcheck.mjs --online`）

```bash
node tools/selfcheck.mjs --online   # 本地 12 条规则 + 线上核账本（慢十几秒）
```

分级：**今天的漏账 = error**（去重闸此刻是坏的），**历史漏账 = warn**（老账，不影响今天）。
不分级就会天天红，红到没人看。

为什么放在 tools 而不是 `lib/selfcheck.mjs`：那边是纯函数（不读盘、不联网）。
往里加网络，"自检自己会失败"，可信度就没了。

### 21.3 数字

```
check.mjs   → PASS  84 文件 / 28 测试文件 / 373 例 / 禁改区 7 个未变
selfcheck   → ✓ 0 error / 1 warn（19 条历史漏账）
```

**待处理**：那 19 条历史漏账不补 —— `--fix` 的时间戳是"现在"，会把它们算进今天。

---

## 22. 2026-11-05 深夜：两个线上反馈的根因

### 22.1 「发视频不带文字」——根因不在发送，在**打开的页面不对**

**复现**：`node tools/dy.mjs dm --to <ownerSec> --text "..." --dry`
→ `{"ok":false,"error":"会话没打开（等不到输入框）","nick":"辰辰辰chen","log":["找到行 辰辰辰chen"]}`

**根因**（现场 probe 抓到）：
`openPage()` 只按**域名**挑标签页，**不导航**。上一步「分享视频」留下的标签页停在
`/video/7681526730688271994`，而视频页的**分享面板**里好友行也带
`[data-e2e="conversation-item"]` —— 于是 im-send「找得到行、双击没反应、等不到输入框」。
`tellOwner` 里 `if (!(dr && dr.ok)) say = ''` 又把原因一起吞了，表现就是"只收到视频、没有字"。

**修**：
1. `lib/chrome.mjs` `openPage({navigate:true})`：选中的页≠目标就 `Page.navigate`。
2. `lib/im.mjs` `send()`：发私信前先把它导航到 `https://www.douyin.com/chat`。
3. `index.js` `tellOwner`：失败**不再静默** —— 原因写进 `notify-state.sayError`，
   且只在"确认没发出去"的错上换目标重试一次。

**验证**：同一命令重跑 → `{"ok":true,"dry":true,"log":["找到行 辰辰辰chen","输入框出现","文字已写入"]}`

### 22.2 「回复有机器人腔」

**根因**：提示词开头是「**你是这个抖音账号的主人**」——这句话把语气往客服/官方号带；
而她的「说话方式」（括号小动作、篇幅跟随）从来没进过提示词，只吃了身份卡。

**修**（`lib/settings.mjs` `personaFromCard`）：
- 开头改成「你是下面这个人。说话像她本人，不像客服，也不像在运营一个账号」
- 追加一句固定的说话方式：括号小动作、他短我短、禁用「感谢支持/很高兴为你/希望能帮到你」、不总结、不反问一串

**实测**（`duty.generate`，1.2s）：
> 「（把脸凑近窗玻璃看水珠）雨太大，镜头都糊了，明天补给你。」

persona 长度 361 字（原 278），仍远低于 520 上限。

### 22.3 验收

```
check.mjs   → PASS  84 文件 / 28 测试 / 373 例 / 禁改区 7 个未变
selfcheck   → ✓ 0 error / 1 warn（今天 1 条回复没记作者 uid）
```

---

## 23. 2026-11-05 晚：时间显示差 8 小时

**现象**（用户截图）：@我 列表里 1 小时前那条显示成「9 小时前」。9 − 1 = 8，正好是东八区偏移。

**根因**：抖音的 `create_date` 形如 `2026-11-05 10:26:24`，**无时区标记，实际是 UTC**。
- `lib/inbox.mjs` 的 `AGE_MIN` 用 `Date.parse()` → 按本地解，差 8 小时
- `client.js` 的 `ago()` 用 `new Date(iso)` → 同样差 8 小时
- `picks.mjs:74` 早就修过这一处，但收件箱这条路没同步

**修**：新建 `lib/reltime.mjs`，把时间口径收成一份：
- `parseDouyinTime()`：无标记当 UTC；只有日期当本地零点；带 Z 原样；数字当毫秒
- `toIsoZ()`：统一成带 Z 的 ISO，前端怎么解都不会再偏
- `relTime()`：刚刚 / N 分钟前 / N 小时前（同一天）/ **昨天 HH:MM** / N 天前（<7）/ MM-DD

接线：`inbox.mjs` 的 `AGE_MIN` 与条目 `at` 都走它，并新增 `when` 字段；
`client.js` 的 `Time` 优先渲染 `when`（同 `ago()` 留作兜底）。

**验证**：
```
inbox --at-only → when: 34 分钟前 | at: 2026-11-05T10:26:24.000Z   （原来显示 9 小时前）
tests/reltime.test.mjs 11 例：跨天/昨天/坏输入/未来时间/真实截图那条
```

**顺带核实**：`lib/duty.mjs` 的 `ageHoursOf()` 本来就会补 `Z`，48 小时时效窗一直是对的，没动。

**验收**：`check.mjs` PASS 86 文件 / 29 测试 / 384 例。

**生效**：`client.js` 刷新页面即可；`inbox.mjs` 由 CLI 子进程加载，下次开面板就是新的。**不用重启 DSH。**

---

## 24. 2026-11-05 夜：视图模型 + 动作账 + 自动现状页

> 这一轮不加功能，只拆两个结构问题：界面逻辑不可测、出错没有现场。

### 24.1 `lib/viewmodel.mjs`（新）

把「一条收件箱记录 → 界面上那几个字」变成纯函数：

```js
inboxItemView('dm'|'at'|'own', item, { now })  // → { when, preview, notes, blocked, tone }
inboxHeadline(inbox, now)                      // → { worth, text: '3 条值得回 · 2 分钟前' }
```

`lib/inbox.mjs` 在三个候选函数的返回处挂 `it.view`；`client.js` 改成
`it.view ? it.view.preview : 旧逻辑`（**行数没有增加**，1938/1940 没变）。
规则现在可以单测，也能给 CLI / 日报复用。

### 24.2 `lib/runlog.mjs`（新）—— 动作账

`~/.dsh/douyin-studio/runs.jsonl`，一行一个动作：`{at, kind, target, ok, stage, error, took}`。
超过 2MB 轮转成 `.1`，坏行跳过，写失败返回 null（绝不因为记账把主流程搞挂）。

接线三处：
- `tools/dy.mjs` 的 `out()`：每条 CLI 的最终结果（覆盖全部命令）
- `lib/sendlog.mjs`：真正发出去的那一步
- `index.js` `tellOwner`：分享卡片 + 补一句话这个**组合动作**的整体结果

> 和 ledger 的分工：ledger 是业务账（管去重、管额度），runs 是运维账（管排查）。
> 以后"它到底做没做"不用再翻聊天记录。

### 24.3 `tools/status.mjs`（新）—— 数字不再手抄

`node tools/status.mjs` → 覆盖写 `docs/STATUS.md`：体量、`check --quick` 输出、
行为自检结论、最近 60 条动作的成功/失败与分布。

HANDOFF 第 1 节曾写「b21 / 1565 行 / 242 例」而代码是 b35 —— 这类漂移以后只会在 STATUS.md 出现，
且它每次都是重新采样的。

### 24.4 验证

```
node tools/check.mjs     → PASS  91 文件 / 31 测试文件 / 399 例 / 禁改区 7 个未变
node tools/status.mjs    → docs/STATUS.md 已生成
宿主（端口已从 51549 变 58337）
  GET /api/douyin-studio/status → 200
  GET /api/douyin-studio/inbox  → items[0].view.when = "48 分钟前"（真实数据）
```

**仍需重启**：`index.js` 的改动（tellOwner 动作账、uid 落盘）在宿主启动时加载。
`lib/*` 与 `client.js` 都是按需/子进程加载，已生效。

**已知非产品问题**：`tmp/preview` 沙盘页要求 `/vendor/react.js` 由外部服务器提供，
临时起的静态服务没映射对，渲染检查没跑通 —— 与 `client.js` 本身无关（语法与真机接口均已验证）。

---

## 25. 2026-11-05 夜（二）：调度层重写 + 界面收口 + 结构债

> 这一轮把 `docs/方案-调度与界面优化-2026-11-05.md` 的 A1–A5 / B1–B6，
> 以及上一轮「项目意见」里的 P0/P1 结构项一起落实。版本号 b35 → **b36**。

### 25.1 调度（A1–A5）

| 文件 | 干什么 |
|---|---|
| `lib/scheduler.mjs`（新） | 窗口制 `scanWindows`（旧字段只读映射成单窗口）、按天稳定的 ±15% 抖动、≥45 分钟最小间隔、四档退避熔断、纯函数 `decide()` |
| `lib/roundstate.mjs`（新） | `scan-state.json` / `rounds.jsonl` / `health.json` / `STOP` 的唯一写盘口 |
| `lib/dashboard.mjs`（新） | 面板 / CLI / scanTick 共用的只读快照：`next` + `hero` + `log` + `funnel` |
| `index.js` scanTick | 额度为 0 跳过且不消耗轮次、失败退避、连败 6 次停到次日、每轮写台账、跳过原因去重 |
| `tools/dy.mjs schedule` | `--pause on\|off`；CLI 与面板读数同源，宿主没重启也能验 |

**确定性抖动是硬要求**：tick 每 5 分钟跑一次，若每次重算点位会飘，
就会出现「这一轮永远等不到」或「同一轮刷两次」。随机源是 `hash(day+index)`。

真实数据实测：`09:12 / 13:13 / 17:12`，`±36 分钟`，`done=3`，`quotaLeft=37`。
暂停往返：`--pause on` → `action=pause`；`--pause off` → 恢复，STOP 文件已删。

### 25.2 体量债：CSS 真源

`client.js` 曾卡在 1938/1940 行，其中 **352 行是 CSS 原文**。
现在 `assets/panel.css` 是可读源文件，`tools/build-client.mjs` 压成一行写回
`client.js`；`check.mjs` 第 ⑦ 条比对两者，分叉就红。**生成物仍是单文件**，
宿主不用改加载方式。行数 1937 → 1711。

### 25.3 界面（B1–B6 + 键盘 / 响应式）

- 看板三数：粉丝/作品/获赞 → **待回 / 额度剩 / 上一条回评成败**，22px·660·tabular-nums，可点跳转
- 收件箱改**表格式一行**（谁 / 说了什么 / 判定 / 时间），行高 30，一屏扫 10+ 条
- 新增**值班日志**卡：动作账 + 轮次账 + 业务账合成时间线，跳过原因可见；带三段漏斗
- 头部加「下一轮 15:32（±N 分钟）· 暂停刷」，暂停写 `STOP`
- 收件箱空态给两个动作；时间设置按「静音 / 低峰一 / 低峰二」分卡片小标题
- `⌘/Ctrl+K` 命令面板、`1–4` 切区、`r` 刷新、`/` 打开面板；输入框里不抢键
- `@media (max-width:720px)`：分段控件横向滚动 + 两端渐隐、表格收一列、看板折行

**降级**：宿主没重启时 `/schedule` 还是 404，面板从 `/budget`+角标+账本拼一份
只读快照，看板不空白、暂停按钮不出现（避免点了没反应）。

### 25.4 结构（上一轮项目意见）

| 项 | 落地 |
|---|---|
| P0 视图模型 | `lib/viewmodel.mjs` 扩出 `heroView` / `dutyLogView` / `funnelView`，前端只画 |
| P0 动作账 | `lib/runlog.mjs` 已有，接到 `/runs`、`/schedule.log` |
| P0 数字自动 | `tools/status.mjs` 生成 `docs/STATUS.md` |
| P1 类型边界 | `jsconfig.json`（checkJs）+ `tools/typecheck.mjs`；本机无 tsc，验收先强制 12 个纯模块 / 68 个导出都有 JSDoc |
| P1 回放测试 | `tests/fixtures/douyin-sample.json` + `tests/replay.test.mjs`（5 例），钉真实字段形状 |
| P1 发布链 | `lib/publish-rules.mjs` + `tools/rules-drift.mjs`；**先检测不改禁改区**，两条链都是视频 30 / 图文 20 |
| P2 单写者 | `lib/store.mjs` 按文件串行 read-modify-write；scanTick 的跨 await 写入全改走它，12 路并发自增测试证明不丢 |
| 预览验证 | `tools/preview.mjs` + `tools/preview-check.mjs`，真实浏览器渲染四视图 + 420px 窄屏 |

### 25.5 验收

```
node tools/check.mjs            → PASS  106 文件 / 35 测试文件 / 438 例
                                    client.js 1711/1940 · 禁改区 7 个哈希未变
                                    样式真源 / 类型契约 / 发布规则 全绿
node tools/selfcheck.mjs        → ✓ 通过（1 warn：今天 1 条回复没记作者 uid，历史遗留）
node tools/dy.mjs schedule      → 真实数据：点位/抖动/额度/漏斗/日志都读得出来
preview-check（4 视图 + 420px） → ok=true，reply 3 行表格、today 3 条日志、b36
降级路径（noschedule=1）        → ok=true，看板仍有数、按钮不出现
```

### 25.6 仍需重启 / 未做

- **重启 DSH 才有新路由** `/schedule`、`/schedule/pause`、`/runs`。
  CLI `node tools/dy.mjs schedule` 现在就能跑，验证不依赖重启。
- `lib/publish.mjs` 在禁改区，没改成 import 共享规则 —— 目前是「分叉报警」，
  等下次真要改发布行为时一起切。
- 多账号参数化、`api.mjs` 拆分、点赞/收藏写接口、19 条历史漏账补记：
  都属新增写行为或大范围重构，这轮刻意没碰。

### 25.7 同夜补丁：设置页「两个不同颜色面板」其实是卡片背景中途结束

**现象**（用户截图）：设置 → 时间，卡片底边横穿表单，
「低峰二」及后面的字段落在另一块更暗的底色上，像被第二个面板包住/遮挡。

**实测**（真实浏览器量盒子）：`[data-dys-view]` 高 387px，
`[data-dys-view] > *:only-child{min-height:100%}` 让唯一的卡片也被拉伸/锁在 387px，
但表单内容一直排到 882px —— **卡片背景在第 387px 结束，最后 216px 内容画到容器底色上**。

**修**（只改一条 CSS，未动任何 JS / 数据 / 交互）：
`assets/panel.css` 的 only-child 规则加 `align-self:start`，让卡片按内容自然长高，
滚动交给 `[data-dys-view]` 的 `overflow:auto`。改完经 `tools/build-client.mjs` 重建。

**验证**：
```
修复前  cardH=387  lastFieldBeyondCard=+217  （溢出）
修复后  cardH=653  lastFieldBeyondCard=-50   （全在卡内，可滚动）
短分组（内容/说话）修复前后都是 268px，未受影响
tools/preview-check.mjs 新增 enclosure 断言：最后一个字段必须落在卡片内
```
