> **包名已改为 `dsh-douyin-studio-zk`**（避免与上游 `dsh-douyin-studio` 在插件市场重名）。安装用 `dsh-douyin-studio-zk@github:Zhangyk1122/dsh-douyin-studio`。

# dsh-douyin-studio local patches (exported 2026-11-19)

> 本文件用 ASCII 文件名（LOCAL-CHANGES.md），避免 macOS 解压时中文名乱码。
> 内容里的中文不影响使用。

## 这是什么

- **包**：`dsh-douyin-studio` v0.7.20（DSH 抖音工作台插件）
- **来源**：`github:dbbdbdhdbxb-design/dsh-douyin-studio#43531b6c808d0f93260f07bdb71e852c1e2e969e`
- **原始安装位置（Windows）**：`C:\Users\Z\.dsh\profiles\desktop\node_modules\dsh-douyin-studio`
- **导出时间**：2026-11-19 23:0x
- 本目录是**打补丁后的工作副本**，`.bak*` 是每次改动前的原始文件，可直接 diff。

> ⚠️ **不含任何密钥**。API key 在 `~/.dsh/.credentials.yaml` 与 `~/.dsh/.env`（`DEEPSEEK_API_KEY`），不要随包分发。

## 解压说明（Win / macOS 通用）

打包方式：Python `zipfile` + `ZIP_DEFLATED`，**正斜杠路径 + 标准 UTF-8 文件名标志**，macOS「归档实用工具」/ Windows 资源管理器 / unzip / 7-Zip 均可正常解压。

```bash
unzip dsh-douyin-studio-0.7.20-patched-2026-11-19.zip -d ~/somewhere
# 目录结构：
#   dsh-douyin-studio/      ← 插件本体
#   LOCAL-CHANGES.md        ← 就是你正在读的这个
```

**放到 Mac 的 DSH 里**：把 `dsh-douyin-studio/` 覆盖到该机器 profile 的 `node_modules/dsh-douyin-studio`（macOS 一般是 `~/.dsh/profiles/<profile>/node_modules/dsh-douyin-studio`），然后重启 DSH。
注意 Mac 上**没有** `C:\Users\Z\...` 这套路径，`.bak` 文件里的路径只作参考。

---

## 一、改了什么（按文件）

### 1. `lib/settings.mjs`
- 新默认值：`replyEveryMin: 30`、`replyEveryMaxMin: 180`、`replyWhiteList: ''`、`replyWhitePerDay: 3`、`whitelist: []`
- 钳制：`whitelist` 最多 30 条，每条 `{nick≤60, uid≤40, quota 1~50, role owner|guest}`

### 2. `lib/autopilot.mjs`
- `whiteAllowed(s, {uid, nick})`：`whitelist` 数组优先（uid 或 nick 匹配）；空数组回落 `replyWhiteList` 字符串；都空 = 不限制
- `quotaFor(s, {uid, nick})`：取白名单里的 `quota`，没有则 `replyWhitePerDay`
- `repliedMap()`：导出 `dm.replied` / `at.replied`（给"待回"扣减用）
- `_runDm`：`pickDm` 后过滤 —— 白名单 + `BUDGET.peerCount('dm', peer) < quota`
- `runAt`：`pickAt` 后加白名单过滤（@ 没有每人额度，见已知限制）
- `start()`：固定 `setInterval` 改为**随机间隔**，每轮现读设置（面板改完下一轮生效）
- `stop()`：`clearTimeout` + `clearInterval`

### 3. `lib/budget.mjs`
- 新增 `peerCount(ch, peer, now)`：数某人今天在某通道的条数

### 4. `index.js`
- `syncBudget()`：每人每天额度取白名单最大 `quota`；`ownerUid` 传空 → **取消主人自动豁免**
- `AUTOPILOT.start`：改用 `settings.replyEveryMin / replyEveryMaxMin`
- 新增 `adjustInbox()`：`/inbox` 返回前扣掉已回复的条目并打 `replied: true`
- `/inbox/count`：角标同样扣已回复
- **2026-11-19 22:55 修复**：`dmIsPending(x)` —— `replied[uid]` 存的是"上次回的那条消息时间"，必须比较 `x.last_at > replied[uid]` 才算待回（否则回过一次就永远不算待回）。`/inbox`、`/inbox/count` 两处都用它。

### 5. `lib/dashboard.mjs`
- `import { repliedMap }`
- `buildSnapshot()` 构建 hero 前按 `repliedMap()` 过滤 dm/@，并传 `pendingOverride`
- dm 部分同样按时间比较（`last_at > replied` 才算待回）

