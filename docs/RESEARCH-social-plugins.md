# 调研：社交媒体自动化 / 机器人运营类项目，能给 dy 借什么

> 调研时间 2026-11-13。数字取自 GitHub REST API（`repos/{owner}/{repo}`，stargazers_count / pushed_at / license），
> 功能点取自各仓库 README 原文。没有实装验证过的一律标「未验」。

## 一、一句话结论

真正值得抄的不是「怎么发」，而是三件事：
**①发布队列（日历+素材库+失败重试）②收件箱的秩序（标签/备注/分配）③商机信号（谁在问价）**。
反检测、批量关注、主动私信这三类，越看越确认不该做。

## 二、项目清单（按性价比排序）

| # | 项目 | 数据 | 它解决什么 | 具体功能点（README 原文/结构） | 能给 dy 借什么 | 代价 / 风险 |
|---|---|---|---|---|---|---|
| 1 | [dreammis/social-auto-upload](https://github.com/dreammis/social-auto-upload) | 16472★ · MIT · 2026-10-22 | 多平台发布：抖音/小红书/快手/视频号/B站/微博/知乎… | 平台表里 **抖音「视频 / 图文 / 定时发布」全 ✅**；统一 CLI（`sau_commands/`）+ `uploader/` 流程；**18 个 Agent Skills** 供 Codex/Claude Code 调 | ①**定时发布**做成「队列 + 到点执行 + 失败重试」；②**Skill 分发**形态（我们已发 DSH 插件，可补一个 `SKILL.md` 版入口）；③按平台拆 `uploader` 的组织方式 | 它是 Python + Playwright，代码不能直接搬（许可 MIT 可搬，但栈不同）；抖音选择器会随页面改版失效 |
| 2 | [gitroomhq/postiz-app](https://github.com/gitroomhq/postiz-app) | 41487★ · AGPL-3.0 · 2026-11-12 | 排期 + 自动化 + 分析的一体化后台 | 明确三大块 **scheduling / automating / analyzing**；**MCP Server** 与一堆 agent 集成；日历化排期 | ①**日历视图**（我们 `calendar.mjs` 要长这样：周视图、拖到某天某时）；②**MCP/Agent 入口**——把「发一条」暴露成工具而不是只有面板按钮；③分析页的「按平台/按时间」切法 | **AGPL-3.0**：代码不能进我们的 MIT 仓库，只能借交互与结构；它带数据库与团队概念，我们零依赖 |
| 3 | [yikart/AiToEarn](https://github.com/yikart/AiToEarn) | 27650★ · MIT · 2026-11-12 | 「一人公司」内容营销：发布 + 互动 + 变现 | **统一日历排期**；**Engage**：自动点赞/收藏/关注、**AI 智能回复评论**、**挖掘「求链接」「怎么购买」等高转化信号**、监测品牌讨论；批量下发创作任务（矩阵号）；草稿批量生成 | ①**商机信号**：在 `comment-filter` 之外加一层 `signal` 标记（问价/求链接/求教程），进收件箱高亮，**只提示不自动回**；②**草稿批量生成**：一次出 3 条候选文案，人工挑一条发 | 它的「自动关注 / 主动参与热点」明确不做（见第三节）；矩阵号 = 多账号，风控翻倍 |
| 4 | [chatwoot/chatwoot](https://github.com/chatwoot/chatwoot) | 39754★ · 2026-11-13 | 全渠道客服收件箱 | 统一 Inbox；**Private Notes 与 @mentions**；**Auto-Assignment**；Teams + Automation；**Campaigns**；Label / Inbox / Agent / Team **报表**；Captain（AI 客服） | ①收件箱加**标签**（待回/已回/忽略）与**私密备注**（对某个人的备注，不给对方看）；②**分配/优先级**：同一个人连发 3 条 > 单条；③SLA 式「放太久没回」提醒 | 它是 Rails 全家桶；我们只借信息结构。AI 客服那种「先答再说」不适合评论区 |
| 5 | [inovector/mixpost](https://github.com/inovector/mixpost) | 3930★ · MIT · 2026-03-16 | 自托管 Buffer 替代 | Schedule / publish / manage；**媒体库**；多账号；分析 | ①**素材库**：把 `D:\抖音内容` 索引成「文件 / 尺寸 / 时长 / 是否已发 / 配过的文案」，发布前先看库；②「同一素材多渠道复用」的字段设计 | 最后更新 2026-03，节奏偏慢；Laravel 栈，只借概念 |
| 6 | [InstaPy/InstaPy](https://github.com/InstaPy/InstaPy) | 18397★ · GPL-3.0 · 2026-10-26 | Instagram 自动化交互 | 交互**配额**（点赞/关注/评论每天上限）、**黑名单/白名单**、按标签/地点筛选目标 | ①**每类动作的日上限**并进 `permissions.mjs`（我们已有通道预算，缺「按人/按作者」的名单）；②**作者黑名单**（不回某些人） | 它的自动关注/取关是骚扰式增长，不做；GPL 代码不进仓库 |
| 7 | [Wechaty/wechaty](https://github.com/Wechaty/wechaty) | 23558★ · Apache-2.0 · 2026-11-13 | 聊天机器人 RPA SDK | 多协议适配、事件模型、插件化 | 事件总线 + 插件注册的写法（我们 `modules` 已经是这个形状，可对照补齐「模块级启停」） | 它是 IM 侧，跟抖音评论区模型不同，别硬套 |
| 8 | [n8n-io/n8n](https://github.com/n8n-io/n8n) | 210345★ · 2026-11-13 | 工作流自动化 | 触发器 / 重试 / 失败分支 / 通知节点 | ①**失败分类 + 指数退避 + 死信**（我们 `queue.mjs` 已有队列，缺分类与退避曲线）；②「失败三次才告警」的策略 | 引入它等于引入一整套运行时，不现实；只借策略 |
| 9 | [subzeroid/instagrapi](https://github.com/subzeroid/instagrapi) | 7141★ · 2026-11-13 | Instagram 私有 API 客户端 | 直接用移动端接口与设备参数 | —— | **不建议**：见第三节 |

## 三、明确不建议借鉴

| 项目/能力 | 为什么不做 |
|---|---|
| instagrapi（私有 API 直连 + 设备参数） | 与「不做指纹伪造」的结论冲突；账号风险全压在客户端伪装上 |
| InstaPy / AiToEarn 的自动关注、取关、批量点赞 | 骚扰式增长，最容易触发风控与举报 |
| AiToEarn「主动参与热点讨论」 | 主动打扰，与 PLAN-0.6 的「不做 speakup」一致 |
| 矩阵号批量运营 | 多账号 = 多份登录态与风控，收益不抵成本 |
| Postiz 的 AGPL 代码 | 许可不允许进 MIT 仓库；只借交互 |

## 四、对照 `docs/PLAN-0.6.md`

| PLAN 里的条目 | 调研结论 |
|---|---|
| `lib/calendar.mjs`（发布队列视图） | **保留，但改定义**：不只是「读 at 定时任务」，要做成 postiz 那种**周视图 + 状态（待发/已发/失败）+ 重试按钮** |
| `lib/permissions.mjs` | **补充**：除「谁能触发」，加「每类动作日上限 + 作者黑白名单」（InstaPy 的配额思路） |
| `lib/timeline.mjs` | **补充**：事件行加 `signal` 标记（商机词），可筛「只看问价的」 |
| `lib/diary.mjs` / `mood.mjs` | 不变（这两条 aurabot 已经是最好的参照） |
| 收件箱页 | **补充**：标签 + 私密备注 + 「放太久」提醒（chatwoot） |
| 素材库 | **新增（PLAN 里没有）**：`lib/media-lib.mjs`，索引 `D:\抖音内容`，发布前先查重（同图/同视频是否发过） |
| 草稿批量 | **新增（PLAN 里没有）**：`lib/drafts.mjs`，一次生成 3 条候选，人工挑 |
| 失败重试 | `queue.mjs` 补**指数退避 + 失败分类**，不引入 n8n |

## 五、落地顺序（在 PLAN 的 P1–P4 之上插两条）

1. P1 mood + purpose（不变）
2. **P1.5 `signal` 商机标记**（最小改动：`comment-filter` 加一个 `signalOf()`，收件箱与时间线各显示一列）
3. P2 diary + 桥
4. **P2.5 素材库 + 草稿箱**（`media-lib.mjs` + `drafts.mjs`）
5. P3 permissions（含配额与黑白名单）+ pause
6. P4 页面（时间线/权限/日志）+ 拆 `index.js`

## 六、未找到 / 未验

- 没找到「DSH 生态内、专门做抖音互动」的第二个插件可对照（`dsh-douyin-life` 只做过自检，未做功能对照）。
- social-auto-upload 的抖音定时发布实现细节（选择器、cookie 存放）**未读源码**，只按 README 的 ✅ 记录。
- Postiz / Mixpost 的分析指标口径未验，只借页面结构。
