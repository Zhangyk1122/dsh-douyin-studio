# 上架：让任何人一条命令装上

这份文档只讲「怎么让别人也能装」。本机已经能跑，上架要的是三件事：**发布、被收录、被搜到**。

---

## 0. 先补齐 package.json 的三个字段

市场靠这三样认人（缺 repository 的条目通常直接被索引脚本跳过）：

```json
"repository": { "type": "git", "url": "git+https://github.com/dbbdbdhdbxb-design/dsh-douyin-studio.git" },
"homepage": "https://github.com/dbbdbdhdbxb-design/dsh-douyin-studio#readme",
"icon": "assets/logo.svg"
```

`description` / `keywords` 已有（`deepseek` `harness` `dsh` `dsh-plugin` `douyin` 等），别删——
市场按关键词分类，删了就只剩「按名字搜」。

---

## 1. 发布到 npm

```bash
cd C:\Users\admin\.dsh\plugins\dsh-douyin-studio
npm run check                 # 自检 + 全量测试，必须 PASS
npm publish --access public   # 必须发到 registry.npmjs.org
```

三个坑：

1. **不能发到 npmmirror**。本机 `~/.npmrc` 指着 `registry.npmmirror.com`（只读镜像），
   发布前先 `npm config set registry https://registry.npmjs.org/`，或者
   `npm publish --registry https://registry.npmjs.org/`。
2. 包里 `files` 已经把 `index.js / client.js / lib / tools / prompts / assets / SKILL.md /
   CHANGES.md / cordis.patch.yml` 都带上了——**运行时一个文件都不能少**，
   `tools/check.mjs` 的「打包完整」会盯着。
3. 名字 `dsh-douyin-studio` 在 npm 上若已被占，只能改名（`@你的scope/dsh-douyin-studio`），
   同时把 `dsh.bundle.patch` 与 README 里的安装命令一起改。

---

## 2. 被 market 收录

market（`dshmarket`）的索引源是：

- `https://awesome-dsh-plugin.com/plugins.json`
- 目录站：`https://awesome-dsh-plugin.com`

收录方式是在 `awesome-dsh-plugin` 仓库提一个 PR，往清单里加一条（字段与现有条目保持一致）：

```json
{
  "name": "dsh-douyin-studio",
  "description": "抖音工作室：收件箱、自动回评/私信、发布、预算与面板",
  "repo": "https://github.com/dbbdbdhdbxb-design/dsh-douyin-studio",
  "npm": "dsh-douyin-studio",
  "tags": ["douyin", "automation", "dsh-plugin"],
  "author": "dbbdbdhdbxb-design"
}
```

PR 合并后，market 的「发现」页会在下次拉索引时出现它（本机也能立刻验证：
设置 → 插件 → 市场 → 刷新索引）。

---

## 3. 不经过市场也能装（保底路径）

用户在 DSH 里执行：

```bash
dsh plugin --profile <profile> add dsh-douyin-studio
```

或者直接把 GitHub 仓库地址给 `add`（market 与 CLI 都认 git 依赖）。

**注意**：桌面版用的是自己的 profile（本机是 `desktop`，不是 `web`）。
写成 `web` 会装进另一个 profile，桌面端看不见——README 里要写清这一点。

---

## 4. 首次使用清单（决定「别人装完能不能跑起来」）

1. 本机有 Chrome / Edge（`DOUYIN_BROWSER` 可指定路径）。
2. 打开插件面板 → 登录抖音（扫码）→ 设置里填 `ownerUid`（主人数字 uid，用来按 uid 找人，不靠昵称）。
3. 确认调试端口（默认 9334）没被别的程序占用。
4. 先跑 `doctor`：`node tools/dy.mjs doctor`，应显示 `cdp up` 且账号 uid 有值。
5. 默认是**只读**：不自动刷、不自动回。要开自动，得自己去设置里开，并过总闸（KILL 文件）。

---

## 5. 上架前最后一遍

```bash
node tools/check.mjs            # 不加 --quick：连测试一起跑
node tools/status.mjs           # 重生成 docs/STATUS.md
git status                      # 必须 clean
```

- `check` 里「禁改区 7 个文件哈希未变」必须 ✓：那 7 个是发私信/发布/预算的核心，
  第三方 PR 改了它们要人工过一遍。
- 版本号、`CHANGES.md`、`docs/STATUS.md` 三者要对得上。