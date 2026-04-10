# H1-2: Hermes → WoClaw 路径映射

> Step 2 of Story H1 — 确认 `skills` / `shared-skills` / `workspace-agents` / `model-config` 的目标路径映射

## 路径映射总览

| Hermes 路径 | 类型 | WoClaw 目标 | 映射类型 |
|------------|------|------------|---------|
| `~/.hermes/skills/*.md` | 目录 | `hermes:skill:<name>` (Memory) | 直接迁移 |
| `~/.hermes/shared-skills/*.md` | 目录 | `hermes:shared-skill:<name>` (Memory) | 直接迁移 |
| `~/.hermes/workspace-agents/` | 目录 | `GET /agents` + `hermes:agent:<id>` (Memory) | 适配迁移 |
| `~/.hermes/model-config/` | 目录 | Hub 环境变量 / Config | 文档参考 |
| `~/.hermes/messaging-settings/` | 目录 | 无直接等价 | ❌ 不兼容 |

---

## 1. `skills` → WoClaw Memory Pool

**源路径:** `~/.hermes/skills/*.md`

**目标:** WoClaw Memory Pool，key = `hermes:skill:<skill-name>`，tags = `["hermes", "skill"]`

**迁移逻辑:**

```javascript
// hermes-skill-to-memory.js (伪代码)
const skillFiles = fs.readdirSync('~/.hermes/skills/').filter(f => f.endsWith('.md'))
for (const file of skillFiles) {
  const name = path.basename(file, '.md')
  const content = fs.readFileSync(`~/.hermes/skills/${file}`, 'utf-8')
  const { description, trigger, actions } = parseHermesSkill(content)
  await woclaw.memory.write(`hermes:skill:${name}`, {
    value: content,
    label: name,
    tags: ['hermes', 'skill', trigger || 'general'],
    metadata: { description, trigger, actions }
  })
}
```

**解析规则:**
- 每个 `.md` 文件为一个 skill
- frontmatter `---` 块解析为 metadata
- `# Skill Name` 作为 label
- body 作为 value
- 文件名作为 skill name

**WoClaw Hook 脚本生成:**
- 读取 `hermes:skill:<name>` 后，生成 `packages/woclaw-hooks/hermes-skill-<name>.sh`
- Hook trigger 从 skill metadata 的 `trigger` 字段读取

---

## 2. `shared-skills` → WoClaw Memory Pool

**源路径:** `~/.hermes/shared-skills/*.md`

**目标:** WoClaw Memory Pool，key = `hermes:shared-skill:<skill-name>`，tags = `["hermes", "shared-skill"]`

**与 `skills` 的区别:**
- `skills/` 是 agent 私有的
- `shared-skills/` 是多 agent 共享的
- WoClaw 中通过 Memory 的 `tags` 区分（`shared` tag = 可被其他 agent 发现）

**迁移逻辑:**

```javascript
const sharedFiles = fs.readdirSync('~/.hermes/shared-skills/').filter(f => f.endsWith('.md'))
for (const file of sharedFiles) {
  const name = path.basename(file, '.md')
  const content = fs.readFileSync(`~/.hermes/shared-skills/${file}`, 'utf-8')
  await woclaw.memory.write(`hermes:shared-skill:${name}`, {
    value: content,
    label: name,
    tags: ['hermes', 'shared-skill', 'shared'],  // 'shared' tag = 跨 agent 可见
    metadata: { source: 'shared-skills', shared: true }
  })
}
```

**发现机制:**
- 其他 agent 通过 `GET /memory?tags=hermes,shared` 发现共享 skills
- 无需显式迁移到 Topic

---

## 3. `workspace-agents` → WoClaw Agent Registry

**源路径:** `~/.hermes/workspace-agents/`

**目标:** `GET /agents` (WoClaw Agent Discovery API) + `hermes:agent:<id>` (Memory)

**目录结构（推测）:**
```
~/.hermes/workspace-agents/
  ├── <agent-id>/
  │   ├── SOUL.md
  │   ├── USER.md
  │   ├── config.yaml
  │   └── memories/
  │       ├── MEMORY.md
  │       └── USER.md
```

**迁移逻辑:**

