<div align="center">

**Fkdmks Skills**

# 🧰 Fkdmks Skills

#### 我自己项目里用的 AI Skill 集合，都开源在这里

[![License](https://img.shields.io/badge/License-MIT-3B82F6?style=for-the-badge)](./LICENSE)
[![Skills](https://img.shields.io/badge/Skills-6-10B981?style=for-the-badge)](#-skills-%E7%9B%AE%E5%BD%95)
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
| 🏁 [**madmax-dev（功能开发 + 测试工作流）**](#-madmax-dev) | 一个 PRD 进去，设计 → 计划 → 开发 → 用例 → 端到端 → 修复 → 验收全流程出来，带状态文件、三个人工关口和断点续跑 | 给 Agent 一份 PRD 并说"把这个功能做完并测掉" |

---

## 📦 安装方式

在 Claude Code、Codex 等支持 Agent Skills 的工具里，直接说：

```
帮我安装这个 skill：https://github.com/AIFkdmks2046/Fkdmks-skills/tree/main/prd-kit
```

Agent 会自己 clone 到 `~/.claude/skills/prd-kit`（或对应 Agent 的 skill 目录），不用你操心路径。

你的 Agent 不支持 Skill 也没关系：把 `prd-kit/SKILL.md` 全文下载下来，当成项目规则文件（或直接贴进对话）让 Agent 照着执行，效果一致。

### 🏁 madmax-dev 套件的安装

`madmax-dev` 由 5 个技能组成，**必须装成同一父目录下的兄弟目录**（`madmax-dev-clean` 用 `../madmax-dev-qa/scripts/` 找脚本，拆开就找不到依赖）：

```bash
SKILLS_DIR="$HOME/.claude/skills"        # Qoder 用 ~/.qoder-cn/skills，Codex 用 ~/.codex/skills
git clone --depth 1 https://github.com/AIFkdmks2046/Fkdmks-skills.git /tmp/fkdmks-skills
mkdir -p "$SKILLS_DIR"
cp -R /tmp/fkdmks-skills/madmax-dev/* "$SKILLS_DIR"/
```

装完 `$SKILLS_DIR` 下应该同时有 `madmax-dev-qa`、`madmax-dev-cases`、`madmax-dev-review`、`madmax-dev-e2e`、`madmax-dev-clean` 五个目录。

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
├── prd-kit/                      # skill 本体
│   ├── SKILL.md                  # Agent 加载的指令（带 frontmatter）
│   ├── references/
│   │   ├── smoke-tests.md        # 17 条 smoke test 清单
│   │   └── split-pattern.md      # Split Mode 的 5 步执行细则
│   ├── templates/
│   │   ├── PRD.md.tmpl           # 根 PRD.md 模板
│   │   ├── features.md.tmpl      # 功能分册模板
│   │   ├── engineering.md.tmpl   # 工程分册模板
│   │   └── changelog.md.tmpl     # 变更日志模板
│   └── examples/
│       └── sample-output/        # 虚构 todos CLI 项目示例
│           ├── PRD.md
│           └── docs/PRD/
│               ├── features.md
│               ├── engineering.md
│               └── changelog.md
└── madmax-dev/                   # 5 个同级技能，结构见下文
```

**示例**

[`prd-kit/examples/sample-output/`](./prd-kit/examples/sample-output/) 给了一份虚构 todos CLI 项目的完整 PRD 骨架，演示 prd-kit 铺出来的东西长什么样。

---

### 🏁 madmax-dev

> *"这个功能做完了吗？"——不看聊天记录，看状态文件。*

**它只解决一件事：把一个功能从 PRD 推到验收，并且中途不丢进度。**

给它一份 PRD，它按状态机推进 13 个阶段，每个阶段落地成 `.qoder/qa/<slug>/` 下的产物文件；其中三个阶段**必须停下来等人**，其余自动跑。功能做到哪、卡在哪、还有什么问题没修，全部可以从磁盘重新算出来——换一个会话、换一个 Agent、甚至隔一周回来，都能接着做。

**五个技能各管一段**

| 技能 | 角色 | 产出 |
|------|------|------|
| **madmax-dev-qa** | 主调度（唯一写状态文件的人） | `workflow-state.md`、阶段推进、关口、看护 |
| **madmax-dev-cases** | 用例设计 | `test-cases.md` |
| **madmax-dev-review** | 用例审查（判覆盖率与可执行性） | `test-review-r<N>.md` |
| **madmax-dev-e2e** | 真浏览器端到端执行 | `test-report-r<N>.md`、`issues.md`、`evidence/` |
| **madmax-dev-clean** | 历史归档与过期清理 | `history/`、`archive/` |

**流程**

```
0-prd → 1-design ⟂ → 2-plan ⟂ → 3-dev → 3.5-code-review
      → 4-testcase → 5-testcase-review → 6-e2e → 7-fix ⟲
      → 7.5-final-review → 8-acceptance ⟂ → 8.5-wrapup → done
```

`⟂` = 人工关口（① 设计文档 ② 执行文档 ③ 最终验收），到点必停、必须等你回复，不许"先做下去最后一起看"。

**三条支撑机制**

| 机制 | 解决什么 |
|------|----------|
| **状态文件** `.qoder/qa/<slug>/workflow-state.md` | 唯一事实源。`stage` 说在哪个大阶段，`progress` 说这个阶段做到第几个 Task；接手时只认它，不认记忆 |
| **工作区租约** `.qoder/qa/.active-lease/` | 原子目录锁 + 心跳。同一时刻只有一个执行者能写，防止两个会话并发改同一个功能 |
| **看护 watchdog** | 定时检查原会话是否停下不管这个功能了；它只是监工——唤醒原会话，绝不替原会话干活、不改代码、不提交 |

**问题分级与放行**

端到端跑出来的每条红用例必须映射成 `issues.md` 一行，或进 `flaky.md`（只写在报告里不算）。P0/P1 未全部修复 ⇒ **不通知验收**，状态置 `acceptance_blocked` 并写人工待办；P2 可以带病验收，但要在通知里逐条声明。

**文件结构**

```
madmax-dev/
├── madmax-dev-qa/
│   ├── SKILL.md                          # 主调度：状态机 + 关口 + 租约 + 看护
│   ├── references/
│   │   └── watchdog-prompt-template.md   # 看护 prompt 模板（watchdog_protocol=2）
│   └── scripts/
│       ├── qa-state.mjs                  # doctor / migrate / list / bind / close / archive / gc
│       ├── qa-lease.mjs                  # acquire / renew / handoff / release / status
│       ├── watchdog-preflight.mjs        # 确定性预检：输出 NUDGE / SKIP / PENDING / REMOVE / DISABLE
│       └── *.test.mjs                    # 38 个用例，node scripts/*.test.mjs 直接跑
├── madmax-dev-cases/SKILL.md
├── madmax-dev-review/SKILL.md
├── madmax-dev-e2e/SKILL.md
└── madmax-dev-clean/SKILL.md
```

**跑起来需要的前提**

- 目标项目是 git 仓库（每个阶段的产物按 Task 小步提交；不是仓库时会先问你 `git init`）。
- 需要 `.qoder/qa/config.md` 里写清启动命令、URL、测试账号——测试账号写占位说明，真实凭据留在环境变量里，不入库。
- `madmax-dev-qa` 在开发与审查阶段引用 [superpowers](https://github.com/obra/superpowers) 插件的 `brainstorming` / `writing-plans` / `executing-plans` / `test-driven-development` / `requesting-code-review` / `systematic-debugging` 等技能；没装的话这几段由主会话自己执行，流程不变。
- 看护依赖 Agent 侧的定时任务能力（Qoder 用 `qoder_cron`）。没有定时任务也能用：只是断点续跑要你自己说"继续 XX 功能"。

---

## 🛡 安全与边界

- 不修改 git 状态——Create / Split 都只 `Write` 新文件，不 `git add` / `git commit`。
- 不覆盖已有文件——撞名一律走 `.new-<date>` 后缀，避免误伤。
- 不索要敏感数据——PRD 文件里写了什么全凭你自己控制。
- 不执行 PRD 内容里的命令——如果某个 features.md 写了"运行 rm -rf /"，prd-kit 当字符串处理，不会真去执行。

**madmax-dev 的额外红线**

- **端到端测试只打本地或测试环境**，绝不对生产环境做任何写入（下单、支付、发消息、改数据、删数据）。
- 不执行来源不明的脚本；不把密钥、token、账号密码写进配置、报告或提交内容。
- 只 commit 不 push；提交前复查暂存内容。证据截图、租约锁、看护日志、历史目录一律不入库。
- 三个人工关口不可被"最后一起看"这类话内联跳过；用户免掉的只是那一次关口，不是关口本身。
- 看护（定时任务）的启用/停用/删除只能由用户决定，执行者觉得吵只能写待办建议。

---

## 📝 许可证

本仓库所有 Skill 与随附文件以 **MIT** 许可证发布，详见 [LICENSE](./LICENSE)。

---

## 🙏 致谢

- 灵感与目录风格：[Khazix Skills](https://github.com/KKKKhazix/khazix-skills)
- Skill 标准：[Agent Skills](https://agentskills.io)