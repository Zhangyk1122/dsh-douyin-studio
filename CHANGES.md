## 0.7.7 — 2026-11-14（读接口去副作用 + 前端契约测试）

- **`lib/risk.mjs` 的 `riskState()` 改成纯读。** 以前冷却过期时它顺手重写 `risk.json`（`atomicWriteJson`），而这个函数挂在 `GET /risk` 上、面板头部每次刷新都会调 —— 一个 GET 每次刷新都写一次盘。现在过期就返回 `cooling:false` 不落盘，真正的清理交给下一次 `noteRisk` / `clearRisk`。补一条用例：过期后连读两次，文件内容必须逐字不变。
- **新增 `tests/client-contract.test.mjs`（8 条）。** 0.7.6 的发布卡坏在「前端做了两次点击的本地 arm，payload 里却没有 `confirm`」，711 个后端测试一个都没抓到。这条测试把 `jpost/onPost` 的调用点抓出来，凡是后端要 `confirm: true` 的路径（`/queue/retry`、`/queue/clear`、`/publish`、`/reply`、`/dm/send`、`/picks/act`），前端每一处调用都必须带；另断言 `/publish` 必须带 `kind`，否则视频会被当图文走 `--img`。
- 测试 **720 pass / 0 fail**（711 + 9）。

## 0.7.6 — 2026-11-14（按 `审查-2026-11-14.md` 逐条收口）

审阅稿提了 8 条「最该先修」和二十来条 P0/P1/P2。这一版把「面板上点了没反应 / 看着成功其实没做」这一类全部收掉 —— 共同特征是**前端发了后端不认的参数，后端还回 200**，用户永远等不到报错。

- **A 收件箱「回一条」打不开。** 根因是冒泡：`Item` 整行 `onClick: onOpen`（`client.js:812`），而 Composer（textarea + 回一条按钮）是行内子节点，点输入框就把整块收起。给 Composer 容器加 `onClick: (e) => e.stopPropagation()`。
- **B 「开值班 / 开盯私信」是假按钮。** 前端发 `{ on: true }`，后端只认 `body.action`，落 into else 分支返回 `200 {ok:true}` —— 看着成功、实际没开。改成 `{ action: 'start' | 'stop' }`。
- **C 重放 / 清死信空转。** 后端要 `body.confirm === true` 才动手，前端传的是 `{}`，于是回 200 什么都不做。两处都补 `{ confirm: true }`。
- **D 后端兜底不再回 200。** `/watch`、`/duty` 的 else 分支从 `200 {ok:true, ...status}` 改成 `400 {ok:false, error:'不认识的 action：…', hint:'面板发 {action:"start"|"stop"}…'}`。这一条是防「再长出一个假按钮」的根 —— 不认的参数必须吵。
- **E `notifyQuiet` 点了会亮但不落盘。** `lib/settings.mjs` 的 `DEFAULTS` 里根本没有这个字段，`normalize()` 自然也不认，面板上那个 switch 是个纯装饰品。补 `notifyQuiet: false` + `normalize` 一行 + 用例（`'yes'` 不算开、缺省 false）。`quietFrom/quietTo` 只说哪段算安静，**这个才决定安静时要不要闭嘴**。
- **F `engage plan` 永远返回空清单。** 两个真 bug 叠在一起：①`lib/tools-extra.mjs:89` 拿 `loadPicks()` 当数组用（它返回 `{updatedAt, items}`，真实 195 条），`.slice` 抛 TypeError 被 catch 吞掉 → items 恒空；②`lib/engage.mjs` 的 `planEngage` 读 `it.aweme_id` 时漏了字段名（候选库就叫 `aweme_id`），清单里 aweme 恒为空串。顺手重写 `authorsOf()`：按 `,，、;；\n` 切段、**含括号的段整段当一个名字**（抖音昵称常带空格，「大地矿业（CDD MINING)」会被撕成两片，白名单永远命中不了）。修完实测 `scanned:195 / skipped:194 / list[0].aweme` 有值。
- **G 自主执行 5 个开关要按两次。** `autoDm / autoComment / autoAt / autoPublish / autoReport` 打开之后它会**自己**往别人评论区、私信、公开主页发东西，以前一下点开就生效，页面滑一下手滑就开了，还没有任何回执。现在第一次只把开关染红（`[data-dys-switch][data-armed]`）+ 提示「再点一次就打开」，6 秒不点自己复位。关掉仍然一次就行 —— 关是安全方向。
- **H 设置页摊开 16 项只在 JSON 里的配置**（审查 P1）：`ownerSecUid`、`scanMode`（推荐流 / 搜索）、`scanApi`、`scanKeywords`、`publishWho`、`unattendedPublish/From/To/PerDay`、`engageOn/engageAuthors/engagePerDay/engageGapSec`、`personaSource`（aurabot / card / custom / off）、`personaFile`。全部逐个核过真实消费者：`scanMode`/`scanApi`/`scanKeywords` → `index.js:442-450`，`unattended*` → `lib/unattended.mjs:95-118`，`engage*` → `lib/engage.mjs` + `lib/tools-extra.mjs:86`，`personaSource` → `lib/persona.mjs:50`。**不为装饰品开口子。**
- **I 风控冷却终于上了面板**（审查 P0-5）：`lib/risk.mjs` 一直在，但只有 CLI 读它 —— 面板照样显示「今天还能发 N 条」，用户点下去才发现被拒。新增 `GET /risk`（`index.js`，用把 `GET /kill` 压成一行换来的净零行数），头部加胶囊「风控冷却 · 还剩 N 分」，tooltip 带 code 与 reason。
- **J 「连败 N 次」改名「刷视频连败 N 次」**：那个 `health` 来自 `schedule.health`，数的是刷视频连续失败，不是回评失败。名字错了会让人关错东西。
- **K 面板有了发布入口**（审查 P0-4）。之前「从零到第一条作品」走不完第 7 步 —— 后端 `POST /publish` 一直在（带 `needsConfirm` 二段确认），前端没有入口。新增 `PublishCard`：文件路径（占位符直接用 `settings.publishDir`，后缀校验 png/jpg/webp/mp4/mov）、标题 20 字计数、可见性 select、文案；「存草稿」「真发」都是二段确认，`who === 'public'` 时多一条 warn 胶囊。底部写清「自主声明固定内容由AI生成，第一次发之前先跑 CLI `dy publish --dry`」。
- **L README 三处漂移**：`每 5 分钟` → 每 30 分钟（`index.js:1155` 的 `everyMin: 30` 才是真值，`lib/autopilot.mjs:530` 的 `= 5` 只是函数默认值）；`digestAt/digestPerDay` 整段重写（这两个字段已删，真实机制是 `sharePerDay` + `atPerDay` + `lib/tier.mjs` 的 `pickTier`，账在 `notify-state.json`）；测试段「19 个文件、261 例」→ 73 个文件、711 例。
- **M README 补 10 条查不到的命令**：`sticker *`、`replies`、`comment-at`、`comment-image`、`watchback`、`risk`、`kill`、`schedule`、`unattended`、`engage`。功能一直在，文档里一个字没有，等于没有。
- **N `check.mjs` 第 ⑯ 条守卫「文档覆盖」**：HELP 里 43 条命令，README 里必须都能查到 `dy.mjs <命令>`。⑬ 只管「HELP ↔ 代码」对不对称，管不了「用户看不看得见」——这次漂移就是这么攒出来的。
- **O 修一次编码事故（`package.json` 曾被 PowerShell 按 GBK 重写）。** 现象是 `check.mjs` 突然三连挂：`语法` 报 `node:internal/modules/package_json_reader:193`、`测试` 报 `files 覆盖运行时与文档资产`、`打包完整` 报 `files 漏了 index.js,client.js,lib,…`。根因是文件里的中文被按 GBK 重编码、`description` 结尾的引号被吞掉，JSON 直接解析不了 —— `files` 读不到，于是上层全塌。修法：从 `git show HEAD:package.json` 取回原始 UTF-8 版本、只换 `version` 一行、用 node 写回（无 BOM）。**教训：这个仓库的任何文件都不要用 PowerShell 的 `Out-File` / `Set-Content` 写，中文一定会烂。** 顺手扫了全仓文本文件，`lib/im.mjs` 也有一段注释早在接手前就烂了（`/** 发私信… */` 那四行），一并重写。
- **K 补漏（复核发现）。** 发布卡的「点两次」只是前端本地状态，payload 里没有 `confirm: true` —— 后端 `index.js:914` 只认这个字段，于是永远回 `needsConfirm`，**连草稿都发不出去**。补上 `confirm: true`；顺带补 `kind`（按 `.mp4/.mov` 后缀判 `video`），否则视频会被当图文走 `--img`。这是「前端发后端不认的参数」第三次出现，下一版值得加一条契约测试。
- 全量 **711 pass / 0 fail**；`tools/check.mjs` PASS（`client.js 1934/1940  index.js 1250/1250  最大 lib 742/760`，禁改区 7 文件哈希未变，样式真源一致 27873 字符）。

