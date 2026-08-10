# PRD · todos-cli

> **这是一个 prd-kit 铺出来的虚构示例**。
> 演示 prd-kit 在一个真实的（虚构的）Rust todos 命令行项目上铺出的 PRD 骨架长什么样。
> 内容是占位 + 假数据，不是真实实现记录。

---

## §1 一句话定位

一个 Rust 单二进制本地命令行 todos 工具，零依赖，跨平台。

## §2 仓库结构

```
todos-cli/
├── Cargo.toml
├── README.md
├── src/                    # 二进制入口
│   ├── main.rs             # clap CLI 入口
│   ├── cmd/                # 子命令实现
│   │   ├── add.rs
│   │   ├── list.rs
│   │   ├── done.rs
│   │   └── rm.rs
│   └── store.rs            # JSON 持久化
├── tests/                  # 集成测试
└── PRD.md                  # ← 本文件
    └── docs/PRD/           # PRD 分册
        ├── features.md     # 功能分册
        ├── engineering.md  # 工程分册
        └── changelog.md    # 变更日志
```

## §3 文档索引（指向各分册）

| 分册 | 内容 | 行数 |
|------|------|------|
| [**features.md**](docs/PRD/features.md) | §3 功能全景 / §4 数据模型 / §5 关键流程 | ~80 行 |
| [**engineering.md**](docs/PRD/engineering.md) | §9 技术栈 / §10 项目结构 / §11 配置 / §12-§15 构建/调试/测试/FAQ | ~80 行 |
| [**changelog.md**](docs/PRD/changelog.md) | §8 变更日志（v0.1 / v0.2 / v0.3） | ~30 行 |

## §4 维护约定（5 条同步义务）

> 本节是 prd-kit 铺设的标准内容，所有 prd-kit 铺出的项目都一样。

1. **改 features.md → 同步更新 PRD.md §3 索引**（行数 + 链接）。
2. **改 engineering.md → 同步更新 PRD.md §3 索引**。
3. **任何代码变更 → 在 changelog.md §8 追加一行**（Conventional Commits 格式 + 日期）。
4. **features.md / engineering.md 单文件超 600 行** → 调用 `/prd-kit split` 按 H2/H3 拆分。
5. **新增分册**（如 `docs/PRD/architecture.md`）→ 在本文件 §3 加一行。

## §5 最近变更

详见 [docs/PRD/changelog.md](docs/PRD/changelog.md)。当前最新：v0.3 — 加 JSON 持久化（2026-07-22）。

## §6 待办

- [ ] （本节由业务团队维护，不属于 prd-kit 铺设的标准内容）

## §7 已知约束

- 仅支持本地文件存储（`~/.todos.json`），不支持云同步。
- 不做 i18n，提示语英文。

---

> 以上是 prd-kit 铺设的标准骨架。**修改业务内容请在对应分册改，PRD.md 只维护索引**。