### 6. `lib/viewmodel.mjs`
- `heroView({..., pendingOverride})`：支持外部传入已扣过的 pending（0 显示 0，无数据才显示「—」）

### 7. `client.js`（面板）
- **新增「白名单」页**：顶部 tab「今天 / 回应 / 找内容 / 设置 / 白名单」；一行一人：昵称 / uid（可选） / 每天额度 / 角色（主人|成员），可增删改
- 「自主执行」顶部新增共享节奏：**最短间隔(分) / 最长间隔(分)**（管整轮：私信/@/发布/报平安）
- 「回评论」行新增 **间隔(分)**（`dutyEveryMin`），保存即重排值班定时器
- 文案更新（旧的"定时器每 5 分钟"已改）

### 8. `cordis.patch.yml`（插件自带 bundle patch）
```yaml
- id: douyin-studio
  name: dsh-douyin-studio
  config:
    cdpPort: 9334
    profileDir: ""
    autoOpen: true
    perDay: 20
    limitsJson: '{"perDay":{"dm":999,"at":999},"perHour":{"dm":999,"at":999},"minGapSec":{"dm":3,"at":3},"totalPerDay":9999}'
```
> 注意：`limitsJson` 写到 profile 的 `cordis.patch.yml` **不生效**（实测 budget 仍显示默认值），必须写在插件自带的这个文件里。

---

### 9. `lib/api.mjs`（2026-11-20 新增）
- `projAweme()` 补投影图文图片：`images`（每个取 `url_list[0]`，最多 35 张）+ `image_count`。
- 作用：@ 图文作品时能拿到图片地址，交给视觉模型看图（视频的 images 通常为空数组）。

### 10. `lib/frames.mjs`（2026-11-20 新增）
- 把写死的 `FFMPEG = env || 'E:\tools\ffmpeg\ffmpeg.exe'` 改成 `resolveFfmpeg()` 跨平台探测：
  env `DOUYIN_FFMPEG` → PATH（win: where / 其它: which）→ 平台常见路径 → 兜底。
- 作用：Mac/Linux 不用再手动设 `DOUYIN_FFMPEG`，Windows 行为不变（仍回落 E:\tools）。

### 11. `lib/api.mjs`（2026-11-20 新增）
- `projAweme()` 补 `aweme_type` / `media_type`（判断视频/图文/单图的依据）。

### 12. `lib/understand.mjs`（2026-11-20 新增，新模块）
- `classifyAweme(d)`：判型 video | image | unknown（看 aweme_type + images + play_url）。
- `understandVideoFile(media)`：把媒体交给 video-watch-plus 跑 probe + audio_probe + asr，返回结构化结论。
- `understand(awemeId)`：detail → 判型 → 视频走 video-watch-plus / 图文返回图片地址。
- 依赖环境变量：`VW_DIR`（video-watch-plus 目录）、`VW_PYTHON`（带 faster-whisper 的 python）、`VW_FFMPEG`、`HF_HOME`。

### 26. 修私信「失败两次就永久不回」（2026-11-21，真机定位）
- **症状**：`dm.tries[peer]` 达到 `maxTries=2` 后 `pickDm` 直接 `continue`，这个人**永远**不再被回；而那两次失败是页面没修好时留下的脏数据。
- **修法**：tries 改成按「哪一条消息」计数 `{n, at}`——只有同一条消息失败够次数才跳过；新消息来了自动给新机会。失败记录同步改成 `{ n, at: c.at }`。
- 兼容旧数据：读到数字按 `{n, at:''}` 处理，因此旧脏数据会自动失效（本次也手动清了 `dm.tries`）。
- **验证**：清掉 tries 后下一轮（11:36:43）自动回了「跟着瞎晃呗，反正家里也没人看见」，会话回读确认已送达。

### 25. 修私信「文字拼接/写不进去」（2026-11-21，真机踩到两次）
- **症状 A**：dry 打完字不清空 → 下一次真实发送把旧文本一起发出去（实测发出「测试一下，别当真测试一下私信通道…」）。
- **症状 B**：`Input.insertText` 是「插入」不是「覆盖」，任何残留都会和正文拼起来。
- **症状 C**：坐标点击没落上焦点时 `insertText` 丢字，报「文字没写进输入框」。
- 修法：① dry 结束前清空输入框；② **每次打字前先清空**（selectAll+delete + Backspace）；③ 写入失败重试一次，且每次都重新读编辑器坐标 + JS 强制 focus。
- 验证：`sendByUi(dry)` 日志出现「dry 清空输入框（残留：）」；真实发送日志「文字已写入 → 输入框已清空」，`verified_http: true`。