## 0.7.5 — 2026-11-14（表情包私信真的发得进去了）

- **根因一：回读误判。** `lib/im.mjs` 的 `read()` / `conversations()` 用 `if (!text) continue` 过滤空消息，而图片消息的 body 里根本没有 `text`，只有 `{ aweType:2702, cover_width, cover_height, md5, from_gallery:1, resource_url:{ data_size, large_url_list } }`。于是「图已经发出去」被回读判成「没发」。现在认 `aweType 2702` → `kind:'image'`、`text:'[图片]'`，并带回 `bytes`（`resource_url.data_size`）与 `url`。
- **根因二：会话根本打没打开。** 坐标双击 12 次里只中一两次，其余时候输入框压根不渲染 —— 「图已塞进输入框却没图」一半原因在这。新增 `openRowBySec()` + `clickRowBySecJs`：按 sec_uid 找到会话行，在**行内子元素**上派发 `pointerover/enter/down + mouse down/up + click` 整串合成事件（会话行自己的 props 只有 `onMouseDown`，没有 `onClick`）。
- **根因三：塞图通道是死的。** `DOM.getDocument {depth:-1}` 在这台 Chrome 上返回空壳、`DOM.querySelector` 恒为 0，`DOM.setFileInputFiles` 从来没真正执行过。改成 `stageFileByReact()`：读文件 → base64 → 页面里造 `File` → 沿 `input.semi-upload-hidden-input` 往上找 `memoizedProps.onFileChange` → **传 File 数组**（handler 要 `e.length/e.filter/e.size`，传 `{files:[]}` 或 `[[file]]` 都抛）。
- **根因四：确认框只吃原生 click。** 塞完之后弹 `MsgInputSendFileModal`（发送给 X | 文件名 | 801 B | 取消 | 发送(1)）。CDP 的 `Input.dispatchMouseEvent` 点得到按钮但不生效，必须 `el.click()`。新增 `waitSendModal()` / `confirmSendModal()` / `cancelSendModal()`，`--dry` 走到确认框出现就取消（这才真能证明「图进了待发队列」）。
- `sticker-send.mjs` 里统一用 `evalIn(c, …)`（`openPage()` 返回的是 `{send, ev, close}`，没有 `evaluate`，之前 `c.evaluate is not a function` 就是这么来的）。
- **附言框真身是 `TEXTAREA.semi-input-textarea`**（343×42 @ 543,418），不是 `MsgInputSendFileModalim-saas-input` —— 那个 class 是外层 wrapper，读它的 `value` 永远空。新增 `SEND_MODAL_CAPTION`，定位顺序：确认框里的 textarea → 任意 textarea/input → 放弃。`--dry` 现在也会先写附言再读回，返回 `captioned: verified / written / no-box`，不真发也能验附言。
- **真机验收（带附言）**：`dy sticker send --uid 110149990088 --id st_ab831cf67a --text "这张给你诶"` → `ok:true verified:http-image at 12:42:59.272Z bytes:801`；`im.read` 回读看到 `12:42:57.641 kind:text "这张给你诶"` 紧跟 `12:42:59.272 kind:image 801 B` —— 附言先到、图后到，端到端确认。
- **真机验收**：`dy sticker send --uid 110149990088 --sticker st_ab831cf67a` → `ok:true verified:http-image at 2026-11-14T12:38:41.281Z bytes:801`，`url` 是 douyinpic 的图片地址；日志四步齐（找到会话 → 打开且 sec_uid 校验通过 → 图交给上传 → 确认框 → 已点发送 → 回读确认）。
- `tests/sticker-send.test.mjs` 重写：18 例，覆盖 MIME 推导、File 数组传参、no-input/no-handler/threw 三种失败、确认框超时、dry 只点取消、以及「im.mjs 必须认 2702 且带回 data_size」的一致性断言。
- **自动发布链路一直是坏的**（`lib/autopilot.mjs` 的 `runPublish`）：给的 CLI 参数里没有 `--declare`，而 `publish-cli` 的校验在 `--draft` 之前就 `die`，于是每轮都失败一次、往 autopilot-log 记一笔 `{"kind":"publish","ok":false,"error":"要 --declare（一般 ai）；真发不许 none"}` —— 连草稿都到不了。属于「断在安全侧」，不等于安全，是链路压根没通。现在补 `'--declare', s.publishDeclare || 'ai'`（这套产出的图文确实是模型生成的，声明 ai 是实话），并加一条用例钉死参数序列：`--declare ai` 必须在、`--draft` 必须在、`--who` 跟着 settings 走（默认 `private`）。
- 真机验收（发布填表）：`dy publish --img "D:\抖音内容\xiaoxi-20261114.png" --title 小汐 --desc "屏幕里的一条鱼，今天也在。" --who public --declare ai` → `title/desc/who/declare` 四项 `ok`，`declare.read === "内容由AI生成"`，页面三个可见性 label 里只有「公开」是 `data-checked="true"`。**没点发布**。
- 全量 **708 pass / 0 fail**；`tools/check.mjs` PASS（禁改区 7 文件哈希未变）。
- `.gitignore` 加 `lib/publish/shot-*.png`：发布页截图带抖音昵称与主页信息，不该进公开仓库。

## 0.7.4

- 修 `lib/comment-image.mjs` 定位：真机上评论页**没有现成的 contenteditable**，只有一个 `#comment-input-container` 和占位文案「留下你的精彩评论吧」，点一下才长出编辑框。现在分两步：先点容器，再找编辑框；dry 实测日志 `评论框已定位 → 图已塞进评论框 → 文案已写入`。
- `tests/comment-image.test.mjs` 的选择器校验改成只挑「长得像选择器」的字符串，否则源码里的 `') || [` 会被当选择器，正则编译直接抛。

## 0.7.3

- 修 `tools/dy.mjs` 的 `argOf`：`--text --dry` 这种把 flag 写在值位置时，旧代码会把 `--dry` 当正文发出去（真发过一条 `--dry`）。现在下一个 token 以 `--` 开头就按空值处理。
- `lib/sticker-send.mjs` 验收改判：图片消息不进 `im.read` 的列表，改成数页面上 `[class*="MessageItemImage"]` 的个数，发前发后对比。
- 面板观感：卡片/主卡分层投影、hero 双色径向底、数字等宽、标签栏吸顶 + 背景模糊、hover 只在鼠标设备生效（触屏不动）。样式仍以 `assets/panel.css` 为唯一真源，`build-client` 内联。

## 0.7.2

- 新增 `lib/invite.mjs`：圈地自萌。`isInvite()` 认「小汐/小肥鱼 + 来/回/看看」这类点名邀请；`REFUSE_WORDS`（别来/别刷/别蹭/拉黑…）优先于邀请，命中就闭嘴；`NOISE_RE` 吃掉 666/哈哈哈/前排；`planSpeak({mode:'invite'})` 给调用方一个明确的开/关。
- 新增 `lib/watchback.mjs` + `dy watchback`：回评闭环。从通知里挑 `type 31/32`（回复了你的评论），去重、限 72 小时、主人优先，输出 `{aweme,cid,root,nick,text}`，只读。
- `lib/sticker-send.mjs`：发图前先记条数，发完按「条数增长 OR 文字命中」判成功——图片消息的 text 常为空，旧判法会把成功当失败。
- 真机：`dy reply` 在主人那条「表演下呗小汐」下面回上了（cid `7707655976401486630`）；`dy watchback --owner-only` 返回 1 条。
- 已知未通：私信发本地图仍被吞（日志到「图已塞进输入框」为止），下一步改成先点输入框旁的图片按钮、等弹层里的 file input 再塞；本地图发出去也只是「图片消息」，平台原生贴纸只能从表情面板选。

