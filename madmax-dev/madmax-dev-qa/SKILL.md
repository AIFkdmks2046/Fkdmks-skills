---
name: madmax-dev-qa
description: 【Mad Max · 交付】Use when a user provides a PRD or feature requirements and wants that feature developed, reviewed, tested and signed off — including when they ask to continue, check the progress of, or abandon a feature workflow started earlier.
---

# 功能开发 + 测试工作流（主调度）

## Overview

以**状态机 + 状态文件 + 工作区租约**驱动：每个功能一个状态文件 `.qoder/qa/<slug>/workflow-state.md`，它是唯一事实源；流程分阶段推进，其中三个阶段必须**停下来等人**，其余全自动。

看护（watchdog）的定位是 **supervisor，不是第二个执行者**：它只在原会话停下时唤醒原会话继续，不在自动化会话里重做 stage。

核心原则：**进度只认状态文件，并发只认租约，产物只认磁盘**。任何"我记得刚才做到哪了"或"它应该没在跑"的判断都不作数。

## 身份与路由（会话 / 功能 / 缺陷）

三个身份，不要混：

| 身份 | 存在形式 | 说明 |
|---|---|---|
| 功能 | 状态文件的 `feature_id`（稳定）+ `slug`（展示名） | 目录仍用 slug；`feature_id` 只允许 `[A-Za-z0-9._-]`，中文 slug 迁移时自动生成 `feature-<hash>`，可用 `--feature-id` 覆盖 |
| 会话 | 状态文件 `executor.session_id` + `executor.run_id` | 只记录当前 owner：谁在做这个功能 |
| 缺陷 | `<slug>/issues.md` 的一行 | 按功能归属；跨功能用 `origin_feature` + `affects`，不按会话拆 |

**一个会话做多个功能** = 多个状态文件的 `executor.session_id` 相同；**一个功能换会话** = handoff 后改写 `executor`。不维护第二份绑定表，也不保留历史 owner。

会话开始先路由，不要猜：

```bash
node <技能目录>/scripts/qa-state.mjs list --root <项目根> --session <Qoder 会话 ID>
```

- 0 个功能 → 先确认是不是“换会话接手”：用户点名了功能/slug，或列表里已有同名/同主题功能 → 用 `list --root <项目根>`（不带 `--session`）找到它，`acquire` 后 `bind` 接管（覆盖旧 `executor`）；只有用户明确要做**新功能**时才走 stage 0
- 1 个功能 → 直接续跑
- 多个 → 列出来让用户选一次，不要自己挑
- 用户说“继续上一个任务”且候选不唯一 → 同样让用户选一次
- 旧会话已结束、新会话接手时，`--session` 查不到旧功能是正常的；**不要因此把同一功能当新功能重开**

> 看护把租约交给旧会话、旧会话却不再工作时，等 TTL 过期后新会话 `acquire` 即可；不要用 `--force` 抢有效租约。

`qa-state list` 从所有状态文件派生，不另建索引；只扫 `.qoder/qa/*/`，`history/` 里的已结束功能不算候选。`migrate` / `bind` / `close` / `archive --apply` 是写操作，必须持有租约。

## When to Use

- 用户给出 PRD / 需求文档，要求开发 + 测试 + 验收
- 用户说"继续 XX 功能的工作流""XX 功能做到哪了"
- 用户说"放弃 XX 功能"
- 不适用：单点小改动、纯问答、只写文档

## 快速参考

| 项 | 值 |
|---|---|
| 产物根目录 | `.qoder/qa/<slug>/`（slug：中文可用，禁空格与 `/ # ?`） |
| 状态文件 | `.qoder/qa/<slug>/workflow-state.md` |
| 工作区租约 | `.qoder/qa/.active-lease/`（原子目录锁，**不入 git**） |
| 看护日志 | `.qoder/qa/<slug>/watchdog-log.md` |
| 人工关口 | ① 设计文档 ② 执行文档 ③ 最终验收 |
| 待办目录 | `.qoder/qa/pending/` → 归档 `.qoder/qa/archive/` |
| 历史目录 | `.qoder/qa/history/<slug>-<YYYYMMDD>/`（已结束功能；`list` 不再扫，可定期 `gc`，**不入 git**） |
| 证据目录 | `.qoder/qa/<slug>/evidence/`（**不入 git**） |
| 项目配置 | `.qoder/qa/config.md`（启动命令 / URL / 测试账号 / 数据初始化） |
| 租约脚本 | `<技能目录>/scripts/qa-lease.mjs` |
| 状态脚本 | `<技能目录>/scripts/qa-state.mjs`（`doctor` / `migrate` / `list` / `bind` / `close` / `archive` / `gc`） |
| 清理子技能 | `madmax-dev-clean`（归档 + 过期清理；自动触发与手动触发都走它） |
| 看护预检 | `<技能目录>/scripts/watchdog-preflight.mjs` |
| 看护模板 | `<技能目录>/references/watchdog-prompt-template.md` |
| flaky 清单 | `.qoder/qa/<slug>/flaky.md`（判为 flaky 的用例；放行需用户签字） |

`<技能目录>` = 本 SKILL.md 所在目录（`madmax-dev-qa/`）。4 个子技能与它**同级**：`madmax-dev-cases/`、`madmax-dev-review/`、`madmax-dev-e2e/`、`madmax-dev-clean/`；缺任何一个都按"未安装"处理，不要另写实现。

