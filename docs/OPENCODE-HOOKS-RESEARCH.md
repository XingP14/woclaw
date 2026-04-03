# OpenCode Hooks 机制调研 — S2-1

**日期：** 2026-04-03
**结论：** ❌ OpenCode 无原生 session lifecycle hooks（需自建 plugin）

---

## 调研结果

### 1. OpenCode 原生 Hooks（Feature Request #14863）

- **GitHub Issue：** https://github.com/anomalyco/opencode/issues/14863
- **状态：** Feature Request（未实现）
- **提案内容：** 提议添加 `sessionStart`、`sessionEnd`、`messageReceived`、`toolExecuted` 等生命周期钩子
- **配置格式（提案）：**
  ```json
  {
    "hooks": {
      "sessionStart": [{ "type": "command", "command": "/path/to/start.sh", "timeout": 10 }],
      "sessionEnd": [{ "type": "command", "command": "/path/to/end.sh", "timeout": 30 }]
    }
  }
  ```
- **结论：** 原生 hooks **不存在**，短期内不会提供

### 2. OpenCode Plugin 系统

- OpenCode 有插件系统，但需要开发完整插件，门槛高
- 插件可监听 session 事件，但官方文档有限

### 3. Oh My OpenCode（第三方插件）

- **文档：** https://www.mintlify.com/code-yeongyu/oh-my-opencode/configuration/hooks
- 提供 46 个 hooks，包括 session 生命周期事件
- 但这是第三方插件，需用户额外安装

### 4. 第三方 Hook 插件

- Reddit 帖子提到第三方 opencode hooks 插件（opencode-cli）
- 但无稳定维护

---

## WoClaw 集成方案

| 方案 | 难度 | 可靠性 | 推荐 |
|------|------|--------|------|
| 依赖 oh-my-opencode 插件 | 中 | 中（第三方） | ⚠️ 可选 |
| 自建 OpenCode plugin | 高 | 高 | 长期方案 |
| 轮询 opencode session list | 低 | 低（浪费资源） | ❌ 不推荐 |
| 等待原生 hooks | - | - | ❌ 未知时间 |

**结论：** S2（OpenCode Hook 脚本）短期内无法实现（依赖不存在的原生 hooks）。建议：
1. 跳过 S2，进入 S3（Codex Hook npm 发布）
2. 长期方案：自建 OpenCode plugin