# CHANGES

## 0.7.1 — 2026-11-13（只回主人的那一轮 + 表情私信的真实结果）

- `lib/duty.mjs`：`run()/_run()` 新增 `ownerOnly`，候选里 `author_id !== ownerUid` 的直接跳过（验收用，避免扫到别人）；CLI `duty run --owner-only`。
- `lib/sticker-send.mjs`：定位校验降级 —— `openRow` 的 sec_uid 校验失败但输入框已出现时继续（抖音改过 DOM 后 `currentSecUidJs` 常读空），只记一行日志；塞图后等 2.5 s 再回车（图要先上传完）；发完**回读接口**确认，回读看不到就返回 `ok:false`（不再把「界面点过了」当成功）。
- 真机结果：`duty run --owner-only --max 2 --auto` → `scanned 71 / fresh 0 / filtered 0 / picked 0`（主人今天没有新评论可回）；文字私信已发到主人号并回读确认；**表情私信仍未通** —— 两次（含换成合法 PNG）都是「塞进输入框」成功、回读没有，已按失败返回。
- 全量 689 pass；`check --quick` PASS。


## 0.7.0 — 2026-11-13（照调研补三块：风控冷却、表情「对味」、看图打标）

- **风控冷却** `lib/risk.mjs`（调研 P0-1，蓝本 bili-pond 的 like-cooldown）：`looksLikeRisk()` 认 `-352/-412/2154/3002` 与「频繁/操作太快/验证码」这类文字；`riskState()` 读时自愈；`noteRisk()` 按次数翻倍（30→60→120→封顶 360 分钟）；`coolingGate()` 给一句人话；`guardedWrite()` 冷却中直接拒、失败像风控就记账。CLI 加 `risk` / `risk clear`；所有写命令在总闸后多过一道风控闸（`--dry` 与只读不吃）。
- **表情「对味」** `lib/stickers.mjs`：`rankStickers()` 新增 `now/cooldownH`，6 小时内刚发过的那张 −3 分（防复读，到点自愈）；新增 `CONTEXT_MOOD` 与 `pickForContext()`（at/share→share，dm→soft，reply→reply，publish→happy）。
- **入库打标** `lib/vision-label.mjs`：`parseLabel()` 先认 JSON（name/mood/tags/when），没有 JSON 就把文字当「什么时候用」、不编名字；`labelSticker()` 走 `DOUYIN_STUDIO_VISION_CMD`，没配返回 `no-vision`。CLI `sticker add --file <图> --vision`。
- **设置自洽校验** `lib/settings-check.mjs`：`checkSettings()` 抓「日上限吃不到」「>24 条/天」「静音起止同点」三类，只报警不改值。
- 新增测试 `tests/risk.test.mjs`(7)、`tests/risk-label.test.mjs`(8)、`tests/comment-image.test.mjs`(6)。
- 全量 689 pass / 0 fail；`check --quick` PASS（43 条命令与 HELP 一致）。
- 未接线（下一版）：`pickForContext` 还没接进 at/share 的自动配图；`sticker add --vision` 需要你自己配 `DOUYIN_STUDIO_VISION_CMD` 才有标。


## 0.6.7 — 2026-11-13（评论也能带图了）

- 新增 `lib/comment-image.mjs`：`videoUrl()`、`commentBoxJs`（先找 `[data-e2e="comment-input"]`，再退 `[contenteditable="true"]` / `div[role="textbox"]`）、`planCommentImage()`（缺 id / 图不在磁盘直接拒）、`commentWithImage()` —— 打开 `/video/<id>` → 定位评论框 → 点一下聚焦 → 复用 `sticker-send.stageFile()` 把图塞进 `input[type=file]` → `Input.insertText` 写文案 → `pressEnter()`；`dry` 只塞不回车。**没有另造一套点击**，和私信发图同一条路。
- `tools/dy.mjs` 新增 `comment-image --aweme <id> --file <图> [--text "..."] [--dry]`，已进 `WRITE` 闸门与命令表。
- 新增 `tests/comment-image.test.mjs` 6 例（地址拼装、缺 id、图不存在、放行、定位脚本选择器）。
- 全量 673 pass / 0 fail；`check --quick` PASS（41 条命令与 HELP 一致）。
- 未做真机：评论带图会消耗当天真实额度，等你说了再跑（`--dry` 可以先验图进没进框）。


## 0.6.6 — 2026-11-13（表情包能真的发进私信了）

- `lib/sticker-send.mjs` 新增 `sendStickerDirect()`：落到 `/chat` → 按 uid/sec_uid/昵称找人 → 点开校验 → 塞图 → 打文案 → 回车；`--dry` 只塞不回车。走的是和日报同一条私信路（`im-locate` + `im-report` 那套），不另造一套点击。
- `tools/dy.mjs` 新增 `sticker send --to <昵称> [--uid] [--sec] [--id st_x] [--mood] [--tags a,b] [--text "..."] [--dry]`。
- 全量 667 pass；`check --quick` PASS（40 条命令与 HELP 一致）。


## 0.6.5 — 2026-11-13（私信/评论带图的第一段：把图塞进去，不替你按发送）

- 新增 `lib/sticker-send.mjs`：`planStickerMessage()` 纯判断（图在不在、多大、文案压空白并截断）；`stageFile()` 走 `DOM.setFileInputFiles` 把本地图塞进 `input[type=file]`，没 input 先点一次「图片」按钮再找；`stageStickerDm()` 认人 → 塞图 → 打文案，**不自动回车**；`pressEnter()` 单独暴露给调用方决定何时提交。
- 为什么先塞不直接发：发送按钮的 DOM 每版都变，`input[type=file]` + 回车两年没变；结果未知时宁可停。
- 测试 +8（`tests/sticker-send.test.mjs`，含「会话没打开就停、不塞图」）；全量 667 pass；`check --quick` PASS。


## 0.6.4 — 2026-11-13（收藏表情包 + @ 的形状对齐真机）

- 新增 `lib/sticker-collect.mjs`：从评论/私信里把别人发的图收进本地库。`imageUrlsOf()` 认 `image_list / images / sticker.url` 三处、只收 http(s)；`planCollect()` 排重 + 限量；下载走页面内 `fetch(credentials:'include')` → blob → base64 → 落盘 → 入 `stickers` 库，失败只记 `failed` 不中断。
- `lib/mention.mjs` 的 `mentionExtra()` 改成真机抓到的形状（`start/end` 指向正文里的 `@昵称`，多带 `nickname` 反而会被服务端忽略）；`planMention()` 带上正文一起算位置。
- 命令行加 `dy.mjs sticker collect --aweme <id> [--max 8] [--mood m] [--tags a,b]`（只读：读评论 + 下载，不发任何东西）。
- 测试 +6（`tests/sticker-collect.test.mjs`）；全量 659 pass；`check --quick` PASS。


## 0.6.3 — 2026-11-13（表情包库 + @ 身份这两个地基）

- 新增 `lib/stickers.mjs`：本地表情包库。收图（jpg/png/gif/webp，单张 ≤4MB）、按 hash 去重、标签/心情、最多 300 张、超了丢「最没用过」的；挑图按「心情匹配 → 标签命中 → 用得少 → 新增的」排，发一次记一次。
- 新增 `lib/mention.mjs`：@ 的身份判断。只有「昵称 + 纯数字 uid」才算能 @（昵称可重名，靠它 @ 会 @ 错人）；`planMention()` 返回正文与 `text_extra`，四种理由（off / no-owner / no-uid / already-in-text / prefixed）都能解释。
- 命令行新增 `dy.mjs sticker add|list|pick|use|rm|stats`（只碰磁盘，不走网络）。
- 测试 +15（`tests/stickers.test.mjs` 8、`tests/mention.test.mjs` 7）；全量 653 pass。




## 0.6.2 — 2026-11-13（抽帧：把一条视频压成一张图）

真机 190 ms 出一张 960×360、34 KB 的 3×2 拼图（6 秒测试片）。
没有视觉通道时不猜画面 —— `describe()` 明说 `no-vision`，绝不编一段「她看到了什么」。

