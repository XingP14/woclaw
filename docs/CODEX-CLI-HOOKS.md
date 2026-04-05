# Codex CLI Hooks — WoClaw Integration Guide

> 为 OpenAI Codex CLI 安装 WoClaw Hook 脚本，实现跨会话共享上下文

---

## 概述

本指南说明如何为 **OpenAI Codex CLI** 安装 WoClaw Hook 脚本，实现：

| Hook | 触发时机 | 作用 |
|------|----------|------|
| `SessionStart` | 会话启动/恢复时 | 从 WoClaw Hub 读取共享上下文，注入为开发者上下文 |
| `Stop` | 会话结束时 | 将会话摘要写入 WoClaw Hub |
| `PreCompact` | 上下文压缩前 | 将关键信息 checkpoint 到 Hub |

---

## 前置要求

- OpenAI Codex CLI 已安装
- 网络可达 WoClaw Hub（默认 `http://your-hub-host:8083`）
- Python 3.8+

---

## 快速安装

推荐使用 `woclaw-codex` 包（完整的官方安装方式）：

```bash
pip install woclaw-codex
cd ~/.codex/plugins  # 或任意目录
python3 -m woclaw_codex.install
```

或者直接用 WoClaw 仓库中的安装脚本：

```bash
cd packages/codex-woclaw
python3 install.py
```

---

## 安装脚本做了什么

`install.py` 会依次执行：

1. **创建 `~/.codex/hooks/` 目录**
2. **复制 Hook 脚本到 `~/.codex/hooks/`**
   - `session_start.py` — SessionStart hook
   - `stop.py` — Stop hook
   - `precompact.py` — PreCompact hook
3. **创建 `~/.codex/hooks.json`** — Codex CLI 原生 hooks 配置
4. **更新 `~/.codex/config.toml`** — 启用 `codex_hooks = true`

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WOCLAW_HUB_URL` | `http://your-hub-host:8083` | Hub REST API 地址 |
| `WOCLAW_TOKEN` | `WoClaw2026` | Hub 认证 Token |
| `WOCLAW_KEY` | `codex:context` | 共享上下文 key |

安装后可在环境变量中覆盖：

```bash
export WOCLAW_HUB_URL="http://your-hub-host:8083"
export WOCLAW_TOKEN="WoClaw2026"
export WOCLAW_KEY="codex:myproject"
```

---

## `hooks.json` 配置说明

安装后 `~/.codex/hooks.json` 内容类似：

```json
{
  "hooks": {
    "SessionStart": [{
      "matcher": "startup|resume",
      "hooks": [{
        "type": "command",
        "command": "python3 ~/.codex/hooks/session_start.py",
        "statusMessage": "Loading shared context from WoClaw"
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "python3 ~/.codex/hooks/stop.py",
        "timeout": 30,
        "statusMessage": "Saving session to WoClaw Hub"
      }]
    }],
    "PreCompact": [{
      "hooks": [{
        "type": "command",
        "command": "python3 ~/.codex/hooks/precompact.py",
        "timeout": 15,
        "statusMessage": "Saving checkpoint to WoClaw before compaction"
      }]
    }]
  }
}
```

> Codex CLI 的 `matcher` 字段控制 hook 在哪些场景触发。`startup|resume` 表示会话启动和恢复时触发。

---

## Hook 脚本说明

### session_start.py（会话启动）

```
触发时机：Codex CLI 启动 / resume
操作：
  1. 从环境变量读取 WOCLAW_HUB_URL / WOCLAW_TOKEN / WOCLAW_KEY
  2. GET <WOCLAW_HUB_URL>/memory?key=<WOCLAW_KEY>
  3. 将记忆内容注入为 Codex 会话的开发者上下文
  4. 若无记忆则静默跳过
```

### stop.py（会话结束）

```
触发时机：Codex CLI 会话结束（输入 exit / Ctrl-D / stop）
操作：
  1. 读取会话 transcript
  2. 生成会话摘要（文件修改、关键决策、工具使用）
  3. POST <WOCLAW_HUB_URL>/memory — 将摘要写入 Hub
  4. 输出保存确认
```

### precompact.py（上下文压缩前）

```
触发时机：Codex 上下文即将压缩前
操作：
  1. 读取当前会话状态
  2. 生成带时间戳的 key：compact:codex:<timestamp>
  3. POST <WOCLAW_HUB_URL>/memory — 保存压缩前 checkpoint
  4. 输出保存确认
```

---

## 验证安装

### 1. 检查 Hook 脚本

```bash
ls -la ~/.codex/hooks/
```

预期输出：
```
woclaw-session-start.py   (或 session_start.py)
woclaw-stop.py            (或 stop.py)
woclaw-precompact.py      (或 precompact.py)
```

### 2. 检查 Hub 连通性

```bash
curl http://your-hub-host:8083/health
```

预期：`{"status":"ok","agents":...,"topics":...}`

### 3. 手动触发 session-start

```bash
python3 ~/.codex/hooks/session_start.py
```

预期输出：
```
Loading shared context from WoClaw
<记忆内容或静默无输出>
```

---

## 卸载

```bash
python3 install.py --uninstall
```

卸载后会从 `~/.codex/hooks.json` 中移除 WoClaw 相关配置。

---

## 故障排查

### Hook 没有执行

1. 确认 `~/.codex/config.toml` 包含 `codex_hooks = true`
2. 确认 `~/.codex/hooks.json` 格式正确（JSON 无尾随逗号）
3. 确认脚本有执行权限：`chmod +x ~/.codex/hooks/*.py`
4. 手动运行脚本检查错误：`python3 -u ~/.codex/hooks/session_start.py`

### Hub 连接失败

```bash
# 检查 Hub 是否可达
curl http://your-hub-host:8083/health

# 检查 token
curl -H "Authorization: Bearer WoClaw2026" http://your-hub-host:8083/memory
```

### 共享上下文为空

确认所有 Codex 实例使用相同的 `WOCLAW_KEY`：
```bash
echo $WOCLAW_KEY
```

---

## 与其他框架共享上下文

所有使用相同 key 的框架实例会共享同一块上下文区域：

| 框架 | Hook | 默认 key |
|------|------|----------|
| OpenAI Codex CLI | SessionStart/Stop/PreCompact | `codex:context` |
| Claude Code | session-start/stop/precompact | `project:context` |
| Gemini CLI | SessionStart/End | `gemini:context` |
| OpenCode | via oh-my-opencode | `project:context` |

> **注意**：Codex CLI 默认 key 是 `codex:context`，与 Claude Code (`project:context`) 不同。如需跨框架共享，设置为相同值。

---

## 相关文档

- [API.md](./API.md) — Hub REST API 完整参考
- [CLAUDE-CODE-HOOKS.md](./CLAUDE-CODE-HOOKS.md) — Claude Code Hooks 指南
- [GEMINI-CLI-HOOKS.md](./GEMINI-CLI-HOOKS.md) — Gemini CLI Hooks 指南
- [ROADMAP.md](./ROADMAP.md) — 开发路线图
