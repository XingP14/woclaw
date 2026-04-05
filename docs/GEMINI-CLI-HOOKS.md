# Gemini CLI Hooks — WoClaw Integration Guide

> 为 Gemini CLI 安装 WoClaw Hook 脚本，实现与 OpenClaw、其他 AI 框架的共享上下文

---

## 概述

本指南说明如何为 **Gemini CLI** 安装 WoClaw Hook 脚本，实现：

| Hook | 触发时机 | 作用 |
|------|----------|------|
| `SessionStart` | 会话启动/恢复/清除时 | 从 WoClaw Hub 读取共享上下文，注入 Gemini 会话 |
| `SessionEnd` | 会话结束时 | 将会话摘要写入 WoClaw Hub，供其他框架使用 |

---

## 前置要求

- Gemini CLI 已安装（v0.26.0+，支持 hooks 系统）
- 网络可达 WoClaw Hub（默认 `http://your-hub-host:8083`）
- `curl` 和 `node` 已安装

---

## 快速安装

### 方式一：使用 woclaw-hooks（推荐）

```bash
npm install -g woclaw-hooks
npx woclaw-hooks --framework gemini
```

### 方式二：手动安装

```bash
# 复制 hook 脚本到 Gemini CLI hooks 目录
mkdir -p ~/.gemini/hooks
cp $(npm root -g)/woclaw-hooks/gemini-session-start.sh ~/.gemini/hooks/woclaw-session-start.sh
cp $(npm root -g)/woclaw-hooks/gemini-session-stop.sh  ~/.gemini/hooks/woclaw-session-stop.sh
chmod +x ~/.gemini/hooks/woclaw-session-*.sh
```

---

## 配置 `~/.gemini/settings.json`

Gemini CLI 通过 `settings.json` 的 `hooks` 字段配置生命周期钩子。

编辑 `~/.gemini/settings.json`（没有则创建）：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "woclaw-session-start",
            "type": "command",
            "command": "bash /home/user/.gemini/hooks/woclaw-session-start.sh"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "woclaw-session-end",
            "type": "command",
            "command": "bash /home/user/.gemini/hooks/woclaw-session-stop.sh"
          }
        ]
      }
    ]
  }
}
```

> **注意**：Gemini CLI v0.26.0+ 支持 `SessionStart` 和 `SessionEnd` hooks。其他 hooks（如 `PreCompress`）可通过相同方式添加。

---

## 环境变量

安装后配置保存在 `~/.woclaw/.env`：

```env
WOCLAW_HUB_URL=http://your-hub-host:8083
WOCLAW_TOKEN=WoClaw2026
WOCLAW_PROJECT_KEY=project:context
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

### gemini-session-start.sh（会话启动）

```
触发时机：Gemini CLI 启动 / resume / clear
操作：
  1. 从 ~/.woclaw/.env 读取配置
  2. GET /memory?key=<project_key>
  3. 将记忆内容输出到 stdout（Gemini CLI 通过 systemMessage 显示）
  4. 若无记忆则输出 "No shared context found"
```

### gemini-session-stop.sh（会话结束）

```
触发时机：Gemini CLI 会话结束时
操作：
  1. 从 stdin 读取 Gemini CLI SessionEnd JSON（sessionId, recentInteractions）
  2. 提取最近 5 条交互记录作为摘要
  3. POST /memory — 将摘要写入 Hub
  4. 输出保存确认
```

---

## Gemini CLI Hook stdin/stdout 协议

### SessionStart 输入（stdin）

```json
{
  "sessionId": "string",
  "events": [...],
  "recentInteractions": [...],
  "currentDirectory": "string"
}
```

### SessionStart 输出（stdout）

```json
{
  "decision": "allow",
  "systemMessage": "从 WoClaw Hub 读取的共享上下文内容..."
}
```

### SessionEnd 输出（stdout）

```json
{
  "decision": "allow",
  "systemMessage": "Session summary saved to WoClaw Hub"
}
```

> **注意**：Gemini CLI 要求 stdout **只能输出 JSON**，普通文本需通过 `systemMessage` 字段传递。

---

## 验证安装

### 1. 检查 Hub 连通性

```bash
curl http://your-hub-host:8083/health
```

预期：`{"status":"ok","agents":...,"topics":...}`

### 2. 检查 Hook 脚本

```bash
ls -la ~/.gemini/hooks/woclaw-session-*.sh
```

预期：两个脚本存在且有执行权限（`-rwxr-xr-x`）

### 3. 手动触发 session-start

```bash
bash ~/.gemini/hooks/woclaw-session-start.sh
```

预期输出：
```
=== WoClaw: Shared project context (project:context, N entries) ===
<记忆内容>
============================================================
```

或首次使用：
```
=== WoClaw: No shared context found (first session?) ===
```

### 4. 测试会话启动

```bash
# 启动一个新的 Gemini CLI 会话，观察 SessionStart hook 是否执行
gemini
```

在会话开始时应该看到 WoClaw 上下文加载信息。

---

## 卸载

```bash
# 移除 hook 脚本
rm ~/.gemini/hooks/woclaw-session-start.sh
rm ~/.gemini/hooks/woclaw-session-stop.sh

# 从 settings.json 中移除 hook 配置
# 编辑 ~/.gemini/settings.json，删除 SessionStart 和 SessionEnd 条目
```

---

## 故障排查

### Hook 脚本没有执行

1. 确认 `settings.json` 格式正确（JSON 无尾随逗号）
2. 确认脚本有执行权限：`ls -la ~/.gemini/hooks/woclaw-session-*.sh`
3. 确认 `~/.gemini/settings.json` 中 `hooks.SessionStart` 路径正确

### Hub 连接失败

```bash
# 检查 Hub 是否可达
curl http://your-hub-host:8083/health

# 检查 token
curl -H "Authorization: Bearer WoClaw2026" http://your-hub-host:8083/memory
```

### 共享上下文为空

确认所有框架使用相同的 `WOCLAW_PROJECT_KEY`：
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
| **Gemini CLI** | SessionStart/End | `project:context` |
| OpenCode | via oh-my-opencode | `project:context` |

不同项目建议使用不同 key：
```bash
WOCLAW_PROJECT_KEY="project:<项目名>"
```

---

## 与 Claude Code / Codex 协同示例

```
场景：Claude Code 发现了一段代码架构决策，想让 Gemini CLI 也能看到

1. Claude Code 会话中执行：
   # 将决策写入 WoClaw Hub
   woclaw memory write project:context "Architecture: 使用事件溯源模式..."

2. 启动 Gemini CLI：
   → SessionStart hook 自动从 Hub 读取 "Architecture: 使用事件溯源模式..."
   → Gemini CLI 立即了解项目上下文，无需重复说明
```

---

## 相关文档

- [API.md](./API.md) — Hub REST API 完整参考
- [gemini-hooks-research.md](./gemini-hooks-research.md) — Gemini CLI Hook 机制研究
- [CLAUDE-CODE-HOOKS.md](./CLAUDE-CODE-HOOKS.md) — Claude Code Hook 集成指南
- [OPENCODE-INTEGRATION.md](./OPENCODE-INTEGRATION.md) — OpenCode 集成指南
- [ROADMAP.md](./ROADMAP.md) — 开发路线图
