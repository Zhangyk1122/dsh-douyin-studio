# 面板与内部约定

> 从 README 拆出来的。改 `client.js` / `index.js` 之前该看的约定都在这里。
>
> 一句话：面板不是给人看的花架子，它是这套东西的仪表盘 —— 每条都对应一个真状态。

面板背后就这几条，全都只回 JSON。**改页面只动 `client.js`，别把逻辑写进前端。**

### 两条硬规矩（2026-11-02 审计后立的）

1. **子命令一律走 `lib/proc.mjs`（异步 spawn）**，禁止在请求路径上引入 `spawnSync` / `execSync`。
   原因：`/inbox` 超时给到 240 秒、实际也要十几秒，同步版会把整个 DSH 的事件循环按住，
   那十几秒里连静态资源都发不出去，页面就是「卡死」。实测数据见 `tmp/verify-proc.mjs`：
   同样跑一条 600ms 的子进程，同步版把定时器推迟了 682ms，异步版只迟到 5ms。
2. **所有请求先过 `lib/guard.mjs`**。这套接口没有 token，靠的是「只有本机页面会调」；
   但浏览器里任何网页都能往 127.0.0.1 发 POST，而这里有 `/dm/send`、`/queue/retry`、`/duty`。
   规则：`Sec-Fetch-Site: cross-site` 直接拒 → 没有来源信息放行（curl）→ 有 Origin 就比 Host。
   确实要从别处调，设 `DOUYIN_STUDIO_ALLOW_ORIGIN` 放行。
3. **慢接口先给缓存，再后台补**。`/inbox` 要走私信 + 通知 + 作品评论三条链路，十几秒；
   打开面板干等十几秒是不能接受的。所以磁盘上留一份上次的结果
   （`~/.dsh/douyin-duty/inbox-cache.json`），过期就**先答再改**：
   立刻把旧的给前端，同时后台跑一轮，前端看到 `cache.refreshing` 就轮询、刷完自动换。
   - 判定全在 `lib/cache.mjs`：`decideCache()` 只回答「这次的缓存算冷/新/旧」，
     `serveInbox()` 负责「要不要等」。**改缓存策略只动这两个函数，别写进路由。**
   - `cold`（没缓存 / limit 变了）才等 —— 也就是**只有第一次打开慢**。
   - 同一时刻只允许一轮在飞（`inboxTask` 单飞），连点刷新不会变成对抖音连打三枪。
   - 失败**不覆盖**缓存：一份 2 分钟前的真实列表，比一份「刷新失败后的空结果」有用。
   - `?fresh=1` 才等真结果 —— 发完私信要看自己那条时走这条。

| 方法 | 路径 | 干什么 |
|---|---|---|
| GET | `/config` | 端口、每天回评上限、盯私信/值班开关 |
| GET | `/status` | 我是谁 + 今日额度（带登录 cookie 真查一次） |
| GET | `/doctor` | 环境体检 |
| GET | `/snapshots` | 登录态快照列表 |
| GET | `/dm?limit=8` | 私信会话列表，**每条带 `unread`，顶层返回未读总数** |
| GET | `/dm/read?uid=` | 某个会话最近 15 条 |
| POST | `/dm/mark-read` | 记「这个人的会话我看到了 last_at」——不写这一步，红点永远灭不掉 |
| POST | `/dm/send` | 发私信。第一次回 `needsConfirm`，带 `confirm:true` 才真发 |
| GET | `/ledger?n=` | 最近回了谁、为什么回 |
| GET | `/trend?days=` | 粉丝/总赞/作品数趋势 |
| POST | `/trend/save` | 记今天一笔 |
| GET | `/queue` | 失败重试队列（pending / dead） |
| GET | `/errors?n=` | **出错时间线**：队列死信 + 发布日志里的异常行 + 值班上一轮的 error |
| GET | `/duty` | 值班开关 + **上一轮结果**（扫到几条/挑中几条/是否自动回/错误） |
| POST | `/duty` | `{action:'start'|'stop'}` |
| GET | `/watch` | 盯私信状态 + 已见时间戳 |
| POST | `/watch` | `{action:'start'|'stop'}` —— 面板上的「开盯/停盯」 |
| POST | `/queue/retry` | 真去重放 pending。第一次回 `needsConfirm`，带 `confirm:true` 才动，一次最多 5 条 |
| POST | `/queue/clear` | 只清白名单之外的那批**死信**（试满 5 次的），pending 一律不动，需要 `confirm:true` |
| GET | `/publishes?n=` | **发布记录**：只读 `publish-log.jsonl` 里的 `RESULT` 行（散文日志不算） |
| GET | `/names` / POST `/names/refresh` | 昵称缓存 / 抄一次 |
| GET | `/login/qr` | 没登录时出一张二维码 |
| POST | `/snapshot` | 存一份登录态快照 |
| GET | `/inbox?limit=8` | **收件箱**：私信 / @我 / 自己作品下新评论，每条带 `worth/why/blocked` 和回它要用的 id |
| GET | `/budget` | 今天各通道用了多少、还剩多少、总闸多少 |
| POST | `/reply` | 回评论（顶层或楼中楼）。第一次回 `needsConfirm`，`confirm:true` 才真发；两道闸都在 CLI 里 |
| POST | `/comment-self` | 在自己作品下发顶层评论（同样两下确认） |
| POST | `/feed` | 刷视频（内容限定 + 去重），只读 |
| GET | `/settings` | 面板设置（含自主执行五个开关；带 `patch:true` 表示支持按字段保存） |
| POST | `/settings` | 合并式保存：只覆盖传进来的字段 |
| GET | `/autopilot` | 自主执行：开着什么、今天发了几个、**它最近自己做过什么** |
| POST | `/autopilot/run` | 跑一轮。`{dry:true}` = 演练（不生成不发送）；真做要 `{confirm:true}` |

