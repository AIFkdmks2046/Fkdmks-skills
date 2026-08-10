# features · todos-cli

> prd-kit 铺设的功能分册。**该章节写什么**请按以下结构填业务内容。

## §3 功能全景

### §3.1 添加 todo（`add`）

**用户故事**：作为用户，我能在终端跑 `todos add "buy milk"`，把一条 todo 加到本地列表。

**入参**：
- `--priority, -p`（可选）：`high` / `medium` / `low`，默认 `medium`
- `--due`（可选）：`YYYY-MM-DD` 格式

**出参**：打印 `[#] 1 buy milk (medium)`。

**边界**：
- 标题为空 → 报错退出（exit code 2）
- 优先级非法 → 报错退出（exit code 2）

### §3.2 列表 todo（`list`）

**用户故事**：作为用户，我能在终端跑 `todos list`，看到所有未完成的 todo，按优先级 + 创建时间排序。

**出参示例**：
```
[1] (high)   buy milk         2026-08-10
[2] (medium) write spec       2026-08-09
[3] (low)    read paper       2026-08-08
```

**筛选**：
- `--all` / `-a`：包含已完成
- `--priority <p>`：仅显示指定优先级
- `--due <date>`：仅显示指定截止日期

### §3.3 标记完成（`done`）

**用户故事**：作为用户，我能在终端跑 `todos done 1`，把 id=1 的 todo 标记为已完成。

**边界**：
- id 不存在 → 报错退出（exit code 3）

### §3.4 删除 todo（`rm`）

**用户故事**：作为用户，我能在终端跑 `todos rm 1`，把 id=1 的 todo 删除（不可恢复）。

**边界**：
- 默认需 `--force` / `-f` 确认；不传 → 交互式 y/N 提示

### §3.5 持久化（自动）

**行为**：所有命令自动读写 `~/.todos.json`，无需用户配置路径。

**并发**：单进程假设，不处理文件锁。

## §4 数据模型

```rust
struct Todo {
    id: u32,
    title: String,
    priority: Priority,  // High | Medium | Low
    due: Option<Date>,
    done: bool,
    created_at: DateTime,
}

struct TodoStore {
    version: u32,         // 当前 1
    todos: Vec<Todo>,
}
```

JSON 文件格式：
```json
{
  "version": 1,
  "todos": [
    {"id": 1, "title": "buy milk", "priority": "medium", "due": null, "done": false, "created_at": "2026-08-10T10:00:00Z"}
  ]
}
```

## §5 关键流程

### §5.1 add → 持久化

```
用户: todos add "buy milk"
  ↓
main.rs: parse args (clap)
  ↓
cmd/add.rs:
  1. load ~/.todos.json (or empty)
  2. id = max(existing.id) + 1
  3. push Todo { id, title, priority, due=None, done=false, created_at=now }
  4. write ~/.todos.json (pretty = false)
  5. print "[#] <id> <title> (<priority>)"
```

### §5.2 list → 排序 → 输出

```
用户: todos list
  ↓
main.rs: parse args
  ↓
cmd/list.rs:
  1. load ~/.todos.json
  2. filter (--all: include done; default: !done)
  3. sort: priority desc → created_at asc
  4. format & print each row
```

## §6 错误码

| Exit code | 含义 |
|-----------|------|
| 0 | 成功 |
| 1 | 内部错误（IO / 解析失败） |
| 2 | 用户输入非法（空标题 / 非法优先级） |
| 3 | 资源不存在（todo id 不存在） |

## §7 待办（业务级）

- [ ] 支持 `todos edit <id> --title "..."` 编辑标题
- [ ] 支持 `todos clear --done` 批量清除已完成
- [ ] 支持 `--json` 输出，便于脚本管道

---

> 该分册超过 600 行时调用 `/prd-kit split`，按 H2/H3 拆到 `docs/PRD/features/<topic>.md`。