- 新增 `lib/frames.mjs`：`tileFilter(时长)` 按 6 格算采样（`fps=n/d`），`grabFrames()` 调 ffmpeg
  抽一帧拼图落 `<outDir>/<aweme>-sheet.jpg`，`describe()` 走 `DOUYIN_STUDIO_VISION_CMD`
  外部命令（`<cmd> <图片路径>` → stdout 一句话）；没配就返回 `no-vision`。
- ffmpeg 路径可用 `DOUYIN_FFMPEG` 覆盖，默认 `E:\tools\ffmpeg\ffmpeg.exe`。
- 测试 `tests/frames.test.mjs` 5 例；全量 638 pass。

## 0.6.1 — 2026-11-13（看过这条视频；发送结果分三态）

「她到底看没看」以前说不清：提示词里只有文案前 160 字和对方那句话。
现在回评论之前，先真去读一次这条的详情和热评 —— 不调模型、不花钱，884 ms 一条（真机）。

- 新增 `lib/watch.mjs`：`watchOnce(aweme)` 并发取 `api.detail` + `api.comments`，
  30 分钟内同一条只请求一次；`watchOf()` 折成事实（时长/赞/评/藏/热评三条）；
  `watchLine()` 只说事实：「这条视频 15 秒、30.9 万 赞、3349 条评论。评论里在说：…」。
  抽帧要 vision key，本机没有 —— 返回值里明写 `frames: false`，不假装看过画面。
- `lib/duty.mjs`：`PROMPT` 里多一行「我看过这条：…」；`_run` 生成前 `watchOnce(c.aweme)`，
  拿不到就少一行材料，不阻塞回复。
- 新增 `lib/send-state.mjs`：`classifySend()` 把发送结果分成 sent / failed / unknown，
  超时、断连、CLI 回 null 一律 unknown（`canRetry` 只放 failed）。
  `lib/runlog.mjs` 给 tellOwner / dm / reply / comment-at 记 `delivery`，事件账同步带上。
  这一版只记账、不改发送行为 —— 先让账本说实话。
- 测试：`tests/watch.test.mjs` 6 例、`tests/send-state.test.mjs` 5 例；全量 633 pass。

## 0.6.0 — 2026-11-13（像人：有心情、有想做的事、会主动开口、记得住人情、说话有停顿）

「像真人」拆开是六件事，这一版先做四件半（剩「看视频」等 vision key）。全部零依赖、全部可回滚。

- 新增 `lib/mood.mjs`：valence/arousal/energy/affinity 四个量，各有半衰期（6h/3h/4h/720h）；
  `note(kind)` 记账（被 @ +0.12 唤醒、失败 -0.08、休息回能量），`moodLine()` 只输出「今天什么状态」，
  **不写进正文**——心情是语气的底色，不是台词。
- 新增 `lib/purpose.mjs`：早/午/晚三个时段各有一个「想做的事」，按 `sha256(day:slot)` 定种子 →
  同一天不会变；`markDone()` 记完成。兴趣词最多掺一条，避免整天只想着关键词。
- 新增 `lib/speakup.mjs`：主动开口的闸门 `decide()`——免打扰、每日上限（默认 2）、冷却（90 分钟）、
  以及**必须有由头**（有没回的评论 / 心情被撩起来 / 日程里那件事还没做）。没有由头就不说，
  这是默认，不是异常。
- 新增 `lib/episodes.mjs`：一周压三条「情节」（做了什么 / 和谁碰过两次以上 / 哪次没成），
  每条都带 `refs`（事件 id），点得回去；同一周只生成一次。
- 新增 `lib/rhythm.mjs`：回评论前按字数停 2–6 秒（`typingMs`），普通评论 3% 概率「这次没回」，
  @ 和私信永不漏；`DOUYIN_STUDIO_FAST=1` 时零延迟（测试用）。
- `lib/contacts.mjs`：加 `heat/lastHit`，`bumpHeat()` 记「被想起一次」，`heatOf()` 按 30 天半衰；
  老数据没有这两个字段也照读。
- `lib/duty.mjs`：`PROMPT` 末尾接 `moodLine()`（并写明「只影响语气，别说出来」）；
  回评前过 `humanDelay()`。
- 测试：`tests/mood.test.mjs` 10 例、`tests/purpose.test.mjs` 8 例、`tests/speakup.test.mjs` 9 例、
  `tests/episodes.test.mjs` 9 例、`tests/rhythm.test.mjs` 6 例。

## 0.5.12 — 2026-11-13（先判后说：不值得回的不回；晚上了还欠着 @ 就先补）

抄 aurabot `chat/group-policy.js` 的思路：那边「必回 / 插话 / 闭嘴」是**先判后说**，
dy 这边以前是「抓到就生成、生成就发」，于是抽奖号、互关号、纯表情都会认真回一句。

- 新增 `lib/comment-filter.mjs`：`judgeComment()` 挡广告引流、纯表情/纯符号、`666/第一/打卡`、
  一两个字的凑热闹；`dedupeByText()` 把刷屏的同一句只留一条。
  **拿不准的一律放行**——宁可多回一句真人，也不把真人当广告。
- `lib/duty.mjs`：候选先过这道减法，跳过原因记进 `results`，返回值新增 `filtered`。
- `lib/tier.mjs`：`pickTier()` 认 `hour` —— 20 点以后还没 @ 过，就先补 @（欠账优先），
  不再让「第一轮被窗口挡掉」变成「这一整天只发私信」。不传 `hour` 行为不变。

## 0.5.11 — 2026-11-13（评论区的人记得住：第一次像认识，第二次才不像第一次）

回复「机械、没特色」的根子不是文笔，是**每条都像第一次见**。aurabot 那边有 `contacts` 这一层
（谁来过、说过什么、回过几次），dy 这边完全没有 —— 所以同一个人第三次留言，我们还是只能「哈哈可爱」。

- 新增 `lib/contacts.mjs`：`<studioHome>/contacts.json`，一人留 3 句原话（每句 ≤80 字）、
  记 `count/replies/lastAt`；上限 400 人，满了先丢「从没回过、最久没出现」的。
- `summaryFor(uid)` 只产出事实：`来过 3 次，你回过他 1 次，以前说过「…」`。
  **没有记录返回空串**；第一次来的人不说「来过 N 次」——不许把路人说成熟客。
- `lib/duty.mjs`：生成前查一眼 `c.history`，`PROMPT` 多一段「这个人你以前见过：…」，
  并明确「接得上就接一句，接不上就当没看见，别硬攀关系」；回成功后才 `remember` + `noteReply`
  （顺序反了新人会被静默丢掉）。
- 新增 `tests/contacts.test.mjs` 7 例（同句去重、长句截断、首次不说次数、无记录返回空、满表淘汰、坏文件不抛）。

## 0.5.10 — 2026-11-13（面板接上宿主设计令牌，和 aurabot 一套观感）

以前面板自己写死了一套颜色：深色下靠 `color-mix(currentColor)`，浅色下另写一张 `[data-theme="light"]`
覆盖表。问题是它只认得「明暗」两档，认不出宿主换主题、换字体、换分层色。

- 令牌改成「宿主优先、自家兜底」：`--dys-ink/sub` ← `--dsw-alias-label-primary/secondary`，
  `--dys-line/line2` ← `--dsw-alias-border-l1/l2`，`--dys-blue` ← `--dsw-alias-brand-primary`，
  `--dys-ok/bad/amber` ← `state-success/warn/error`，`--dys-fill2` ← `--dsw-alias-interactive-bg-hover`。
  宿主没给就退回原来的 `color-mix`，老环境不会突然变样。
- 卡片面用 `--dsw-alias-bg-layer-1`（主卡 `layer-2`），不再靠半透明叠色猜深浅。
- 字体跟宿主：`font-family:var(--dsh-font-family-ui, inherit)`。
- 补 `:focus-visible`：按钮 / 链接 / summary / 收件箱行，键盘走路也看得见焦点。

## 0.5.9 — 2026-11-12（两轮空转的真凶：页面回了 `null`）

`rounds.jsonl` 里 11-11、11-12 各有一次 `ok:false`，error 都是
`Cannot read properties of null (reading 'ok')`，而 `jobs` 那边还是 `ok:true`——
因为它们记的不是同一件事：作业只管「没抛异常」，轮次才知道「这一轮到底拿到没拿到」。

