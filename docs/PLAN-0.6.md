# 0.6 方案：把 aurabot 的「内在」搬过来，再借别人的「外在」

> 写于 2026-11-13。这一版不追新功能数量，追的是四件事：
> **记得住人**（已做）、**有心情**、**有交代**（今天该做的做到没）、**看得见**（她今天干了什么）。

## 一、先说现在缺什么

| 层 | aurabot 有 | dy 现在 | 后果 |
|---|---|---|---|
| 人的记忆 | `contacts` | 0.5.11 已有 | — |
| 心情 | `mood`（影响表情/语速/上下文） | 无 | 昨天被骂，今天照样甜 |
| 一天过的日子 | `diary`（日结） | 无 | 只记事件，不记「那天我怎么回的」 |
| 今日目标 | `purpose`（欠账补做） | 只有 tier 轮换 + 0.5.12 晚补 @ | 发布永远「有空再说」 |
| 权限 | `access.js` + 每动作权限 | 全开/全关 | 谁都能让它发东西 |
| 暂停 | `pauseDay` | 只能全局 kill | 停一天得停全部 |
| 登录态 | 缓存 `account` | 每次现开浏览器查 | 慢，还多开页 |
| 去重 | `sharedDy` 绝不二次分享 | 只按 aweme 记账 | 同一条可能被分享两次 |
| 页面 | 每模块一个 tab，信息密度高 | 卡片堆 | 找「今天干了什么」得翻 JSONL |

## 二、借鉴来源与落点

### 1) aurabot `features/companion.js`（mood / speakup）
- **抄什么**：心情由事件推动（回复成功 +、失败 −、连续失败更低），输出一行上下文，影响**语气松紧**，不做数值面板。
- **落点**：新增 `lib/mood.mjs`；`lib/duty.mjs` 的 `SYSTEM()` 末尾拼 `moodLine()`。只允许改「句尾那半句的语气」，不许改事实与长度规则。
- **不抄**：speakup（主动找人）。抖音里主动私信是招人烦与风控的主要来源。

### 2) aurabot `modules/diary`
- **抄什么**：一天结束写一段第一人称，不是流水账。
- **落点**：新增 `lib/diary.mjs`；23:30 汇总当天 `events-*.jsonl` → 80–120 字；写一条 `kind:'diary'` 事件进 spool（桥自动进记忆）。

### 3) aurabot `purpose/engine.js`
- **抄什么**：今天要达成什么，没达成就补，不是「有空才做」。
- **落点**：新增 `lib/purpose.mjs`，`plan({ hour, counters, settings })` 返回有序动作队列；`lib/tier.mjs` 改为吃 `plan`（0.5.12 的 `hour>=20` 规则并进去，不重复实现）。

### 4) aurabot `src/douyin/duty.js`（同赛道，最该抄）
- **权限模型**：`profilePermits(cfg, key, chat)` —— 浏览 / 点赞 / 评论 / 私信 / 分享各一条，按「主人 / 私聊 / 群 / 访客」判。
  → 新增 `lib/permissions.mjs`，默认**全开**（不改变现有行为），只加「谁能触发写操作」的白名单。
- **暂停一天**：`pauseDay` + `pauseReason`，到点自动恢复；面板显示「今天歇着，因为…」。
- **登录态缓存**：`account` 存上次查到的昵称/uid，面板只读它，不为了显示状态去开浏览器。
- **绝不二次分享**：`sharedDy` 记 id，同一条永不重复分享。
- **首见私信不回溯**：`dmSeen` + `dmInit`，第一次进会话只记 id 不回旧消息。

### 5) 别的社媒插件（通用做法）
- **内容日历 / 排期**：发布不再只有「现在发」，可排到某个时段（dy 已有 `at` 定时，缺的是**队列视图**）。
- **素材库**：`D:\抖音内容` 索引化（文件名、尺寸、时长、是否已发），发布时先看库。
- **回复模板库**：把「兜底句」从代码常量挪到 `templates.json`，可按场景（@ / 私信 / 评论）分组、可按天轮换。
- **7 日复盘**：粉丝/赞/评论的曲线 + 最好/最差条目（`lib/trend.mjs` 已有雏形）。

