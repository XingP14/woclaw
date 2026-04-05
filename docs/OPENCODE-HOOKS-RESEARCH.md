# OpenCode Hooks 机制调研

**S2-1 日期：** 2026-04-03
**S2-2 日期：** 2026-04-03
**S2-1 结论（已修正）：** ✅ OpenCode 有丰富的原生 plugin session events + oh-my-opencode 完整 Claude Code 兼容层

---

## S2-1 调研结果（修正版）

### 原始结论（已过时）
❌ ~~OpenCode 无原生 session lifecycle hooks（需自建 plugin）~~

### 实际发现

#### 1. OpenCode 原生 Plugin 系统 ✅

OpenCode 有完整的 plugin 系统，支持 session 生命周期事件。

**文档：** https://opencode.ai/docs/plugins/

**可用 Session Events：**
- `session.created` — Session 创建时
- `session.compacted` — Session 压缩时
- `session.deleted` — Session 删除时
- `session.diff` — Session diff 时
- `session.error` — Session 错误时
- `session.idle` — Session 空闲时
- `session.status` — Session 状态变更
- `session.updated` — Session 更新时

**Plugin 结构：**
```javascript
export const WoClawPlugin = async ({ project, client, $, directory, worktree }) => {
  return {
    "session.created": async (data) => {
      // 从 WoClaw Hub 读取共享上下文
      // 注入到 OpenCode 当前 session
    },
    "session.idle": async (data) => {
      // 将 session 摘要写入 WoClaw Hub
    },
    "session.compacted": async (data) => {
      // 上下文压缩前写入关键信息
    }
  }
}
```

**Plugin 安装方式：**
- 项目级：`{app}/.opencode/plugins/` + 配置 `"plugins": ["woclaw-opencode"]`
- 全局级：`~/.config/opencode/plugins/` + `~/.config/opencode/opencode.json`
- npm 包：`npm install woclaw-opencode` + 配置 `"plugin": ["woclaw-opencode"]`

#### 2. oh-my-opencode — Claude Code 兼容层 ✅

**GitHub：** https://github.com/code-yeongyu/oh-my-opencode
**文档：** https://www.mintlify.com/code-yeongyu/oh-my-opencode/configuration/hooks

**关键特性：**
- 提供 **Claude Code 完整兼容层**（hook 系统、命令、skills、agents、MCPs）
- 46+ built-in hooks
- 安装后自动支持 Claude Code 的 `~/.claude/settings.json` hook 配置
- **对 WoClaw 的意义：** 已有的 Claude Code hooks（`claude-session-start.sh`、`claude-session-stop.sh`、`claude-precompact.sh`）可以直接在安装了 oh-my-opencode 的 OpenCode 中使用！

#### 3. 已有生态插件参考

| 插件 | 功能 |
|------|------|
| opencode-supermemory | 跨 session 持久记忆（Supermemory）— 直接竞争对手 |
| opencode-notificator | Session 事件桌面通知 |
| opencode-wakatime | 使用时长追踪 |

---

## S2-2 评估结论：oh-my-opencode 集成可行性

### 方案 A：依赖 oh-my-opencode（推荐 ✅）

**优点：**
1. WoClaw 已有 Claude Code hooks 可以直接复用，无需新开发
2. oh-my-opencode 流行度高（Discord 社区活跃）
3. 用户安装 oh-my-opencode 后零额外配置即可使用 WoClaw

**缺点：**
1. 用户需额外安装 oh-my-opencode
2. 依赖第三方插件（非 OpenCode 原生）
3. oh-my-opencode README 提到 Anthropic ToS 问题（第三方 OAuth）

**集成方式：**
用户安装 oh-my-opencode → WoClaw Claude Code hooks 自动生效 → 读写 WoClaw Hub

### 方案 B：自建原生 OpenCode Plugin

**优点：**
1. 无依赖，原生 OpenCode 支持
2. 可精准控制 session.created/idle/compacted 行为

**缺点：**
1. 需要新开发 plugin（比方案 A 工作量更大）
2. 需要发布到 npm 并维护

---

## WoClaw 集成方案对比

| 方案 | 难度 | 可靠性 | 开发量 | 推荐 |
|------|------|--------|--------|------|
| **A: oh-my-opencode 复用** | 低 | 高 | ~0（直接复用） | ✅ **首选** |
| B: 自建 native plugin | 高 | 高 | ~2h | 备选 |

---

## 下一步行动

**S2-3（下一步）：** 设计 `woclaw-opencode` 插件架构
- 方案 A：文档说明 + 教程（用户安装 oh-my-opencode 后直接用 Claude Code hooks）
- 方案 B：如需原生支持，创建 `packages/opencode-woclaw/` 插件

**建议：**
1. **立即可行：** 写一份 OpenCode + oh-my-opencode + WoClaw 集成文档
2. **长期方案：** 开发 `woclaw-opencode` 原生 npm 插件（参考 opencode-supermemory）
