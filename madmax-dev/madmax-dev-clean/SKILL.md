---
name: madmax-dev-clean
description: 【Mad Max · 交付】清理 madmax-dev-qa 工作流的历史数据（已结束功能目录与已归档待办）。当用户说“清理工作流历史”“清理 qa 历史”“归档已完成功能”“清理 .qoder/qa”“qa cleanup”时使用；madmax-dev-qa 在会话启动 bind 后与 8.5 收尾时也会自动调用。默认 dry-run，只删超过保留期（默认 30 天）的 history/ 与 archive/ 条目，不碰活功能与未处理待办。
---

# QA 历史清理（madmax-dev-clean）

## 职责边界

| 管 | 不管 |
|---|---|
| `archive`：把 `done` / `aborted` 的功能目录移入 `history/` | `close`：写工作流终态，归 `madmax-dev-qa` |
| `gc`：删除过期历史与已归档待办 | 活功能目录、`pending/` 未处理待办 |
| 查看历史与保留期（`list`） | 代码、git、状态文件内容 |

## 依赖与路径

`SKILL_DIR` = 本文件所在目录。脚本在 `madmax-dev-qa` 技能里，不复制一份实现：

```bash
QA_STATE="$SKILL_DIR/../madmax-dev-qa/scripts/qa-state.mjs"
QA_LEASE="$SKILL_DIR/../madmax-dev-qa/scripts/qa-lease.mjs"
```

脚本不存在时，告知用户先安装/修复 `madmax-dev-qa`，不要另写清理逻辑。

## 规则（哪些算历史，保留多久）

| 类别 | 什么算 | 位置 | 保留期 |
|---|---|---|---|
| 活功能 | `stage` 不是 `done` / `aborted` | `.qoder/qa/<slug>/` | **不删** |
| 历史功能 | `stage=done` 或 `aborted`，且执行过 `archive --apply` | `.qoder/qa/history/<slug>-<归档日>/` | **默认 30 天**，从归档日算 |
| 已归档待办 | 功能归档时同 slug 的 `pending/*.md` 自动移入，或人工确认后移入 | `.qoder/qa/archive/` | **默认 30 天**，从归档时刻算（归档时会重置 mtime） |
| 未处理待办 | 仍在 `pending/`，功能未归档 | `.qoder/qa/pending/` | **不删** |

- 自动清理只有两个触发点：主技能会话启动 `bind` 后、8.5 收尾。**没有独立定时器**。
- 时间口径 Asia/Shanghai；`history/` 取目录名里的归档日（当天 23:59:59 起算），`archive/` 取文件 mtime。
- `history/` 不入 git；`list` 的 `history.stale` 只是提示，不会自动删。

## 三种调用方式

### A. 自动模式（madmax-dev-qa 调用，执行者已持租约）

```bash
# 会话启动 bind 后：只清过期历史
node "$QA_STATE" gc --root <项目根> --older-than 30 --apply \
  --session <会话 ID> --run-id <执行 ID>

# 8.5 收尾：先归档已结束功能，再清过期历史
node "$QA_STATE" archive --root <项目根> --apply \
  --session <会话 ID> --run-id <执行 ID>
node "$QA_STATE" gc --root <项目根> --older-than 30 --apply \
  --session <会话 ID> --run-id <执行 ID>
```

不要再 acquire；租约由主技能持有。失败只报告，不阻断主流程。

### B. 手动预览（默认，用户说“看看要清什么”）

```bash
node "$QA_STATE" list --root <项目根>
node "$QA_STATE" archive --root <项目根> --slug <slug>     # 不带 --apply 就是预演
node "$QA_STATE" gc --root <项目根> --older-than 30         # 不带 --apply 就是预演
```

把结果整理成一张表再问用户：**将归档哪些功能、将删哪些路径、共多大、保留期多少、剩余多少**。

### C. 手动执行（用户确认后）

1. 查租约：

   ```bash
   node "$QA_LEASE" status --root <项目根> --json
   ```

   有有效租约 → 停止，告知用户“有工作流在跑，等它结束或让执行者自己清理”；**不抢锁、不用 `--force`**。
2. 取当前会话 ID（`list_chat_sessions`，同 cwd 最近更新；不确定问用户一次）；生成 `run-id=cleanup-<YYYYMMDD-HHmmss>`。
3. 拿短租约并执行：

   ```bash
   node "$QA_LEASE" acquire --slug madmax-dev-clean --kind manual \
     --session <会话 ID> --run-id <run-id> --ttl 300 --root <项目根>

   node "$QA_STATE" archive --root <项目根> [--slug <slug>] --apply \
     --session <会话 ID> --run-id <run-id>
   node "$QA_STATE" gc --root <项目根> --older-than 30 --apply \
     --session <会话 ID> --run-id <run-id>

   node "$QA_LEASE" release --slug madmax-dev-clean \
     --session <会话 ID> --run-id <run-id> --root <项目根>
   ```

4. 输出报告：归档 N 个、删除 N 个（X MB）、剩余历史 N 个；逐条列出删除路径。

## 安全红线

- **默认 dry-run**；只有用户明确确认，或主技能自动模式，才加 `--apply`。
- 只允许 `qa-state archive` / `qa-state gc`；**禁止 `rm -rf`、禁止手删活功能**（没结束的功能应先由主技能 `close`）。
- `--older-than 0` 或明显短于 30 天：必须用户明确说“全删 / 只留 N 天”，执行前复述影响。
- 不改状态文件、不 `close`、不改代码、不 commit。
- 不进 `pending/` 删未处理待办；`gc` 只扫 `history/` 与 `archive/`。
- 路径安全检查由 `qa-state` 内置：只删两个历史目录的直接子项，拒绝其它路径。

## 输出模板

```text
历史清理结果（保留期 30 天）
- 归档功能：2 个（C端导航重构-20261022、B端配置联动审查-20261022）
- 删除历史：1 个 / 12.4 MB
- 删除已归档待办：3 个
- 剩余历史：1 个（未到保留期）
```

## 常见问题

| 现象 | 处理 |
|---|---|
| `找不到功能状态文件` | `--slug` 与 `.qoder/qa/` 下的目录名不一致；先 `list --root` |
| 退出码 2 / 租约不属于 | 有别的执行者持锁，或 session/run-id 与 acquire 不一致 |
| 功能还在 6-e2e / 7.5 | 不能归档；先完成或由主技能 `close --stage aborted` 放弃 |
| 删完还剩很多 | `gc` 只清超过保留期的；没到期的不会删 |
| 找不到 `qa-state.mjs` | `madmax-dev-qa` 技能未安装或路径变了 |
