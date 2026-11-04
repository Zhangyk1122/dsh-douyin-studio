# 施工图：从「能执行」到「会挑」—— 给 DSH 的执行版

> 写于 2026-11-04 21:30 · 基线 `PANEL_BUILD = 28`，`node tools/check.mjs` PASS（66 文件 / 20 测试文件 / 283 例）
> 读者：要在这个仓库里改代码的模型（DSH），以及给它派活的人。
> 本文所有「为什么」都标了出处；「怎么做」写到函数签名和验收命令，不需要再问。

---

## 0. 先读这三条，不然会返工

1. **一次只做一项。** 本文列了 T1–T6，按顺序，做完一项跑一次 `node tools/check.mjs`。
   同时开两项 = 分不清是谁弄坏的（这是这个仓库返工最多的原因）。
2. **只认 `check.mjs` 的 PASS，不认自己的自述。** 模型说"已修复"是零信息量的。
3. **`lib/publish-*.mjs` / `lib/im-send.mjs` / `lib/api.mjs` 的签名与间隔 / `lib/budget.mjs` 的额度数字** —— 这四块是禁改区。
   其中 `budget.mjs` 的额度数字**必须由人批准**才能改（T3 会用到），理由见 §5。

---

## 1. 现在到哪了

| 已有 | 状态 |
|---|---|
| 31 个 `douyin_studio_*` 工具 | ✅ 回私信 / 回评论 / 回 @ / 回自己视频 / 回楼中楼 / 发布 / 分享 / 删评 / 导出 |
| 面板 b28，9 个区 | ✅ 新增「挑」，有候选库与打分，22 例测试 |
| `lib/picks.mjs` | ✅ 归一化 / 判 / 打分 / 合并 / 状态机，全纯函数 |
| `lib/taste.mjs` | ❌ **不存在**。所以「作者重合」「话题重合」两项权重恒为 0 |
| 点赞 / 收藏 / 关注 | ❌ **不存在**。`lib/api.mjs` 只有读 + 回评 + 删评 |
| 「一天刷几轮」 | ❌ 现在的 `rounds` 是**翻页深度**，不是「一天刷几次」 |
| 通知预算 | ❌ 没有。现在是「有就发」，会把人烦到关掉 |

一句话：**会干活，不会挑，也不会克制。**

---

## 2. 四条设计原则（每条都带出处）

### 2.1 先减，再加

> "Making important information stand out does not always mean adding emphasis… **Removing nonessential elements can be equally or even more effective**."
> —— NN/g《8 Design Guidelines for Complex Applications》 https://www.nngroup.com/articles/complex-application-design

所以本仓库的规矩：**新增任何控件前，先说明它替掉了什么。** 替不掉就别加。

### 2.2 折叠只做两层

> "designs that go beyond 2 disclosure levels typically have low usability… If you have so many features that you need 3 or more levels, consider simplifying your design."
> —— NN/g《Progressive Disclosure》 https://www.nngroup.com/articles/progressive-disclosure

9 个区（含 b28 新加的「挑」）→ **3 个一级 + 1 个「更多」**，不要再往下分第三层。

### 2.3 颜色只表达状态，一屏只有一个实心按钮

> "颜色是用来传达信息的，而非装饰… 强调色仅在两种场景出现：状态反馈、当前页面最重要的那一个操作按钮。"
> —— Vercel Geist `design.md` https://vercel.com/design.md （中文梳理见 https://sotasync.com/reader/2026-06-20-vercel-design-system-geist）

本条已在 b28 执行过一次：原本「挑」卡里 4 个实心蓝的「发我」被改成描边，点了确认才变实心。

### 2.4 动效默认 0ms

> Geist 文档原话："**0ms 往往是最好的选择**"——能不动就不动，要动就短、要快。

`client.js` 里现有的 `transition:.12s` 保留（按钮反馈），但**不要新增任何入场动画、骨架闪烁、位移过渡**。

---

## 3. 为什么要「通知预算」—— 有实验数据

> 田野实验 N=247（实验组 124 人关掉通知一天）：**减少通知打断能提升绩效、降低紧张感**。
> —— Ohly & Bastin, *Journal of Occupational Health* 65(1):e12408, 2023
> https://academic.oup.com/joh/article/65/1/e12408/7243989

> 被打断后平均要 **23 分 15 秒**才回到原来的任务；且被打断的人「更快但更紧张、错误更多」。
> —— Mark, Gudith & Klocke, *The Cost of Interrupted Work*, CHI 2008

