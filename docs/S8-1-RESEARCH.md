# S8-1 研究结论：openclaw mcp serve 接口 & woclaw-mcp 架构分析

**日期**: 2026-04-03
**步骤**: S8-1 ✅

## 结论摘要

`woclaw-mcp` 已完整实现 MCP CLI serve 功能，无需从零开发。

---

## openclaw mcp serve 是什么

- OpenClaw 的 MCP serve：将 OpenClaw 会话/频道暴露为 MCP tools
- MCP client（如 Claude Desktop）通过 stdio 连接 `openclaw mcp serve`
- 暴露工具：`conversations_list`, `messages_read`, `messages_send` 等（面向 OpenClaw 会话）
- **与 WoClaw 无关**，WoClaw 需要自己的 MCP serve

---

## woclaw-mcp 已完整实现

**位置**: `woclaw-mcp@0.1.2` (npm)
**bin**: `woclaw-mcp`
**实现方式**: Node.js ESM，JSON-RPC 2.0 over stdin/stdout

### 已实现的 8 个 MCP tools

| Tool | 说明 |
|------|------|
| `woclaw_memory_read` | 读取 WoClaw Hub 共享记忆 |
| `woclaw_memory_write` | 写入 WoClaw Hub 共享记忆 |
| `woclaw_memory_delete` | 删除记忆键 |
| `woclaw_memory_list` | 列出所有记忆 |
| `woclaw_topics_list` | 列出所有 topic |
| `woclaw_topic_messages` | 获取 topic 历史消息 |
| `woclaw_topic_send` | 向 topic 发送消息 |
| `woclaw_topic_join` | 加入 topic 订阅 |

### CLI 参数
```bash
woclaw-mcp --hub=ws://localhost:8082 --token=xxx --rest-url=http://localhost:8083
```

### MCP 协议实现（JSON-RPC 2.0）
- `initialize` → 返回 protocolVersion + capabilities + serverInfo
- `tools/list` → 返回工具列表（含 inputSchema）
- `tools/call` → 执行工具（通过 fetch 或 WebSocket 发给 Hub）

---

## S8 实现方案

### 方案选择：集成到 woclaw CLI（推荐）

在 `plugin/bin/woclaw-cli.js` 添加 `mcp` 子命令：

```javascript
else if (command === 'mcp') {
  const sub = args[1];
  if (sub === 'serve') {
    // 方案A：spawn woclaw-mcp 子进程
    const { spawn } = require('child_process');
    const mcpBin = require.resolve('woclaw-mcp/dist/index.js');
    spawn('node', [mcpBin, ...args.slice(2)], { stdio: 'inherit' });
  }
}
```

### 两种集成路径

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A: 子进程调用** | woclaw-cli spawn woclaw-mcp | 代码复用，版本独立 | 需要 woclaw-mcp 已在 node_modules |
| **B: 嵌入源码** | 将 woclaw-mcp 逻辑复制到 woclaw CLI | 无额外依赖 | 代码重复，维护成本高 |

**推荐方案 A**，但需要 woclaw plugin package.json 添加 `woclaw-mcp` 为可选 peer dependency。

### 用户使用方式（两种入口）

```bash
# 方式1：直接用 woclaw-mcp
woclaw-mcp --hub=ws://your-hub-host:8082 --token=WoClaw2026 --rest-url=http://your-hub-host:8083

# 方式2：通过 woclaw CLI（S8-3 实现目标）
woclaw mcp serve --hub ws://your-hub-host:8082 --token WoClaw2026 --rest-url http://your-hub-host:8083
```

---

## S8 后续步骤计划

- **S8-2（10min）**: 设计 woclaw MCP serve 实现方案（确认方案 A/B）
- **S8-3（10min）**: 在 woclaw-cli.js 添加 `mcp serve` 子命令
- **S8-4（10min）**: 测试 `woclaw mcp serve` + 更新 package.json
