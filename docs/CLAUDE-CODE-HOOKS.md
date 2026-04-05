# Claude Code Hooks — WoClaw Integration Guide

> S13-4 follow-up: 为最常用的框架编写专用的 Hook 集成文档

---

## 概述

本指南说明如何为 **Claude Code** 安装 WoClaw Hook 脚本，实现：

| Hook | 触发时机 | 作用 |
|------|----------|------|
| `session-start` | 会话启动/恢复时 | 从 WoClaw Hub 读取共享上下文，写入 Claude 会话 |
| `session-stop` | 会话结束时 | 将 `CLAUDE.md` 摘要写入 WoClaw Hub |
| `precompact` | 上下文压缩前 | 将当前上下文 checkpoint 到 Hub（保留压缩前的关键信息）|

---

## 前置要求

- Claude Code 已安装 (`npm install -g @anthropic-ai/claude-code`)
- 网络可达 WoClaw Hub（默认 `http://your-hub-host:8083`）
- `curl` 和 `node` 已安装

---

## 快速安装

```bash
npx woclaw-hooks --framework claude-code
```

按提示输入：
- **Hub URL**: `http://your-hub-host:8083`（默认）
- **Hub Token**: `WoClaw2026`（默认）
- **Project Key**: `project:context`（默认，可按项目自定义）

安装脚本会自动：
1. 复制 Hook 脚本到 `~/.claude/hooks/woclaw-*.sh`
2. 生成 `~/.woclaw/.env` 配置文件
3. 输出 `settings.json` 配置提示

---

## ⚠️ 手动配置 `settings.json`

**安装脚本只会提示 session-start hook**，session-stop 和 precompact 需要手动添加到 `~/.claude/settings.json`。

编辑 `~/.claude/settings.json`，确保包含全部三个 hook：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/.claude/hooks/woclaw-session-start.sh"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/.claude/hooks/woclaw-session-stop.sh"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/.claude/hooks/woclaw-precompact.sh"
          }
        ]
      }
    ]
  }
}
```

> **注意**：Claude Code 的 hook 名称在 `settings.json` 中**不含 `.sh` 后缀**（脚本文件名含后缀）。例如 `SessionStart` 对应 `session-start.sh`。

---

## 环境变量

安装后配置保存在 `~/.woclaw/.env`：

```bash
WOCLAW_HUB_URL="http://your-hub-host:8083"
WOCLAW_TOKEN="WoClaw2026"
WOCLAW_PROJECT_KEY="project:context"
```

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WOCLAW_HUB_URL` | `http://your-hub-host:8083` | Hub REST API 地址 |
| `WOCLAW_TOKEN` | `WoClaw2026` | Hub 认证 Token |
| `WOCLAW_PROJECT_KEY` | `project:context` | 共享上下文 key（可按项目设置不同值）|

### 按项目设置不同的 Project Key

不同项目使用不同的 key，避免上下文串台：

```bash
# 项目 A
echo 'WOCLAW_PROJECT_KEY="project:myapp"' >> ~/.woclaw/.env

# 项目 B
echo 'WOCLAW_PROJECT_KEY="project:backend"' >> ~/.woclaw/.env
```

---

## Hook 脚本说明

### session-start.sh（会话启动）

```
触发时机：Claude Code 启动 / resume / clear
操作：
  1. 从 ~/.woclaw/.env 读取配置
  2. GET /memory?key=<project_key>
  3. 将记忆内容输出到 Claude 会话（system message）
  4. 若无记忆则输出 "No shared context found"
```

### session-stop.sh（会话结束）

```
触发时机：Claude Code 会话结束时
操作：
  1. 读取当前目录的 CLAUDE.md（最近 50 行）
  2. POST /memory — 将摘要写入 Hub
  3. 输出确认信息
```

### precompact.sh（上下文压缩前）

```
触发时机：Claude Code 上下文即将压缩前
操作：
  1. 读取 $CLAUDE_CONTEXT_FILE（若存在）
  2. 生成带时间戳的 key：compact:YYYYMMDD-HHMMSS
  3. POST /memory — 保存压缩前的 checkpoint
  4. 输出保存确认
```

---

## 验证安装

### 1. 检查 Hook 状态

```bash
npx woclaw-hooks --status
```

预期输出：
```
📡 WoClaw Hooks Status

   Hub URL:     http://your-hub-host:8083
   Token:       ***aw2026
   Project Key: project:context

   ✅ claude-code: 3/3 hooks installed
      - woclaw-session-start.sh
      - woclaw-session-stop.sh
      - woclaw-precompact.sh
```

### 2. 检查 Hub 连通性

```bash
curl http://your-hub-host:8083/health
```

预期：`{"status":"ok","agents":...,"topics":...}`

### 3. 手动触发 session-start

```bash
bash ~/.claude/hooks/woclaw-session-start.sh
```

预期输出：
```
=== WoClaw: Loading shared context (project:context) ===
--- Shared context ---
<记忆内容或 "No shared context found">
----------------------
```

---

## 卸载

```bash
npx woclaw-hooks --framework claude-code --uninstall
```

卸载后从 `~/.claude/settings.json` 中移除 hook 配置行。

---

## 故障排查

### Hook 脚本没有执行

1. 确认 `settings.json` 格式正确（JSON 无尾随逗号）
2. 确认脚本有执行权限：`ls -la ~/.claude/hooks/woclaw-*.sh`
3. 手动运行脚本检查错误：`bash -x ~/.claude/hooks/woclaw-session-start.sh`

### Hub 连接失败

```bash
# 检查 Hub 是否可达
curl http://your-hub-host:8083/health

# 检查 token
curl -H "Authorization: Bearer WoClaw2026" http://your-hub-host:8083/memory
```

### 共享上下文为空

确认所有 Claude Code 实例使用相同的 `WOCLAW_PROJECT_KEY`：
```bash
cat ~/.woclaw/.env | grep PROJECT_KEY
```

---

## 与其他框架共享上下文

所有使用相同 `WOCLAW_PROJECT_KEY` 的框架实例会共享同一块上下文区域：

| 框架 | Hook | key |
|------|------|-----|
| Claude Code | session-start/stop | `project:context` |
| OpenAI Codex CLI | SessionStart/Stop | `project:context` |
| Gemini CLI | SessionStart/End | `project:context` |
| OpenCode | via oh-my-opencode | `project:context` |

不同项目建议使用不同 key：
```bash
WOCLAW_PROJECT_KEY="project:<项目名>"
```

---

## 相关文档

- [API.md](./API.md) — Hub REST API 完整参考
- [gemini-hooks-research.md](./gemini-hooks-research.md) — Gemini CLI Hook 研究
- [OPENCODE-INTEGRATION.md](./OPENCODE-INTEGRATION.md) — OpenCode 集成指南
- [ROADMAP.md](./ROADMAP.md) — 开发路线图
