# engineering · todos-cli

> prd-kit 铺设的工程分册。**该章节写什么**请按以下结构填技术细节。

## §9 技术栈

| 类别 | 选型 | 版本 | 理由 |
|------|------|------|------|
| 语言 | Rust | 1.7x stable | 单二进制 / 零运行时依赖 / 跨平台编译 |
| CLI 解析 | clap | 4.x | derive 宏，类型安全 |
| 序列化 | serde + serde_json | 1.x | 标准 |
| 时间 | chrono | 0.4.x | 时区 + 格式化 |
| 测试 | cargo test 内置 | — | 集成测试在 `tests/` |
| 错误处理 | anyhow | 1.x | 二进制场景够用 |

## §10 项目结构

```
todos-cli/
├── Cargo.toml
├── Cargo.lock
├── README.md
├── src/
│   ├── main.rs           # clap Parser 入口
│   ├── cmd/
│   │   ├── mod.rs
│   │   ├── add.rs
│   │   ├── list.rs
│   │   ├── done.rs
│   │   └── rm.rs
│   ├── store.rs          # TodoStore + JSON 读写
│   └── model.rs          # Todo / Priority struct
├── tests/
│   ├── add_test.rs
│   ├── list_test.rs
│   └── store_test.rs
└── PRD.md
    └── docs/PRD/         # 本目录
```

## §11 配置

**唯一配置项**：todo 存储路径，默认为 `~/.todos.json`。

**覆盖方式**（优先级从高到低）：
1. 环境变量 `TODOS_STORE=/path/to/file.json`
2. 命令行 `--store <path>`（所有子命令通用）
3. 默认值 `~/.todos.json`

## §12 构建

```bash
cargo build --release              # 输出 target/release/todos
cargo install --path .             # 安装到 ~/.cargo/bin/todos
```

**交叉编译**（可选）：
```bash
cargo build --release --target x86_64-pc-windows-gnu
cargo build --release --target x86_64-unknown-linux-gnu
cargo build --release --target aarch64-apple-darwin
```

## §13 调试

```bash
RUST_LOG=todos=debug cargo run -- add "test"     # 启用 debug 日志
cargo run -- --store /tmp/test.json list        # 用临时文件调试
```

**已知坑**：
- Windows 下 `~` 由 `dirs` crate 解析，CMD / PowerShell 默认 `$HOME` 可能未设，落到 `%USERPROFILE%`。

## §14 测试

```bash
cargo test                          # 全部测试
cargo test --test add_test          # 单个测试文件
cargo test -- --nocapture           # 看到 println! 输出
```

**测试覆盖目标**：核心命令 + store 读写 round-trip ≥ 80%。

**CI**（待接入）：GitHub Actions，跑 `cargo test` + `cargo clippy` + `cargo fmt --check`。

## §15 FAQ

**Q：为什么不用 SQLite？**
A：当前 todos 数量级别（< 1000）不需要 SQL。JSON 文件 < 100KB，秒级加载。如未来需要多用户/同步，再迁移到 SQLite。

**Q：为什么不支持 Windows MSVC 编译？**
A：[在此写 FAQ]

**Q：为什么 todo id 是 u32 而不是 UUID？**
A：[在此写 FAQ]

---

> 该分册超过 600 行时调用 `/prd-kit split`，按 H2/H3 拆到 `docs/PRD/engineering/<topic>.md`。