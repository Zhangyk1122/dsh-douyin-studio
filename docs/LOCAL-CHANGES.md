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
4. **`watch`（新私信即时回）在 0.7.20 是坏的**：`douyin_studio_watch` 报 `WATCH.start is not a function`，所以没有即时回，只能等随机拍
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
