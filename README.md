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

## 它和别的抖音插件不一样在哪

市场里叫 `douyin` 的有十几个。真正在做同一件事的只有一类：**在专用浏览器里刷抖音、边看边回**。
常见实现是解析页面 DOM（Playwright 驱动 Edge/Chrome，靠选择器和坐标点击）。这套做法能抽帧、能抓弹幕，
但也把「页面长什么样」变成了自己的命门 —— 抖音改一次 class，插件就瞎一次。

这个插件走的是另一条路：**直接调抖音网页版的接口**（`/aweme/v1/web/...`、私信 imapi protobuf），
只有「塞图进输入框」这种接口做不了的活儿才回到 DOM。差别如下：

| | 本插件 | DOM 解析派（如 `dsh-douyin-agent` 系） |
|---|---|---|
| 数据来源 | 抖音 web API（JSON / protobuf） | 页面 DOM + 真实鼠标坐标 |
| 推荐流遇到直播卡 | 不会：`aweme_type` 那层就滤掉了 | 会整轮停机（上游 issue #25） |
| 窗口最小化 / 拖到屏幕外 | 无影响：合成事件直接派发到元素 | 会话点不开（上游 issue #3） |
| 页面改版 | 接口字段变了才需要改 | 每个 class 名都是风险点 |
| 发送状态机 | 无持久水位；`unknown` 只停手不重试 | 一条不可核对的消息可让会话永久卡死（issue #6 / #17） |
| 抽帧故事板 / 弹幕 / 音频转写 | **没有** | 有（真播 + 逐秒抽帧 + 时间轴） |
| 读评论 / 带图评论 | 有 | 无（issue #26 在求） |
| 私信带图 / 表情包 / @ 提醒 | 有 | 无 |
| 风控码分级（352 / 412 / 2154 / 3002） | 有，冷却 30→60→120→360 分 | 未见 |
| 「到底看了没」 | `dy see` 把详情里的播放直链直接抽成 3×2 拼图（15 秒的片子 47 KB），**图是真的，描述仍要由看过图的人写**；没抽就是 `frames: false` | 真的播放并采样画面 |

一句话：**它不假装自己看过视频。** 抽帧是真的（`dy see`），但「画面里有什么」永远不由它编 ——
描述要么来自真的打开那张图的调用方，要么就承认没看，不拿封面凑。

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

## 命令行

44 条命令的完整用法（参数、真机坑、返回字段）→ **[docs/COMMANDS.md](docs/COMMANDS.md)**

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

## 它自己动的时候（默认都不动）

三件事 —— **无人值守发布**、**主动互动**、**自主回评** —— 都要先开闸，缺一条就退回人工。
所有会发出去的动作只在谷时窗口里跑（默认 `00:30–08:30`，`settings.activeFrom/activeTo` 可改），
窗口外只读；面板上手动点的那下不受时间限制，拦了按钮就白点了。

```bash
node tools/dy.mjs unattended status     # 四条闸分别是什么状态
node tools/dy.mjs engage plan           # 今天会碰谁（只出清单，不出手）
node tools/dy.mjs schedule --days 7     # 刷视频的排期
```

四条闸怎么判、额度账本、后台作业退避、静音与谷时的区别 → **[docs/AUTOPILOT.md](docs/AUTOPILOT.md)**

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

## 发布能力一览

标题 / 简介 / 背景音乐 / 本地 BGM 混流 / 封面 / 可见性 / 自主声明 / 定时 / 草稿 —— 九项都在真机上跑通过，
2026-11-02 真发过一条（仅自己可见）并回管理页回读确认。默认**不给** `--publish`，点发布必须显式要。

步骤顺序是排过的：`标题 → 简介 → 音乐 → who → 定时 → 声明 → 封面`。封面必须排最后 ——
它会拉起编辑面板盖住整页，排前面时一卡就让后面几步全部假失败。

三个只在真机上才看得见的坑、封面 iframe 读不到的地方 → **[docs/PUBLISH.md](docs/PUBLISH.md)**

## 已知边界

- 回评走**网页接口**（站在页面里发），不是官方开放平台；风控由页面自己处理，我们不拼签名。
- 发布走 **CDP 点真页面**，比接口糙，但稳定、可核实。
- 视频的转码慢，`--video` 一次只能一条。
- 封面的编辑器会加载 `summon.bytedance.com` 的跨域 iframe，主文档读不到它的 DOM ——
  我们只点主文档里的「完成」，所以那条 iframe 里的高级编辑（裁剪框位置等）用不了。

## 面板与内部约定

数据接口、两条硬规矩、自主执行、面板设计规矩 → **[docs/INTERNALS.md](docs/INTERNALS.md)**

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