**stage 合法枚举**（写状态文件时只能取这些值）：
`0-prd`、`1-design`、`2-plan`、`3-dev`、`3.5-code-review`、`4-testcase`、`5-testcase-review`、`6-e2e`、`7-fix`、`7.5-final-review`、`8-acceptance`、`8.5-wrapup`、`done`、`aborted`

**看护协议版本**：`watchdog_protocol: 2`。状态文件缺失或版本不符时，看护不得推进任何阶段，只能写待办；旧 prompt 的 `active_lock` / “另一功能 2 小时锁” / `stage=8` 规则一律作废。

## 会话启动协议（人工会话与看护都一样）

任何要推进 workflow 的会话，第一步不是改代码，而是**路由 + 拿租约**：

1. 路由：

   ```bash
   node <技能目录>/scripts/qa-state.mjs list --root <项目根> --session <Qoder 会话 ID>
   ```

   0 个 → 新建功能；1 个 → 续跑；多个 → 让用户选一次。
2. Read 状态文件；确认 `watchdog_protocol: 2`；先跑一次体检：

   ```bash
   node <技能目录>/scripts/qa-state.mjs doctor --state <状态文件>
   ```

   退出码 1 = 有 blocking errors（缺 `executor` / `progress`、残留 `active_lock`、登记产物磁盘不存在、当前阶段缺产物等）。先修状态，不要带病推进。
3. 拿租约：

   ```bash
   node <技能目录>/scripts/qa-lease.mjs acquire \
     --slug <slug> --kind manual \
     --session <Qoder 会话 ID> --run-id <本次执行 ID> \
     --ttl 900 --stage <stage> --task <n> --step <n>
   ```

   退出码 2 = 有别的执行者持有有效租约：人工会话告知用户并停止；看护记日志并退出。
4. 把当前会话写回状态文件（写操作，必须在租约内）：

   ```bash
   node <技能目录>/scripts/qa-state.mjs bind \
     --state <状态文件> --session <会话 ID> --run-id <执行 ID> \
     [--feature-id <稳定 ID>]
   ```

5. 抢到租约并 bind 后重新 Read 一次状态文件（防止读到的状态已被别人改过）；顺手调用 `madmax-dev-clean` 的自动模式清理过期历史（失败只记日志，不阻断主流程）。
6. 开始工作；每完成一个 Step：

   ```bash
   node <技能目录>/scripts/qa-lease.mjs renew \
     --slug <slug> --session <会话 ID> --run-id <执行 ID> \
     --task <n> --step <n>
   ```

   并更新 `progress` / `revision` / `heartbeat_at`。
7. 到关口：先跑 `doctor`（进入 stage 8 前用 `--strict`），再写 `awaiting_user`，`qa-lease release`，停止。
8. 一轮结束但工作流没完成：**保留租约**，让 TTL 自然过期；不要因为“这轮回复完了”就释放。用户在 TTL 内回来会续租；看护只有在会话确实空闲/冷且租约过期后才唤醒。
9. 整个流程结束/中止：先 `qa-state close` 写终态，再处理看护与归档（见“收尾与历史清理”），最后释放租约。

没有 `executor.session_id` 或没有租约的人工会话，等于看护看不见的“幽灵执行者”；开始前必须补齐。

## 任务级进度（checkpoint）

`stage` 只决定“在哪个大阶段”，`progress` 决定“这个阶段做到哪”。两者缺一不可：

- 每完成一个 Task/Step：更新 `progress.current_task/current_step/completed_tasks`，并 `qa-lease renew`。
- 任务完成以**提交存在**为准：先 commit，再写 `completed_tasks` + `last_commit`；不要把“代码看起来改完了”当成完成。
- 接手/唤醒前：读 `progress`，用 `git log --oneline` / `git status` 对照；已完成的 Task 不得重跑。
- 工作区有未提交、又不在 `progress` 里的改动：不自动继续，写 pending 让人判断。
- `plan.md` 的复选框不是进度源；可以勾，但看护只认状态文件 `progress`。
- `progress` 为空 = 账本缺失：看护不会 NUDGE，也不会 EXECUTE_FALLBACK；必须先补 `current_task/current_step/completed_tasks/last_commit`（用 `plan.md` + `git log` 对照）。
- 每个 stage 收尾必跑 `qa-state doctor --state <状态文件>`；errors 不为 0 不得进入下一 stage。进入 stage 8 前必须 `doctor --strict`（warnings 也清零，flaky 除外——flaky 进 `flaky.md` 并等用户签字）。
- 旧状态文件不要手改：用 `qa-state migrate`（见“迁移旧状态文件”）。

## 阶段流程

