# Smoke Tests — 23 条验收清单

> 本文件列出 prd-kit skill 的全部 smoke test。运行方式：**手动逐条执行**。skill 不引入自动化测试框架。

---

## A. 安装完整性自检（6 条，必跑）

```bash
test -f ~/.claude/skills/prd-kit/SKILL.md                          && echo OK || echo FAIL: SKILL.md
test -f ~/.claude/skills/prd-kit/templates/PRD.md.tmpl             && echo OK || echo FAIL: PRD.md.tmpl
test -f ~/.claude/skills/prd-kit/templates/features.md.tmpl        && echo OK || echo FAIL: features.md.tmpl
test -f ~/.claude/skills/prd-kit/templates/engineering.md.tmpl     && echo OK || echo FAIL: engineering.md.tmpl
test -f ~/.claude/skills/prd-kit/templates/changelog.md.tmpl       && echo OK || echo FAIL: changelog.md.tmpl
test -f ~/.claude/skills/prd-kit/references/split-pattern.md       && echo OK || echo FAIL: split-pattern.md
```

期望输出：6 行 `OK`。

---

## B. Create Mode 8 条 smoke test

每条针对一个空目录跑 `/prd-kit create` 或手动复制模板验证。

| # | 场景 | 操作 | 期望 |
|---|---|---|---|
| B1 | 全新空项目 | 在空目录执行 create | 4 文件全部直接创建，无冲突 |
| B2 | 仅 PRD.md 已存在 | 把任意 PRD.md 放进空目录 → create | PRD.md → `.new-<date>`，其他 3 份直接创建 |
| B3 | 仅 docs/PRD/3 文件全存在 | 把 3 个 .md 放进 docs/PRD/ → create | PRD.md 直接创建；3 文件全 `.new-<date>` |
| B4 | 4 文件全部已存在 | 把 4 文件全放进 → create | PRD.md 弹 AskUserQuestion；3 文件全 `.new` |
| B5 | PRD.md 已存在 + 用户选「跳过」 | 选 2 → create | PRD.md 不写；其他 3 份照常处理 |
| B6 | PRD.md 已存在 + 用户选「取消」 | 选 3 → create | 任何文件都不写（包括未冲突的） |
| B7 | 同日 .new 已存在 | 提前建 features-new-<date>.md → create | 计数器 A 触发 → features-new-<date>-2.md |
| B8 | docs/PRD/ 父目录不存在 | 在无 docs/PRD/ 的项目里 create | 自动 mkdir -p，4 文件正常创建 |

**执行**：每条用一个临时空目录，结束后 `rm -rf` 清理。

---

## C. Split Mode 6 条 smoke test

每条针对一个超 600 行的 features.md 副本跑 `/prd-kit split`。

| # | 场景 | 操作 | 期望 |
|---|---|---|---|
| C1 | 单文件 800 行 | 把现 features.md 复制 8 份拼成 800 行 → split | 拆出 1 个新文件；features.md 留 4.3 链接行 |
| C2 | 多文件均 ≥ 600 行 | features.md + engineering.md 都 ≥ 600 → split | 询问「先拆哪个」；拆一个不进另一个 |
| C3 | 文件 150-600 行 | features.md 写 400 行 → split | 报行数 + 询问「未达阈值，是否继续」 |
| C4 | 文件 < 150 行 | features.md 写 100 行 → split | 强制拒绝，报行数 |
| C5 | 无 H2/H3 候选 | features.md 全是 H1 + 段落 → split | 报错「无候选边界」，回 Step 2 |
| C6 | 用户在 AskUserQuestion 选「取消」 | 选最后一项「不拆分」 → split | 中止；不写任何文件 |

**执行**：每条用临时副本，结束后 `rm -rf` 清理。

---

## D. 边界行为 3 条回归

| # | 场景 | 操作 | 期望 |
|---|---|---|---|
| D1 | 路径含中文 / 空格 | 在 `测试 项目/` 下 create | 4 文件全部正常创建（无绝对路径污染模板） |
| D2 | 非 git 目录运行 | 在 `~/Downloads/test/`（非 git 仓库）→ create | 不报错；正常创建 |
| D3 | skill 自带 templates 缺失 | 删 1 个 .tmpl → create | 启动自检失败 → 报错「skill 安装不完整，请重装」 |

---

## 验收 Gate

```
A(6) + B(8) + C(6) + D(3) = 23 条全部通过 → release
```

加上 `doc-sync` / `neat-freak` 现有测试仍可用 = 最终验收。

---

## 不做的事

- ❌ 不写自动化 e2e 测试脚本
- ❌ 不引入 pytest / jest / 任何测试框架
- ❌ 不把 smoke test 集成到 CI
- ❌ 不监控文件行数自动跑拆分（用户手动触发）

保持 skill **零依赖**——只是模板 + 步骤描述 + 手动验证清单。
