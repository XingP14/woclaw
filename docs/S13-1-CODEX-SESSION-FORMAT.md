# S13-1: Codex Session 存储格式调研

**日期**: 2026-04-04
**步骤**: S13-1（调研）
**结论**: ✅ 有完整存储格式，迁移工具可行

---

## Codex CLI Session 存储格式

### 1. 主存储：`~/.codex/history.jsonl`

- **格式**: JSON Lines（每行一个 JSON 对象）
- **内容**: 完整对话记录，每行一个 message
- **可通过 `codex transcript.path` 配置覆盖路径
- Codex 官方文档确认

### 2. 分会话存储：`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`

- **格式**: JSON Lines，每行一个事件（action/observation）
- **结构更丰富**: 包含 tool calls、outputs、trajectory
- **日期分片**: `sessions/2026/04/03/rollout-abc123.jsonl`
- 来源: GitHub issue #2288（Codex 官方仓库）

### 3. Hook 系统提供的结构化数据

Codex 通过 `~/.codex/hooks.json` 注册 hooks，hook 脚本通过 stdin 接收 JSON：

**SessionStart Hook stdin**:
```json
{
  "session_id": "7f9f9a2e-1b3c-4c7a-9b0e-...",
  "cwd": "/path/to/project",
  "matcher": "startup|resume"
}
```

**SessionStop / Stop Hook stdin**（woclaw-codex stop.py 使用）:
```json
{
  "session_id": "7f9f9a2e-1b3c-4c7a-9b0e-...",
  "transcript_path": "/home/user/.codex/sessions/2026/04/03/rollout-abc123.jsonl",
  "cwd": "/path/to/project",
  "stopReason": "task_complete|error|user_stopped|..."
}
```

### 4. `codex exec --json` 输出格式

- 流式 JSON，每行一个 state change 事件
- 可重定向到文件: `codex exec --json ... > output.jsonl`
- 来源: GitHub issue #2288（Codex 团队确认）

---

## 迁移工具设计输入

### 输入源
| 源 | 路径 | 格式 | 关键字段 |
|----|------|------|---------|
| **主历史** | `~/.codex/history.jsonl` | JSONL | messages[], session_id, created_at |
| **分会话轨迹** | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | JSONL | events[], tool_calls, trajectory |
| **Hook stdin** | 运行时注入 | JSON | session_id, cwd, stopReason |

### 输出目标
- **WoClaw Memory**: `codex:session:<session_id>` — 写入 session summary
- **WoClaw Topic**: `codex-sessions` — 发布 session 事件
- **WoClaw Memory**: `codex:context` — 累积项目上下文（可配置 key）

### 迁移步骤（S13-2 ~ S13-4）
1. **S13-2**: 解析 `history.jsonl`（逐行 JSON）→ 提取 messages/decisions
2. **S13-3**: 实现 `woclaw migrate --framework codex --session-id <id>` CLI
3. **S13-4**: 测试 + 模板复制到 S14-S16

---

## 参考资料

- Codex Hooks 文档: https://developers.openai.com/codex/hooks
- Codex Config Advanced: https://developers.openai.com/codex/config-advanced
- Codex history.jsonl: https://developers.openai.com/codex/config-reference
- GitHub #2288: `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl` 格式确认