| stage | 动作 | 产出 | 关口 |
|---|---|---|---|
| `0-prd` | `qa-state list --session` 路由；拿到 PRD；校验需求点+验收标准（缺项问用户或记待办）；生成 slug；建 v2 状态文件（`feature_id`、`watchdog_protocol: 2`、`executor`、`progress`）；`qa-state doctor`；用模板建 watchdog；检查 git 仓库 | `workflow-state.md` | — |
| `1-design` | 调 superpowers:brainstorming；收尾跑 `doctor` | `design.md` | ① `awaiting_user: design_review` |
| `2-plan` | 调 superpowers:writing-plans；收尾跑 `doctor` | `plan.md` | ② `awaiting_user: plan_review` |
| `3-dev` | spawn 子 Agent 执行（Read executing-plans / subagent-driven-development / TDD 的 SKILL.md）；每个 Task 先 commit 再记 `progress` | 代码 + 自测 + `progress.last_commit` | — |
| `3.5-code-review` | spawn 审查子 Agent（Read requesting-code-review 的 SKILL.md） | `code-review.md` | — |
| `4-testcase` | spawn 子 Agent（Read madmax-dev-cases/SKILL.md） | `test-cases.md` | — |
| `5-testcase-review` | spawn 审查子 Agent（Read madmax-dev-review/SKILL.md）；结论必须是 PASS | `test-review-r<N>.md` | — |
| `6-e2e` | spawn 子 Agent（Read madmax-dev-e2e/SKILL.md）；每条红用例必须映射到 issue 或 `flaky.md` | `test-report-r<N>.md`、`issues.md`、`flaky.md`（如有）、`evidence/` | — |
| `7-fix` | **只修 `issues.md` 里 open 的应用缺陷**（每个 open 问题 spawn 修复子 Agent，Read systematic-debugging/SKILL.md）；修完 spawn e2e 子 Agent 做回归 | `test-report-r<N+1>.md`、`issues.md` 状态更新 | — |
| `7.5-final-review` | spawn 复核子 Agent，按放行清单判定 | `final-review.md` | — |
| `8-acceptance` | `doctor --strict`；生成验收摘要并通知用户 | `acceptance-summary.md` | ③ `awaiting_user: final_acceptance` |
| `8.5-wrapup` | 调 neat-freak 同步 PRD/记忆文档（全局规则 A/B 双份同轮同步）；`qa-state close --stage done` → 调用 `madmax-dev-clean`（归档 + 清理过期历史） | 文档更新 + 功能目录移入 `history/` | — |

**每个 stage 收尾**：`qa-state doctor --state <状态文件>` 必须 errors=0（进 stage 8 前 `--strict`）；失败先修状态，不带病推进。

**回归范围（不要全量重跑）**：回归只重跑**曾有问题的用例**，再按修复改动的涉及面**抽样几个受影响区域**的相关用例补测；报告轮次递增（`test-report-r<N+1>.md`），不覆盖历史。

**所有 stage 通用**：开工前 `qa-state list` 路由 + `qa-lease acquire` + `qa-state bind`；每完成一个 Task/Step 更新 `progress` 并 `renew`；收尾跑 `qa-state doctor`；到关口或流程结束 `release`。阶段产物缺失才重做，未来 `planned` 缺失不重做。

## 关口规则（不可跳过）

三个关口必须**停下并等用户回复**，然后继续：

1. 写完 `design.md` → `qa-state doctor`（errors=0）→ 写 `awaiting_user: design_review` → `release` → 停下，请用户审设计
2. 写完 `plan.md` → `qa-state doctor`（errors=0）→ 写 `awaiting_user: plan_review` → `release` → 停下，请用户审执行计划
3. 7.5 复核通过 → `qa-state doctor --strict`（或把应修项写进 `issues.md` 并阻塞验收）→ 写 `acceptance-summary.md` → 写 `awaiting_user: final_acceptance` → `release` → 通知用户验收，等最终结论

**不允许**因为"用户说写完再验收"而把关口内联执行。用户当初的这句话是描述**最终**验收，不是取消中间关口。内联跳过关口 = 流程失败。

若用户明确说"这次不要设计审"，只跳该次，并在状态文件记 `gates_skipped: [design_review]`。

## 状态文件格式（v2）

```yaml
feature: 待办清单
slug: 待办清单
feature_id: todo-list      # 稳定 ID，只允许 [A-Za-z0-9._-]；报告/issue 用它归属
watchdog_protocol: 2
stage: 3-dev
awaiting_user: none        # design_review | plan_review | final_acceptance | acceptance_blocked | none
executor:
  kind: manual             # manual | watchdog
  session_id: "de918e7c-..."  # 原 Qoder 会话 ID；看护靠它找回原会话
  run_id: "20261021-2252"
  heartbeat_at: "2026-10-21 23:40"
  ttl_seconds: 900
progress:
  current_task: 2
  current_step: 1
  completed_tasks: [1]
  last_commit: "4e45e26"
artifacts:
  existing: [config, design, plan]
  planned: [testcases, issues, reports, review]
issues: { total: 3, open: 1, closed: 2 }
review_round: 1
fix_round: 1
watchdog_cron_id: "d473c957-..."
skipped: []
gates:
  design_review: "通过 —— ..."
  plan_review: "待过"
  final_acceptance: "待过"
revision: 7
updated_by: "manual:de918e7c"
updated: "2026-10-21 23:40"
```

**状态文件是唯一机器可读事实源**：