## 三、文件级改动清单

### 新增
| 文件 | 职责 | 依赖 |
|---|---|---|
| `lib/mood.mjs` | 心情三档，事件驱动，`moodLine()` | fsx |
| `lib/diary.mjs` | 日结：读 events → 一段话 → 写回 events | events, fsx |
| `lib/purpose.mjs` | 今日目标与欠账排序 | settings |
| `lib/permissions.mjs` | 谁能触发写操作 | settings |
| `lib/timeline.mjs` | 把 runs / events / ledger 合成「今天的时间线」 | 三个读接口 |
| `lib/calendar.mjs` | 发布队列视图（读 `at` 定时任务） | publish 只读 |

### 修改
| 文件 | 改什么 |
|---|---|
| `index.js` | **先拆**：`/open`、`/tabs`、`/inbox/count` 搬进 `lib/routes-misc.mjs`（现在正好 1250 行，卡死上限）；再接新路由 `/timeline`、`/permissions`、`/pause` |
| `lib/duty.mjs` | `SYSTEM()` 拼 `moodLine()`；动作前查 `permissions`；`purpose.plan()` 决定「回 / 不回」 |
| `lib/tier.mjs` | 吃 `plan`，删掉自己那套晚 8 点规则（合并，不叠加） |
| `lib/settings.mjs` | 新增 `moodEnabled`(默认 true)、`pauseDay`、`permissions{}`、`templates{}` |
| `client.js` + `assets/panel.css` | 三个新页 + 状态灯 + 空态文案 |

### 测试
`tests/mood.test.mjs`、`tests/purpose.test.mjs`、`tests/diary.test.mjs`、`tests/permissions.test.mjs`、`tests/timeline.test.mjs` —— 每个 5–8 例，**先写「不许发生」的那条**（例如：没记录时心情不许编、权限没配时不许默认禁止）。

## 四、页面怎么改（借 aurabot 的信息密度）

一级标签保持 5 个以内：

1. **概览**（现状，加状态灯：浏览器 / 登录 / 循环 / 今天的目标）
2. **时间线**（新）：`09:12 刷到 20 条 · 09:40 回了 2 条 · 22:30 发日报`，可按「只看动作 / 只看失败」筛
3. **收件箱**（现状，加「这个人是谁」——contacts 摘要）
4. **设置**（现状，加权限矩阵与暂停）
5. **诊断**（现状，加日志尾部 200 行 + 关键字过滤，替代「自己去翻 JSONL」）

空态统一：说清楚「为什么现在是空的」（没到窗口 / 没新评论 / 浏览器没开），不要只显示 0。

## 五、顺序与验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| P1 | mood + purpose（合并 tier） | 单测全绿；tier 旧行为回归通过；真机一轮看 `plan` 输出 |
| P2 | diary + 桥接 | 手动触发一次日结，`events` 里出现 `kind:'diary'`，aurobot 侧 `added:1` |
| P3 | permissions + pause | 默认全开时行为不变；关掉「私信」后 dm 工具返回明确原因 |
| P4 | 页面三页 + 拆 index.js | `check --quick` PASS（index < 1250）；全量测试绿 |

每阶段独立 commit，可单独回滚。

## 六、风险与边界

- **心情**最容易变成「装情绪」。限制：只改句尾语气词，不改事实、不改长度；连续失败 3 次才降一档。
- **权限**改错会把写操作锁死。默认全开 + 只加黑名单式限制，且每次拒绝都返回「为什么」。
- **日结**要模型跑一次，成本按天一条；失败就跳过，不重试三次。
- **页面变多**会让面板更重。硬约束：一级标签 ≤ 5，新页只加在二级抽屉里。
- **不抄主动私信**：主动打扰是风控与招人烦的主要来源，明确不做。