- 真凶在 `lib/feed.mjs`：`evaluate()` 返回字符串 `"null"` 时，`JSON.parse("null")` 得到 `null`，
  下一行 `if (!page.ok)` 直接抛 TypeError，真实原因（页面还没长出数据）被这句话盖住。
- 新增 `pageOf(raw)`：空值 / 非 JSON / 解析成 null / 数字 / 字符串 / 缺 list，六种情况都归一成
  `{ok:false, error:'人话'}`；`browse()` 改用它。
- 新增 `tests/pageof.test.mjs` 6 例（含「raw 是 null 不许抛」这条钉子）。
- 面板：收件箱默认停在「私信」，可角标算的是三区合计 —— 于是常见「角标 3、列表空」。
  现在只要用户自己没点过，就自动落到第一个真有东西的区（点过之后不再自动跳）。
- 体量：`index.js 1250/1250`（正好卡线，动它之前先想清楚往哪儿挪）。

## 0.5.8 — 2026-11-12（页面不再越开越多）

现场：机器人那个 Chrome 里开着 **17 张** 抖音页（15 张 `/jingxuan` + 2 张 `/chat`）。
每点一次面板里的视频就 `newTab()` 一张，几天下来堆成这样。堆页面的代价不是内存，
是**风控**——同一个账号在十几个页面间来回跳，比什么脚本特征都显眼。

- 新增 `lib/tabs.mjs`：`reusableViewer()`（纯函数，挑一张能复用的、**不碰聊天页**）、
  `openReuse()`（有页就导航，没有才开）、`dedupeDouyin()`（只留 1 聊天 + N 看视频）、
  `tabsStatus()` / `sweep()` / `openInRobot()` 三个给面板用的口子。
- `index.js`：`POST /open` 改走 `openInRobot()`；新增 `GET /tabs`、`POST /tabs/sweep`；
  扫描轮 `preflight` 里先收一次页。
- `lib/chrome.mjs`：传了 `want` 又没命中时，**把现有页导航过去**，不再顺手新开一张
  （以前「找不到 /chat」= 又一张抖音页）。
- 面板「诊断与版本」里多一行「开着的页面 · N 张」+「收一收」按钮（展开抽屉才查，不占首屏）。
- `tests/tabs.test.mjs` 6 例：跳过聊天页 / 空列表返回 null / 别的站不碰 / prefer 命中 / prefer 未命中退回第一张 / 非 page 不算。

实测：`dedupeDouyin()` 关掉 15 张、留 2 张；再查 `/json/list` 只剩 chat + jingxuan。

## 0.5.7 — 2026-11-11（@ 不再照搬别人的文案和标签）

真机发出去的是这条：
`@辰辰辰chen 这条我觉得你会喜欢：#丁达尔之境 #Muse强大的Muse，Muse好`
—— 生成失败后退回「模板 + 原文案」，话题标签和别人的句子一起带了上去。

- 新增 `lib/caption.mjs`：`cleanCaption()` 先洗掉话题 / @ / 链接 / 表情；
  `topicsOf()` 把话题词单独摘出来（只当背景，不拼进回复）；
  `looksCopied()` 判「是不是在照抄」；`AT_FALLBACKS` / `DM_FALLBACKS` 是**她自己的话**，一个字都不搬原文。
- 新增 `lib/at-text.mjs`：`composeAtText()` 组装 @ 的那半句 —— 洗完的材料 → 生成 → 剥掉她自己写的 @ 和任何 `#话题` → 再查一遍是否照抄，
  抄了就当没写。生成失败才用兜底，且兜底按秒轮换（`rotate()`），不再天天同一句。
- `index.js`：@ 分支改调 `composeAtText()`（index.js 从 1269 行回到 1198 行）；`notify-state` 多一个 `atWhy`（`gen-failed` / `copied`），
  模板句回潮时能看见，不会再悄悄变回机器。
- `lib/duty.mjs`：评论回复拿到的 `aweme_title` 也走 `cleanCaption`，不再把标签当正文喂进去。

### 从试用过的插件里落下来的做法
- 语义去重（aurabot `one-reply` 的跨轮去重）→ `looksCopied()`：生成的句子和原文案高度重合就不发。
- 失败要能查（`tellOwner` 记账那次的教训）→ `atWhy` 写进 `notify-state`，不再只有一句“发失败了”。
- 轮换取兜底（`lib/tier.mjs` 的轮换思路）→ `rotate()`，兜底文案不再固定。
- 字段归一（`lib/feedapi.mjs` 的 `normalizeItem`）→ 回复材料统一先清洗再进提示词。

## 0.5.6 — 2026-11-11（她记得自己在抖音做过什么；回复前能看见整段文案；角标不再骗人）

- **抖音里做的事进她自己的记忆**：新增 `lib/events.mjs` 的 spool（0.5.4 已有）+ aurabot 侧的消费者。
  dy 只往 `dy-spool.ndjson` 单向追加，aurobot 带游标读、写 `memories.json`——**单写者不变**，
  dy 永远不碰记忆文件。此前「发过作品 / 回过谁」只活在 dy 的 runs.jsonl 里，QQ 那边的小汐完全不知道。
  （消费者在 aurabot 包里：`src/douyin/bridge.js`，每 60s 跑一次，最多 20 条/次。）
- `lib/duty.mjs`：候选的 `aweme_title` 从 `desc` 前 **40 字**放宽到 **160 字**。
  以前她拿到的是被截断的半句文案，回复只能泛泛而谈——不是不会接，是材料被剪了。
- `index.js`：`/inbox/count` 在缓存过期时**顺手补一轮**（仍不等它），返回值多 `stale`。
  以前角标只读缓存、永不刷新，数字会一直停在旧值上。
- 修：`package.json` 带了 BOM，`tests/contract.test.mjs` 解析失败（`Unexpected token '﻿'`）。

## 0.5.3 — 2026-11-11（评论翻页 + 热评进提示 + 选题能走搜索 + 间隔不再固定）

### 补记 0.5.1 / 0.5.2（当时只写了 commit message）

- 0.5.1：`lib/tier.mjs` 的 `pickTier()` 让**每天第一轮先 @**（以前 `shareLeft > 0` 恒真，
  `at` 永远轮不到）；`lib/proc.mjs` 只放行对象（CLI 回 `null` 时折成可解释的失败，不再 TypeError）；
  `index.js` 里 `st.ownerSec` 全部改成 `st.ownerSecUid || st.ownerSec` ——
  设置里叫 `ownerSecUid`，代码读 `ownerSec`，所以 sec_uid 从来没进过 CLI，只能靠昵称找会话，
  于是整天「会话没打开（等不到输入框）」。账本同步改成「卡片发了、话没跟上 = `dm-card-only` + ok:false」。
- 0.5.2：`lib/persona.mjs` 让抖音侧读 aurabot 的人格卡（`personas/xiaoxi.md`），
  `personaLine()` 从 520 字摘要变成 4610 字符的本人；@ 的正文也交给她自己写（剥掉她自己加的 @）。

### 改（本轮）

- `lib/duty.mjs`：
  - `collect({ pages = 2 })`：顺着 `api.comments` 的 `cursor / has_more` 翻页（该接口本来就支持，
    以前只取第一页）；页间停 350–850ms；按 `cid` 去重；返回多 `pages / pageFetched`。
  - 每条作品挑**热评前 3**（按 `digg`，排掉自己），挂到候选的 `hot` 上。
  - `PROMPT` 增加「这条下面别人在说：」段（最多 3 条、带赞数），并说明「不是要你逐条回」。
    以前只喂被回的那一句，所以她说不出评论区在聊什么 —— 不是她没看，是没给。
- `lib/settings.mjs`：新增 `scanMode`（`'feed' | 'search'`，默认 `feed`）与 `scanKeywords`（逗号分隔）。
- `index.js` `startPicksCollect`：
  - 扫描间隔由固定秒改成 `scanGap × 0.7–1.3` 的随机值（固定 6 秒滚一整晚更像脚本）；
  - `scanMode === 'search'` 且有词时走 `search --kw`，把 `list` 归一成 `items` 再进 picks，
    `source` 记 `'search'`，关键词记进 `r.keyword`。

### 验证

