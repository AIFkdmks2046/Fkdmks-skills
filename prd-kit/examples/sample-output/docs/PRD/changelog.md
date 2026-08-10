# changelog · todos-cli

> prd-kit 铺设的变更日志分册。每条变更一行，**最新在上**。

---

## 2026-07-22 · v0.3.0 · feat: 加 JSON 持久化

- todos 数据写到 `~/.todos.json`，重启不丢
- 加 `store.rs` 模块，统一读写
- 加 `tests/store_test.rs` round-trip 测试
- 关联：§3.5 持久化 / §4 数据模型

---

## 2026-07-10 · v0.2.0 · feat: 加优先级（priority）

- todos 支持 `--priority high/medium/low`
- list 默认按优先级 desc 排序
- Todo struct 加 `priority` 字段
- 关联：§3.1 add / §3.2 list

---

## 2026-06-28 · v0.1.0 · feat: 初版

- 实现 add / list / done / rm 四个子命令
- clap derive 解析参数
- 内存存储（重启丢数据）
- 关联：§3 功能全景

---

> 老于 6 个月的条目移到 `docs/PRD/archive/changelog-archive.md`，不在本分册累积。