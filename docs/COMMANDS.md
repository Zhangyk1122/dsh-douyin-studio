# 命令参考

> 从 README 拆出来的。README 只留「第一次来要看的东西」，查参数的时候看这份。
>
> 所有命令都是 `node tools/dy.mjs <命令>`，输出一个 JSON 到 stdout，`ok` 字段永远在。

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
node tools/dy.mjs see --aweme <id> [--cells 6]  # 看一条视频：详情里的播放直链直接喂 ffmpeg，
                                              # 抽成一张 3×2 拼图（每格 2.5 秒）＋ 热评，返回 sheet 路径。
                                              # 只产出图片和事实，不产出观后感 —— 描述要由看过图的调用方写。
                                              # 和 watch（盯私信）不是一回事。
node tools/dy.mjs risk [clear]                # 风控冷却状态 / 手动解除。退避 30→60→120→360 分，
                                              # 命中 352/412/2154/3002 这类码就自动进冷却
node tools/dy.mjs episodes                    # 这周发生了什么，压成三条（带事件 id 可回溯）。同一周
                                              # 只算一次、落盘到 episodes.json；只读命令的失败不计入。

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