### 自主执行（b20）：它自己干，人只定边界

这里**不是**"写一句话再点执行"。面板只回答三个问题：开不开、最多几条、内容从哪来；
具体回谁、回什么、发哪个文件，由 `lib/autopilot.mjs` 自己判断。

```
每 30 分钟醒一次 → runAll()      ← index.js:1155 AUTOPILOT.start({ everyMin: 30 })
  ├─ runDm()      读会话 → 过 inbox.judgeDm（该不该回）→ 生成 → 额度 → 发 → 记账
  ├─ runAt()      读「@我」→ 7 天内、有评论落点 → 生成 → 额度 → at-reply → 记账
  ├─ runPublish() 扫 publishDir → 按文件名取没发过的 → 额度 → publish（草稿或直发）
  └─ runReport()  到点给 ownerNick 发一条今天的账
```

> 间隔是 `30` 分钟，不是 `lib/autopilot.mjs:530` 那个默认值 5 —— 那个默认值只给
> 自己调 `start()` 的人用，宿主启动时显式传了 30。改这里要同时改 `index.js:1155`。

护栏（写死，不开放给面板）：

- **默认全关**。`settings.json` 里五个布尔（回私信 / 回评论 / 回 @ / 发作品 / 报平安）没打开，一条也不会发。
- 每条都过 `lib/budget.mjs` 的额度闸，额度没了整轮停。
- 同一条私信只回一次：`autopilot-state.json` 里 `replied[peer] = 最后回过的消息时间`，
  **每发一条就落盘**（进程重启也不会重复发）。
- 连续失败 2 次的人先放弃（`tries`）。
- 认不出昵称就不发：先抄一次 `/chat` 补名字，补不到就跳过——**不按 uid 猜人**。
- 静音时段（`quietFrom/quietTo`）不主动发；回评论 / 回私信 / 回 @ / 发布都在谷时窗口内（见上）。
- 「演练一轮」是 dry：不生成、不发送、不记账，只列出它会怎么做。
- **每天投递**：`sharePerDay`（默认 2，0 = 不发）每刷一轮从筛选结果里挑**一条**，用**分享卡片**私信发给 `ownerNick`，再补一句「为什么想给你看」；`atPerDay` 走评论区（在那条视频下 @ 你）。两条路分开计数，落在 `~/.dsh/douyin-studio/notify-state.json` 的 `{day, share, at, sent[]}`，跨天清零；`sent[]` 记的是今天叫过的 aweme_id，避免同一轮轮都被同一条霸榜。老的 `digestAt` / `digestPerDay` **已经删了**（见 `lib/settings.mjs:64`）—— 现在没有「到点投递」这回事，投递跟着刷视频的节拍走。同样受静音时段与额度闸约束。
- **主人号免限**：`ownerUid` 填了之后，那一人不吃「同一人每天 2 条」（日总量 / 小时 / 间隔 / 同楼照旧）。
- **口吻**：`persona`（设置页「人设（你谁）」，≤200 字）就是喂给模型的「你是谁」，回私信 / 回 @ / 回评论都读它；
  `botName` 决定报平安的标题（`<botName>日报`，留空就叫「日报」）。两个都留空 = 中性口吻，
  不会带任何别人预设的角色——**2026-11-04 之前这三处写死了同一个角色**，别人装上会用别人的口吻说话。