- frontmatter 是权威；正文只写恢复指引与结论，**不要再抄一份进度数字**（阶段/问题数/关口状态以 frontmatter 为准）。重复维护两套进度必然腐烂。
- `artifacts.existing` 只列已经产出的文件；未来阶段要产出的放 `planned`。看护不得因 `planned` 缺失而重做。`doctor` 会校验 `existing` 的每一项真实存在（可写文件名/相对路径或 `config` 这类别名）。
- `active_lock` 是旧协议遗留，已废弃；遇到就 `qa-state migrate`，不要再写、不要再读。
- `feature_id` 创建后不改；改名只改 `slug`。
- `issues` 的 total/open/closed 必须与 `issues.md` 表格实算一致；`doctor` 会核对。
- 只有租约持有者能写本文件；`qa-state migrate` / `bind` 会检查租约并自动 `revision + 1`、写 `updated_by` / `updated`，用临时文件 + rename 原子替换。手写状态文件时也必须遵守。
- `executor.session_id` 必须是真实 Qoder 会话 ID，且**必填**。人工会话开始时用 `qa-state list --session` 路由，再用 `qa-state bind` 写入；没有它，看护无法“唤醒原会话”。
- 每完成一个 Task/Step 就更新 `progress` 并 `qa-lease renew`；不要等到阶段结束才写。
- `completed_tasks` 只记录已经有提交的任务；`last_commit` 记录对应 hash。没有提交不得标完成。
- 恢复/接手时：读 frontmatter → 校验当前阶段**已产出**的 artifacts → 读 `progress` → `git status` / `git log` 对照。缺失当前阶段产物才重做；未来阶段的 `planned` 缺失不构成重做理由。

## 子 Agent 调度规范

子 Agent 没有 Skill 工具，用 **Read 注入**：

```
你是<角色>。第一步：Read <绝对路径>/SKILL.md，严格按其内容执行。
上下文：PRD=<路径>，设计文档=<路径>，上轮产物=<路径>，输出=<路径>。
```

角色 skill 路径（`<技能目录>` 的父目录即技能根，子技能与它同级）：
- 用例设计 `<技能目录>/../madmax-dev-cases/SKILL.md`
- 用例审查 `<技能目录>/../madmax-dev-review/SKILL.md`
- 端到端测试 `<技能目录>/../madmax-dev-e2e/SKILL.md`
- 开发阶段读 superpowers 插件目录下的 `executing-plans` / `subagent-driven-development` / `test-driven-development` / `requesting-code-review` / `receiving-code-review` / `systematic-debugging` / `verification-before-completion` 的 SKILL.md

**打回即重开**：审查不通过时**重新 spawn** 子 Agent，并把上轮审查意见作为输入；不要指望原 Agent 记住上下文。

## 用例缺陷回流（e2e 阶段发现用例本身写错时）

e2e 报告末尾若有"待修订用例"（应用行为符合 PRD，只是用例写法与既定设计冲突）：

1. 这些用例**不进 `issues.md`**，不算应用缺陷、不进修复循环；
2. 把"待修订用例"清单交回 madmax-dev-cases 子 Agent 修订（**重新 spawn**，附冲突点与依据）；
3. 修订后用例文件版本 +1，**重新过一遍用例审查**（stage 5），再重跑受影响用例（stage 6 增量轮次）；
4. 修订轮次 ≤3；超限则按护栏跳过 + 写待办。

## 护栏与不中断原则

- 用例审查 / 代码审查打回 ≤3 轮；单问题修复 ≤3 次
- 达到上限**不停止整个流程**：跳过该问题，标 `skipped`，**继续完成剩余所有阶段**
- 完成不了的部分走"人工待办闭环"（见下），不要为了一个卡点把整个任务挂起

## 人工待办闭环

1. **记录待办**：写 `.qoder/qa/pending/<slug>-<序号>-<主题>.md`，内容含：背景、卡点原因、已尝试过什么、需要人工做什么、关联产物路径
2. **用户确认标记**：用户处理后告知 → 补充执行/复核对应内容 → 更新状态文件
3. **移除归档**：确认无问题 → 文件移入 `.qoder/qa/archive/`（保留，由 `madmax-dev-clean` 按保留期清理）

## 收尾与历史清理

收尾分两段：**结束**归本技能（`close`），**归档 + 清理**归子技能 `madmax-dev-clean`。

```bash
# 写终态（done=验收通过；aborted=放弃/不再继续）
node <技能目录>/scripts/qa-state.mjs close --slug <slug> --session <id> --run-id <id> \
  --stage done|aborted --reason "<一句话>"
```

- **8.5 收尾**：`close --stage done` → 调用 `madmax-dev-clean`（归档该功能 + 清理过期历史）。
- **中止**：停 cron → `close --stage aborted` → 调用 `madmax-dev-clean`（同上）。
- **会话启动 bind 后**：调用 `madmax-dev-clean` 的自动模式，只清过期历史，不归档活功能。
- 调用方式：优先用 Skill 调用 `madmax-dev-clean`；当前会话没有 Skill 工具时，Read `<技能目录>/../madmax-dev-clean/SKILL.md` 并按其中命令执行。
- **保留期、哪些算历史、安全规则**都在 `madmax-dev-clean/SKILL.md`：默认 30 天，只删 `history/` 与 `archive/` 的过期条目；活功能与未处理待办永不自动删除。
- 子技能可手动触发：用户说“清理工作流历史 / 清理 qa 历史 / 归档已完成功能”时直接调用 `madmax-dev-clean`，默认先预览、确认后再执行。
- `close` 只改状态（`stage` / `awaiting_user: none` / `closed_at` / `closed_reason`），不动文件；输出里有 `watchdog_cron_id` 时先 `qoder_cron action=remove`。
- 会话结束但功能**没完成**：不要 `close`，也不要归档；保留状态文件与租约 TTL，等新会话按 `list --root` + `bind` 接手。