- `node tools/check.mjs --quick` → PASS（146 文件解析、禁改区 7 个哈希未变、体量未超）。
- 全量 `node --test tests\*.test.mjs` → **533 pass / 0 fail / 40 suites**（新增 `tests/collect-hot.test.mjs` 4 例）。
- 真机 `collect({ worksN: 1, pages: 2, freshHours: 0 })` →
  `{ ok:true, seen:8, cand:8, pages:2, pageFetched:1, worksFailed:0, hot:1 }`；
  那条作品一共只有 8 条评论、`has_more:false`，所以只取到 1 页 —— 翻页逻辑是「有下一页才走」。

---

## 0.5.0 — 2026-11-09（时效口径统一：面板说 3 条、值班扫到 0 条，这件事不再可能）

现象：`/schedule` 的 `hero.pending` 是 3，`/duty` 的 `last` 是 `scanned: 0, picked: 0`。
看起来像「评论区没人说话」，实际上是两边用了两套时效：

- `lib/inbox.mjs` 的 `ownComments` 按 **7 天**算 `worth`；
- `lib/duty.mjs` 的 `collect` 按 `settings.replyFreshHours`（默认 **48 小时**）丢候选。

### 改

- `lib/inbox.mjs`：新增纯函数 `freshness(ageMin, freshHours)` —— 唯一的时效口径。
  `ownComments({..., freshHours})` 用它判 `worth`；超时的不删，`worth:false` +
  `blocked:['已经 N 小时没回了（时效 48 小时），不追了']`，列表里仍看得到。
  `inbox()` 默认从 `settings.replyFreshHours` 取，返回值多一个 `freshHours` 供核对。
- `lib/duty.mjs`：新增纯函数 `withinFresh(createDate, freshHours, now)`，`collect()` 改用它；
  `ageHoursOf(v, now)` 现在接受 `now`（测试可控）。
- `lib/duty.mjs`：`collect()` 多记三笔账 —— `seen`（实际看到多少条评论）、`skippedOld`
  （被时效挡掉的）、`worksFailed`（作品评论读失败的）。以前读失败是静默 `continue`，
  面板只看到 `scanned: 0`，分不清「没评论」和「没读到」。
- `lib/duty.mjs`：`scanned` 语义改为「看到多少条」，新增 `fresh`（过关候选数）、
  `skippedOld`、`worksFailed`，一起写进 `duty-state.json`（只增字段，老面板读不到也不坏）。
- `tests/freshness.test.mjs`（新，6 例）：48 小时边界、`0/空/非法 = 不限`、
  日期读不出来就放行、无时区标记的 UTC 不能按本地算、两侧同一口径。

### 真机对照（2026-11-09 19:5x）

```
改前：/duty last = {scanned: 0, picked: 0}       /schedule hero.pending = 3
改后：collect()   = {seen: 47, skippedOld: 45, candidates: 0, worksFailed: 0}
      /inbox      = counts {dm:0, at:2, own:0}, freshHours 48
```

结论：评论区不是「没有评论」，是 47 条里 45 条已经过了 48 小时，剩下的是自己发的。
以前这两个数字合在一起看不出区别，现在一眼能分清。

### 没改

- `atCandidates` 仍按 72 小时 / 7 天分级（`ageRank`），没并进 `replyFreshHours` ——
  @我 和「我作品下的评论」是两种东西，合并要改语义。`(待补充：@我 是否也按 48 小时)`
- 禁改区未动（7 个哈希复核一致）。

## 0.4.9 — 2026-11-09（工具返回类型：把 16 处字符串收回对象）

起因：`douyin_studio_kill` / `douyin_studio_duty` 实测调用就报 `invalid output: "value" must be an object`。
这两条恰好是「看总闸状态」和「看值班在不在跑」的入口——出事的两个口子一起坏。

### 改

- `lib/tools.mjs`：16 处 `return JSON.stringify({...})` 改成直接返回对象（`kill` / `duty` / `watch` /
  `publish` / `dm` / `queue` 等分支）。根因和 0.4.3 一样：这些分支绕过了本文件 `safe()`，
  而宿主给的是 `type:'object'` 的 `textOutput`。0.4.3 只修了 `lib/tools-extra.mjs` 那三条，
  这一批藏在同一个文件里没被发现。
- `lib/tools.mjs:60`：总闸拦下写操作时返回 `killedReply(...)` 对象（原来 `JSON.stringify` 成字符串，
  停损状态一下，所有写工具都变成 `invalid output`）。
- `tests/tool-output.test.mjs`：+2 例 —— ①静态扫描 `lib/tools.mjs` / `lib/tools-extra.mjs`，
  不许再出现 `return JSON.stringify(`；②用假宿主把 11 条只读分支（kill/duty/watch/status/budget/
  jobs/unattended/engage/queue/ledger/trend）真跑一遍，断言返回值都是可 JSON 往返的普通对象。
  假 `DUTY` / `WATCH` 只提供 status/start/stop，不真的起定时器。

### 没改

- 禁改区未动（`api` / `budget` / `im-send` / `publish*` 四个哈希复核一致）。
- 值班 `scanned: 0` 的归因（`/duty` 的 `last` 停在 18:37）留到下一轮，不在这次改。

## 0.4.8 — 2026-11-08（可观测性收口：定点可查、明细账轮转、派生块读盘缓存）

只做「不改接口、不改筛选语义」的三件事。`/inbox/count` 结构、`worth` 的 72 小时线、
面板默认停在哪个区 —— 这三样会动语义，**只出方案，没动代码**。

### 改

- `lib/autopilot.mjs`：`status()` 多一个 `nextReportAt`（ISO 或 `null`），来源是新增的模块级
  `dailyAt`（`armDaily()` 里算 `Date.now() + wait`，`stop()` 清空）。
  以前"下一次日报几点"只活在 `setTimeout` 里，外面问不到；`rearm()` 成没成只能靠"看明天发没发"。
  只增字段，老调用方读不到也不会坏。
- `lib/autopilot.mjs`：新增 `rotateLog(file, maxBytes)` + `LOG_MAX_BYTES`（5 MB），
  `appendLogLine()` 写之前先过一遍：到顶就把账挪成 `<file>.1`（覆盖旧的一代，不攒 `.2/.3`）。
  0.4.5 的 `autopilot-log.jsonl` 是"永不覆盖"账，永不轮转迟早长成没人敢读的文件。
- `lib/roundstate.mjs`：`healthExtra()` 加 1 秒读盘缓存（`HEALTH_MEMO_MS`），
  `readHealth({ memoMs })` 可绕开（默认 1000，传 0 = 直读）；新增 `dropHealthMemo()`，
  `writeHealth()` / `appendRound()` 写完主动清缓存。
  面板 5 秒轮询一次 `/schedule`，一次要读 jobs（最多 3 × 256 KB）+ `autopilot-state.json`。
- `tests/health-extra.test.mjs`：改成"要立刻读到刚写的账就传 `{memoMs:0}`"，另加 2 例
  —— 同一秒内账本变了仍给缓存、绕开/清缓存后给新值；写 health 会主动清缓存。
- `tests/autopilot-clock.test.mjs`：+2 例 —— `status().nextReportAt`（停着 null、跑起来是本地 22:30 的 ISO）；
  `rotateLog`（没到顶不转、到顶转 `.1`、再超不攒 `.2`）。

### 没动（要改语义，先出方案）

- `/inbox/count` 返回结构、`worth` 的 72 小时线、面板默认 tab：见交付说明的「待确认」列表。

## 0.4.7 — 2026-11-08（收三个尾巴：感想、定点重排、收件箱口径）

三件都是 11-07 验收时挂账的东西，不改功能、不加能力。

### 改

- `index.js`（`tellOwner` 里那段感想）：`String(await generate(...))` → `textOfResult(g)`。
  根因：`lib/duty.mjs` 的 `generate()` 回的是 `{ok, text}`，整个对象被 `String()` 就是
  `[object Object]` —— 11-07T12:59:45Z 那条发给主人的私信正是这么来的（`notify-state.json`
  里的 `say` 也一起被污染）。取不到正文就返回空串，交给下面那句「这条想给你看看：…」兜底。
- `lib/text-guard.mjs`：默认从**观察**翻成**拦截**（`guardMode()`）。非字符串正文现在
  `ok:false` 直接拒发，错误串里带 `rawType`；想退回记账模式设
  `DOUYIN_STUDIO_TEXT_GUARD=observe`（`off` / `0` / `false` / `warn` 同义）。
  新增 `textOfResult(v, {fields})`：从 `{text|say|content|reply}` 里取正文。
