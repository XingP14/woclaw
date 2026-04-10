# Hermes Agent Hooks — WoClaw Integration Guide

> Hermes Agent Hooks 集成基于 H1-1/2/3 研究成果，参考 `docs/H1-1-HERMES-MIGRATION-DRYRUN.md`、`docs/H1-2-HERMES-PATH-MAPPING.md`、`docs/H1-3-HERMES-MESSAGING-INCOMPATIBILITY.md`

---

## 概述

本指南说明如何将 **Hermes Agent** 的核心数据接入 WoClaw，实现跨框架共享记忆。

> ⚠️ **兼容性说明**：Hermes Agent 与 WoClaw 在 channel/topic 映射、消息模板、YAML 配置格式上存在不兼容。详见 [H1-3 不兼容报告](H1-3-HERMES-MESSAGING-INCOMPATIBILITY.md)。迁移时请使用 `--skip messaging-settings` 回滚策略。

---

## 已支持的迁移项

| Hermes 数据源 | WoClaw 目标 | 状态 |
|---|---|---|
| `state.db` (sessions) | Memory Pool (`hermes:session:<id>`) | ✅ 可迁移 |
| `MEMORY.md` | Memory Pool (`hermes:memory:<filename>`) | ✅ 可迁移 |
| `USER.md` | Memory Pool (`hermes:user:<section>`) | ✅ 可迁移 |
| `skills/` | Memory Pool (`hermes:skill:<name>`) | ✅ 可迁移 |
| `shared-skills/` | Memory Pool (`hermes:shared-skill:<name>`, tag: `shared`) | ✅ 可迁移 |
| `workspace-agents/` | Agent Registry + Memory entries | ✅ 可迁移 |
| `model-config/` | 文档参考（不迁移 API key） | ⚠️ 需手动 |
| `messaging-settings` | ❌ 不兼容，跳过 | ❌ 不迁移 |

详细路径映射见 [H1-2 路径映射报告](H1-2-HERMES-PATH-MAPPING.md)。

---

## 快速迁移（使用 WoClaw CLI）

```bash
# 1. 安装 woclaw CLI（如果尚未安装）
npm install -g xingp14-woclaw

# 2. 迁移 Hermes 数据
woclaw migrate --framework hermes --agent-dir ~/.hermes

# 3. 验证迁移结果
curl http://your-hub-host:8083/memory?tag=hermes
```

---

## 迁移命令选项

```bash
# 完整迁移
woclaw migrate --framework hermes --agent-dir ~/.hermes

# 跳过 messaging-settings（推荐）
woclaw migrate --framework hermes --agent-dir ~/.hermes --skip messaging-settings

# 预览迁移内容（不写入）
woclaw migrate --framework hermes --agent-dir ~/.hermes --dry-run

# 指定 Hub
woclaw migrate --framework hermes --agent-dir ~/.hermes --hub ws://your-hub-host:8082 --token YOUR_TOKEN
```

---

## Hermes → WoClaw Memory Key 映射规则

| Hermes 路径 | WoClaw Memory Key | 标签 |
|---|---|---|
| `~/.hermes/MEMORY.md` | `hermes:memory:<section>` | `hermes`, `memory` |
| `~/.hermes/USER.md` | `hermes:user:<section>` | `hermes`, `user` |
| `~/.hermes/skills/<name>/` | `hermes:skill:<name>` | `hermes`, `skill` |
| `~/.hermes/shared-skills/<name>/` | `hermes:shared-skill:<name>` | `hermes`, `skill`, `shared` |
| `~/.hermes/workspace-agents/<name>/` | `hermes:agent:<name>` | `hermes`, `agent` |
| `~/.hermes/state.db` (session entries) | `hermes:session:<id>` | `hermes`, `session` |

---

## Hook 生命周期集成

### SessionStart Hook（规划中）

```bash
# hermes-session-start.sh — 读取 WoClaw 共享上下文
#!/bin/bash
WOCLAW_HUB=${WOCLAW_HUB_URL:-ws://your-hub-host:8082}
WOCLAW_TOKEN=${WOCLAW_TOKEN:-your-token}

# 读取与当前项目相关的 Hermite 记忆
curl -s "${WOCLAW_HUB_URL}/memory/recall?q=$PROJECT_DIR&intent=context" \
  -H "Authorization: Bearer $WOCLAW_TOKEN"
```

### SessionStop Hook（规划中）

```bash
# hermes-session-stop.sh — 写入 session 摘要到 WoClaw
#!/bin/bash
# 从 Hermes state.db 读取当前 session 摘要
# 写入 WoClaw: hermes:session:<id>
```

> 📋 **实现状态**：Hermes hooks 脚本尚未实现（S27-H1/S27-H2 待做）。如需立即使用，请使用 `woclaw migrate` 批量迁移历史数据。

---

## WoClaw Hub Token 配置

在 Hermes 工作目录创建 `~/.woclaw/.env`：

```
WOCLAW_HUB_URL=ws://your-hub-host:8082
WOCLAW_TOKEN=WoClaw2026
```

---

## 参考文档

- [Hermes 迁移可行性报告](H1-1-HERMES-MIGRATION-DRYRUN.md)
- [Hermes 路径映射方案](H1-2-HERMES-PATH-MAPPING.md)
- [Hermes messaging 不兼容性报告](H1-3-HERMES-MESSAGING-INCOMPATIBILITY.md)
- [OpenClaw 集成指南](../README.md)