### 24. 修私信发送：`openPage` 没真正落到 /chat（2026-11-21，对比上游后定位）
- **先纠正上一版判断**：`/chat` 路由没坏。坏的是 `openPage({url})` 在同域标签页已存在时会复用、并且只等 1.8 秒；不传 `want`/`navigate` 就可能压根没导航过去，于是读到的是**别的页**（首页外壳）→ 行数 0 → 报「会话列表里没有 XX」。
- 对比上游 `jackey670/dsh-douyin-whale`：它同样 `goto(CHAT_URL)`，但**等的是搜索框**、并且**用搜索框搜人**再点结果。结论：上游逻辑没问题，缺的是「确认真的落在 /chat」。
- 修法（两处调用点各一行）：`im-send.mjs` 的 `openPage({url})` → `openPage({ url: CHAT_URL, navigate: true, want: '/chat' })`；`im-report.mjs` 补上同样的 `want`。
- 验证：`sendByUi({ nick: '绿豆沙', uid: '111430736479', text, dry: true })` → `{ok:true, typed:'…', log:['找到行 绿豆沙','输入框出现','文字已写入']}`。
- 顺带说明：`uid` 认人（sec_uid→uid 反查）已生效，昵称只作兜底。

### 23. 图文作品会看图了（2026-11-21，实测通过）
- 新增 `lib/media-image.mjs`：`prepareImages()` 从 `detail.images[]` 下载（带 Referer/UA，失败重试一次）→ ffmpeg 缩到 1024 宽 jpg → 返回本地路径；`prune()` 保留最近 60 个文件。
- 新增 `duty.generateWithImages()`：直连 profile 配的模型，OpenAI 多模态格式发图（`image_url` base64）。
- `runAt` 接入：图文作品（`images[]` 非空）→ 下载最多 3 张 → 带图 + **会话最近 3 轮摘要**生成回复；任何一步失败静默退回纯文字。
- 开关：`atUnderstandImages`（默认 true）、`atImageMax`（默认 3）、`atImageMaxWidth`（默认 1024）。
- **实测**：9 图壁纸帖取前 2 张 → `prompt_tokens: 1150 / completion: 597`（reasoning 575），回复「第二张粉紫天色配那几棵松树真绝了」——核对原图完全正确（粉紫天空 + 松树 + 冰湖）。
- 坑：推理型模型 `max_tokens` 太小（200）会全被 `reasoning_tokens` 吃光、`content` 为空；设 ≥600 且只取 `content`。

### 22. 回复改走「固定会话 + 轮换」（2026-11-21，实测省 30 倍）
- 新增 `lib/llm-session.mjs`：状态存 `$DSH_HOME/douyin-studio/llm-session.json`（sessionId / turns / bornAt / recent / stat）。
- 新增 `generateViaSession()`：`dsh headless --json [--session-id <id>] -`，任务走 stdin；解析事件流拿 `sessionId` / 正文 / `usage`。
- 轮换规则：轮数 ≥ 50（`DOUYIN_LLM_SESSION_MAX_TURNS`）或超 24 小时（`..._MAX_HOURS`）换新会话；换时把最近 3 轮问答压成几行带过去，避免「换会话=失忆」。
- `generate()` 增加 `DOUYIN_LLM_MODE`：`session`（默认）/ `direct`（profile 直连，最便宜但无历史）/ `fresh`（每次新开）/ `api`（sk- key 走 api.deepseek.com）。
- **实测数字**：复用会话时 `cacheReadTokens: 6400 / inputTokens: 68~204`，缓存命中 **98%**；每条成本从 ¥0.0041 降到 **¥0.00013**（约 30 倍）。
- 实测记忆：第 2 轮问「我叫什么」答「小明」；把阈值调到 1 触发轮换后，新会话仍答「小明」（摘要带过去了）。
- 顺带：模型思考过程偶尔漏进正文（`XX</think>XX`），按最后一个 `</think>` 截断，再清残留标记。