**推论（这决定 T2 的形状）：** 「@ 你」不是一个免费动作，它要从你这儿拿走 20 分钟。
所以默认值必须是**每天 2 次**，不是「有就发」。

---

## 4. 任务清单

### T1 · 口味画像 `lib/taste.mjs`（最优先，纯读）

**为什么先做这个**：`index.js` 里 `ctx.authors` / `ctx.tags` 现在是空数组，作者/话题两项权重恒为 0。
补上它，`picks` 才真的"认识你"，而不是只会匹配关键词。

**架构照抄"记忆流 + 反思"**，不训练模型：

> Park et al., *Generative Agents*, UIST '23（arXiv:2304.03442）把长期记忆写成**只追加的自然语言日志**，
> 检索分数 = `w1·recency + w2·importance + w3·relevance`，并定期把零散记忆**反思**成更高层的结论。
> https://arxiv.org/abs/2304.03442

**落点**：新建 `lib/taste.mjs`（≤150 行）+ `tests/taste.test.mjs`（≥10 例）

```js
// 只读这些已有的东西，不新增采集
export const buildTaste = ({ likes = [], publishes = [], ledger = [], picks = [] }, now = Date.now()) => ({
  authors: { [sec_uid]: weight },   // 计数 × 时间衰减
  tags:    { [tag]: weight },
  dur:     { p50, p90 },            // 时长分位
  hours:   [0..23 的直方图],         // 你几点在刷
  evidence: 0,                      // 参与计算的样本数
  updatedAt: iso,
})
```

- **衰减**：半衰期 14 天（`w = 0.5 ** (ageDays / 14)`）。14 天前赞过的作者不该和新赞的一样重。
- **权重**：`likes` 1.0 / `picks.saved` 1.2 / `publishes` 1.5 / `ledger` 1.0。
  （自己发的最能说明口味，所以最高。）
- **`evidence < 20` 时不许输出结论**：返回空对象，让 `judge()` 退化成"只认关键词"。
  这是硬约束 —— **样本不足就承认不知道**，这比编一个画像更值钱。
- **写入**：`~/.dsh/douyin-studio/taste.json`，走 `lib/fsx.mjs` 的 `atomicWriteJson`。

**验收**
```bash
node tools/check.mjs          # PASS，且测试例数 ≥293
node -e "import('./lib/taste.mjs').then(m=>console.log(m.buildTaste({})))"
# 必须输出全空结构，不许有任何虚假的 authors/tags
```

**坑**：`sec_uid` 才是身份，昵称会改。任何用昵称做 key 的写法都算错。

---

### T2 · 通知预算 `lib/notify.mjs`（纯函数）

**落点**：新建 `lib/notify.mjs`（≤100 行）+ `tests/notify.test.mjs`（≥8 例）；
`lib/settings.mjs` 加三个字段（`notifyPerDay` 默认 2 / `notifyTier` 默认 `at` / `notifyQuiet` 复用 `quietFrom/To`）。

```js
// 今天还该不该叫你
export const allowNotify = ({ items = [], calledToday = 0, perDay = 2, minScore = 0.6 }) => ({
  ok: false,
  tier: 'none' | 'at' | 'dm',   // 入库不占额度，@ 和私信占
  why: '今天已经叫过 2 次' | '没有过线的候选',
})
```

**三档**（这是「恰到好处」的关键）：

| 档 | 触发 | 成本 |
|---|---|---|
| 入库 | 任何 `score ≥ 0.4` | 0（不打扰） |
| @ 你 | `score ≥ 0.75` 且当天未超 | 占 1 次 |
| 私信 | `score ≥ 0.9` 且你最近 24h 主动搜过同类 | 占 1 次，且走 `dm` 额度 |

**沉默也是信息**：连续 3 天 `calledToday === 0` 且 `fresh > 0` → 在「今天」卡里写一句
「这三天没有值得叫你的，刷了 46 条」。**不许硬凑**。

**验收**：`check.mjs` PASS；`allowNotify({calledToday:2})` 必须 `ok:false`。

**出处**：默认 2 次的依据见 §3；「三级分档而非开关」依据 NN/g 的 layered disclosure（§2.2 同一篇）。

---

### T3 · 点赞 / 收藏 / 关注（⚠️ 需要人批准，最后做）

**为什么放最后**：这是**不可逆**的真实互动，而且是这个仓库唯一的封号面。

