<div align="center">

**Fkdmks Skills**

# 🧰 Fkdmks Skills

#### 我自己项目里用的 AI Skill 集合，都开源在这里

[![License](https://img.shields.io/badge/License-MIT-3B82F6?style=for-the-badge)](./LICENSE)
[![Skills](https://img.shields.io/badge/Skills-1-10B981?style=for-the-badge)](#-skills-%E7%9B%AE%E5%BD%95)
[![AgentSkills](https://img.shields.io/badge/AgentSkills-Standard-8B5CF6?style=for-the-badge)](https://agentskills.io)

![Claude Code](https://img.shields.io/badge/Claude_Code-Skill-D97706?style=flat-square&logo=anthropic&logoColor=white)
![Codex](https://img.shields.io/badge/Codex-Skill-10B981?style=flat-square&logo=openai&logoColor=white)
![40+ Agents](https://img.shields.io/badge/40%2B_Agents-Compatible-3B82F6?style=flat-square)

</div>

这里每个 Skill 都是 Agent 能直接加载的结构化指令集，遵循 [Agent Skills](https://agentskills.io) 开放标准。Claude Code、Codex、Qoder、Kimi Code、iFlow、CodeBuddy、Cursor 等 40+ 支持该标准的 Agent 都能装。

---

## 📋 目录

| 名字 | 一句话 | 触发 |
|------|--------|------|
| 🧱 [**prd-kit（PRD 骨架铺装）**](#-prd-kit) | 给一个新项目一键铺出 PRD 文档骨架；或把超 600 行的 PRD 文件按业务边界拆细 | `/prd-kit create` / `/prd-kit split` |

---

## 📦 安装方式

在 Claude Code、Codex 等支持 Agent Skills 的工具里，直接说：

```
帮我安装这个 skill：https://github.com/AIFkdmks2046/Fkdmks-skills/tree/main/prd-kit
```

Agent 会自己 clone 到 `~/.claude/skills/prd-kit`（或对应 Agent 的 skill 目录），不用你操心路径。

你的 Agent 不支持 Skill 也没关系：把 `prd-kit/SKILL.md` 全文下载下来，当成项目规则文件（或直接贴进对话）让 Agent 照着执行，效果一致。

---

## ✨ Skills

<a id="-skills"></a>

### 🧱 prd-kit

> *"新项目要不要 PRD？"——要。"今天就写？"——一行命令铺骨架。*

**它只解决一件事：把 PRD 文档结构化。**

每个项目都要写 PRD，但总卡在三件事：
1. 不知道从哪几个文件开始（一个总览 + 三个分册？还是一个大文件？）
2. 写到一半 features.md / engineering.md 膨胀到上千行，维护不动
3. 文档一改，§ 编号互相打架，多人协作分不清谁没同步

prd-kit 把上面三件事封装成两个原子能力：

| Mode | 触发词 | 干什么 |
|------|--------|--------|
| **Create** | "创建项目 PRD" / "初始化 PRD" / "给 X 项目铺 PRD" / `/prd-kit create` | 在目标项目根目录铺出 4 个骨架文件：`PRD.md` + `docs/PRD/{features,engineering,changelog}.md` |
| **Split** | "拆分 PRD" / "拆分 features.md" / `/prd-kit split` | 把超 600 行的 PRD 文件按 H2/H3 业务边界拆成 `features/<topic>.md` 子文件，原文件留 1 行链接 |

**为什么是「结构」**

PRD 的价值不在文笔，而在「§ 编号能互相引用、§4 同步义务有人遵守、章节膨胀有拆分机制」。一份没有结构的 PRD 写到第 3 个月就和代码不同步了。prd-kit 不是替你写 PRD——它替你**维持 PRD 的形状**，让你专注于业务内容。

**两种 Mode 的工作流**

```
# Create（首次铺骨架）
1. 检测目标项目根目录是否已有 PRD 文件
2. 已存在 → 静默加 .new-<date> 后缀避免覆盖
3. 把 4 个 .tmpl 写到目标路径
4. 报告：哪些新建 / 哪些 .new / 哪些跳过

# Split（拆分超大文件）
1. wc -l 找 ≥ 600 行的文件
2. 读 H2/H3 列候选边界（最多 6 个）
3. AskUserQuestion 选一个边界
4. MoveCut 内容到 docs/PRD/features/<boundary>.md
5. 原文件替换为 1 行链接，更新 PRD.md §3 索引
```

**文件结构**

```
Fkdmks-skills/
├── LICENSE                       # MIT
├── README.md                     # 你正在看这个
└── prd-kit/                      # skill 本体
    ├── SKILL.md                  # Agent 加载的指令（带 frontmatter）
    ├── references/
    │   ├── smoke-tests.md        # 17 条 smoke test 清单
    │   └── split-pattern.md      # Split Mode 的 5 步执行细则
    ├── templates/
    │   ├── PRD.md.tmpl           # 根 PRD.md 模板
    │   ├── features.md.tmpl      # 功能分册模板
    │   ├── engineering.md.tmpl   # 工程分册模板
    │   └── changelog.md.tmpl     # 变更日志模板
    └── examples/
        └── sample-output/        # 虚构 todos CLI 项目示例
            ├── PRD.md
            └── docs/PRD/
                ├── features.md
                ├── engineering.md
                └── changelog.md
```

**示例**

[`prd-kit/examples/sample-output/`](./prd-kit/examples/sample-output/) 给了一份虚构 todos CLI 项目的完整 PRD 骨架，演示 prd-kit 铺出来的东西长什么样。

---

## 🛡 安全与边界

- 不修改 git 状态——Create / Split 都只 `Write` 新文件，不 `git add` / `git commit`。
- 不覆盖已有文件——撞名一律走 `.new-<date>` 后缀，避免误伤。
- 不索要敏感数据——PRD 文件里写了什么全凭你自己控制。
- 不执行 PRD 内容里的命令——如果某个 features.md 写了"运行 rm -rf /"，prd-kit 当字符串处理，不会真去执行。

---

## 📝 许可证

本仓库所有 Skill 与随附文件以 **MIT** 许可证发布，详见 [LICENSE](./LICENSE)。

---

## 🙏 致谢

- 灵感与目录风格：[Khazix Skills](https://github.com/KKKKhazix/khazix-skills)
- Skill 标准：[Agent Skills](https://agentskills.io)