## 看护（Watchdog）v2：supervisor，不是执行者

看护的自动化会话**只做**：读状态 → 查原会话 → 抢租约 → 唤醒原会话 → 记日志退出；异常时只写待办，同因连发 3 次就自动停自己。它不执行 stage、不改代码、不 commit、不跑测试。

### 判断原会话是否还在跑

先取 `executor.session_id`，再用 Qoder 会话工具查：

- `list_chat_sessions`：看 `runtimeState`（`running` / `cold`）、`pendingInteractionCount`。
- `wait_chat_sessions([sessionId], timeoutMs)`：本轮结束、空闲、失败、中断或需要人工时返回。
- **不要用 `updatedAt` 判断存活**：它只在消息边界更新，一个仍在跑工具的长回合可能几十分钟不更新。

映射：`running` → 不打扰；`needs_attention` / `pendingInteractionCount > 0` → 不打扰；`idle` / `ready` / `turn_completed` / `cold` / `interrupted` / `failed` → 可唤醒；`missing` → 看是否有其他 running 会话，再决定兜底。`ready` 是 `list_chat_sessions` 返回的空闲态，必须当作 `idle`。

### 决策表

| 工作流 | 原会话 | 动作 |
|---|---|---|
| `done` / `aborted` | 任意 | `REMOVE`，撤销 cron |
| 任意 stage 的 `awaiting_user: acceptance_blocked` | 任意 | `PENDING`（不再静默跳过） |
| `8-acceptance` + `final_acceptance` | 任意 | `REMOVE` + 通知验收 |
| `awaiting_user` 非空（非 blocked） | 任意 | `SKIP`，等人 |
| 进行中 | `running` / `needs_attention` | `SKIP` |
| 进行中 | `idle` / `cold` / `interrupted` / `failed`，无有效租约，且有 `progress` | `NUDGE` 原会话 |
| 进行中 | `idle` / `cold` / …，无有效租约，但 `progress` 为空 | `PENDING`（禁止从零重跑） |
| 进行中 | `missing`，无其他 running，且有 `progress` | `EXECUTE_FALLBACK`（新建执行者） |
| 进行中 | `missing`，无其他 running，无 `progress` | `PENDING`，不重做 |
| 任意 | 有有效租约（含同功能） | `SKIP` |
| 任意 | 同因待办 24h 内已存在 | `LOG_ONLY`（不重复写待办） |
| 任意 | 同因连续 3 次（24h 内） | `DISABLE`（自动停看护，交人处理） |

### 预检脚本

先跑确定性预检，不要让 LLM 凭感觉判断：

```bash
node <技能目录>/scripts/watchdog-preflight.mjs \
  --state <状态文件绝对路径> --slug <slug> \
  --session-status <running|ready|idle|turn_completed|cold|interrupted|failed|needs_attention|missing|unknown> \
  --pending-interaction <n> --any-running <true|false> \
  --pending-dir <项目根>/.qoder/qa/pending
```

退出码：`0` = `NUDGE` / `EXECUTE_FALLBACK`，`2` = `SKIP` / `LOG_ONLY`，`3` = `REMOVE`，`4` = `PENDING`，`5` = `DISABLE`。脚本输出 JSON，含 `action`、`reason`、`fingerprint`（PENDING 时）；日志里原样记下。

预检现在会：用**全阶段产物矩阵**校验（3.5→`code-review.md`、4→`test-cases.md`、5→`test-review-r*.md`、6→`test-report-r*.md`+`issues.md`、7.5→`final-review.md`、8→`acceptance-summary.md`）；缺 `progress` 不 NUDGE；任意 stage 的 `acceptance_blocked` 都报；残留 `active_lock` 直接 PENDING 并提示 `qa-state migrate`；同因待办 24h 内去重，连续 3 次自动 `DISABLE`。

### 看护执行流程

1. **SKIP**：只 append 日志，不改任何文件，退出。
2. **LOG_ONLY**：只 append 日志，不改任何文件（24h 内已有同因待办），退出。
3. **DISABLE**：`action=list` 找到真实 `id`，`action=disable`（**不要 remove**，保留 id 供用户恢复）；写 `.qoder/qa/pending/<slug>-watchdog-disabled-<日期>.md`，含预检 JSON、同因待办历史、处理建议；通知用户看护已自动停用；退出。
4. **REMOVE**：`action=list` 找到名为「madmax-dev-qa 看护：<slug>」的任务，取真实 `id`，`action=remove`；清状态文件 `watchdog_cron_id`（只在没有有效租约时写）；通知验收/结束；退出。禁止臆造 ID。
5. **PENDING**：写 `.qoder/qa/pending/<slug>-watchdog-<日期>.md`，**开头必须是两行机器可读标记**（预检靠它判重）：

   ```html
   <!-- watchdog_reason: <fingerprint> -->
   <!-- watchdog_at: <ISO-8601 带时区> -->
   ```

   正文包括预检 JSON、原因、需要人工做什么、状态文件路径；记日志；退出。同因由预检去重，不要靠 supervisor 自己判断。
