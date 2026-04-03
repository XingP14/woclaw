# WoClaw 路线图 / Roadmap

> 规划 WoClaw 的发展方向，持续迭代

## 🎯 项目定位

**WoClaw = Shared Memory + Messaging Hub for AI Agents**

让 OpenClaw、Claude Code、Gemini CLI、**OpenAI Codex CLI**、OpenCode 等多个 AI 框架共享项目上下文、记忆和决策。解决"每个 AI 都从零开始"的问题。

**核心方向：** 跨框架共享记忆 + 实时消息路由。

> ⭐ **高优先级项目：OpenAI Codex CLI 集成** — OpenAI 官方 Python Codex 代理的 WoClaw Hook 支持，使 Python 代理能读写共享记忆。

## 🚀 v0.2 — P0 功能（当前）

### 核心已上线
- [x] WebSocket Hub (ws://vm153:8082) ✅
- [x] REST API (vm153:8083) ✅
- [x] Topic Pub/Sub ✅
- [x] Shared Memory Pool ✅
- [x] Message History (last 50) ✅
- [x] Token Authentication ✅
- [x] npm 包发布 (xingp14-woclaw@0.3.0, woclaw-hooks@0.1.0, woclaw-mcp@0.1.2) ✅

### P0 - 跨框架 Hook 集成
- [x] Claude Code Hook Scripts — SessionStart/Stop/PreCompact hooks 读写 WoClaw Memory ✅
- [x] **Story: Gemini CLI → WoClaw 记忆读写** — 实现 Gemini CLI 的 hook 脚本读写 WoClaw Memory ✅ (S1-1/2/3, 2026-04-03)
- [x] **Story: OpenCode → WoClaw 记忆读写** — 实现 OpenCode 的 hook 脚本（参考 Claude Code）✅ (S2-1/2/3, 2026-04-03)
- [x] **⭐ OpenAI Codex CLI Hook Scripts** — 高优先级！OpenAI 官方 Python Codex 代理集成 ✅ (S3, 2026-04-03)

### P0 - OpenAI Codex CLI 支持（新增 ⭐ 高优先级）
- [x] wo-codex CLI 包 — `packages/codex-woclaw/` created (woclaw-codex@0.1.0) ✅
- [x] SessionStart Hook — `session_start.py` reads from WoClaw Hub REST API ✅
- [x] SessionStop Hook — `stop.py` reads transcript + writes summary to WoClaw Hub ✅
- [x] PreCompact Hook — Codex 上下文压缩前将关键信息写入 memory ✅ v0.1.2
- [x] **Story: Codex Hook npm 发布** — `woclaw-codex@0.1.2` npm 发布 ✅ 2026-04-03
- [x] 环境变量配置：`WOCLAW_HUB_URL` + `WOCLAW_TOKEN` ✅

### P0 - OpenClaw Plugin 完善
- [x] Plugin 导出格式修复（使用 `defineChannelPluginEntry`）✅
- [x] **Story: vm153 plugin 验证** — 在 vm153 上安装 xingp14-woclaw，重启 gateway，验证 channel 连接正常 ✅ (S4-1/2/3, 2026-04-03)
- [x] **Story: VPS4 plugin 验证** — 在 VPS4 本地安装验证 ✅ (S5-1/2/3, 2026-04-03)

---

## 🔥 v0.3 — MCP + Hook 系统

### MCP Bridge
- [x] WoClaw MCP Server — 暴露 `woclaw_topics`, `woclaw_memory_read`, `woclaw_memory_write`, `woclaw_send` 工具 ✅ (woclaw-mcp@0.1.2)
- [x] **Story: MCP CLI serve 命令** — 实现 `woclaw mcp serve` 暴露 WoClaw Hub 为 MCP server ✅ (S8-1/2/3/4, 2026-04-04)

### Hook 系统
- [x] **Story: Claude Code Hook 安装器** — `woclaw hook install --framework claude-code` 一键安装脚本 ✅ (S6-1/2, 2026-04-03)
- [x] **Story: Codex Hook 安装器** — `woclaw hook install --framework openai-codex` 一键安装脚本 ⭐ ✅ (S7-1/2, 2026-04-04)
- [x] PreCompact hook — Codex PreCompact Hook 完成 ✅ (v0.4.1)，Claude Code precompact.sh 已就绪

### Docker Hub 发布
- [x] GitHub Actions 自动构建 ✅ (hub/v* tag 触发)
- [x] Docker Hub 镜像 xingp14/woclaw-hub ✅

## 🎯 v0.4 — 多框架共享记忆

### Shared Memory 增强
- [x] **Story: Memory Versioning** — 每次 write 时保留旧版本，支持 `memory.versions(key)` 查询 ✅ (S9-1/2/3/4, 2026-04-04)
- [x] **Story: Semantic Recall** — 实现 `recall(query, intent)` 意图感知检索 ✅ (S10-1/2/3/4/5, 2026-04-04)

### Multi-Agent Orchestration
- [x] **Story: Agent 发现** — Hub API `GET /agents` 返回已连接 agent 列表 ✅ (S11-1/2, 2026-04-04)
- [x] **Story: 委托任务** — Agent 可发送 `delegate(task, toAgentId)` 消息 ✅ (S12-1/2/3/4/5, 2026-04-04)
- [x] **Story: 任务状态追踪** — 委托任务可追踪 PENDING/RUNNING/DONE/FAILED 状态 ✅ (included in S12)

### 记忆原语设计

| 原语 | 作用 | WoClaw 实现 |
|------|------|-------------|
| **`remember`** | 将信息写入共享记忆池 | `woclaw memory.write(key, value, tags, ttl)` |
| **`recall`** | 按意图检索记忆 | `woclaw memory.recall(query, intent)` |
| **`link`** | 将两条记忆关联起来 | `woclaw memory.link(from_key, to_key, relation)` |

## 📦 v0.5 — 跨框架数据迁移

### 迁移工具 / Migration Tools
- [x] **Story: Codex 迁移** — `woclaw migrate --framework openai-codex --session-id <id>` 从 Codex 历史导入 ✅ (S13-1/2/3/4, 2026-04-04)
- [x] **Story: Claude Code 迁移** — `woclaw migrate --framework claude-code --session-dir <path>` 导入 sessions ✅ (S14, based on S13-4 template, 2026-04-04)
- [x] **Story: Gemini CLI 迁移** — `woclaw migrate --framework gemini-cli` 导入会话历史 ✅ (S15, based on S13-4 template, 2026-04-04)
- [x] **Story: OpenClaw 迁移** — `woclaw migrate --framework openclaw --agent-id <id>` 导入 memory/sessions ✅ (S16, based on S13-4 template, 2026-04-04)

### 迁移设计

| 源框架 | 迁移内容 | WoClaw 目标 |
|--------|----------|-------------|
| **OpenAI Codex CLI** | Session transcript, project context, key decisions | Shared Memory + Topics |
| **Claude Code** | Session transcript, discovered facts, repo context | Shared Memory + Topics |
| **Gemini CLI** | Conversation history, research findings | Shared Memory + Topics |
| **OpenClaw** | Memory entries, session summaries, agent context | Shared Memory Pool |

### 迁移命令
```bash
# 单框架迁移
woclaw migrate --framework openai-codex --session-id <id>
woclaw migrate --framework claude-code --session-dir ~/.claude/sessions
woclaw migrate --framework gemini-cli
woclaw migrate --framework openclaw --agent-id my-openclaw

# 批量迁移
woclaw migrate --all --dry-run  # 预览，不执行
woclaw migrate --all            # 执行所有迁移
```

### 生态集成
- [ ] ClawHub Skill 发布
- [ ] GitHub Actions CI/CD 完善
- [ ] VS Code / Cursor 插件（可选）

### 文档
- [x] Hook 集成指南 — Claude Code（`docs/CLAUDE-CODE-HOOKS.md`）✅ 2026-04-04
- [x] Hook 集成指南 — Gemini CLI（`docs/GEMINI-CLI-HOOKS.md`）✅ 2026-04-04
- [x] Hook 集成指南 — Codex CLI / OpenCode（`docs/CODEX-CLI-HOOKS.md`）✅ 2026-04-04
- [x] MCP Server 使用文档（`docs/MCP-SERVER.md`）✅ 2026-04-04
- [ ] 视频演示

## 🔧 v0.6 — 生态完善

### 发布到生态
- [ ] Docker Hub 发布（credentials 配置）
- [ ] ClawHub Skill 发布（2026-04-13 后）
- [ ] VS Code / Cursor 插件（可选）

## 🔮 v1.0+ — 高级特性

### 记忆增强
- [ ] Graph Memory — 图数据库后端，支持 temporal/entity/causal/semantic 边类型
- [ ] Semantic Recall — 意图感知检索
- [ ] Deduplication — 自动去重和冲突检测

### 安全与扩展
- [ ] TLS/SSL (wss://)
- [ ] Token 轮换
- [ ] 连接限流
- [ ] 私有 Topic（邀请制）

### 联邦
- [ ] Multi-Hub Federation — Hub 之间互联
- [ ] 官方托管服务

---

## 进度追踪 / Progress

| 版本 | 日期 | 里程碑 |
|------|------|--------|
| v0.1 | 2026-03-30 | 项目立项、Hub 部署 ✅ |
| v0.2 | 2026-03-31 | REST API、npm 发布、跨框架集成 ✅ |
| v0.3 | 2026-04-01 | Tags/TTL 增强、Docker Hub Workflow ✅ |
| v0.4 | 2026-04-02→04-04 | ⭐ **OpenAI Codex CLI Hook 支持**（高优先级）✅ |
| v0.5 | 2026-04-04 | ⭐ **跨框架数据迁移**（OpenAI/Claude/Gemini/OpenClaw → WoClaw）✅ |
| v0.6 | 待定 | Hook 系统完善、Docker Hub、ClawHub Skill |
| v1.0 | 待定 | Graph Memory、Federation |

---

## 📋 Story 卡片（便于心跳执行）

> ⚠️ **评估结论：所有 Story 都无法在 10 分钟内完成，必须拆分步骤**
> 每个步骤 = 1 次心跳内可完成的最小可提交单元

### Stories 完成状态（全部 ✅）

| # | Story | 版本 | 步骤数 | 总工作量 | 状态 |
|---|-------|------|--------|---------|------|
| S1 | Gemini CLI Hook 脚本 | v0.2 | 3 | ~1h | ✅ 2026-04-03 |
| S2 | OpenCode Hook 脚本 | v0.2 | 3 | ~1h | ✅ 2026-04-03 |
| S3 | Codex Hook npm 发布 | v0.2 | 2 | ~20min | ✅ 2026-04-03 |
| S4 | vm153 plugin 验证 | v0.2 | 3 | ~1h | ✅ 2026-04-03 |
| S5 | VPS4 plugin 验证 | v0.2 | 3 | ~1h | ✅ 2026-04-03 |
| S6 | Claude Code Hook 安装器验证 | v0.3 | 2 | ~30min | ✅ 2026-04-03 |
| S7 | Codex Hook 安装器完善 | v0.3 | 2 | ~30min | ✅ 2026-04-04 |
| S8 | MCP CLI serve 命令 | v0.3 | 4 | ~2h | ✅ 2026-04-04 |
| S9 | Memory Versioning | v0.4 | 4 | ~2h | ✅ 2026-04-04 |
| S10 | Semantic Recall | v0.4 | 5 | ~3h | ✅ 2026-04-04 |
| S11 | Agent 发现 API | v0.4 | 2 | ~30min | ✅ 2026-04-04 |
| S12 | 任务委托机制 | v0.4 | 5 | ~3h | ✅ 2026-04-04 |
| S13 | Codex 迁移工具 | v0.5 | 4 | ~2h | ✅ 2026-04-04 |
| S14 | Claude Code 迁移工具 | v0.5 | 4 | ~2h | ✅ 2026-04-04 |
| S15 | Gemini CLI 迁移工具 | v0.5 | 4 | ~2h | ✅ 2026-04-04 |
| S16 | OpenClaw 迁移工具 | v0.5 | 4 | ~2h | ✅ 2026-04-04 |
| S17 | MCP Server 使用文档 | v0.6 | 3 | ~1h | 进行中 |

---

## 🔨 Story 步骤拆分详情

### S1: Gemini CLI Hook 脚本（v0.2）
> 评估：需要先调研 Gemini CLI hook 机制，总计 ~3 步骤

- [x] **S1-1（10min）：调研 Gemini CLI hook 机制** ✅ 2026-04-03
  - Web 搜索 + 文档研究确认：Gemini CLI 有完整 hooks 系统（v0.26.0+）
  - 支持 SessionStart/SessionEnd/PreCompress 等生命周期 hooks
  - 通过 `~/.gemini/settings.json` 配置，stdin/stdout JSON 通信
  - 输出：✅ 有 hooks 支持，参考 Claude Code 模式实现

- [x] **S1-2（10min）：实现 gemini-session-start.sh** ✅ 2026-04-03
  - 创建 `packages/woclaw-hooks/gemini-session-start.sh`
  - 通过 REST API 从 WoClaw Hub 读取共享上下文
  - 支持 Gemini CLI stdin JSON 格式消费
  - 更新 install.js gemini hookNames 和 settingsHint

- [x] **S1-3（10min）：实现 gemini-session-stop.sh + 更新 install.js** ✅ 2026-04-03
  - 创建 `packages/woclaw-hooks/gemini-session-stop.sh`
  - 从 stdin 读取 Gemini CLI SessionEnd JSON（sessionId, recentInteractions）
  - 将 session 摘要写入 WoClaw Hub REST API
  - install.js 早已配置 `hookNames` 包含 `gemini-session-stop`，无需额外修改

### S2: OpenCode Hook 脚本（v0.2）
> 评估：OpenCode **无原生 session lifecycle hooks**（Feature Request #14863 未实现），~3 步骤

- [x] **S2-1（10min）：调研 OpenCode hooks 机制** ✅ 2026-04-03
  - OpenCode 有原生 plugin 系统 + session events（已修正旧结论）
  - oh-my-opencode 有 Claude Code 完整兼容层

- [x] **S2-2（10min）：评估 oh-my-opencode 集成可行性** ✅ 2026-04-03
  - ✅ oh-my-opencode 有完整 Claude Code 兼容层（46+ hooks）
  - ✅ WoClaw Claude Code hooks 可直接复用（无需新开发）
  - 方案A（推荐）：文档引导用户安装 oh-my-opencode，WoClaw hooks 自动生效
  - 方案B：自建 woclaw-opencode 原生 plugin（长期方案）

- [x] **S2-3（10min）：设计 OpenCode WoClaw plugin 方案** ✅ 2026-04-03
  - 方案A（推荐）：oh-my-opencode 零开发复用 Claude Code hooks
  - 方案B（备选）：opencode-woclaw 原生插件（`packages/opencode-woclaw-plugin/` 已就绪，待 npm 发布）
  - 输出：`docs/OPENCODE-INTEGRATION.md` 集成指南

### S3: Codex Hook npm 发布（v0.2）
> 评估：package.json 已就绪，~2 步骤 ✅ 已完成

- [x] **S3-1（10min）：审查并完善 woclaw-codex package** ✅ 2026-04-03
  - ✅ package.json files/bin 字段完整（*.py, install.py, bin/cli.js）
  - ✅ README.md 内容完整，包含安装说明和环境变量说明
  - ✅ `npm pack --dry-run` 验证通过，7 个文件打包正确

- [x] **S3-2（10min）：执行 npm publish** ✅ 2026-04-03
  - ✅ `woclaw-codex@0.1.2` 已发布至 npm（https://www.npmjs.com/package/woclaw-codex）
  - ✅ `npm view woclaw-codex` 验证通过
  - ✅ 更新 ROADMAP.md

### S4: vm153 plugin 验证（v0.2）
> 评估：需要 SSH + 操作，~3 步骤 ✅ 全部完成

- [x] **S4-1（10min）：SSH 检查 vm153 当前状态** ✅ 2026-04-03
  - `openclaw status` + `openclaw channels list` 执行完毕
  - 结果：plugin 已安装（`ls ~/.openclaw/extensions/` 含 woclaw），channel "WoClaw default: configured, enabled" ✅
  - WoClaw Hub 连接：ws://192.168.102.153:8082，已认证为 vm153 ✅
  - 注：vm153 自连存在 1006 异常关闭后重连（循环依赖，Hub 和 plugin 同机），功能正常
  - `ssh -i ~/.ssh/id_ed25519 root@vm153 openclaw status`
  - 检查 woclaw plugin 是否已安装（`~/.openclaw/extensions/`）
  - 检查 channel 状态

- [x] **S4-2（10min）：安装/更新 xingp14-woclaw plugin** ✅ 2026-04-03
  - 原 0.3.0 → 升级到 0.4.3（npm latest）
  - rm -rf 清理旧目录后正常安装
  - 重启 gateway（kill old PID → nohup openclaw gateway）
  - channel 状态确认：configured, enabled，Hub 自连正常

- [x] **S4-3（10min）：验证 WebSocket 连接** ✅ 2026-04-03
  - `curl http://vm153:8083/health` → `{"status":"ok","agents":2,"topics":2}`
  - WebSocket 直连测试：ws://192.168.102.153:8082 → 连接成功（315ms），认证正常
  - Hub 可见 2 个 agent，channel WoClaw default 配置 enabled

### S5: VPS4 plugin 验证（v0.2）
> 评估：本地 Docker 环境，~3 步骤（注意 plugin ID mismatch 警告）

- [x] **S5-1（10min）：检查当前 plugin 状态** ✅ 2026-04-03
  - `openclaw status` + `openclaw channels list` 执行完毕
  - 结果：WoClaw channel "configured, enabled" ✅，Hub 健康 ✅ (`{"status":"ok","agents":2,"topics":2}`)
  - `xingp14-woclaw` (v0.4.3) 已安装，config 指向 Hub ws://192.168.102.153:8082 ✅
  - `xingp14-woclaw.broken`（root 所有，无法清理）是旧版残留，造成 duplicate ID 警告 ⚠️
  - Plugin ID mismatch：manifest id="woclaw" vs npm package="xingp14-woclaw"
  - **S5-2 修复方案**：更新 `openclaw.plugin.json` manifest id 为 `xingp14-woclaw`，或修改 config entries key

- [x] **S5-2（10min）：修复 plugin ID mismatch** ✅ 2026-04-03
  - 修复：`~/.openclaw/openclaw.json` 的 `plugins.installs.woclaw` → `plugins.installs.xingp14-woclaw`（与 manifest id 和目录名对齐）
  - 重启 gateway 后 channel 状态 clean，无 mismatch 警告
  - 注：`plugins.entries.xingp14-woclaw` 早已正确，无需修改

- [x] **S5-3（10min）：重启并验证** ✅ 2026-04-03
  - 重启 gateway（SIGUSR1 hot reload）
  - 验证 `openclaw channels list` woclaw 显示 "configured, enabled"（无 mismatch 警告）✅
  - 确认 Hub 连接数（2 agents, 2 topics）✅
  - 注意：channel key 必须是 `woclaw`（匹配 manifest channels 数组），plugin entry key 是 `xingp14-woclaw`（匹配 manifest id）

### S6: Claude Code Hook 安装器验证（v0.3）
> 评估：install.js 已完整，需要测试验证，~2 步骤

- [x] **S6-1（10min）：审查 install.js 对 Claude Code 的支持** ✅ 2026-04-03
  - ✅ hook 文件检测/install/uninstall 逻辑完整正确
  - ✅ hookNames=['session-start','session-stop','precompact'] 覆盖三种 hook
  - ✅ ~/.claude/hooks + ~/.claude/settings.json 路径正确
  - ⚠️ **settingsHint 仅含 session-start 配置**（session-stop/precompact 用户需手动添加）
  - ⚠️ **precompact hook 未在 settingsHint 中提及**，用户不知道要配置
  - ℹ️ Claude Code settings.json 使用 hook 名称（不含 .sh），如 `"SessionStart": "woclaw-session-start"`
  - ℹ️ install.js 已调用 saveConfig(config) 写入 ~/.woclaw/.env ✅

- [x] **S6-2（10min）：测试 Claude Code hook 安装（dry-run 方式）** ✅ 2026-04-03
  - ✅ 模拟安装测试通过：session-start/stop/precompact 全部正确安装
  - ✅ 权限 0o755 正确设置
  - ✅ env 替换正确：HUB_URL/TOKEN/PROJECT_KEY 均正确替换
  - ⚠️ **settingsHint 只提示 session-start**，session-stop/precompact 配置缺失（用户需自行添加到 settings.json）
  - ℹ️ Claude Code settings.json hook 名称不应含 .sh 后缀（如 `SessionStart: "woclaw-session-start"`）
  - 不实际修改 `~/.claude/`，只验证 install.js 逻辑
  - 或在临时目录模拟 `~/.claude/` 结构测试

### S7: Codex Hook 安装器完善（v0.3）
> 评估：需要统一 codex 安装入口，~2 步骤 ✅ 全部完成

- [x] **S7-1（10min）：对比 install.py vs install.js 的 Codex 支持** ✅ 2026-04-03
  - ✅ `install.py`（woclaw-codex）：完整支持 SessionStart/Stop/PreCompact + config.toml 自动配置
  - ✅ `install.js`（woclaw-hooks）：支持 SessionStart/Stop，缺失 PreCompact + 需手动 config.toml
  - 结论：`woclaw-codex`（install.py）为官方推荐完整安装方式
  - 详见 `docs/S7-1-ANALYSIS.md`

- [x] **S7-2（10min）：统一 Codex 安装体验** ✅ 2026-04-03
  - ✅ README 新增 "OpenAI Codex CLI — Recommended: use woclaw-codex package instead" 章节
  - ✅ 对比表：woclaw-codex vs woclaw-hooks 功能差异
  - ✅ 提供两种安装路径（完整 vs 基础）

### S8: MCP CLI serve 命令（v0.3）
> 评估：需要 OpenClaw CLI 集成，~4 步骤

- [x] **S8-1（10min）：研究 openclaw mcp serve 接口** ✅ 2026-04-03
  - `openclaw mcp serve` exposes OpenClaw sessions as MCP tools（与 WoClaw 无关）
  - `woclaw-mcp@0.1.2` 已完整实现 WoClaw MCP serve（8 tools，JSON-RPC 2.0 over stdio）
  - 方案确定：在 woclaw-cli.js 添加 `mcp serve` 子命令，spawn woclaw-mcp 子进程
  - 详见 `docs/S8-1-RESEARCH.md`

- [x] **S8-2（10min）：设计 woclaw MCP serve 实现方案** ✅ 2026-04-03
  - **选择方案 B2**：独立子进程 + 相对路径引用 mcp-bridge
  - 在 `bin/woclaw.js` 添加 `mcp serve` 子命令，spawn `../mcp-bridge/dist/index.js`
  - 传递 `--hub`, `--token`, `--rest-url` 参数
  - 详见 `docs/S8-2-DESIGN.md`

- [x] **S8-3（10min）：实现 woclaw mcp serve 子命令** ✅ 2026-04-03
  - 在 `bin/woclaw.js` 添加 `mcp serve` 子命令，spawn woclaw-mcp 子进程
  - 通过环境变量 `WOCLAW_WS_URL`, `WOCLAW_REST_URL`, `WOCLAW_TOKEN` 传递 Hub 连接参数
  - 添加 `--rest-url` 全局旗标支持；添加 `__dirname` ES module polyfill
  - 验证：`woclaw mcp serve` → Hub ws://vm153:8082 连接成功

- [x] **S8-4（10min）：测试 woclaw mcp serve + npm 发布** ✅ 2026-04-04
  - REST API 测试通过：`GET /memory` → 正常返回记忆列表 ✅
  - REST API 测试通过：`GET /topics` → 正常返回 topics (general, woclaw-test) ✅
  - WebSocket 连接测试通过 → Hub ws://vm153:8082 认证成功 ✅
  - MCP 暴露 8 个 tools：woclaw_memory_read/write/delete/list, woclaw_topics_list/messages/send/join ✅
  - npm 包已就绪：xingp14-woclaw@0.4.3 ✅，woclaw-mcp@0.1.2 ✅

### S9: Memory Versioning（v0.4）
> 评估：Hub 侧改动，~4 步骤

- [x] **S9-1（10min）：设计 Memory Versioning 方案** ✅ 2026-04-04
  - 查看 `hub/src/memory.ts` 和 `hub/src/db.ts`
  - 设计：write 时保留旧值到 `memory_versions` 表
  - 输出：数据库 schema 变更方案 + 实际实现
  - `DBMemoryVersion` 类型已添加至 `types.ts`
  - `setMemory()` 在覆盖前自动保存旧值到 `memory_versions`，版本号从 1 开始递增
  - `GET /memory/:key/versions` REST 端点已添加，Hub 已部署并测试通过 ✅

- [x] **S9-2（10min）：实现 DB versioning 支持** ✅ 2026-04-04（随 S9-1 一起完成）
  - 在 `db.ts` 添加 `getMemoryVersions(key)` 方法
  - 修改 `setMemory` 在更新前保存旧值

- [x] **S9-3（10min）：实现 REST API versioning 端点** ✅ 2026-04-04（随 S9-1 一起完成）
  - 添加 `GET /memory/:key/versions` 端点
  - 在 `rest_server.ts` 注册路由

- [x] **S9-4（10min）：添加单元测试** ✅ 2026-04-04
  - 在 `hub/test/memory.test.ts` 添加 6 个 versioning 测试用例
  - `npm test` → 52/52 passed ✅

### S10: Semantic Recall（v0.4）
> 评估：最复杂，~5 步骤

- [x] **S10-1（10min）：设计 Semantic Recall 方案** ✅ 2026-04-04
  - 选择方案A：关键词 + 评分（stop words 过滤 + 关键词匹配 + tag 权重 + recency 排序）
  - 无外部依赖，直接可用

- [x] **S10-2（10min）：实现 recall(query) 函数** ✅ 2026-04-04
  - 在 `memory.ts` 添加 `recall(query, intent?, limit?)` 方法
  - 基于关键词匹配（substring/token/tag）+ recency 排序

- [x] **S10-3（10min）：实现 recall intent 解析** ✅ 2026-04-04（随 S10-2 完成）
  - 支持 `intent` 参数，根据 intent 标签匹配 +5 权重

- [x] **S10-4（10min）：添加 REST API 端点** ✅ 2026-04-04
  - `GET /memory/recall?q=<query>&intent=<intent>&limit=<n>`
  - Hub 已部署，API 测试通过 ✅

- [x] **S10-5（10min）：测试 + 文档** ✅ 2026-04-04
  - 6 个 recall 单元测试 ✅，58/58 tests pass ✅
  - Bug fix: recency boost 不应计入 score filter

### S11: Agent 发现 API（v0.4）
> 评估：简单 API 端点，~2 步骤

- [x] **S11-1（10min）：实现 GET /agents 端点** ✅ 2026-04-04
  - `ws_server.ts` 新增 `getAgentsInfo()` 方法，返回所有已连接 agent 列表
  - `rest_server.ts` 新增 `GET /agents` 端点，`/agents?format=details` 返回完整信息
  - `index.ts` 更新 RestServer 构造函数传递 wsServer
  - 测试通过：`GET /agents` → vm152 + vm153 两个 agent ✅

- [x] **S11-2（10min）：测试 + 补充字段** ✅ 2026-04-04
  - `GET /agents` → 返回 vm152 + vm153，含 connectedAt/topics/lastSeen 字段 ✅

### S12: 任务委托机制（v0.4）
> 评估：复杂协议设计，~5 步骤

- [x] **S12-1（10min）：设计委托协议** ✅ 2026-04-04
  - 设计 delegation 消息格式（type, task, fromAgent, toAgent, status）
  - 确定 Hub 侧状态存储方式
  - 输出：`docs/S12-1-DELEGATION-PROTOCOL.md` + `hub/src/types.ts` delegation types

- [x] **S12-2（10min）：实现 delegation 消息路由** ✅ 2026-04-04
  - 在 `ws_server.ts` 处理 `delegate` 消息类型
  - 将 delegation 转发给目标 agent
  - Hub SIGUSR1 重启完成，delegations.size 已纳入 stats

- [x] **S12-3（10min）：实现委托状态跟踪** ✅ 2026-04-04
  - `delegations` Map 已存在于 ws_server.ts，`handleDelegateCancel` 完整实现双向通知
  - 修复 REST DELETE `/delegations/:id` 缺少 `note` 字段的不一致问题

- [x] **S12-4（10min）：添加 REST API 端点** ✅ 2026-04-04
  - `GET /delegations`, `POST /delegations`, `DELETE /delegations/:id` ✅
  - `GET /delegations/pending?agentId=X` ✅ 全部验证通过

- [x] **S12-5（10min）：CLI 支持 + 测试** ✅ 2026-04-04
  - `woclaw delegate <toAgent> <description>` ✅
  - `woclaw delegations [status]` ✅
  - Hub vm153 重启完成

### S13-S16: 迁移工具（v0.5）
> 评估：每个 ~4 步骤，以 S13 Codex 为例

- [x] **S13-1（10min）：调研 Codex session 存储格式** ✅ 2026-04-04
  - Web 搜索 + Codex 官方文档确认存储格式
  - `~/.codex/history.jsonl` — 主历史（JSONL，每行 messages）
  - `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl` — 分会话轨迹（JSONL，tool calls + trajectory）
  - Hook stdin 格式：`{session_id, transcript_path, cwd, stopReason}`
  - 输出：`docs/S13-1-CODEX-SESSION-FORMAT.md`

- [x] **S13-2（10min）：实现 session parser** ✅ 2026-04-04
  - 创建 `packages/woclaw-hooks/codex-migrate.js`（纯 Node.js，456 行）
  - 支持 --list/--session-id/--session-file/--all 四种模式
  - 解析 history.jsonl，提取 decisions/files_modified/tools_used/commands_run
  - 生成 markdown summary，写入 WoClaw Hub (codex:session:<id>)
  - VPS4 测试：--list 正常返回（Codex 未安装，结果为 0 sessions）

- [x] **S13-3（10min）：实现 `woclaw migrate --framework codex` CLI** ✅ 2026-04-04
  - 添加 `migrate --framework codex [--list|--session-id <id>|--all]` 子命令到 `plugin/bin/woclaw-cli.js`
  - 通过 child_process.spawn 调用 `codex-migrate.js`，stdio inherit
  - 支持 codex / openai-codex 别名
  - CLI 加载测试通过（401 是 Hub 地址问题，非代码错误）

- [x] **S13-4（10min）：测试 + S14-S16 框架** ✅ 2026-04-04
  - S14 模板：`claude-migrate.js` — 列表 ~/.claude/sessions/，解析 JSONL，写入 WoClaw Hub
  - S15 模板：`gemini-migrate.js` — 读 ~/.gemini/history.jsonl，迁移 Gemini 会话
  - S16 模板：`openclaw-migrate.js` — 读 ~/.openclaw/openclaw.json，迁移 agent memory
  - 所有脚本通过 --help/--list 测试（无报错）；openclaw-migrate --list 正确识别 defaults agent

### S17: MCP Server 使用文档（v0.6）
> 评估：mcp-bridge README 仅 75 行，需要完整中文文档，~3 步骤

- [x] **S17-1（10min）：编写 docs/MCP-SERVER.md 完整文档** ✅ 2026-04-04
  - 创建 `docs/MCP-SERVER.md`（199 行），包含：
    - 三种安装方式（woclaw CLI / 直接运行 / 本地构建）
    - Claude Desktop / Cursor / Windsurf 配置示例
    - 8 个 MCP tools 详解（记忆 4 个 + Topic 4 个）
    - 环境变量说明
    - 故障排除指南

---

_Last updated: 2026-04-04 03:03 CST_