**落点**：
1. `lib/api.mjs` 新增 `like(aweme)` / `collect(aweme)` / `follow(secUid)`，**全部带 `dry` 参数**，默认 dry。
2. `lib/budget.mjs` 加三个渠道 **+ 分钟级限流**（这是新增能力）：

```js
CHANNELS += ['like', 'save', 'follow']
perDay:    { like: 30, save: 10, follow: 5 }
perMinute: { like: 3,  save: 2,  follow: 1 }   // ← 新增，现在只有 perHour
minGapSec: { like: 20, save: 30, follow: 60 }
```

**为什么必须有 perMinute**：平台的频控是**分级惩罚**的 —— 秒级超限只是报错，
触发分钟级要停 5 分钟，触发日级当天就用不了。

> 巨量引擎《频控限制》：「触发秒级频控则会报错…触发分钟级或天级频控后，将会引发惩罚机制」；
> 分钟级「5 分钟后自动恢复」，天级「第二个自然日可自动恢复」。
> https://open.oceanengine.com/labels/12/docs/1699633682588749

现在 `budget.mjs` 只有 `perHour`，一小时 6 条你可以 6 条连着发完 —— 这在点赞上是危险动作。

**验收**：先 `dry` 跑一遍打印计划；`node tools/check.mjs` PASS；`tests/budget.test.mjs` 加一条
「同一分钟内超 perMinute 必须拒」。

**⛔ 门禁**：改 `budget.mjs` 的额度数字前，必须拿到人的一句"可以"。没有就停在 `dry`。

---

### T4 · 界面：8 区 → 3 区 + 更多

**落点**：`client.js` 的 `VIEWS`（现 9 项）→ 一级 3 项 `['picks','待办','今天']` + 「更多」二级面板
`['自主','设置','刷视频','额度','后台','趋势']`。**只有两层，不许第三层**（§2.2）。

同时三件小事，都是「恰到好处」的减法：

1. `[data-dys-view] > *` 现在是 `max-height:min(72vh,640px); overflow:auto` —— **只设上限没设高度**，
   导致卡片内滚 + 页面也滚，切 tab 时整页高度跳。改成给容器 `min-height` 固定值，去掉内层 `overflow:auto`。
2. 卡片加 `data-kind="list|form|metric"`，三种各自定 `padding` / 行高 / 间距。
   现在 9 种不同的东西共用 `padding:15px 17px`，这是"密度不稳"的根。
   间距按 Geist 的三步节奏：**组内 8px，组间 16px，板块间 32px**（出处同 §2.3）。
3. tab 上带角标：待办=几条要回，挑=几条新。**有数字才高亮，没数字就安静。**

**验收**：`node tmp/preview/shot.mjs panel-b29.png` 出图；肉眼过五条自检（见 §6）。

---

### T5 · 「一天刷几轮」真的按轮次跑

**现状**：`settings.rounds` 只传给 `feed --rounds`，那是**翻页深度**；一天刷几次没人管。

**落点**：新建 `lib/schedule.mjs`（≤80 行）纯函数：

```js
export const dueRounds = ({ now, perDay = 3, window = ['00:30','08:30'], doneToday = 0 }) => ({
  due: true, round: 2, why: '第 2 轮，距上一轮 4 小时',
})
```

挂在 `lib/duty.mjs` 已有的 `beat()` 上（`setInterval` 在第 268 行），**不要引 cron 依赖**，仓库零依赖是硬规矩。

**验收**：`tests/schedule.test.mjs` ≥8 例（跨午夜窗口、窗口外不跑、doneToday 满了不跑）。

---

### T6 · 事件驱动：私信来了才醒（可选，最后）

**现状**：每 N 分钟轮询一次，贵且慢。
同类插件 `dsh-douyin-watch` 的做法是**新消息唤醒 agent**：
https://findharness.com/plugins/miqian-nomad-dsh-douyin-watch

**落点**：`index.js` 的 tick 里先做一个**便宜的检查**（未读数），非零才启动完整流程。
不新增依赖、不新增常驻进程。

---

## 5. 禁区（违反任何一条，这一轮就是白干）

