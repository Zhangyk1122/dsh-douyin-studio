# dsh-douyin-studio

一个跑在 [DeepSeek Harness](https://github.com/deepseek-ai) 里的抖音工作台：看作品、评论、私信、通知，
回评、发图文和视频、盯私信、看数据趋势——全部走**你已经登录的浏览器**，不碰账号密码，也不用开放平台。

一套 core，两层入口：**DSH 工具**（`douyin_studio_*`）和**命令行**（`node tools/dy.mjs …`）。

> ## 先读这一段（风险与定位）
>
> **它是给单个账号、私人在自己的机器上用的工具，不是给陌生人批量运营的服务。**
>
> - 它**驱动你真登录着的浏览器**：发出去的话、点掉的发布、删掉的评论，都是真的、撤不回来。
> - 抖音没有给这种用法发许可证。自动化操作**可能触发风控**（限流、验证码、临时封禁），
>   风险由使用者承担；出问题时唯一的急救是**立刻停手**（见下面「停损」），不是重试。
> - 自主执行（自己回私信 / 自己发作品 / 盯私信）**默认全关**。要开，请先看清楚每一行开关
>   管的是什么，并且从 `draft` 起步。
> - 别拿它做刷量、刷评、多账号矩阵、代运营别人的号。这些不在设计里，也不在支持范围里。
> - 代码里所有"最后一下"都留了闸：`confirm: true`、`--publish`、首次发布先 `dry`、额度与去重。
>   **别为了让流程跑顺就绕过它们** —— 那是这套东西唯一的安全边际。

## 安装

```bash
# 1) 应用内：设置 → 插件 → 市场 → 搜 dsh-douyin-studio → 安装（上架后可用）
# 2) 命令行，直接从 GitHub 装（现在就能用；profile 名换成宿主实际用的那个，桌面版通常是 desktop）
dsh plugin --profile desktop add "dsh-douyin-studio@github:dbbdbdhdbxb-design/dsh-douyin-studio"
```

仓库：https://github.com/dbbdbdhdbxb-design/dsh-douyin-studio

装完重启宿主，设置页会多一个「抖音工作室」。首次使用：面板里扫码登录 → 设置里填主人 `ownerUid`
→ 跑 `node tools/dy.mjs doctor` 确认 `cdp up`。默认只读，不自动刷、不自动回。

上架 / 发布流程见 [docs/PUBLISH.md](docs/PUBLISH.md)。

## 装

前提：Windows + 一个登录着抖音的 Chrome/Edge + DSH。

```bash
# 装进某个 profile（desktop / web / 你自己的名字都行）
dsh plugin --profile desktop add "dsh-douyin-studio@github:dbbdbdhdbxb-design/dsh-douyin-studio"
```

装完**重启 DSH**（`index.js` 是启动时加载的；`client.js` 改完刷新页面就生效）。
设置页在「插件 → dsh-douyin-studio」，底部会显示 `诊断与版本 · b<数字>`。

想先不改 profile、直接试命令行：

```bash
git clone https://github.com/dbbdbdhdbxb-design/dsh-douyin-studio.git
cd dsh-douyin-studio
node tools/dy.mjs doctor        # 环境体检：浏览器 / CDP / 登录态 / 额度
node tools/dy.mjs status        # 我是谁 + 今天还能发几条
```

## 第一次用

1. 先在**你自己的浏览器里登录抖音**（插件不会问你要密码，它只是接管这个 profile 的标签页）。
2. `node tools/dy.mjs doctor` —— 这一步会把「找不到浏览器 / 端口被占 / 没登录」分开告诉你。
3. 想真发东西时加 `--publish`；不加就只填好不点，最后一下留给人。

## 安全边界（重要）

- **不存密码、不存 cookie 到库里**：登录态只活在浏览器 profile 里。
- **默认只存草稿**：`publish` 不带 `--publish` 就停在发布页；`--who` 默认 `private`。
- **每天有上限**：发布 5、评论 20、私信 15、@ 10、自己作品下 5，小时级还有更细的闸（`lib/budget.mjs`，别改）。
- **删除不可撤销**：`delete` / `delcomment` 只认完全匹配且唯一命中，删之前先 `--dry` 看一眼。
- **首跑必须 dry**：新机器第一次 `publish` 只能 `dry`，跑通一次才解锁真发（`$DOUYIN_STUDIO_HOME/first-run.json`）。
- **声明必填**：真发/存草稿必须给 `declare`（一般 `ai`），真发不许 `none`。

### 停损（出事就按这个）

任何一个写操作都可以被一个文件全局挡住：

```bash
node tools/dy.mjs kill on  --reason "风控提示 1200"   # 立刻停
node tools/dy.mjs kill status                        # 看现在停没停、为什么
node tools/dy.mjs kill off                           # 确认安全再解除
```

等价于在 `$DOUYIN_STUDIO_HOME/KILL` 放一个文件（内容 `{"at":"…","reason":"…"}`）。
开着的时候：回评 / 私信 / @ / 分享 / 发布 / 删除 / 队列重试一律拒；只读动作不受影响。
DSH 里对应工具 `douyin_studio_kill`，面板上同一个开关读的是同一份文件。

## 它和 dsh-douyin-scroll 的区别

那边是「值班链路 + 设置页 + 一堆历史脚本」；这边只做**干净的三层**：

| 层 | 文件 | 干什么 |
|---|---|---|
| 引擎 | `lib/cdp.mjs` | 唯一碰浏览器的地方（找 Chrome、起窗口、连 CDP、认标签页） |
| 引擎 | `lib/api.mjs` | 站在已登录的 `www.douyin.com` 里 fetch（页面自带 cookie 与签名） |
| 引擎 | `lib/ledger.mjs` | 回评额度 + 三重去重 + 「为什么回」 |
| 引擎 | `lib/publish.mjs` | 发布菜谱：本地先挡错，再交给 CDP 流程 |
| 引擎 | `lib/publish-cdp.mjs` | CDP 会话（连页面/求值/等条件/填字/点坐标），一步都不猜 |
| 引擎 | `lib/publish-steps.mjs` | 发布十步：每一步单独可测，返回 `{ok, why}` |
| 引擎 | `lib/im.mjs` | 私信读：纯 HTTP + 只解必要 protobuf 字段 |
| 引擎 | `lib/publishes.mjs` | 发布记录：只认日志里的 `RESULT` 行 |
| 引擎 | `lib/unread.mjs` | 未读标记：只往前走，不给假条数 |
| 引擎 | `lib/errors.mjs` / `lib/lock.mjs` | 错误分五类 / 同一时刻只许一个 CDP 操作 |
| 菜谱 | `tools/dy.mjs` | 一条命令跑完一串 |
| 工具 | `index.js` | 只做参数整形 + 起子进程 + 解析 JSON |

**为什么工具只起子进程**：同一套逻辑必须能脱离 DSH 直接跑（半夜在终端里排障），
不能只活在插件里。所以参数、额度、去重全在 `lib/`，CLI 和工具共用一份。

## 命令行

```bash
node tools/dy.mjs doctor                      # 环境体检（CDP / profile / 标签页 / 额度）
node tools/dy.mjs status                      # 我是谁 + 今日额度
node tools/dy.mjs works --count 5             # 我的作品
node tools/dy.mjs detail --aweme <id>         # 单条详情
node tools/dy.mjs likes --count 5             # 我喜欢过的（空 = 可能设成私密）
node tools/dy.mjs notices --limit 10          # 通知：谁@我 / 谁回我 / 谁关注点赞
node tools/dy.mjs comments --aweme <id>       # 某条下面的评论（带楼根）
node tools/dy.mjs reply --aweme <id> --cid <cid> --text "..." --reason "..." [--root <楼根>] [--dry]
node tools/dy.mjs publish --img a.jpg --title "..." --desc "..." --who private --declare ai --publish
node tools/dy.mjs quick --video a.mp4 --text "第一行当标题，剩下的全是简介" [--publish]
node tools/dy.mjs latest --min 30 --n 5        # QQ 刚发来的图/视频落在哪（默认只认 30 分钟内）
node tools/dy.mjs digest [--dry]               # 每天给他私信发几条视频（条数/时间在设置里）
node tools/dy.mjs delete --title "标题"        # 标题完全匹配且唯一命中才删
node tools/dy.mjs ledger --recent 8           # 回了什么、为什么回
node tools/dy.mjs names --refresh             # 抄一次 /chat，把 uid→昵称 存下来（私信接口不给昵称）
node tools/dy.mjs cost                        # 今天/近几天花多少钱（同一份账本）
node tools/dy.mjs detail --aweme <id>         # 单条精确数据
node tools/dy.mjs likes [--count 20]          # 我赞过的（或别人的）
node tools/dy.mjs notices [--group like]      # 谁 @ 我 / 谁回了我
node tools/dy.mjs search --kw "大肥鱼" --count 3   # 搜视频
node tools/dy.mjs delcomment --aweme <id> --cid <cid> [--dry]   # 删自己的评论
node tools/dy.mjs check --img a.jpg           # 发布前本地查文件（不碰浏览器）
node tools/dy.mjs snapshot list|save|restore  # 登录态快照
node tools/dy.mjs dm [--limit 10]             # 私信会话（只读，纯 HTTP ~0.5s，不用第二个浏览器）
node tools/dy.mjs dm --to <sec_uid>           # 读和某个人的对话
node tools/dy.mjs dm --to "昵称" --text "…" --dry   # 发私信：只打字不发送
node tools/dy.mjs dm --to "昵称" --text "…"         # 真发（回车发送，发完用接口回读核实）
node tools/dy.mjs share --aweme <id> --to "昵称" --dry            # 分享卡片：只看找到的是谁
node tools/dy.mjs share --aweme <id> --to "昵称" --sec <sec_uid>  # 真发卡片（发完接口回读）

# 2026-11-01 新增五样
node tools/dy.mjs login whoami | qr         # 登录状态 / 出二维码（存成 douyin-duty/login-qr.png）
node tools/dy.mjs watch once [--loud]       # 盯一次私信，有新的弹 Windows 通知（静音时段默认不弹）
node tools/dy.mjs watch start --every 90 --for 3600   # 常驻盯一小时
node tools/dy.mjs duty collect              # 只看：我作品下还有谁的话没接
node tools/dy.mjs duty run [--auto] [--dry] [--max 2] # 值班跑一轮（--auto 才真回）
node tools/dy.mjs trend save | show         # 每天存一条号的数据，看涨跌
node tools/dy.mjs queue list | retry | clear# 失败重试队列（回评/私信/卡片）
```

# 2026-11-02 新增：收件箱 / 预算 / 刷视频 / 自己评论区
node tools/dy.mjs inbox [--limit 8] [--dm-only|--at-only|--own-only]
                                              # 该回什么：私信 / @我 / 自己作品下的新评论，
                                              # 每条带 worth（值不值得回）、why/blocked（为什么）、以及回它要用的 id
node tools/dy.mjs dm-send --to "昵称" --text "…" [--dry]   # 发私信（走消息预算，发完接口回读）
node tools/dy.mjs at-reply --aweme <id> --cid <cid> [--root <楼根>] --text "…" [--dry]   # 回 @我
node tools/dy.mjs comment-self --aweme <id> --text "…" [--dry]   # 在自己作品下发顶层评论
node tools/dy.mjs feed [--count 20] [--rounds 3] [--min-sec 5] [--max-sec 180]
                       [--allow 关键词,关键词] [--block 关键词] [--min-digg 100] [--mark-seen]
                                              # 刷视频：内容限定 + 去重，只读
node tools/dy.mjs budget [--recent 8] [--reset]   # 今天各通道还剩几条、最近发了什么
```

# 2026-11-14 补的命令（以前只活在 HELP 里、文档里查不到）

```bash
node tools/dy.mjs sticker list [--mood soft] [--tag 测试] [--limit 50]
node tools/dy.mjs sticker add --file a.png [--mood soft] [--tags 蓝,测试] [--name 名字]
node tools/dy.mjs sticker pick [--mood soft] [--tags …]     # 只看会挑哪张，不发
node tools/dy.mjs sticker use --id st_xxx                   # 记一次「用过了」（打分时避开最近发的）
node tools/dy.mjs sticker rm --id st_xxx                    # 删库里的（文件也删）
node tools/dy.mjs sticker collect [--count 8]               # 从评论区捞图入库（要登录态）
node tools/dy.mjs sticker send --uid <uid> [--id st_xxx | --mood … ] [--text 附言] [--dry]
                                              # 私信发一张图。走「塞给 React 的 onFileChange → 等确认框 → 原生 click 发送」
                                              # 三条都是真机上唯一能走通的路（2026-11-14 打通，见 CHANGES.md 0.7.5）
node tools/dy.mjs sticker stats                             # 库里多少张、各情绪几张

node tools/dy.mjs replies --aweme <id> --cid <楼根> [--count 20]   # 楼中楼（顶层评论接口拿不到这一层）
node tools/dy.mjs comment-at --aweme <id> --to "昵称" --uid <uid> --sec <sec_uid> [--text "…"] [--dry]
                                              # 在评论区真 @ 某人（text_extra type 必须是 0，多带 nickname 会被忽略）
node tools/dy.mjs comment-image --aweme <id> --file a.png [--text "…"] [--dry]
                                              # 评论带图：先点容器再找 contenteditable，然后塞图 + 回车
node tools/dy.mjs watchback [--limit 30] [--max 10] [--owner-only]
                                              # 谁回了我（通知 31/32 类，最容易被漏的一层），默认只看主人
node tools/dy.mjs risk [clear]                # 风控冷却状态 / 手动解除。退避 30→60→120→360 分，
                                              # 命中 352/412/2154/3002 这类码就自动进冷却

node tools/dy.mjs kill status | on [--reason "…"] | off     # 全局停损。开着时所有会发出去的动作一律拒
node tools/dy.mjs schedule [--days 7]         # 刷视频的排期（谷时窗口里怎么分轮）
node tools/dy.mjs unattended status | on | off [--from 01:00 --to 06:00 --per-day 2]
                                              # 无人值守发布。开了只是「允许」，真发还要过四道闸
node tools/dy.mjs engage status | plan | on --authors "A,B" | off
                                              # 主动互动灰度。白名单空 = 一条都不碰；同一作者一天只碰一次
```

**这几样的默认值**：盯私信**开**（插件启动 90 秒后自己开始跑）；值班**关**，自动回也**关**——
它自己会动手的事，默认得等人点头。

`snapshot save` **浏览器开着也能存**：它走 CDP 的 `Network.getAllCookies` 导出 `cookies.json`
（Chrome 96+ 的 Cookies 文件在 `Default/Network/` 下，且运行中被独占锁着，拷文件会 EBUSY）。
`snapshot restore` 开着浏览器就一条条 `Network.setCookie` 塞回去（实测 85/85 成功），关着才拷文件。

输出永远是**一行 JSON**（`ok` 字段一定有），失败也输出 JSON 且退出码 1。

## 五道闸（回评）+ 第二道总闸（所有出口）

1. 这条 `cid` 回过没有
2. 这个人今天回过几次（默认 2）
3. 这栋楼（`root_comment_id`）今天回过没有（一栋楼只回一次）
4. 总额度（默认 20/天）+ 每条视频「中午 5 + 晚上 5」
5. 账本坏了就 fail-closed（一律拒绝，宁可少回也不乱回）

回评、私信、@我、自己评论区**四类消息共用一份预算**（`lib/budget.mjs`），
另加日限 / 小时限 / 最小间隔 / 同一人每天 2 条 / 总闸 40 条/天：

| 通道 | 每天 | 每小时 | 最小间隔 |
|---|---|---|---|
| 回评论 | 20 | 6 | 45 秒 |
| 私信 | 15 | 5 | 60 秒 |
| 回 @ | 10 | 4 | 60 秒 |
| 自己评论区 | 5 | 3 | 30 秒 |
| 发布 | 5 | 2 | 120 秒 |

额度只写在账本里，不写在提示词里 —— 靠自律一定会重复回。

## 发布

本地先挡：标题超长（图文 20 / 视频 30）、`--at` 太近或超 14 天、`--who` 取值不对、
`--draft` 与 `--publish` 同时给、`--draft` 带定时。

然后：传文件 → 图文自动切「发布图文」 → 填标题/简介（**回读核实**，零宽字符不算写进去）→
可见性 → 自主声明 → 定时 → 点发布 → 回读核实。

不给 `--publish` / `--draft` 就只「摆好不点」，最后一下留给你。

### 从 QQ 发过来就走 `quick`

你在 QQ 里发「视频/图片 + 一段话」，那边先 `latest` 找刚落的文件，再：

```bash
node tools/dy.mjs quick --video "C:\Users\admin\.dsh\media\onebot\media_xxx.mp4" --text "文案原文"
```

标题取文案第一行（图文 20 / 视频 30 字，超了自动截），简介用整段原文；默认 `private` +
只存草稿，要真发再加 `--publish`，要公开再加 `--who public`。走的是同一套预算账本（发布 5 条/天）。

## 无人值守发布（默认关）与主动互动灰度

两件"没人盯着"的事。默认都是关的 —— 不是保守，是因为这两条一旦判错，代价是公开的。

**无人值守**：开了也只是"允许"。真发要同时满足四条，缺一条退回人工：

1. `settings.unattendedPublish === true`
2. 现在在 `unattendedFrom`–`unattendedTo` 窗口里（跨零点也认）
3. 今天自动发的条数 < `unattendedPerDay`
4. 首跑已经成功 dry 过，且总闸没开

```bash
node tools/dy.mjs unattended status
node tools/dy.mjs unattended on --from 20:00 --to 23:30 --per 1
node tools/dy.mjs publish --img "..." --title "..." --declare ai --auto --publish
```

自动发的每一条都落 `autopublish.jsonl`（日期、标题、声明、成败），额度按这份账本数。

**主动互动**：这一版**只出清单，不出手**。从已收集的候选里挑白名单作者的视频，
同一作者一天最多碰一次，整体不超过 `engagePerDay`，两条之间至少 `engageGapSec`：

```bash
node tools/dy.mjs engage status
node tools/dy.mjs engage on --authors "小A,小B"
node tools/dy.mjs engage plan      # 只打印"今天会碰谁"
```

真动作仍然走 `comment_at` / `share`，且必须 `confirm`。白名单为空 = 一条都不碰。

**后台作业**：一轮刷完是一个作业（`lib/jobs.mjs`），失败退避重试两次，每一步之前看总闸，
账在 `jobs.jsonl`；`dy.mjs jobs` 或 `douyin_studio_jobs` 能查"昨晚那一轮为什么没跑"。

## 什么时候才动（谷时窗口）

回评论、回私信、回 @、自主发布都要过模型 —— 所以它们只在 **DS 的谷时（默认 00:30–08:30）**
里跑，窗口外只读：

- `settings.activeFrom / activeTo`（`HH:MM`，两个都空 = 不限制；跨午夜如 `22:00`–`06:00` 也认）
- 窗口判断在 `lib/autopilot.mjs` 的 `inActive()`；`runDm` / `runAt` / `runPublish` 各自先查
- **回评论（值班）也看这个窗口**：`lib/duty.mjs` 自动轮次在窗口外直接 skipped；面板上
  点「开值班 / 现在跑一轮」是手动，不受时间限制（手动都拦，按钮就白点了）
- 窗口两个字段都空着时，值班退回原来的 09:00–23:00 礼貌时段
- 静音时段（`quietFrom/quietTo`）管的是「别在人家睡觉时发」，两个窗口互不替代
- 回 @ 另外记一笔 `aweme:cid` 到 `autopilot-state.json` 的 `at.replied`，回过的不会再回 —
  2026-11-03 12:46 和 12:51 同一句回过两遍，就是因为当时没记

## 配置

`apply(ctx, config)` 认这几个字段（都标了 `volatile`，设置页能改）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `cdpPort` | 9334 | 浏览器调试端口 |
| `profileDir` | 空 → `$DSH_HOME/douyin-duty/chrome-profile` | 登录资料目录 |
| `autoOpen` | true | 没窗口时自己起一个 |
| `perDay` | 20 | 一天最多回几条（会真的接到预算上，不再是摆设） |
| `keywords` | 空 | 刷视频的默认白名单（逗号分隔） |
| `blockKeywords` | 空 | 刷视频的默认黑名单 |
| `limitsJson` | 空 | 覆盖整张预算表（JSON，形如 `{"perDay":{"dm":10}}`） |

## 发布（publish-cli）现在能做什么

2026-11-02 全量真跑过一遍（真页面、不发出去），六项全绿：

| 步骤 | 状态 | 备注 |
|---|---|---|
| 标题 / 简介 | ✅ | 回读校验，字数上限 `视频30 / 图文20` |
| 背景音乐 `--dy-music` | ✅ | 搜关键词 → 点第一首 → 回读 chip，确认不再是「创作的原声」 |
| 本地 BGM `--bgm` | ✅ | ffmpeg 混流到 `lib/publish/bgm-mix-*.mp4` |
| 封面 `--cover` | ✅ | 点 `coverControl` 里的 `.cover-` → 塞图 → 点「完成」 |
| 谁可以看 `--who` | ✅ | 页面原话精确匹配（`仅自己可见` 少两个字就静默降级成公开） |
| 自主声明 `--declare` | ✅ | 入口是 `[class*=selectText]`，回读同一个框 |
| 定时 `--at` / 草稿 `--draft` | ✅ | |
| 真点发布 `--publish` | ✅ | 2026-11-02 真发过一条（仅自己可见），内容管理页回读确认；**会真发出去**，默认不给这个开关 |

**步骤顺序是排过的**：`标题 → 简介 → 音乐 → who → 定时 → 声明 → 封面`。
封面必须排在最后 —— 它会拉起一个编辑面板盖住整页，排在前面时一卡就让后面几步全部假失败。

### 三个只在真机上才看得见的坑（改代码前先读）

1. **`el.click()` 和合成 PointerEvent 在这页没用**，只有 `Input.dispatchMouseEvent` 真鼠标能开面板。
2. **封面的「完成」按钮不在任何 `[class*=modal]` 容器里**（它在 `.buttons-BoCvr4`），
   所以搜索范围必须放全文档，锁在弹层 root 里永远找不到。
3. **点完「完成」不能立刻按 Escape** —— 面板本来会自己淡出，这时补一个 Esc 会把刚设好的封面取消掉，
   页面又变回「横/竖双封面缺失」。

## 已知边界

- 回评走**网页接口**（站在页面里发），不是官方开放平台；风控由页面自己处理，我们不拼签名。
- 发布走 **CDP 点真页面**，比接口糙，但稳定、可核实。
- 视频的转码慢，`--video` 一次只能一条。
- 封面的编辑器会加载 `summon.bytedance.com` 的跨域 iframe，主文档读不到它的 DOM ——
  我们只点主文档里的「完成」，所以那条 iframe 里的高级编辑（裁剪框位置等）用不了。

## 设置页的数据接口（`/api/douyin-studio/*`）

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

## 收件箱怎么判「该不该回」

规则在 `lib/inbox.mjs`，纯本地分数，不花接口钱：

- 最后一条是**我**发的 → `waiting`，不回（人家还没接话）
- 只有表情（`[送心]` 这类先剥掉）、或昵称像官方/助手的系统话术 → 不回
- 超过 72 小时没动 → 不回
- 问句 +30、有实质内容 +10、6 小时内 +30 / 今天 +15、第一次私信 +10
- ≥20 分算「值得回」，≥50 分标 `high`

改规则先跑 `node tests\inbox.test.mjs`。

## 测试

```
node --test tests\*.test.mjs
```

**73 个文件、708 例**（2026-11-14 实测：`node --test` 全绿 8.1 s）。

分层的：
- `publish-steps` `publish-seam` `publish*`：发布链的接缝，不碰真页面
- `budget` `guard` `cache` `proc` `inbox` `unread` `ledger-broken` `fsx`：账本、额度、并发、缓存
- `autopilot` `autopilot-io` `settings` `feed` `policy` `export*` `engage` `risk` `sticker-send`
  `comment-image` `invite` `watchback` `frames` `mention`：后加的能力，一份一个

全部是「本地逻辑」的测试——**它们绿灯不代表发布成功**。
其中两条是防回退的：`proc` 的并发用例（谁把 `run()` 改回同步它就红）、
`cache` 的 stale 用例（谁把「先答再改」改成 await，它就红）。
发布那部分只有真页面跑一遍才算数（见上面「发布」那节）。

⚠️ 在 DSH 沙箱里 `node --test` 会 spawn EPERM（禁止管道式子进程），要一个一个文件跑：
`node tests\budget.test.mjs`。

`publish-seam` 专门盯「接缝」：不许 `import 'ws'`、WHO_MAP 必须是页面原话、
日志不许写到不存在的目录、`.map(resolve)` 这种参数错位、`--no-shot/--reupload` 还在不在。
它挡的是**跨版本重写时最容易掉的零件**，不是功能本身。