6. **NUDGE**：
   - `qa-lease acquire --kind watchdog --session watchdog-<runId> --run-id <runId> --ttl 300`；退出码 2 → 记日志退出。
   - **再查一次**原会话；若已变成 `running` / `needs_attention` → release，记日志，退出。
   - 目标 `run_id` = `executor.run_id`（预检保证非空；为空说明状态未 bind，预检会 PENDING，不会走到这里）。
   - **先 handoff**：`qa-lease handoff --from-session watchdog-<runId> --from-run-id <runId> --to-session <target> --to-run-id <目标 run_id> --to-kind manual --ttl 900`，再发消息（避免目标续租时租约还没交接）。
   - `send_message_to_chat_session(target, prompt)`，prompt 必须包含：
     - 先读状态文件和 `progress`；
     - 当前 `stage` / `current_task` / `current_step` / `completed_tasks`；
     - “不要重做已完成任务”；
     - 用 `session_id=<target>` / `run_id=<目标 run_id>` 先 `qa-lease renew` 续租（返回 2 时等 5 秒重试，最多 3 次）；
     - 每完成一个 Step 更新 `progress` / `state`；
     - 遇关口停下等用户。
   - `wait_chat_sessions([target], 15000–30000)` 确认它从 idle/cold 变成 `running`。
   - 确认失败：用目标身份 `qa-lease release`（租约已交接），写 pending，记日志；同一目标连续 3 次唤醒失败 → 不再自动唤醒，转人工。
   - 记日志，退出。**不要等整个工作流跑完**。
7. **EXECUTE_FALLBACK**（只允许原会话确实不存在且 `progress` 存在）：
   - acquire 租约（kind=watchdog）；
   - 用 `create_chat_session` 新建执行者（**不要在本 supervisor 会话里执行**）；
   - handoff 租约给新会话（新 run_id = `<runId>-exec`）；
   - `qa-state bind --state <状态文件> --session <新会话 ID> --run-id <新 run_id>` 把 `executor` 写回状态文件；
   - 发送自包含 prompt：读 SKILL.md / 状态 / plan / `progress`；从 `current_task/step` 继续；不要重做 `completed_tasks`；先续租；每 Step 更新进度；关口停下；
   - 记日志，退出。
   - 没有 `progress` 时禁止走这条；写 pending。

### 创建、移除与日志

- **建**（stage 0）：唯一入口是 MCP 工具 `qoder_cron`。`action=add`，`job={ name:"madmax-dev-qa 看护：<slug>", schedule:{kind:"cron", expression:"0 * * * *", timeZone:"Asia/Shanghai"}, prompt, cwd:"<项目根绝对路径>" }`。`prompt` 必须从 `<技能目录>/references/watchdog-prompt-template.md` 填充，不能复制旧 prompt；返回的 `id` 写入 `watchdog_cron_id`。
- **移除**：先 `action=list` 找真实 `id`，再 `action=remove`；禁止臆造 ID。
- **中止**：用户说“放弃 XX 功能” → 先停止 cron → `qa-state close --stage aborted --reason "<原因>"` → 调用 `madmax-dev-clean` 归档 → 释放租约；遗留待办保留并列出。
- **启停权限**：看护的 enable/disable/remove **只能由用户决定**；执行者（人工会话/子 Agent）一律禁止，觉得噪声大只能写 pending 建议。唯一例外是看护按 3-strike 自动 `DISABLE`。
- **日志**：每次运行 append 一行到 `.qoder/qa/<slug>/watchdog-log.md`：
  `| 时间 | run_id | action | reason | target_session | session_status | lease_owner | lease_age_ms |`
  `reason` 里带上 JSON 的 `fingerprint`（若有）。文件不存在时先写表头。日志是排障依据，不是状态源。
- **协议漂移**：状态文件 `watchdog_protocol` 与 cron prompt 里的版本必须一致；预检发现不一致会 `PENDING`，不要绕过。
- **额度耗尽**：触发可能排队或作废；恢复后下一次整点会再跑。预检是幂等的，积压多次触发只产生一次有效唤醒。
- 断点续跑不依赖 cron 存活：用户说“继续 XX 功能”即可恢复。

### 迁移旧状态文件（v1 → v2）

旧状态文件不要手改，用脚本（写操作，先拿租约）：

```bash
node <技能目录>/scripts/qa-state.mjs migrate \
  --state <状态文件> --session <会话 ID> --run-id <执行 ID> \
  [--feature-id <稳定 ID>] [--dry-run]

node <技能目录>/scripts/qa-state.mjs doctor --state <状态文件>
```

`migrate` 会：补 `watchdog_protocol: 2` / `feature_id` / `executor` / `progress`；把 `artifacts` map 改成 `existing` / `planned`；删除 `active_lock`；`revision + 1`；原子保存。

迁移后 `doctor` 报的 blocking errors 才是真正要人工判断的（如登记产物缺失、`progress` 需按 `plan.md` + `git log` 补齐）。迁移完成前看护会 `PENDING`，这是有意的安全行为。

## 并发互斥（工作区租约）