| 禁区 | 原因 |
|---|---|
| `lib/publish-*.mjs` | 要真 Chrome + 真页面才能验；选择器失效只能靠真机发现 |
| `lib/im-send.mjs`、`/dm/send`、`/queue/retry` | 发出去撤不回来 |
| `lib/budget.mjs` 的额度数字 | 改错不是"不好用"，是掉登录或封号。**需人批准** |
| `index.js` 的 `loadHostDeps()` / `ctx.tools.register()` / `ctx.webServer.register()` | 宿主 API 没文档，猜错 = 插件整个不激活 |
| 任何新 npm 依赖 | 零依赖是这个仓库活了 28 个版本的原因 |
| 任何 >200 行的重构 | 上下文成本最高、回归面最大、收益最不确定 |

---

## 6. 「恰到好处」的五条自检（改完界面必答）

1. 两秒内能不能说出"现在该干哪件事"？说不上来 = 没焦点。
2. 切 tab 时页面高度跳不跳？跳 = 骨架没定。
3. 有没有第二个滚动条？有 = 高度没定。
4. 把文案说明全删掉，界面还成立吗？不成立 = 靠文案撑。
5. 随便删一个元素，体验变差了吗？没变差 = 它是多余的（§2.1）。

---

## 7. 验收总表

| 任务 | 命令 | 通过标准 |
|---|---|---|
| T1 taste | `node tools/check.mjs` | PASS；测试 ≥293 例；空输入输出全空 |
| T2 notify | 同上 | PASS；`calledToday=2` 必拒 |
| T3 互动 | 先 `--dry`，再 `check.mjs` | PASS；分钟级超限必拒；**有人批准** |
| T4 界面 | `node tmp/preview/shot.mjs panel-b29.png` | 出图 + §6 五条全过 |
| T5 轮次 | `node tools/check.mjs` | PASS；跨午夜窗口有测试 |
| T6 事件 | 连续 24h 日志对比 | 轮询次数明显下降，无漏回 |

体量超预算时：**显式改 `tools/check.mjs` 的 `BUDGET` 数字，并在注释里写理由**。
不要偷偷加行（这个仓库的规矩是"让它成为一次有意识的选择"）。

---

## 8. 出处清单

**设计**
1. NN/g《8 Design Guidelines for Complex Applications》 https://www.nngroup.com/articles/complex-application-design
2. NN/g《Progressive Disclosure》 https://www.nngroup.com/articles/progressive-disclosure
3. Vercel Geist 设计系统 `design.md` https://vercel.com/design.md ｜中文梳理 https://sotasync.com/reader/2026-06-20-vercel-design-system-geist
4. Dashboard 信息层级（status → context → diagnosis → detail） https://imdshakil.com/?p=3813

**注意力 / 通知**
5. Ohly & Bastin 2023, *J Occupational Health* 65(1):e12408（N=247 田野实验） https://academic.oup.com/joh/article/65/1/e12408/7243989 ｜PMC 全文 https://pmc.ncbi.nlm.nih.gov/articles/PMC10244611/
6. Mark, Gudith & Klocke 2008, *The Cost of Interrupted Work*, CHI '08（恢复需 23 分 15 秒）

**推荐 / 记忆**
7. Park et al. 2023, *Generative Agents*, UIST '23（记忆流 + 反思 + 三维检索） https://arxiv.org/abs/2304.03442

**同类开源项目（抄它们的哪一段，§1 那张表之外）**
8. `paopaojun/Douyin_Curation_Assistant` —— 刷与动分离、候选库、创作者画像、浏览器实验室
   https://github.com/paopaojun/Douyin_Curation_Assistant
9. `dreammis/social-auto-upload`（16k★）—— 一行 CLI 发十平台、账号级 cookie 隔离
   https://github.com/dreammis/social-auto-upload ｜实测复盘 https://techmoon.xyz/?p=33325
10. `xpzouying/xiaohongshu-mcp`（16.8k★）—— 工具面含 **like / favorite / comment**，正好是 T3 的接口形状参考
    https://github.com/xpzouying/xiaohongshu-mcp
11. `NanmiCoder/MediaCrawler`（64k★）—— CDP 模式复用真实浏览器上下文
12. `miqian-nomad/dsh-douyin-watch` —— 事件驱动唤醒（T6）
    https://findharness.com/plugins/miqian-nomad-dsh-douyin-watch

**平台限制**
13. 抖音开放平台《OpenAPI 调用指南》：单接口默认 1000 次/分钟（**注意：这是开放平台 API，不是网页接口，只能当量级参考**）
    https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/tutorial/beginner/openapi-call-guide
14. 巨量引擎《频控限制》：秒 / 分钟 / 天三级惩罚，分钟级停 5 分钟，天级停到次日
    https://open.oceanengine.com/labels/12/docs/1699633682588749
