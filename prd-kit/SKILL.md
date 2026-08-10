---
name: prd-kit
description: >
  铺设 / 拆分项目的 PRD 文档骨架（根 PRD.md + docs/PRD/{features,engineering,changelog}.md）。
  触发词：「创建项目 PRD」「初始化 PRD」「给 X 项目铺 PRD」「拆分 PRD」「拆分 features.md」，
  或 `/prd-kit create` / `/prd-kit split`。MUST trigger when the user asks to bootstrap a
  new project's PRD structure or split an over-600-line PRD file. Not for ongoing sync
  maintenance (use `doc-sync` / `neat-freak` instead).
license: MIT. See LICENSE
metadata:
  author: Guocan (AIFkdmks2046)
  version: "1.1.1"
---

# prd-kit — 项目 PRD 骨架铺设与拆分

> Cross-platform Agent Skill。Claude Code / OpenAI Codex / OpenCode / OpenClaw 通用。
> 走标准的 Claude Code Skill 加载流程（`SKILL.md` 入口）。

把项目 PRD 维护约定（根 `PRD.md` + `docs/PRD/{features,engineering,changelog}.md` 4 文件结构、`PRD.md §4` 5 条同步义务、§ 编号体系）封装成两个原子能力：

| Mode | 触发词 | 任务 |
|---|---|---|
| **Create** | "创建项目 PRD" / "初始化 PRD" / "给 X 项目铺 PRD" / `/prd-kit create` | 在目标项目根目录铺设 4 个骨架文件 |
| **Split** | "拆分 PRD" / "拆分 features.md" / `/prd-kit split` | 把超 600 行的 PRD 文件按业务边界拆细 |

Maintain（5 条同步义务的日常维护）**不在本 skill 范围内**——沿用 `doc-sync` / `neat-freak`。

## 启动自检（每次进入必跑）

```bash
test -f ~/.claude/skills/prd-kit/SKILL.md \
  && test -f ~/.claude/skills/prd-kit/templates/PRD.md.tmpl \
  && test -f ~/.claude/skills/prd-kit/templates/features.md.tmpl \
  && test -f ~/.claude/skills/prd-kit/templates/engineering.md.tmpl \
  && test -f ~/.claude/skills/prd-kit/templates/changelog.md.tmpl \
  && test -f ~/.claude/skills/prd-kit/references/split-pattern.md
```

任一缺失 → 报错「skill 安装不完整，请重装」并中止。**不要在没有模板的情况下继续生成**，否则会写出不一致的内容。

## 安全规则

1. **永远不覆盖已有文件**——已存在 → `.new-<YYYY-MM-DD>.md` 后缀；同日拍撞 → 计数器 A（`-2` / `-3`）。
2. **路径一律相对目标项目根，不写绝对路径到模板里**（跨平台兼容）。
3. **不修改 git 状态**——Create Mode 只 `Write` 新文件；Split Mode 的 MoveCut / 原文件替换为链接 / 更新 PRD.md §3 索引除外（拆分业务必需的文件修改，但仍不执行任何 git 命令）。
4. **路径含中文 / 空格无碍**——模板内容只用 `/` 相对路径，不拼接绝对路径。
5. **非 git 目录运行**——不阻止，不依赖 git（PRD 铺设和 git 状态解耦）。

---

## Mode A：Create（铺设骨架）

### 触发判定

匹配以下任一即进入 Create：
- 用户说「创建项目 PRD」「初始化 PRD」「给 X 项目铺 PRD」「铺一套 PRD」
- 用户说 `/prd-kit create`
- 用户说 `/prd-kit` 且未携带 split 关键字

### Step 1 — 确定目标项目

默认取 `cwd`（用户当前所在目录）。用户说 "在 X" / "给 X 项目" → 取 `X` 作为项目根。**目标必须是一个目录**——文件路径报错退出。

### Step 2 — 检测已存在文件（4 文件独立判定）

```bash
test -f <project>/PRD.md                      # 存在？
test -f <project>/docs/PRD/features.md        # 存在？
test -f <project>/docs/PRD/engineering.md     # 存在？
test -f <project>/docs/PRD/changelog.md       # 存在？
test -d <project>/docs/PRD                    # 父目录？
```

每个文件独立落入 4 类状态之一：