- **租约是工作区级的**，不是 per-feature：`.qoder/qa/.active-lease/`，所有执行者（人工/看护、任意功能）共用。一次只有一个租约持有者。
- 有效租约 = `now - heartbeat_at <= ttl_seconds`。任何有效租约（**包括同功能、包括人工会话自己**）都会让看护 `SKIP`。
- 租约过期不等于可以抢：还要查原会话 `runtimeState`。`running` / `needs_attention` → 仍然 `SKIP`；只有原会话确实 idle/cold/missing 且过期，才允许 `acquire`。
- 抢租约必须用 `qa-lease.mjs acquire`（`mkdir` 原子创建 + 过期重命名），不要手写 `active_lock`，不要 `rm -rf` 不认识的锁目录。
- 人工会话不拿租约 = 看护无法知道你正在跑。每次开始工作、每个 Step、每个阶段都要 `renew`；到关口/结束才 `release`。
- 多功能的看护也遵守同一把锁：A 功能持锁时，B 功能的看护 `SKIP`，不是“另一功能才跳过”。
- `.qoder/qa/.active-lease/` 加入项目 `.gitignore`；租约、watchdog-log、`history/` 都不入库。
- `qa-state migrate` / `bind` 在脚本内校验租约；没有有效租约直接退出码 2。`list` / `doctor` 只读，不需要租约。

## Git 纪律

- 只 commit 不 push（push 需用户明确要求）；不跳过 hooks
- 提交前 `git status` 复查暂存内容，防误提交敏感文件
- message：`type(scope): 描述`，QA 产物 scope 用 `qa/<slug>`
- 提交点：设计 `chore(qa/<slug>): 设计文档` / 计划 `chore(qa/<slug>): 执行文档` / 代码按任务小步 `feat(<slug>): ...` / 用例与报告 `chore(qa/<slug>): ...` / 修复 `fix(<slug>): ISS-003 ...` / 收尾 `docs: 同步 PRD 与记忆文件` / 验收通过打 tag `qa/<slug>-accepted`
- 证据不入库：`.qoder/qa/*/evidence/` 加进项目 `.gitignore`；报告与 issues 里记证据相对路径
- 租约、看护日志、历史目录不入库：`.qoder/qa/.active-lease/`、`.qoder/qa/*/watchdog-log.md`、`.qoder/qa/history/` 加进项目 `.gitignore`
- 看护 supervisor 不 commit；只有持租约的执行者提交
- 项目不是 git 仓库时：问用户是否 `git init`；用户拒绝则跳过全部提交点，并在待办记"本功能未纳入版本管理"

## 安全红线（不可协商）

- 端到端测试**只允许针对本地或测试环境**；禁止对生产环境做任何写入操作（下单、支付、发消息、改数据、删数据）。
- 不执行来源不明的脚本；不把密钥、token、账号密码写进 `config.md`、报告或提交内容（测试账号写占位说明，真实凭据留在环境变量或本地不入库文件）。
- 修复问题时只改与该问题相关的代码，不顺手做无关重构。

## 缺陷台账（issues.md）

`issues.md` 是唯一的缺陷源；`pending/` 只是人工待办，不是缺陷台账。

表头至少包含：

| ID | 级别 | 用例/需求 | 现象 | 根因 | 状态 | 证据 | origin_feature | affects |
|---|---|---|---|---|---|---|---|---|

- 状态枚举：`open` / `fixing` / `closed` / `verified` / `skipped`；`待裁决`、`待办` 一律按 `open` 计。
- **每条红色 E2E 用例必须对应一行 issue，或进 `flaky.md`**；不允许只在报告或 pending 里提。
- 跨功能缺陷：`origin_feature` 记录发现它的功能，`affects` 记录受影响功能（逗号分隔）；只在 origin 功能记一行，affects 功能引用该 ID，不重复记。
- `qa-state doctor` 会核对：frontmatter 的 `issues.total/open/closed` 与表格实算一致；最新报告里的失败用例已映射；stage ≥ 8 时 open P0/P1 必须为 0。

## flaky 判定协议

先定义“干净环境”，否则“倾向 flaky”不是结论：

1. 单进程、无并发、DB 可重置；记录 `resetSeed` 耗时。
2. `resetSeed > 120s` 或 health check 失败 → 判环境不可测，**不出结论**，写 pending。
3. 同一 commit 连续 2 次独立运行都红 → 判缺陷，进 `issues.md`。
4. 绿↔红翻转（同 commit）→ 判 flaky，写 `flaky.md`，隔离该用例。
5. flaky 不计入 P0/P1 清零；放行必须用户签字，并在验收通知里列出。

`flaky.md` 每行至少：用例 ID、commit、2 次运行结果、证据路径、签字状态。

## 问题分级与验收放行

| 级别 | 定义 | 例子 | 验收要求 |
|---|---|---|---|
| P0 阻塞级 | 主流程走不通、崩溃/白屏、数据错误或丢失、资损与安全风险 | 下单失败、金额错、数据消失、越权 | **必须全部修复** |
| P1 功能级 | 非核心功能不可用，或结果错误但有绕行；错误提示误导 | 导出无响应但可手动复制、校验失效 | **必须全部修复** |
| P2 体验级 | 样式、文案、轻微性能、日志缺失、兼容边角 | 错位、错别字、略慢 | 可带病验收，通知中逐条声明 |

