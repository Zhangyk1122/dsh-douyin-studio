# 抖音工作室（douyin-studio）

一套抖音操作：看账号、看作品、看评论、回评、发图文/视频、删自己发的。

## 什么时候用哪个

| 想做 | 用 |
|---|---|
| **该回什么**（私信 / @我 / 自己评论区，带理由） | `douyin_studio_inbox`（先看这张表，再决定回哪条） |
| **今天各通道还剩几条** | `douyin_studio_budget` |
| 我是谁、今天还能回几条 | `douyin_studio_status` |
| 我有啥作品、数据怎么样 | `douyin_studio_works`（单条精确数据用 `_detail`） |
| 我赞过什么 | `douyin_studio_likes` |
| 谁 @ 我 / 谁回复了我的评论 | `douyin_studio_notices` |
| 私信：看会话、看聊天记录（只读） | `douyin_studio_dm` |
| 私信：发一句话 | `douyin_studio_dm` 带 `text`，**必须带 `confirm: true`**；只想试就 `dry: true` |
| 私信：走预算发（和面板同一条路） | `douyin_studio_dm_send` |
| 回一条 @ 我的评论 | `douyin_studio_at_reply` |
| 在自己作品下发顶层评论 | `douyin_studio_comment_self` |
| 刷视频（内容限定 + 去重） | `douyin_studio_feed` |
| 私信：把一条视频当卡片发过去 | `douyin_studio_share`（带 `confirm: true`，先 `dry: true` 看目标） |
| 这条视频下面谁说了什么（找靶子） | `douyin_studio_comments` |
| 回一条评论 | `douyin_studio_reply` |
| 发图文 / 视频 / 定时 / 存草稿 | `douyin_studio_publish` |
| 删一条自己发的 | `douyin_studio_delete` |
| 私信里的人都是谁 | douyin_studio_names（action=refresh 抄一次） |
| 今天回过谁、为什么回 | `douyin_studio_ledger` |
| 今天花了多少钱 | `douyin_studio_cost` |
| 号涨没涨（粉丝/总赞/作品） | `douyin_studio_trend`（`action: "save"` 记今天一笔） |
| 有失败要不要补 | `douyin_studio_queue`（`retry` 重放，试满 5 次标 dead） |
| 有人私信我了吗 | `douyin_studio_watch`（`once` 弹通知；静音时段只记不弹） |
| 评论区还有谁的话没接 | `douyin_studio_duty`（默认只收集不自动回） |
| 登录还在吗 / 出二维码 | `douyin_studio_login`（`qr` 存 `douyin-duty/login-qr.png`） |
| 按关键词找视频、找靶子 | `douyin_studio_search` |
| 删掉自己在别人视频下的评论 | `douyin_studio_delcomment` |
| 发布前本地查文件（尺寸/比例/大小） | `douyin_studio_check` |
| 登录态快照（存 / 列 / 还原） | `douyin_studio_snapshot` |

## 回评的正确姿势

1. 先 `douyin_studio_comments` 拿 `cid`，楼中楼再拿 `root_comment_id`
2. 想清楚**为什么回这一条**（会写进账本；事后能复盘「是不是见到谁都凑一句」）
3. `douyin_studio_reply`，参数：`aweme` / `cid` / `text` / `root` / `author` / `reason`
4. 不确定就先 `dry: true`，看看网关过不过

**别做的事**：同一个人一天超过 2 条、一栋楼回两次、拿视频 id 当楼根。
这三条工具都会拦，但拦下来别硬换参数重试。

## 收件箱的正确姿势

1. `douyin_studio_inbox` 先看 `worth: true` 的（`high` 是「人家在等一句正经话」）
2. 每条已经带好回它要用的 id：私信用 `uid`（`dm_send`），@我 / 自己评论区用 `aweme_id` + `cid`
   （楼中楼再带 `root_comment_id`）
3. **不要为了凑数回**——四类消息共用一个总闸（40 条/天），把额度花在真问题上
4. 判不判「该回」的规则在 `lib/inbox.mjs`，改之前先看 `tests/inbox.test.mjs`

## 发布的正确姿势

1. 图片用**绝对路径**（相对路径会把渲染进程挂死，踩过）
2. 标题：图文 ≤20 字，视频 ≤30 字（代码里就是这个数，别按页面上写的 55 填）
3. 想让人看到就给 `who: "public"`，自测一律 `who: "private"`，测完 `douyin_studio_delete`
4. AI 图要带 `declare: "ai"`（平台要求，也是体面）
5. 定时 `at` 只能用「2 小时后 ~ 14 天内」，格式 `"2026-11-05 20:00"`
6. 想留最后一下给自己：不给 `publish` 也不给 `draft`，它会摆好不点

## 出错怎么读

- `{"ok":false,"stage":"validate","errors":[...]}` → 本地就挡了，照 errors 改
- `{"ok":false,"stage":"quota","why":"..."}` → 额度/去重挡了，`retryAfter` 说什么时候再来
- `{"ok":false,"stage":"cdp",...}` → 真页面那一步炸了，看 `log`/`stderr`

`stage` 永远在，先看它就知道错在哪一层。