| 文件 | 不存在 | 存在 |
|---|---|---|
| `PRD.md` | "直接创建" | **需用户确认** |
| `docs/PRD/features.md` | "直接创建" | "静默加后缀" |
| `docs/PRD/engineering.md` | "直接创建" | "静默加后缀" |
| `docs/PRD/changelog.md` | "直接创建" | "静默加后缀" |
| `docs/PRD/` 父目录 | `mkdir -p` | 无操作 |

### Step 3 — 仅当 PRD.md 存在 → AskUserQuestion（单次弹）

```
PRD.md 已存在。要怎么处理？

  1. 生成 PRD-new-<YYYY-MM-DD>.md（避免覆盖，其他 3 份照常）
  2. 跳过 PRD.md，其他 3 份照常
  3. 取消整个 Create
```

**docs/PRD/ 的 3 个文件不需要询问**——它们静默走 `.new` 后缀，避免一次 Create 弹 4 次。

### Step 4 — 按各文件状态写文件

每个文件独立判断写哪个路径：

| 文件 + 状态 | 写入路径 |
|---|---|
| `PRD.md` + 不存在 | `<project>/PRD.md` |
| `PRD.md` + 存在 + 用户选 1 | `<project>/PRD-new-<YYYY-MM-DD>.md` |
| `PRD.md` + 存在 + 用户选 2 | 不写 |
| `PRD.md` + 存在 + 用户选 3 | 中止整个 Create（已写的也不撤回——spec §4 第 92 行明文） |
| `docs/PRD/X.md` + 不存在 | `<project>/docs/PRD/X.md` |
| `docs/PRD/X.md` + 存在 | `<project>/docs/PRD/X-new-<YYYY-MM-DD>.md` |

**模板选择**（写文件时复制 `<skill>/templates/<name>.tmpl` 到目标路径）：

| 目标路径 | 模板 |
|---|---|
| `PRD.md` 或 `PRD-new-*.md` | `templates/PRD.md.tmpl` |
| `docs/PRD/features.md` 或对应 `.new` | `templates/features.md.tmpl` |
| `docs/PRD/engineering.md` 或对应 `.new` | `templates/engineering.md.tmpl` |
| `docs/PRD/changelog.md` 或对应 `.new` | `templates/changelog.md.tmpl` |

### Step 5 — `.new` 同胞拍撞 → 计数器 A

如果 `<project>/docs/PRD/features-new-<YYYY-MM-DD>.md` 已存在（同日），按以下规则处理：

```
报告：「同日 .new 已存在 features-new-<date>.md」
询问：「要继续吗？」
  - 继续 → 写 features-new-<YYYY-MM-DD>-2.md
  - 继续 2 仍拍撞 → -3.md，依此类推
  - 取消 → 跳该文件，其他照常
```

只对**真实拍撞**触发，旧日期的 `.new` 不算拍撞。

### Step 6 — 报告 + 下一步提示

```
✅ 已创建（无冲突）：
  - <project>/PRD.md
  - <project>/docs/PRD/features.md
  - <project>/docs/PRD/engineering.md
  - <project>/docs/PRD/changelog.md

⚠️ 已生成避免覆盖（.new）：
  - <project>/docs/PRD/changelog-new-<YYYY-MM-DD>.md

⏭ 已跳过：
  - <project>/PRD.md（用户选择跳过）

❌ 已取消：无

---

下一步：
1. 按各文件内的「该章节写什么」提示语填写业务内容。
2. 如同时存在 <原> + <原>-new-<date>.md，请检查 / 合并二者。
3. PRD.md §4 维护约定已写好——项目层同步义务，新项目无须改动。
4. 超 600 行拆分由本 skill 接管（`/prd-kit split`）。
```

---

## Mode B：Split（拆分超 600 行文件）

### 触发判定

匹配以下任一即进入 Split：
- 用户说「拆分 PRD」「拆分 features.md」「features.md 太长了」
- 用户说 `/prd-kit split`

### Step 1 — 识别超 600 行的文件 + 读其 § 结构

```bash
wc -l <project>/PRD.md
wc -l <project>/docs/PRD/features.md
wc -l <project>/docs/PRD/engineering.md
wc -l <project>/docs/PRD/changelog.md
```