判定顺序：阻断主流程/数据资损安全 → P0；功能不可用或结果错误但可绕行 → P1；其余 P2。**拿不准就高不就低**。

**放行规则**：所有 P0/P1 必须 `closed`/`verified` 才通知验收；未清零则**不通知**，状态置 `awaiting_user: acceptance_blocked`，写待办并告知"验收被阻塞"。

**验收通知必须包含**：各级问题数量与状态 → P0/P1 清零证明（issues 行 + 证据路径）→ P2 遗留清单 → flaky 清单与签字状态 → skipped 与 pending 待办清单 → 回归报告轮次 → 变更 commit 范围 → 小程序真机抽查清单 → `qa-state doctor --strict` 的结论。

## 常见错误（基线实测：Agent 无流程指令时的真实做法）

| 错误 | 纠正 |
|---|---|
| 把三个关口内联执行，"反正最后统一验收" | 关口是逐个停，用户只免了最终验收那次 |
| 产物散落在项目根（DESIGN.md/TESTS.md/PLAN.md） | 全部进 `.qoder/qa/<slug>/` |
| 不写状态文件，任务一停就断线 | 阶段完成立刻重写状态文件 |
| 跳过代码审查与用例审查直接测 | 3.5 与 5 是必过环节 |
| 问题不分级、不建 issues.md，只在报告里"缺陷记录" | 分级 + 独立 `issues.md` |
| 自己判"全部通过，可验收"就结束 | 须经 7.5 复核 + 关口③ |
| 报告覆盖写，重跑丢历史 | `test-report-r<N>.md` 轮次命名 |
| 截图直接进 git 撑大仓库 | `evidence/` 加 .gitignore |
| 人工会话不拿租约、不写 `executor.session_id` | 看护看不见你，必然并发；开工前先 acquire |
| 用 `active_lock` / `updatedAt` 判断会话是否在跑 | 租约心跳 + `runtimeState`；`updatedAt` 不是心跳 |
| 看护在 automation 会话里直接执行 stage | supervisor 只唤醒原会话；执行必须在原会话/新执行者 |
| 在 `running` 会话上发“继续”消息 | 会被 steering/queue，等于制造并发；先查再发 |
| 状态只写到 `stage`，不写 `progress` | 接手只能从 Task 1 重做；每个 Step 都要写 |
| `artifacts` 把未来产物也列进去 | 分 `existing` / `planned`；缺失未来产物不重做 |
| frontmatter 和正文各写一套进度 | frontmatter 唯一权威；正文只能是派生摘要 |
| cron prompt 复制旧规则不更新 | 加 `watchdog_protocol` 版本，预检不一致就 PENDING |
| 执行者觉得看护吵就自己 disable/remove | 启停只能由用户决定；执行者只能写 pending 建议 |
| 状态文件登记了产物，磁盘上却没有 | `qa-state doctor` 会报 `artifact_missing`；阶段收尾必跑 |
| `issues` 计数与 `issues.md` 表格不符 | `doctor` 核对；以表格实算为准 |
| 红色用例只写进 pending，不进 issues | 每条红必须映射 issue 或 `flaky.md`，否则验收不可见 |
| 手写 v1→v2 迁移 | 用 `qa-state migrate`，它会校验租约、原子保存 |
| 正文再抄一份阶段/问题数 | frontmatter 唯一权威；正文只留恢复指引 |
| 同因待办一小时一个 | 预检按 fingerprint 去重；24h 同因 `LOG_ONLY`，连续 3 次 `DISABLE` |
| 只在 stage 8 处理 `acceptance_blocked` | 任意 stage 的 `acceptance_blocked` 都要 PENDING |
| 功能做完/放弃后目录一直留在顶层 | `close` 写终态 → 调用 `madmax-dev-clean` 归档 + 清理 |
| 直接 `rm -rf` 功能目录 | 先 `close` 再 `archive`，保留可追溯历史；只有 `gc` 能删历史 |

## Red Flags — 停下来自检

- 打算"先做下去，最后一起给用户看" → 关口就在这里
- 产物写到了项目根而不是 `.qoder/qa/<slug>/`
- 一个问题修不好就打算停掉整个流程 → 应该跳过 + 写待办 + 继续
- 打算自己说"可以验收了" → 7.5 复核 + 用户确认
- 状态文件没更新就以为"进度还在"
- 没拿租约就开工，或觉得“我是人工会话所以不用租约”
- 打算用 `updatedAt` / `active_lock` 判断原会话是不是停了
- 打算在 `running` 会话上发“继续”消息
- 打算让看护在 automation 会话里直接执行 stage
- 打算从 `stage` 重跑，而不是从 `progress.current_task/step` 继续
- 状态文件没有 `executor.session_id` 就启用看护
- cron prompt 与 `watchdog_protocol` 版本不一致还继续跑
- 打算手写状态文件迁移 → 跑 `qa-state migrate`
- 打算跳过 `qa-state doctor` 直接进下一 stage
- 打算自己 disable/remove 看护 → 只有用户或 3-strike 可以
- 打算把红色用例只写进 pending → 必须进 `issues.md` 或 `flaky.md`
- 打算在状态文件正文再维护一份进度 → frontmatter 唯一权威
