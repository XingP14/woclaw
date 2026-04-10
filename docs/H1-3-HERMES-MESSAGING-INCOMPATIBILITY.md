# H1-3: Hermes `messaging-settings` 不兼容性与回滚策略

> Step 3 of Story H1 — 记录 `messaging-settings` 与 WoClaw 的不兼容点及回滚策略

---

## 1. 概述

`messaging-settings/` 是 Hermes Agent 的消息路由配置目录，定义了：
- Channel（频道/通道）定义与连接参数
- 消息路由规则（哪些 agent 往哪些 channel 发什么）
- 消息模板（特定 channel 的消息格式）
- 跨 agent 消息协议

WoClaw 的消息模型是 **Topic Pub/Sub**，与 Hermes 的 channel-based routing 有本质差异，因此 `messaging-settings` 无法直接迁移。

---

## 2. 不兼容点详解

### 2.1 Channel 定义 vs Topic

| Hermes Channel | WoClaw Topic | 兼容结果 |
|---------------|-------------|---------|
| 命名的 channel（如 `slack`, `discord`, `email`）| Topic 名称（如 `alerts`, `tasks`）| 可映射，但语义不同 |
| Channel 连接参数（token/credentials）| WoClaw channel plugin（plugin 内部管理）| ❌ 不兼容 |
| Channel 路由规则（入站/出站过滤）| Topic subscribe/publish（无过滤规则）| ⚠️ 部分可模拟 |
| Channel enable/disable 开关 | Topic 存在性（动态创建）| ❌ 不兼容 |

**核心差异：**
- Hermes Channel = 带认证信息的连接端点（Slack token, Discord webhook 等）
- WoClaw Topic = 纯消息路由层，不持有第三方 credentials

### 2.2 路由规则不兼容

Hermes 的 `messaging-settings` 可定义：
```
# 伪示例
on message from agent-A to channel-X:
  filter: message.type == "alert"
  transform: add_prefix("[ALERT]")
  route to: channel-Y
```

WoClaw Topic 模型：
- `publish(topic, message)` — 无条件发布到 topic
- `subscribe(topic)` — 无条件接收 topic 所有消息
- **无消息过滤、无转换、无条件路由**

### 2.3 消息模板不兼容

Hermes 支持为特定 channel 定义消息模板（templated messages），WoClaw 无等价功能。

---

## 3. 回滚策略

### 3.1 迁移时跳过 `messaging-settings`

```bash
# Hermes → WoClaw 迁移命令
woclaw migrate --framework hermes \
  --source ~/.hermes \
  --skip messaging-settings
```

迁移工具在检测到 `messaging-settings/` 时：
1. 输出警告日志
2. 将目录内容复制到 WoClaw Memory 作为文档参考：`hermes:messaging-settings:backup`
3. 继续执行其他可迁移项（skills, shared-skills, workspace-agents）

### 3.2 事后手动重建

Hermes 用户迁移后若需重建消息路由，建议：

**方案 A — WoClaw Topic 重设计（推荐）：**
1. 梳理原 `messaging-settings/` 中的 channel 用途
2. 按功能创建对应 WoClaw Topics
3. 各 agent 使用 `woclaw topic join <topic>` 订阅相关 topic
4. 使用 WoClaw Federation 连接其他 Hub（如需要跨 Hub 通信）

**方案 B — 保留 Hermes 运行（短期过渡）：**
1. 保持 Hermes 实例继续运行（处理旧有 channel 消息）
2. WoClaw 作为新增的记忆层，两套系统并行
3. 逐步将 agent 迁移到 WoClaw

### 3.3 迁移输出示例

```
⚠️  [woclaw migrate] messaging-settings/ detected — skipping (incompatible)
ℹ️  Backing up messaging-settings to WoClaw Memory: hermes:messaging-settings:backup
ℹ️  To review backup: GET /memory/hermes:messaging-settings:backup
ℹ️  For manual migration guidance, see: docs/HERMES-MIGRATION.md
```

---

## 4. 迁移命令设计

### 4.1 `woclaw migrate --framework hermes` 实现

```javascript
// packages/hermes-migrate/index.js
async function migrateHermes(sourceDir, options = {}) {
  const skips = new Set(options.skip || [])

  // 1. Skills
  await migrateSkills(`${sourceDir}/skills`)

  // 2. Shared-skills
  await migrateSharedSkills(`${sourceDir}/shared-skills`)

  // 3. Workspace-agents
  await migrateWorkspaceAgents(`${sourceDir}/workspace-agents`)

  // 4. Model-config (as reference doc, no credentials)
  if (!skips.has('model-config')) {
    await migrateModelConfig(`${sourceDir}/model-config`)
  }

  // 5. messaging-settings — skip with warning
  if (!skips.has('messaging-settings')) {
    await backupMessagingSettings(`${sourceDir}/messaging-settings`)
  }
}
```

### 4.2 参数说明

| 参数 | 说明 |
|------|------|
| `--skip <item>` | 跳过指定迁移项（可重复） |
| `--skip messaging-settings` | 跳过消息路由配置（总是需要手动重建）|
| `--backup-dir <path>` | 指定备份目录（默认 WoClaw Memory）|

---

## 5. 参考文档位置

- `docs/H1-1-HERMES-MIGRATION-DRYRUN.md` — 迁移可行性分析
- `docs/H1-2-HERMES-PATH-MAPPING.md` — 路径映射（H1-2 输出）
- `docs/H1-3-HERMES-MESSAGING-INCOMPATIBILITY.md` — 本文档（H1-3）
- `docs/HERMES-MIGRATION.md` — 用户级迁移指南（待创建，H2-Step 3）

---

## 6. H1 Story 完成状态

| Step | 内容 | 状态 |
|------|------|------|
| H1-1 | Hermes dry-run 可迁移项分析 | ✅ 2026-04-10 |
| H1-2 | skills/shared-skills/workspace-agents/model-config 路径映射 | ✅ 2026-04-10 |
| H1-3 | messaging-settings 不兼容点和回滚策略 | ✅ 2026-04-10 |

**Story H1 完成 ✅**
