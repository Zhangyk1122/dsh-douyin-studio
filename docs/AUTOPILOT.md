# 它自己动的时候

> 从 README 拆出来的。三件事（无人值守发布 / 主动互动 / 自主回评）都默认关，
> 这里的每一条都是「开了之后它到底按什么判」。

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

