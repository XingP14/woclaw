# OpenCode + WoClaw 集成指南

> S2-3 日期：2026-04-03
> 两种方案，方案 A 零开发直接复用，方案 B 提供原生插件

---

## 方案 A：oh-my-opencode（推荐，零开发）

### 原理

[oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) 提供 Claude Code 完整兼容层（46+ hooks）。
安装后，WoClaw 的 Claude Code hooks（`claude-session-start.sh`、`claude-session-stop.sh`、`claude-precompact.sh`）直接在 OpenCode 中生效。

### 安装步骤

```bash
# 1. 安装 oh-my-opencode（参考其文档）
# 2. 将 WoClaw Claude Code hooks 链接到 oh-my-opencode 配置目录
ln -s ~/.claude/settings.json ~/.config/opencode/settings.json 2>/dev/null || true

# 3. 验证 hooks 存在
ls ~/.claude/hooks/  # 应该有 session-start.sh, session-stop.sh, precompact.sh

# 4. 配置 WoClaw 环境变量
export WOCLAW_HUB_URL=ws://your-hub-host:8082
export WOCLAW_TOKEN=WoClaw2026
export WOCLAW_REST_URL=http://your-hub-host:8083
```

### 限制

- 需要用户手动安装 oh-my-opencode
- 依赖第三方插件（非 OpenCode 原生）
- oh-my-opencode 涉及 Claude Code ToS 问题（第三方 OAuth）

---

## 方案 B：opencode-woclaw 原生插件（自建，推荐备选）

### 状态

✅ 代码已完成：`packages/opencode-woclaw-plugin/`
⚠️ 尚未发布 npm 包
⚠️ 尚未经过真实 OpenCode 环境验证

### 功能

| 功能 | 实现状态 | 说明 |
|------|---------|------|
| `session.created` hook | ✅ | 从 Hub 加载共享上下文 |
| `session.compacted` hook | ✅ | 保存 session 快照到 Hub |
| `shell.env` hook | ✅ | 注入 WOCLAW_* 环境变量 |
| `woclaw_memory_read` tool | ✅ | 读取共享记忆 |
| `woclaw_memory_write` tool | ✅ | 写入共享记忆 |
| `woclaw_memory_list` tool | ✅ | 列出所有记忆 key |
| `woclaw_memory_delete` tool | ✅ | 删除记忆 key |
| `woclaw_topics_list` tool | ✅ | 列出 topic |
| `woclaw_hub_status` tool | ✅ | 检查 Hub 状态 |

### 安装方式

**方式 1：直接复制（推荐测试用）**
```bash
mkdir -p ~/.config/opencode/plugins/
cp packages/opencode-woclaw-plugin/index.js ~/.config/opencode/plugins/woclaw.js
```

**方式 2：npm 包（待发布）**
```bash
npm install opencode-woclaw
# 然后在 opencode.json 添加 "plugins": ["opencode-woclaw"]
```

### 环境变量配置

```bash
export WOCLAW_HUB_URL=ws://your-hub-host:8082
export WOCLAW_TOKEN=WoClaw2026
export WOCLAW_AGENT_ID=opencode-$(hostname)
export WOCLAW_REST_URL=http://your-hub-host:8083
export WOCLAW_PROJECT_KEY=project:context  # 可选，默认 "project:context"
```

### 使用示例

```
> /woclaw_memory_write project-status "Using WoClaw for multi-agent coordination"

> /woclaw_memory_read project-status

> /woclaw_hub_status

> /woclaw_topics_list
```

---

## 推荐路径

| 场景 | 推荐方案 |
|------|---------|
| 快速试用（5 分钟） | 方案 A：oh-my-opencode |
| 生产环境 | 方案 B：opencode-woclaw 原生插件 |
| 长期维护 | 方案 B + npm 发布 |

---

## 待办事项

- [ ] 在真实 OpenCode 环境中验证 `session.created` hook 是否正常工作
- [ ] 发布 `opencode-woclaw` npm 包
- [ ] 解决 `@opencode-ai/plugin` peer dependency（OpenCode 自身提供）
- [ ] 添加 `session.idle` hook（定期保存摘要到 Hub）