状态文件：`~/.dsh/douyin-studio/autopilot-state.json`（`replied` / `done` / 日志最近 20 条）。

### 面板的设计规矩（b13 定的，改 `client.js` 之前先看）

这些不是审美偏好，是为了别退回「一屏六个按钮一样重、六张卡各一条彩线」：

1. **一屏最多一个实心主按钮**（`primary`）。现在只有「回一条」是。开值班 / 刷一批 / 出二维码一律描边次级。
2. **颜色只承担语义**：绿=正常、琥珀=该看一眼、红=真坏了、蓝=能点。**不要给卡片加装饰性彩色边线** —— b12 每张卡顶一条，六种颜色，全是噪音。
3. **状态用「圆点 + 中性文字」**（`Pill`），不要彩底彩字、也不要彩框彩字。
4. **卡片只有两级**：主卡 `data-lead`（收件箱），其余同款。分级靠背景和标题字号，不靠边框颜色。
5. **调试信息进「诊断与版本」抽屉**（CDP 端口 / uid / 上限）。`b<N>` 留在摘要行 —— 刷新后对不上就是吃了缓存。
6. **空状态要给下一步**（`Empty` 的 `action`），不要只陈述「还没刷过」。
7. **卡片标题永远不缩、不换行**（b19 补的）：`[data-dys-title]` 必须 `flex:0 0 auto` + `nowrap`，
   右上工具区放不下就整体掉到下一行。b18 的「动作」卡因为标题没有这两条，被四个按钮压成了竖排的「动 / 作」，
   按钮还顶出了卡片边框 —— 这类"挤出去"不是配色问题，是 `flex-basis` 问题。
8. **配置类卡片里不要放"让人替它写内容"的输入框**（b20 立的）：回什么、发哪个由它自己判断，
   面板只留开关 + 数量 + 路径。所以在「自主执行」里看不到"发给谁 / 说什么"——
   看到那两个框就说明又退回成手动工具了。
9. **图标只做参照，不做装饰**：`Ico` 是内联 stroke SVG（零依赖、跟 currentColor），
   统一 22×22 软底方块；只有主卡那一个用强调色，避免出现第二个视觉焦点。
10. **参数框失焦才提交**（`MiniField`）：每敲一个字就 POST 会被服务端回写覆盖，
    输 `21:30` 会变成 `2`。这类 bug 只在真打字时出现，预览截图看不出来。

顺手记一个坑：`/errors` 回的是 `{at, kind, text, detail}`，**不是** `{stage, message}`。
b12 读错字段，所以「出错记录」永远显示一个空白的 `error`；b13 才修。

**「今天做了什么」怎么切档**：默认只看今天（按本机日期过滤），右上角「历史」翻出全部，再点回「只看今天」。
三个账本一次取够（`/ledger?n=40`、`/publishes?n=30`、`/errors?n=20`），切换是**纯前端过滤**，
不额外发请求，也就不会多出一种失败态。跨天的行会补 `月/日` 前缀 ——
否则昨天 23:41 会混在今天的 22:xx 里，看着像排错了序。

状态文件都在 `~/.dsh/douyin-duty/`：`watch-state.json`（盯私信）、`duty-state.json`（值班上一轮）、
`dm-read.json`（已读标记）、`queue.json`（重试队列）、`trend.jsonl`（趋势）、`dm-names.json`（昵称）。
消息预算单独在 `$DSH_HOME/douyin-studio/budget.json`（`{day, entries:[{ch,at,peer,thread,note}]}`），
`DOUYIN_STUDIO_LIMITS` 可以整张盖掉，`DOUYIN_STUDIO_HOME` 换目录。
`feed-seen.json` 记刷过哪些视频（保留最近 800 个 id，免得一直推同一条）。
`lib/publish-log.jsonl` 是发布日志，`/errors` 会读它。

