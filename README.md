# dsh-douyin-studio-zk（fork）

一个跑在 [DeepSeek Harness](https://github.com/deepseek-ai) 里的抖音工作台：看作品、评论、私信、通知，回评、发图文和视频、盯私信、看数据趋势，并且**能看懂 @ 它的视频和图文**。

> **上游**：[dbbdbdhdbxb-design/dsh-douyin-studio](https://github.com/dbbdbdhdbxb-design/dsh-douyin-studio) @ 43531b6（v0.7.20，MIT）。
> 本 fork 在上游基础上加了白名单/额度、图文支持、以及一套「视频理解」能力（详见 [docs/LOCAL-CHANGES.md](docs/LOCAL-CHANGES.md)）。

一套 core，两层入口：**DSH 工具**（douyin_studio_*）和**命令行**（node tools/dy.mjs …）。

> ## 先读这一段（风险与定位）
>
> 它是给**单个账号、私人在自己的机器上**用的工具，不是给陌生人批量运营的服务。
> - 驱动你**真登录着的浏览器**：发出去的话、删掉的评论，都是真的、撤不回来。
> - 抖音没给这种用法发许可证，自动化可能触发风控（限流/验证码/封禁），风险自担；出事先「停损」。
> - 自主执行默认全关，从 draft / dry 起步。
> - 别拿它做刷量、刷评、多账号、代运营。

## 本 fork 新增了什么（相对上游）

| 功能 | 说明 |
|---|---|
| **白名单 + 每人每天额度** | 只回白名单里的人，每人每天可设独立 quota；面板新增「白名单」页，轮询改随机间隔 |
| **待回角标修复** | /inbox、/inbox/count 扣掉已回复条目；按 last_at > replied 判待回，不再回过一次就永远不算待回 |
| **图文支持** | projAweme 投影 aweme_type / images / image_count，@ 图文能取图交给视觉模型 |
| **ffmpeg 跨平台探测** | Mac/Linux 不用再手动设 DOUYIN_FFMPEG，自动找 PATH / 常见路径 |
| **视频理解** | 新增工具 douyin_studio_video_understand，接 [video-watch-plus](https://github.com/xinhailaopo/video-watch-plus)，做结构量测 + 声学判型 + ASR 转写证伪 + 拼图 |

## 安装

```bash
# 从本 fork 安装
dsh plugin --profile desktop add "dsh-douyin-studio-zk@github:Zhangyk1122/dsh-douyin-studio"
```

或克隆后本地 link：

```bash
git clone https://github.com/Zhangyk1122/dsh-douyin-studio.git
cd dsh-douyin-studio
dsh plugin --profile desktop add link:$PWD
```

装完**重启 DSH**。首次使用：面板扫码登录 → 填 ownerUid → node tools/dy.mjs doctor 确认 cdp up。

## 视频理解（本 fork 新增，可选）

video-watch-plus 已**打包进本仓库**（vendor/video-watch-plus/，MIT），不用再单独 clone。只差外部环境：ffmpeg + 一个带 faster-whisper 的 python。环境变量：

| 变量 | 说明 |
|---|---|
| VW_DIR | 可选。默认用插件自带的 vendor/video-watch-plus，一般不用设 |
| VW_PYTHON | 装了 faster-whisper（1.2.x）+ numpy + Pillow + av<19 的 python |
| VW_FFMPEG | ffmpeg 路径（含 scdet/freezedetect/drawtext 的完整构建） |
| VW_FFPROBE | ffprobe 路径（可选，缺了 video-watch-plus 会用不了） |
| HF_HOME | faster-whisper 模型缓存目录 |

Windows 上只需装两样东西（一次性）：

```powershell
# 1) ffmpeg（含 ffprobe，完整构建）：winget install ffmpeg  或从 gyan.dev 下载
# 2) python venv + faster-whisper
python -m venv .venv-asr
.venv-asr\Scripts\pip install faster-whisper numpy pillow "av<19"
# 然后把 VW_PYTHON 指到 .venv-asr\Scripts\python.exe
```

首次转写会自动从 hf-mirror 下载模型（约 460MB，small），之后不再下载。

视频理解的两条链（**由模型根据你 @ 时说的话判断**，不用代码正则）：

```text
@ 视频 → api.detail 判「视频/图文」（接口字段，代码做）
  ├─ 视频 + mode=transcribe → 只做 声学判型 + ASR 转写（省 token）
  └─ 视频 + mode=watch       → 全量：结构 + 声学 + 转写 + 4×4 拼图
@ 图文 → 取图地址 → 交给视觉模型
```

## @ 提示词速查

| 想让它做 | 直接说 |
|---|---|
| 看视频全貌 | 帮我看看这个视频说的是什么 |
| 只把语音变文字 | 转写这段语音 |
| 读图 | 帮我看看这张图里是什么 |
| 读图上的字 | 图上的字读一下 |

核心一句话：**要画面就带「画面/看看/视频」，只要声音就带「音频/转写/语音」**。

## 安全边界

- 不存密码/cookie 到库，登录态只活在浏览器 profile。
- 默认只存草稿；每天上限：发布 5、评论 20、私信 15、@ 10、自己作品下 5（小时级更细，见 lib/budget.mjs）。
- 删除不可撤销；首跑必须 dry；真发必须给 declare（一般 ai）。

### 停损（出事就按这个）

```bash
node tools/dy.mjs kill on  --reason "风控提示 1200"
node tools/dy.mjs kill status
node tools/dy.mjs kill off
```

开着的时候：回评/私信/@/分享/发布/删除/队列重试一律拒；只读动作不受影响。

## 预算（四类消息共用一份账本）

| 通道 | 每天 | 每小时 | 最小间隔 |
|---|---|---|---|
| 回评论 | 20 | 6 | 45 秒 |
| 私信 | 15 | 5 | 60 秒 |
| 回 @ | 10 | 4 | 60 秒 |
| 自己评论区 | 5 | 3 | 30 秒 |
| 发布 | 5 | 2 | 120 秒 |

## 命令行 & 文档

- 完整命令用法 → docs/COMMANDS.md
- 自主执行四道闸 → docs/AUTOPILOT.md
- 面板与内部约定 → docs/INTERNALS.md
- 发布流程与真机坑 → docs/PUBLISH.md
- **本 fork 全部改动清单 → docs/LOCAL-CHANGES.md**

## 测试

```bash
node --test tests\*.test.mjs
```

73 个文件、708 例（本地逻辑测试；绿灯不代表发布成功，发布那部分要真页面跑一遍才算数）。

⚠️ DSH 沙箱里 node --test 会 spawn EPERM，要一个个文件跑：node tests\budget.test.mjs。

## 已知边界

- 回评走网页接口（不是官方开放平台），风控由页面自己处理。
- 发布走 CDP 点真页面，稳定但一次只能发一条视频。
- 视频理解里的「下载 play_url → 本地文件」这步依赖登录态，需在真实登录的机器上验证。
- video-watch-plus 的 read（裁切放大读小字）依赖 ImageMagick；studio 集成里拼图只用 ffmpeg，不装 magick 也能看图。