- `lib/autopilot.mjs`：新增 `rearm()`。`armDaily()` 以前只在 `start()` 里跑一次，
  面板把 `reportAt` 从 22:30 改成 00:30 得重启宿主才算数；`rearm()` 就地按新时间重排，
  自动巡航没在跑（`timer` 为空）时返回 `running:false`，不会把机器人弄醒。
- `index.js`：`POST /settings` 保存成功后调 `AUTOPILOT.rearm()`，返回值里多一个 `daily`
  （`{at, wait}` 或 `null`），面板能立刻看到「下一次定点在什么时候」。
- `tests/text-guard.test.mjs`：重写。默认拦、`=observe` 退回、`textOfResult` 五种入参、
  外加一条**事故写法不许回潮**的源码检查（跳过注释行，查 `String(await generate(` 与
  `textOfResult(g)`）。
- `tests/autopilot-clock.test.mjs`：+2 例（没在跑不硬拉起来；在跑时改 `reportAt`，`daily.at` 跟着变）。

### 没改

- 禁改区一个字节没动：`lib/im-send.mjs`、`lib/api.mjs`、`lib/budget.mjs`、`lib/publish*.mjs`。
- `/inbox` 与 `/inbox/count` 的口径**只查清、没动代码**（结论写进交付说明与 `docs/STATUS.md`）：
  同一份缓存里两者是一致的（3 = dm 0 + at 2 + own 1，11-08 00:46 实测）；
  不一致只发生在「两次调用之间刷过一轮」或「面板只看 dm 一个区而角标是三区合计」。

## 0.4.6 — 2026-11-07（出站类型闸，**观察模式**，单独一批）

只做一件事：给"发出去的正文"加一道类型检查。和 0.4.5 分开提交、分开上线，因为这类闸门
一旦误拦，坏的是"该发的没发出去"，比 `[object Object]` 更难在半夜发现。

### 加

- `lib/text-guard.mjs`（新）：`rawTypeOf(v)` / `guardText(v, where)`。
  字符串原样通过；非字符串记 `rawType`（object / number / array / null …）后**仍然照发**
  （观察模式，等于只记账不拦），但 `rawType` 会随返回值一路带回。
  设 `DOUYIN_STUDIO_TEXT_GUARD=block` 才真的拒发，错误串里带 `rawType`。
- `lib/im-report.mjs`：`sendDirect()` 入口先过闸；返回值多一个可选 `rawType`。
- `lib/autopilot.mjs`：`runReport()` 把 `rawType` 一并写进 `autopilot-log.jsonl` 与返回值
  ——下次再出现 `[object Object]`，账里能直接看到"哪条链、原始类型是什么"。
- `tests/text-guard.test.mjs`（新，6 例）：字符串通过、object 记为 object 且放行、
  number/array/null 分得开、开 block 真拦、开 block 不误伤字符串、`where` 带得回去。

### 兼容 / 风险

- 默认（不设环境变量）= 行为与 0.4.5 完全一致，只是多一个返回值字段；
  唯一可见差异是 `rawType !== 'string'` 的调用会多带一个键。
- 观察一天后若 `autopilot-log.jsonl` 里没出现 `rawType`，说明链路本来就是干净的，
  可以直接把开关当默认收紧，或者干脆删掉这一层。

## 0.4.5 — 2026-11-07（可观测 + 定时对齐；不新增能力）

这一版全部来自实弹里"看得见但查不动"的四件事：54s 的 scan 花在哪、11-04 起连挂 11 次的
日报为什么只剩一条记录、22:30 的日报为什么 22:49 才发、同时开 4 个抖音页时为什么"点得着却打不开"。
一条行为都没改，改的是"以后再出这类问题，能不能一次问清楚"。

### 加

- `lib/jobs.mjs`：`runJob(name, fn)` 的 `fn` 现在会收到一个 `mark(名字)`。每按一次记一段耗时，
  账行落成 `phases: { feed: 41000, judge: 900 }`（每段是"距上一个 mark"的毫秒）。
  老作业函数不接参数照跑；没调 `mark` 的作业账行里不会多出这个字段。
- `lib/jobs.mjs`：账本按月轮转 —— `jobs-YYYY-MM.jsonl`（当月）+ 往前读 2 个月；
  0.4.4 之前的 `jobs.jsonl` **仍然会被读到**，历史不用搬家。
- `lib/jobs.mjs`：`readJobs(n)` 改尾部读（最多 256KB / 一次），不再整份读进来。
- `index.js`：`startPicksCollect(mark)` 埋三段 —— `feed`（浏览器 + 滚动 + 网络，这一跳最贵）、
  `judge`（打分）、`save`（写库）。
- `lib/autopilot.mjs`：新增 `autopilot-log.jsonl`。state 里的 `log` 仍然只留 20 条给面板看，
  但每一行同时追加进这个文件，永不覆盖 —— 11-04 到 11-07 那 11 次 report 失败就是被 20 条挤掉的。
- `lib/autopilot.mjs`：`reportAt` 单独对表。`start()` 里多一个 `armDaily()`：按 `reportAt`
  排一个 `setTimeout`（跨零点自动 +24h），到点就跑；30 分钟的 tick 保留，只当"睡醒补跑"。
  新增纯函数 `clockMinutes()` / `msToNextClock()`（读不出来返回 null，不猜时间）。
- `lib/chrome.mjs`：`openPage({ want })` 与 `matchTab(tabs, host, want)`。
  传了 `want`（如 `'/chat'`）就先按 pathname 精确命中、再按前缀命中，命中不到**返回 null 去开新页**，
  不再退回"同域随便一张"。不传 `want` = 老行为，一个字节没变。
- `lib/im-report.mjs`：发日报改 `openPage({ url: CHAT_URL, navigate: true, want: '/chat' })`。
- `lib/roundstate.mjs`：`readHealth()` 多返回两块**派生**字段（读时算，不写盘）：
  `last: {scan, report, publish}` 最近一次成功的时间；`took: {n, p50, p95}`（样本 < 5 不出现）。
- 测试 +20 例：`tests/jobs.test.mjs` +3（phases 落账 / 无 mark 不写字段 / 跨月与老账本一起读）、
  新增 `tests/chrome-tab.test.mjs`（5 例：老行为不变、精确命中、命中不到返 null、前缀、坏 url）、
  新增 `tests/autopilot-clock.test.mjs`（7 例：对表纯函数 + 明细账追加）、
  新增 `tests/health-extra.test.mjs`（5 例：last/took 派生 + 不写盘）。
- `docs/STATUS.md`：重新生成（client.js 1740、index.js 1151）。

### 没做（有意）

- `lib/api.mjs`、`lib/budget.mjs`、`publish*` 三件套：一个字节没动（禁改区）。
- `picks.json` 48KB 全量读：先只改 `jobs`，picks 的结构动到面板读法，单独一批再议。
- `settings.json` 单写者：**暂缓**。查了实现，`writeSettings()` 是 `readSettings → normalize → atomicWriteJson`
  全同步、单进程内无 await 断点，同进程的并发写不可能发生；只有两个插件实例共用同一个
  `DOUYIN_STUDIO_HOME` 才会撞（那是 11-07 修掉的双实例问题）。真再现再加 `rev`。
- 反检测 / 浏览器启动参数：登录风险，照旧不碰。

## 0.4.4 — 2026-11-07（只加观察项，不改行为）

这一版的目的是**让下一次改动有证据**：scan-round 出现过 1.2s 和 63.6s 两种耗时，
账里只有 `took` 一个数，分不清是逻辑慢还是浏览器那一跳慢。

### 加

- `lib/jobs.mjs`：`runJob(name, fn, { preflight })`。预检耗时记进 `pre`（毫秒），
  预检抛错记 `-1` 且**不影响作业本身**；没给 `preflight` 时账里不出现该字段（旧读法不变）。
- `index.js:1099`：`scan-round` 传入 `preflight: listTabs` —— 只量「CDP 还活着吗、回多慢」。
- `tests/jobs.test.mjs`：3 例（pre 量到、预检抛错不影响、无 preflight 不写字段）。
- `tests/tool-output.test.mjs`：+2 例，把契约扩到**全部 36 条工具**
  （名字前缀、对象 schema、有描述、无重名）。