### 21. 生成回复改用「本机 profile 配置的模型」直连（2026-11-21）
- 新增 `resolveLlm()`：读 `$DSH_HOME/profiles/<p>/cordis.patch.yml` 的 `agent-default-model`（provider+model）与对应 provider 的 `baseURL`/`apiKeyEnv`，key 从 `.credentials.yaml` 的 `refs` 取。**不写死任何厂商**，换机器读它自己的配置。
- `DOUYIN_LLM_BASE_URL` / `DOUYIN_LLM_API_KEY` / `DOUYIN_LLM_MODEL` 可整体覆盖。
- `generate()` 变成三级：readKey(sk- 真 key，走 api.deepseek.com) → **profile 直连** → `dsh headless` 兜底。
- 为什么重要：`dsh headless` 每次要把整套系统提示词+工具定义塞进去，实测 **inputTokens 6479**（outputTokens 7）；profile 直连只要几百 token，**省一个数量级**，且快（3.8s vs 数秒起会话）。
- 验证：`resolveLlm()` → `{baseURL: .../v1, model: DeepSeek-V4-Flash-Vision-Exp, via: "profile:desktop/oneapi"}`；`generate()` → `{ok:true, via:"profile"}`。

### 20. 修「@ 我 / 私信不回复」的第三层根因：生成回复在 macOS 上直接崩（2026-11-21）
- **bug C（最致命）**：`lib/duty.mjs` 的 CLI 回退写死 `spawn('cmd.exe', ['/c', 'dsh', 'headless', ...])` —— 只有 Windows 能跑，macOS/Linux 直接 `spawn cmd.exe ENOENT`，于是 `generate()` 必然失败 → 自动回复一条都发不出。改为 `spawnHeadless()`：按平台选 shell，并给 `dsh` 一个候选路径列表。
- **bug D**：headless 子进程拿不到宿主凭据 → `MISSING_CREDENTIAL: llm-deepseek ... deepseek-official`。现在从 `$DSH_HOME/.credentials.yaml` 的 `refs.DEEPSEEK_API_KEY` 注入 env。
- **bug E**：`readKey()` 正则 `[A-Za-z0-9_\-]{16,}` 遇到平台 key 里的点号（`ak_xxx.yyy`）会截断成 <16 位 → 静默返回空。改为允许任意非空白字符，但**只接受 `sk-` 开头**（api.deepseek.com 认的格式），其它交给 CLI 分支。
- 验证：`generate("说一句十个字以内的话")` → `{ok:true, via:"cli", text:"好的，就这样回答。"}`

### 19. 修「配了自动回复却一条都不回」（2026-11-21，真机定位）
- **bug A：昵称缓存路径算错**。`lib/names.mjs` 用「相对 lib 往上三级」定位 `douyin-duty`：`link:` 安装下算成 `<仓库父目录>/douyin-duty`，正常安装下算成 `profiles/<profile>/douyin-duty`，两种都和其它模块（`$DSH_HOME/douyin-duty`）读写的位置不同 → `nameOf()` 永远为空。改为 `$DSH_HOME/douyin-duty`。
- **bug B：昵称拿不到就永远不发**。`_runDm` 里 `if (!nick) skip「怕发错人」`，而 imapi 不给昵称、`/chat` 也可能抄不到（实测 `scraped:0`）→ 一条都不发。新增 `configuredNick()`：`ownerUid→ownerNick`、白名单 `uid→nick` 作为兜底。
- **顺带纠正**：回私信**不再被谷时窗口拦**（只有 `peakReply===false` 才按窗口拦）；被窗口拦的是发作品/回评论等。
- 验证：`configuredNick(111430736479)` → `绿豆沙`；用「对方刚发来新消息」的模拟会话跑 `pickDm` → 能选中（score 75），白名单放行。

### 18. 视频理解改成零配置（2026-11-21）
- `understand.mjs` 新增 `resolvePython()`：按 `VW_PYTHON` → `~/.dsh/douyin-duty/venv` → 插件 `.venv-asr`/`.venv` → `python3` 顺序探测，每个候选都验 `import faster_whisper`，结果缓存。
- 子进程默认注入 `HF_HOME=~/.dsh/douyin-duty/hf-cache`、`HF_ENDPOINT=hf-mirror`，模型缓存不再落到 `~/.cache`。
- 真机验证：**不设任何环境变量**跑 `video-understand` 成功（download/audioProbe/asr 全 ok，probe/grid 在 transcribe 模式跳过）。

### 17. 修复 `WATCH.status is not a function`（2026-11-21，真机验证）
- **根因（上游 bug）**：`45f338f`（0.6.1）把 `lib/watch.mjs` 从「盯私信守护」（tick/start/stop/status）整个重写成「看过这条视频的证据面」（watchOnce/watchOf/watchLine），但 `index.js`、`lib/tools.mjs`、`tools/dy.mjs` 仍在调 `WATCH.start/status/stop` → 函数不存在。从 0.6.1 一直坏到 0.7.20。
- **修法**：把 0.6.0（`6444d19`）的守护实现还原成独立模块 `lib/dm-watch.mjs`，`index.js` 的 `import * as WATCH` 改指到它，`tools/dy.mjs` 的 `watch` 命令同步改。
- **效果**：面板「开盯私信」不再报错；`watch once/status/start/stop` 可用；新私信可触发 `onFresh` 立刻回（就是你要的「发现即回」，不用等随机轮拍）。
- 验证：`node tools/dy.mjs watch status` 返回 `{ok:true, running:false}`；`watch once` 返回 `{ok:true, fresh:[], notified:0}`。