- **未检测到任何 PRD 文件** → 提示 "未检测到 PRD；可输入 `/prd-kit create` 铺设骨架"，中止。
- **全部 < 150 行** → 报行数，中止（不进入流程）。
- **150 ≤ 行数 < 600** → 报行数 + "未达拆分阈值（600），但你仍可继续"。**询问是否继续**——不强制拒绝。
- **行数 ≥ 600** → 直接进入 Step 2。

如果有多个文件 ≥ 600 行，**单次只拆一个**——询问用户先拆哪个。

### Step 2 — 扫描 H2/H3 找天然业务边界

读目标文件，按 H2/H3 标题列出候选边界。**启发**：业务域 / 子系统 / 技术层。
最多 6 候选 + Other。

例：
- "认证（§3.1）" / "员工管理（§3.2）" / "文档管理（§3.3）" / "问答（§3.4）" / "向量检索（§3.5）" / "工程配置（§9-§11）"

**未找到任何 H2/H3** → 报错 "无 H2/H3 候选边界"，回 Step 2。

### Step 3 — AskUserQuestion 选边界

```
features.md 当前 738 行。请选择要拆分出去的边界：

  1. 认证（§3.1，~85 行）
  2. 员工 / 角色（§3.2，~120 行）
  3. 文档管理（§3.3，~180 行）
  4. 问答 / 检索（§3.4-§3.5，~210 行）
  5. 工程配置（§9-§11，~140 行）
  6. 其他（请说明）

  取消 → 不拆分
```

### Step 4 — 按 [references/split-pattern.md](references/split-pattern.md) 5 步执行

1. 创建 `docs/PRD/features/<boundary>.md`（从 features.md 拆分；从 engineering.md 拆分则 `docs/PRD/engineering/<boundary>.md`）；路径已存在则改 `-new-<date>`
2. 把 features.md 中属于该边界的内容 MoveCut 进去
3. 原文件替换为 1 行："详见 [<boundary>.md](features/<boundary>.md)"（从 engineering.md 拆分则 `engineering/` 前缀）
4. 不重排 § 编号；新文件用 `§<boundary>.<原小节号>` sub-anchor
5. 更新 PRD.md §3 索引表

完整细则见 [references/split-pattern.md](references/split-pattern.md)。

### Step 5 — 复核 + 报告

```bash
wc -l <project>/docs/PRD/features.md       # 拆分前 / 后
wc -l <project>/docs/PRD/features/<boundary>.md     # 新文件
test -f <project>/docs/PRD/features/<boundary>.md   # 链接有效性
```

```
✅ 拆分完成

  features.md: 738 → 510 行（-228）
  新文件 docs/PRD/features/auth.md: 228 行

  下一步：
  - 检查 PRD.md §3 索引表是否更新
  - 检查 § 编号是否需要 sub-anchor 重命名
  - 旧 features.md 里的内容已 MoveCut，新文件如有遗漏请手动补
```

---

## 错误处理

| 场景 | 行为 |
|---|---|
| 目标项目目录不可写 | `test -w` 后报错退出 |
| `docs/PRD/` 父目录不存在 | `mkdir -p` |
| 4 文件全部已存在 | 全走"避免覆盖"，全生成 `.new` 兄弟 |
| 同日 `.new` 已存在（拍撞） | 告知 + 询问 + 继续则计数器 A（`-2` / `-3` …） |
| 旧日期 `.new` 存在 | 不算拍撞 |
| 用户调用 prd-kit 但项目无 PRD 文件 | 提示 "未检测到 PRD；可输入 `/prd-kit create` 铺设骨架" |
| Split：未超 600 行 | 报行数；150-600 询问是否继续；< 150 强制拒绝 |
| Split：AskUserQuestion 取消 | 中止；不写任何文件 |
| Split：split-pattern.md 丢失 | 报错 "skill 安装不完整，请重装" |
| Split：边界无 H2/H3 内容 | 报错，回到 Step 2 |
| skill 安装有同名 `prd-kit/` 残影 | 启动检测 templates/ 不完整 → 报错退出 |
| Skill 自带 templates 缺失 | 启动自检失败 → 报错退出 |
| 非 git 目录运行 | 不阻止；不依赖 git |
| 路径含中文 / 空格 | 模板一律 `/` 相对路径 |

---

## 参考资料

- **[references/split-pattern.md](references/split-pattern.md)** — Split Mode 的 5 步执行细则
- **[references/smoke-tests.md](references/smoke-tests.md)** — A 完整性 + B/C/D 共 17 条 smoke test 清单