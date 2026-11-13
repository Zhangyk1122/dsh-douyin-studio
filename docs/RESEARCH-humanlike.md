# 调研：让人「像真人」的开源项目 —— 机制清单与可落地项

> 2026-11-13。星标/许可证/推送时间取自 GitHub REST API；功能点取自各仓库 README / awesome-ai-companion 目录原文。
> 标「未验」= 只读了描述，没跑过。

## 0. 结论先说

「像真人」拆开是六件事，不是一件事：

1. **有情绪**（valence/arousal + energy，会衰减，不是每轮重算）
2. **有自己的日程**（今天想干嘛、几点困、什么时候不想说话）
3. **会主动开口**（有理由才说，不是定时群发）
4. **记得住人**（事实 → 情节 → 遗忘曲线，不是全量塞提示词）
5. **有关系深浅**（对常来的人和对陌生人，语气不同）
6. **有感知**（看过这条视频、听过这段语音的语气）

我们的缺口在 1、2、4、5；3 有半套（aurabot 的 speakup 没搬过来）；6 有一半（热评读了，视频没看）。

## 1. 情绪与状态机

| 项目 | 数据 | 机制（原文要点） | 借什么 |
|---|---|---|---|
| [Ombre-Brain](https://github.com/P0luz/Ombre-Brain) | 1546★ MIT 2026-11-06 | 长期情绪记忆：**valence/arousal 打标**、Obsidian 兼容 Markdown、**遗忘曲线**、vector+BM25 召回 | ①情绪二维打标；②遗忘曲线的衰减函数（比我们「30 天降权」更细） |
| [Shikigami-Protocol](https://github.com/Shikigami-Lab/Shikigami-Protocol) | 19★ **AGPL** 2026-11-01 | **emotion × energy × affinity 三套状态机** + 记忆管线 + 后台反思 + 沉默后主动开口；自称「persona bones，不是 prompt」 | 三状态机**分开建模**（情绪≠精力≠亲密度）——这一点比我们现在的 mood 单值强；AGPL 只借结构 |
| [Persisto-Mate](https://github.com/m-rui001/Persisto-Mate) | 5★ MIT 2026-10-18 | **确定性 Plutchik/PAD 内核** + 外部裁判模型读每轮对话 + **学会的身体时钟（睡眠/做梦）** + ACT-R 记忆 | ①「裁判模型」给每轮打情绪分（我们可用 cheap 模型或规则）；②身体时钟：几点困、几点醒 |
| [Aura](https://github.com/gqy20/Aura) | 10★ 无许可 2026-10-19 | 跨会话记忆 + **情绪状态机** + **关系深化模型** + 健康数据 | 关系深化：亲密度只升不降会因为一次争吵失真，要有「降温」 |
| [kin-mind](https://github.com/mycyg/kin-mind) | 29★ MIT 2026-11-12 | 记忆/情感/**欲望** OS；**心跳时允许写日记、探索或休息**；情绪自然衰减 | 「心跳里可以什么都不做」——这条最像人：不是每次 tick 都必须产出 |

**落地**：`lib/mood.mjs` 用 `{valence:-1..1, arousal:0..1, energy:0..1, affinity:0..1}` 四值，事件驱动 + 每小时衰减；`affinity` 按「他回过我几次 / 我回过他几次 / 间隔」算，不按时间涨。

## 2. 主动开口 / 心跳

| 项目 | 数据 | 机制 | 借什么 |
|---|---|---|---|
| [astrbot_plugin_proactive_chat](https://github.com/Pancakes-Labs/astrbot_plugin_proactive_chat) | 535★ AGPL 2026-11-13 | 私聊+群聊主动消息：上下文感知、持久化、**动态情绪**、**免打扰时段**、TTS | 免打扰 + 「先看最近有没有人说话」两个门槛 |
| [astrbot_plugin_private_companion](https://github.com/menglimi/astrbot_plugin_private_companion) | 401★ AGPL 2026-11-12 | 连续拟人状态、**每天生活日程**、重要日期、日记、**低频**主动消息；60+ 功能 | 「低频」是重点：主动消息的价值在少，不在多 |
| [Headlong](https://github.com/laude-institute/headlong) | 未查 | 递归 LLM 的**内心独白循环**，持续思考流 + 主动触达 | 内心独白：每 N 分钟写一句「我现在在想什么」，作为主动开口的原料 |
| [N.E.K.O](https://github.com/Project-N-E-K-O/N.E.K.O) | 3228★ Apache-2.0 2026-11-13 | 陪伴 agent：实时语音视觉、长期记忆、Live2D/3D、**社交拜访**、插件市场 | 插件市场形态 + 「社交拜访」概念（她去别人主页逛） |

**落地**：`lib/speakup.mjs` 抄 aurabot 的判断（命中话题/冷场/有理由），加三条：①每天 1–3 次；②免打扰 0–8 点；③**说之前先读 5 条最近的评论**，避免自说自话。

## 3. 记忆：分层、复盘、遗忘

| 项目 | 数据 | 机制 | 借什么 |
|---|---|---|---|
| [generative_agents](https://github.com/joonspk-research/generative_agents) | 22375★ Apache-2.0 2024-08 | **memory stream + reflection + planning** 三段式；重要性打分后召回 | 反思：把 N 条事件压成 1 条「我最近好像…」，我们现在只有 diary |
| [Serein](https://github.com/Yinglianchun/Serein) | 未查 | 聊天模型写 **Scenes**、摘要模型写 **Events**，都绑**逐字证据**；rerank 后再召回 | 「每条记忆必须指向原句」——防编造，比我们现在只存文本强 |
| [Memory Constellations](https://github.com/ClaraShafiq/MemoryConstellations) | 未查 | 事实 → 主题星座 → 叙事情节，三层 | 「情节」层：一周里关于某个人的 3 件事合成一段 |
| [Paramecium](https://github.com/Shitsuten/paramecium) | 未查 | **逐字聊天是真相，向量只做索引**，召回原文不召回摘要 | 我们现在 diary 就是摘要，容易越传越歪 |
| [Pawwake](https://github.com/garan0613/pawwake) | 未查 AGPL | fragment / event / core 三层 + 可审阅的合并草稿 | 「合并草稿」= 人可 veto 的记忆合并 |
| [kiwi-mem](https://github.com/LucieEveille/kiwi-mem) | 349★ 2026-10-09 | 向量 + **记忆热度** + **梦境巩固** + 日历层级摘要 | 热度 = 被召回次数；冷记忆进「梦」里再压一次 |
| [cognee](https://github.com/topoteretes/cognee) | 33286★ Apache-2.0 | 通用 agent 记忆平台 | 太重，只借「小模型也能做记忆」的结论 |

**落地**：`lib/episodes.mjs` 每周一次把事件压成 3 条情节（绑 `eventId` 证据）；`contacts.json` 加 `heat`（被召回次数），30 天未命中降权；diary 保留原文摘要但 `ref` 指回事件 id。

## 4. 关系 / 亲密度

- [Aura](https://github.com/gqy20/Aura)：关系深化模型（阶段 + 事件驱动）
- [Phosphene](https://github.com/3lmglow/Phosphene)：任务 + 积分 + 连续天数（把「一起做的事」变成关系资产）
- [shared-page](https://github.com/KKarsyline/shared-page)：共享日历 + 便利贴 + 互相点赞

**落地**：`affinity` 影响三处——称呼、回复长度上限、主动开口概率；不做数值展示（展示就变成游戏化，不像人）。

## 5. 感知（看/听）

| 项目 | 机制 | 借什么 |
|---|---|---|
| [gaze](https://github.com/jiangxi1129/gaze) | 截前台窗口 → 视觉描述 + OCR → 滚动 JSON | 桌面侧的「她在看什么」，与我们 dy 无关但同一思路：**先看再说话** |
| [cove-sensory-mcp](https://github.com/moonlin1213/cove-sensory-mcp) | 把图像/视频/音频路由到多模态 provider | 我们要「看视频」，缺的正是这层（vision key 仍待补充） |
| [ears](https://github.com/eveacla11/ears) / [ace-ears](https://github.com/menelly/AI_Ears) | 语音**相对基线**的音高/能量/停顿分析，输出「比平时小声」 | 如果我们做语音评论，语气比文字更重要 |

## 6. 像人的细节（没有现成项目，靠自己）

- 打字节奏：现在 `scanGap` 已随机，但**回复前的停顿**仍固定。可按字数估 2–6 秒。
- 「想说的多只挑一点」：已是人格卡规则。
- 「有时不回」：真人会漏看。可以给一个 3% 的静默概率（只在非 @ 场景）。

## 7. 不建议借

| 项目 | 原因 |
|---|---|
| Shikigami / astrbot 两个插件 / Pawwake 的**代码** | AGPL 传染，只能借结构自己写 |
| InstaPy 式自动关注、AiToEarn 式主动蹭热点 | 不像人（前面已重新裁定过：改成「有兴趣才点、有理由才说」） |
| 虚拟手机 / Live2D / TTS 整包 | 我们要的是「在抖音里像人」，不是再造一个客户端 |

## 8. 排进 PLAN 的顺序

| 顺序 | 模块 | 机制来源 | 预估 |
|---|---|---|---|
| 1 | `lib/mood.mjs`（valence/arousal/energy/affinity + 衰减） | Ombre / Shikigami / Persisto | 3h |
| 2 | `lib/purpose.mjs`（今天想干什么，三段日程） | private_companion / Persisto 身体时钟 | 2h |
| 3 | `lib/speakup.mjs`（低频主动开口 + 免打扰 + 先读评论） | astrbot proactive_chat / aurabot | 3h |
| 4 | `lib/episodes.mjs`（每周情节 + 证据链接） | Serein / Constellations / generative_agents | 3h |
| 5 | `contacts.heat` + 遗忘曲线 | Ombre / kiwi-mem | 1h |
| 6 | `affinity` 影响称呼与长度 | Aura | 1h |
| 7 | 看视频（vision，待 key） | cove-sensory / 现有热评 | 4h |
| 8 | 打字停顿 + 3% 静默 | 自建 | 0.5h |

前 6 项都不需要新依赖，全部落在现有零依赖结构里。
