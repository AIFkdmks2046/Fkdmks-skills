# Split Pattern — 5 步拆分执行细则

> 本文件是 `SKILL.md` Mode B（Split）的执行细则手册。**完整流程在 SKILL.md**，本文只细化 Step 4 的 5 个子步骤。

## 进入条件

调用方在执行本文件前必须满足：

- [ ] 已识别出 ≥ 1 个超 600 行的文件（SKILL.md Mode B Step 1）
- [ ] 已读目标文件的 § 结构并列出候选边界（SKILL.md Mode B Step 2）
- [ ] 已通过 AskUserQuestion 让用户选定 1 个边界（SKILL.md Mode B Step 3）
- [ ] 已确认 split-pattern.md 存在（启动自检通过）

任一不满足 → 回到对应 Step。

---

## Step 4.1 — 创建新文件

**路径**：`docs/PRD/features/<boundary>.md`（从 features.md 拆分；从 engineering.md 拆分则 `docs/PRD/engineering/<boundary>.md`）

`<boundary>` 用户在 Step 3 选定的边界名（例：`auth` / `employee-role` / `documents` / `qa-retrieval`）。

**已存在处理**：

```bash
test -f <project>/docs/PRD/features/<boundary>.md
```

- 不存在 → 创建 `<project>/docs/PRD/features/<boundary>.md`
- 存在 → 改写为 `<project>/docs/PRD/features/<boundary>-new-<YYYY-MM-DD>.md`
- 同日 `.new` 已存在 → 计数器 A（`-2` / `-3` …），见 SKILL.md §5

**创建内容骨架**（不复制 `features.md.tmpl`——新文件内容由 4.2 MoveCut 写入）：

```markdown
# <boundary> — <中文名>

> 本文从 [`../features.md`](../features.md) §<原小节号> 拆分而来（拆分日期 <YYYY-MM-DD>）。
> § 编号延续 features.md 的 §<原边界>.<原小节号> 体系；如未来再次拆分，使用 §<boundary>.<子边界>.<原小节号> sub-anchor。

---

<MoveCut 进来的内容>

---

_回链：[`../features.md`](../features.md) §<原小节号>_
```

---

## Step 4.2 — MoveCut 内容

从 `features.md` 中读出属于该边界的 H2/H3 + 所有子段落。

**MoveCut 范围判定**：

| 内容类型 | 是否 MoveCut |
|---|---|
| 该边界下的 H3 子段落全部正文 | ✅ |
| 跨边界共用的引言 / 总览段（如"以下是本项目的功能地图"） | ❌ 留在 features.md |
| 跨边界共用的图示 / 表格 | ❌ 留在 features.md |
| 该边界独有的图示 / 表格 | ✅ |
| 该边界独有的编号（§3.x） | ✅（在新文件用 sub-anchor，4.4 详） |
| 引用了其他边界内容的句子 | ⚠️ 改写为指向其他新文件的链接 |

**执行方式**：

1. 读 features.md 全文，定位该边界的起止行号
2. 把内容复制到新文件（Step 4.1 骨架的 `<MoveCut 进来的内容>` 占位）
3. 删除 features.md 中对应行（不留空白行）

**安全检查**：MoveCut 后 features.md 必须仍然合法 markdown——不能删除列表 / 表格的中间行导致残缺。

---

## Step 4.3 — 原文件替换

`features.md` 中原本属于该边界的位置，**替换为一行**：

```markdown
详见 [`<boundary>.md`](features/<boundary>.md)。
```

替换位置：原 H2/H3 标题所在行。

- 若原是 H2（`## 3.3 文档管理`），替换为 H2 + 链接行
- 若原是 H3（`### 3.3.1 公共分类`），替换为 H3 + 链接行

**保持原 H 级别**，不要全部拍平为 H2——sub-anchor 在 4.4 处理。

---

## Step 4.4 — 不重排 § 编号；用 sub-anchor

**§ 编号保护**：原 features.md 的 § 编号体系**不重排**——外部引用（如 `§3.3`）仍然有效。

**sub-anchor 规则**：新文件中如需再次细分小节，使用 `§<boundary>.<原小节号>` 命名：

| 原编号 | 新文件 sub-anchor |
|---|---|
| §3.3 | §auth.3（如果 boundary=`auth`） |
| §3.3.1 | §auth.3.1 |
| §3.3.1.1 | §auth.3.1.1 |

新文件内部**第一层 H2** 仍然使用原编号（`## 3.3 文档管理`），**第二层以下**用 sub-anchor：

```markdown
## 3.3 文档管理      ← 保留原编号
                     ← 原正文 MoveCut 后已删除，仅留 4.3 链接行

### §auth.3.1 公共分类  ← 实际新内容（如有）放在新文件
### §auth.3.2 个人分类
```

> 实际上，由于 4.2 已 MoveCut 大部分正文到新文件，features.md 中该边界位置通常只剩 H2 + 链接行；具体细分留在新文件中进行。

---

## Step 4.5 — 更新 PRD.md §3 索引表

读 `<project>/PRD.md` §3 文档索引表，**追加一行**说明新文件归属：

| 文件 | 覆盖章节 | 角色 |
|---|---|---|
| `PRD.md`（本文件） | §1-§2 总览 + §3 索引 + §4 维护约定 | 项目级入口 / 索引 |
| `docs/PRD/features.md` | §3-§7 | 功能主文件（拆分后部分章节外移） |
| `docs/PRD/features/<boundary>.md` | §<原小节号> | 从 features.md 拆分的 **<中文名>** |
| `docs/PRD/engineering.md` | §9-§17 | 工程层 |
| `docs/PRD/changelog.md` | §8 | 变更日志 |

**追加一行到末尾**，不打乱原顺序（保护外部引用）。

---

## 复核（Step 5）

```bash
# 行数对比
wc -l <project>/docs/PRD/features.md
wc -l <project>/docs/PRD/features/<boundary>.md

# 链接有效性
test -f <project>/docs/PRD/features/<boundary>.md
grep -F "[<boundary>.md]" <project>/docs/PRD/features.md

# 索引更新
grep -F "<boundary>.md" <project>/PRD.md
```

任一失败 → 报错「拆分复核失败」并提示用户手动检查。

---

## 反模式（不要做的事）

| 反模式 | 后果 | 正确做法 |
|---|---|---|
| 重排 § 编号（把 §3.3 改成 §4.1） | 外部引用全断 | 保留原编号 + sub-anchor |
| 把跨边界共用段也 MoveCut | features.md 内容残缺 | 共用段留在 features.md |
| 删除 features.md 中该边界位置不留链接 | 读者找不到内容 | 留 4.3 链接行 |
| 新文件复制 features.md.tmpl 骨架 | 模板不适配细分内容 | 用 4.1 自定义骨架 |
| 一次拆多个边界 | 步骤太多易出错 | 单次只拆一个，下一轮再拆下一个 |
| 不更新 PRD.md §3 索引 | 文档与文件脱节 | 4.5 必做 |