### 16. 修复视频理解取流 403（2026-11-21，真机验证）
- 抖音 CDN 拒 ffmpeg 默认 UA（403 Forbidden），带浏览器 UA + douyin.com Referer 就能拉。
- `understandVideoFile()` 加「下载」步骤：先用 ffmpeg `-user_agent UA -referer REFERER` 把 play_url 拉到本地 `media.mp4`，再交给 probe/audio_probe/asr/grid。
- 真机（登录测试号）跑通：download/probe/audioProbe/asr/grid 五步全 ok，正确转写「大山的小孩」预告片内容。

### 15. 内置 video-watch-plus + 包名改 zk（2026-11-20）
- 把 video-watch-plus 的 `vendor/vw.py`、`vendor/vwtools.py`、`scripts/audio_probe.py`、`scripts/asr_hallucination_check.py` 打包进 `vendor/video-watch-plus/`（MIT，保留 LICENSE/NOTICE）。
- `understand.mjs` 的 `defaultPaths()` 优先用自带的 vendor 目录，不再需要单独 clone 或设 `VW_DIR`。
- 包名改为 `dsh-douyin-studio-zk`（package.json + cordis.patch.yml），避免与上游重名。

### 14. `lib/understand.mjs` 补 grid 步骤（2026-11-20）
- `understandVideoFile()` 加第 4 步：ffmpeg `tile` 抽 16 帧铺 4x4 拼图，返回 `grid` 路径给视觉模型。
- **ImageMagick 不是必须的**：vw.py 的 grid/seq/read 用 magick，但 studio 集成只用 ffmpeg tile 即可看图。
  Mac 上 `brew install imagemagick` 因沙箱 SSL 装不上（ghcr.io/mirrors 证书校验失败），但不影响本功能。
  Windows 用 `setup-windows.ps1` 会装便携版 magick，需要 vw.py 独立 grid/read 时再装。

### 13. 新工具 `douyin_studio_video_understand`（2026-11-20 新增）
- `lib/tools.mjs` 注册工具 + `tools/dy.mjs` 加 `video-understand` 命令。
- 回评前先调它：视频跑三路理解，图文返回图片地址，别只凭标题猜。

## 二、当前配置（在 `~/.dsh/douyin-studio/settings.json`，不在本包内）

```json
autoDm/autoComment/autoAt = true, autoReport = false
ownerNick = "绿豆沙", ownerUid = "111430736479"
replyWhiteList = "绿豆沙,111430736479"
whitelist = [{ "nick": "绿豆沙", "uid": "111430736479", "quota": 5, "role": "owner" }]
replyEveryMin = 10, replyEveryMaxMin = 180
```
账号：`魔方转不动` uid `2394058848217452`（0 作品 → "回评论"无对象）

---

## 三、已知限制 / TODO

1. **@ 没有每人额度**：账本 `at` 条目 `peer` 为空（只记 `thread`），要做按人额度需先把对方 uid 写进 `budget.record({ch:'at', peer})`
2. **只处理 type 45/46**：`lib/inbox.mjs` `atCandidates` 写死 `type===45||46`；「回复我的评论」(31/32) 不触发
3. **`待回` 两处来源**：tab 角标 `/inbox/count` 与头部 `schedule.hero.pending`；都已修，但**必须重启 DSH** 才进宿主
4. ~~**`watch`（新私信即时回）在 0.7.20 是坏的**~~ → **已修（见第 17 条）**：原报 `WATCH.status is not a function`
5. **`limitsJson` 需重启生效**

---

## 四、免重启验证

```bash
node tools/dy.mjs schedule        # 看 hero.pending（读的是打过补丁的 lib）
```
工具：`douyin_studio_inbox` / `notices` / `budget` / `comments` / `replies`

---

## 五、恢复与升级

- **还原**：同目录 `.bak*`（`.bak`、`.bak2`、`.bak3`、`.bak-wl`、`.bak-wl2`、`.bak-badge`、`.bak-badge2`、`.bak-pending`）改名回去
- **升级会覆盖所有本地补丁**（`.bak` 也会丢），升级后照本清单重打