- `docs/STATUS.md`：重新生成（index.js 1146 行）。

### 没做（有意）

- 发布链、`api.mjs`、`budget.mjs` 一个字节没动（禁改区）。
- 没有按 `took` 里的 63.6s 下结论：等 `pre` 攒够 3 天再判断要不要改等待逻辑。

## 0.4.3 — 2026-11-07（P0：三条新工具全废 + 日报连挂 11 次）

这一版只修「已经坏掉、而且没人发现」的东西，没加新能力，也没碰禁改区。

### 修

- `lib/tools-extra.mjs:19`：`ok()` 原来返回 `JSON.stringify(v)`（**字符串**），
  而三条工具的 `output` 用的是 `index.js:178` 的 `textOutput`，schema 是 `type:'object'`。
  宿主校验不过 ⇒ `unattended` / `engage` / `jobs` 一律报
  `invalid output: "value" must be an object`（v0.4.2 上线即全废）。
  现在统一返回对象，和 `lib/tools.mjs:48` 的 `safe()` 同语义。
- `lib/autopilot.mjs`：日报不再靠昵称找会话。`runReport()` 改走 `sendDirect()`：
  **uid 优先**（`settings.ownerUid`），昵称只做兜底；发送前先 `Page.navigate` 到 `/chat`。
- `lib/im-locate.mjs`（新）：会话定位。sec_uid 从会话项的 React fiber
  （`conversation.toParticipantSecUserId`）读，再反查成数字 uid 比对；
  点开后用消息区 fiber 校验「当前会话的对端」，对不上就不发。
- `lib/im-report.mjs`（新）：日报发送链。①落到 `/chat` ②按 uid 找人 ③校验目标
  ④写文字并回读 ⑤Enter ⑥接口回读（`read({uid})`）确认「我发的」那条真的存在。
- `lib/settings.mjs`：新增 `ownerSecUid`（可选）。填了之后昵称彻底不参与定位。
- `tests/tool-output.test.mjs`（新，4 例）：钉死「声明 `type:'object'` 的工具，execute
  必须真的返回对象」。已用回滚验证：把 `ok()` 改回 `JSON.stringify` 时这 4 例会红。
- `docs/STATUS.md`：重新用 `node tools/status.mjs` 生成（client.js 1740 行、lib 65 模块）。

### 没做（有意）

- **禁改区一个字节没动**：`lib/im-send.mjs` 仍按昵称找会话（它的哈希还在 `tools/protected.json` 里）。
  新流程另开 `im-locate` / `im-report` 两个文件，旧路径（手动私信、`dy.mjs im`）行为不变。
- 反检测 / Chrome 启动参数：属登录风险，没动。
- 没引依赖：`puppeteer-core`、`node:sqlite`、`croner` 都评估过，
  但这一版的目标是"修坏掉的"，不是换栈；换栈要单开一版并配回归。

## 0.4.2 — 2026-11-06（把"没人盯着"那一半补上）

上一版解决"出事能停、第一次不闯祸"，这一版加的是**没人点也能跑**的骨架。
三样都默认关：`unattendedPublish`、`engageOn`，以及任何自动执行。

### 加

- `lib/jobs.mjs`：后台作业（串行、退避重试 2 次、每一步先看总闸、账在 `jobs.jsonl`）。
  一轮刷视频现在是一个作业，失败不再整轮作废。
- `lib/unattended.mjs`：无人值守发布的四道闸（开关 / 窗口 / 额度 / 首跑 dry + 总闸），
  账在 `autopublish.jsonl`，按本地日期数额度。
- `lib/engage.mjs`：主动互动规划器（白名单 + 每人每天 1 次 + 总额度 + 间隔），
  **只出清单不执行**，账在 `engage.jsonl`。
- `lib/tools-extra.mjs`：`douyin_studio_unattended` / `douyin_studio_engage` / `douyin_studio_jobs`。
  单独一个文件是为了不让 `tools.mjs` 撞 760 行体量闸。
- `prompts/operate.md`：模型层守则（首跑必 dry、declare 必填、stop 就是停手），
  SKILL.md 首段引用；check 里新增一条保证它不被删。
- CLI：`unattended`、`engage` 两条命令；`publish --auto`。
- 测试：`jobs`(4) / `unattended`(7) / `engage`(6)。

### 改

- `lib/tools.mjs`：publish 加 `auto` 参数，只有显式给了才走无人值守；成功落一条自动发账。
- `lib/settings.mjs`：新增 8 个字段（4 个无人值守、4 个互动），全部默认关。
- `index.js`：`scanTick` 里那一轮刷改成 `runJob('scan-round', …)`。
- `tools/check.mjs`：14 → **16** 条（新能力默认关、提示词守则），工具契约同时看两个注册文件。
- `SKILL.md` / `README.md`：三条新工具的姿势、"四条闸"与"只出清单"的边界。
- `package.json`：0.4.2；`files` 加 `prompts`。

### 没做（有意）

- 自动执行互动：这一版只规划。让模型自己决定"给谁评论"，一次判断错就是公开事故。
- 面板按钮：`unattended`/`engage` 目前只在工具与 CLI 里，先看几天清单再加界面。
- 禁改区照旧未动；反检测参数没加（要动 `lib/chrome.mjs` 的启动参数，属于登录风险）。

## 0.4.1 — 2026-11-05（按 `docs/汇总-项目理解与改进全集-2026-11-05.md` 落地）

只做了一件事：**把审计里"不做就不该继续对外用"的那几条，从文档变成代码**。
没动禁改区（7 个文件哈希未变），没加依赖，没改客户端构建产物以外的样式真源。

### 加

- `lib/killswitch.mjs`：全局停损。`$DOUYIN_STUDIO_HOME/KILL` 存在即停，
  只挡写操作（回评/私信/@/分享/发布/删除/队列重试），dry 与只读一律放行。
  工具层（`lib/tools.mjs` 的 `writeIntent`）、CLI（`tools/dy.mjs` 的启动闸）、
  HTTP（`GET/POST /kill`）三条入口读同一个文件。
- `lib/firstrun.mjs`：首跑必先 dry。没成功 dry 过就不许 `publish: true`；
  dry 通过或真发成功都会解锁（`$DOUYIN_STUDIO_HOME/first-run.json`）。
- 工具 `douyin_studio_kill`（`status` / `on` / `off`）；CLI `dy.mjs kill on|off|status`。
- 面板：顶部「停损 / 解除停损」按钮 + 已停损红标；收件箱顶部停损横幅。
- 测试：`tests/killswitch.test.mjs`、`tests/firstrun.test.mjs`、
  `tests/killgate.test.mjs`、`tests/contract.test.mjs`（共 19 例新增）。
- 自检：`工具契约`、`打包完整`、`默认只读`、`命令行一致` 四条（check 从 10 条到 14 条）。

### 改

- `lib/tools.mjs`：发布标题描述改为 `titleHint()`（原来手写「视频 ≤55」，实际 30）；
  `declare` 在真发/存草稿时必填，真发不许 `none`；publish 成功后落首跑状态。
- `lib/settings.mjs`：`DEFAULTS.scanRounds` 3 → 0（新装不自己刷）。
- `index.js`：`watchOn` 默认 false；盯私信/值班/自主执行/刷轮次都先看总闸；
  `/inbox` 回包里带 `kill` 状态。
- `SKILL.md`：补 `replies` / `detail` / `digest` / `comment_at` / `kill`；
  发布段写清 declare 必填与首跑 dry。
- `README.md`：首屏风险与定位；停损用法；安全边界补三条。
- `package.json`：`files` 补 `assets` / `tests` / `docs` / `jsconfig.json`；版本 0.4.1。
- `tools/dy.mjs`：`doctor` 回显停损状态；publish 分支加 declare / 首跑两道闸。

### 没做（有意留在文档里）

- 禁改区（`budget` / `api` / `im-send` / `publish` / `publish-steps` / `publish-cli` / `publish-cdp`）一律未动。
- 工具风险注解（readOnlyHint 等）：当前宿主 `defineTool` 不认这些字段，做在工具层只是自欺，改为"写清单 + 总闸"。
- 自动对账、告警通道、SLO 面板等 P1：需要新数据源，留到下一轮。