```javascript
const agentDirs = fs.readdirSync('~/.hermes/workspace-agents/')
for (const agentId of agentDirs) {
  const agentDir = `~/.hermes/workspace-agents/${agentId}`
  const soul = fs.readFileSync(`${agentDir}/SOUL.md`, 'utf-8').catch(() => '')
  const user = fs.readFileSync(`${agentDir}/USER.md`, 'utf-8').catch(() => '')
  const memory = fs.readFileSync(`${agentDir}/memories/MEMORY.md`, 'utf-8').catch(() => '')

  // 写入 Memory Pool
  await woclaw.memory.write(`hermes:agent:${agentId}:soul`, { value: soul, tags: ['hermes', 'agent', agentId] })
  await woclaw.memory.write(`hermes:agent:${agentId}:user`, { value: user, tags: ['hermes', 'agent', agentId] })
  await woclaw.memory.write(`hermes:agent:${agentId}:memory`, { value: memory, tags: ['hermes', 'agent', agentId] })

  // Agent 信息注册到 WoClaw Hub（通过 Hub REST API 或连接 Hub）
  // 注意：WoClaw agent 由连接 Hub 的 gateway/plugin 动态注册
  // workspace-agents 中的配置需转换为 WoClaw plugin config
}
```

**与 WoClaw Agent 发现 API 的对应:**

| Hermes Agent 概念 | WoClaw 等价 |
|------------------|------------|
| workspace-agents 目录 | 连接 Hub 的各 OpenClaw agent 实例 |
| Agent SOUL.md | WoClaw Memory `hermes:agent:<id>:soul` |
| Agent USER.md | WoClaw Memory `hermes:agent:<id>:user` |
| Agent memories/ | WoClaw Memory entries |
| Agent config.yaml | WoClaw plugin config (`~/.openclaw/openclaw.json`) |

---

## 4. `model-config` → WoClaw / 环境变量

**源路径:** `~/.hermes/model-config/`（推测目录结构）

**目标:** Hub 环境变量 / 参考文档（不直接迁移配置）

**映射说明:**

| Hermes 配置 | WoClaw 处理 |
|------------|------------|
| LLM Provider (OpenAI/Anthropic/Google) | WoClaw Hub 无 LLM 配置（Hub 是 relay，不是 LLM proxy）|
| Model selection | 不迁移（各 agent 自行配置）|
| API keys | 不迁移（安全原因）|
| Temperature / max_tokens | 不迁移（agent 侧配置）|

**建议:** 将 `model-config/` 内容写入 WoClaw Memory 作为文档参考：
```javascript
await woclaw.memory.write(`hermes:config:model:${configName}`, {
  value: JSON.stringify(modelConfig),
  tags: ['hermes', 'config', 'model'],
  metadata: { source: 'model-config', sensitive: false }
})
```

---

## 5. `messaging-settings` → 不兼容（❌）

**源路径:** `~/.hermes/messaging-settings/`

**说明:** Hermes 的消息路由、channel 配置无 WoClaw 直接等价物。

| Hermes 概念 | WoClaw 等价 | 兼容性 |
|-----------|-----------|--------|
| Channel 定义 | WoClaw Topics + Federation | 部分兼容 |
| Channel routing rules | WoClaw topic subscribe/publish | 需手动重建 |
| Message format/serialization | WoClaw JSON 消息格式 | 兼容 |
| Agent message templates | WoClaw topic messages | 需适配 |

**回滚策略:**
- WoClaw Federation 支持连接其他 WoClaw Hub
- 保留 `messaging-settings` 的 YAML 文件作为迁移后参考文档
- 迁移命令添加 `--skip messaging-settings` 选项

---

## 实现估算

| 子项 | 工作量 | 实现位置 |
|------|--------|---------|
| skills 解析 + 写入 Memory | ~30min | `packages/hermes-migrate/skills.js` |
| shared-skills 解析 + 写入 Memory | ~20min | `packages/hermes-migrate/shared-skills.js` |
| workspace-agents 遍历 + Memory | ~30min | `packages/hermes-migrate/agents.js` |
| model-config 文档化写入 | ~10min | `packages/hermes-migrate/config.js` |
| messaging-settings 不兼容记录 | ~5min | 跳过，输出警告 |

**总计:** ~1.5h（与 H1-1 估算一致）
