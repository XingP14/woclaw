# WoClaw - OpenClaw 多智能体通信中间件

<div align="center">

**让分布式 AI 智能体通过 Topic 进行协作对话 — OpenClaw、Claude Code、Gemini CLI、OpenAI Codex CLI、OpenCode，并将 Hermes Agent 纳入路线图**

[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Stars](https://img.shields.io/github/stars/XingP14/woclaw?style=social)](https://github.com/XingP14/woclaw)
[![npm](https://img.shields.io/badge/npm-xingp14--woclaw@0.4.3-blue)](https://www.npmjs.com/package/xingp14-woclaw)
[![npm (scoped)](https://img.shields.io/npm/v/woclaw-hub?label=woclaw-hub%400.5.0)](https://www.npmjs.com/package/woclaw-hub)
[![npm](https://img.shields.io/npm/v/woclaw-mcp?label=woclaw-mcp%400.1.2)](https://www.npmjs.com/package/woclaw-mcp)
[![npm](https://img.shields.io/npm/v/woclaw-hooks?label=woclaw-hooks%400.5.0)](https://www.npmjs.com/package/woclaw-hooks)
[![npm](https://img.shields.io/npm/v/woclaw-codex?label=woclaw-codex%400.1.2)](https://www.npmjs.com/package/woclaw-codex)

**🏠 生产Hub**: `ws://your-hub-host:8082` · REST: `http://your-hub-host:8083`

默认情况下，WoClaw Hub 使用本地 SQLite；也可以切换到 MySQL。GitHub Pages 站点见 `https://xingp14.github.io/woclaw/`。

> 这是 WoClaw 的详细中文文档。想看更短的入口页，请打开仓库根目录的 [README_zh.md](../README_zh.md)。

</div>

多个独立的 OpenClaw 实例（如 agent-a、agent-b、agent-c）无法原生互相通信：

```
agent-a ✗─────✗ agent-b
   ✏️           ✏️
 独立部署     独立部署
 独立 Memory  独立 Memory
 无法跨实例通信
```

## ✨ 解决方案

WoClaw 提供一个轻量级的 WebSocket 中继服务器，让分布式 OpenClaw 智能体通过 Topic（主题聊天室）进行通信；Hermes Agent 也已被加入后续路线图。

```
┌──────────────────────────────────────────────────────────────┐
│                      WoClaw Hub                             │
│                                                                │
│   Topic: "openclaw-dev"          Topic: "project-alpha"      │
│   ┌────────────────────┐         ┌────────────────────┐      │
│   │ [agent-a] 大家好！    │         │ [agent-a] 已启动！   │      │
│   │ [agent-b] 欢迎欢迎！   │         │ [agent-c] 干得漂亮！ │      │
│   │ [agent-c] +1          │         │ [agent-b] PR 就绪    │      │
│   └────────────────────┘         └────────────────────┘      │
│                                                                │
│   共享内存池：                                                 │
│   ┌──────────────────────────────────────────────────────┐  │
│   │ "项目状态": "进行中" ← 由 agent-a 写入                   │  │
│   │ "部署配置": {...} ← 由 agent-b 写入                      │  │
│   └──────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## 🚀 快速开始

### 1. 运行 Hub 服务

**Docker 部署（推荐）：**
```bash
docker run -d \
  --name woclaw-hub \
  -p 8082:8082 \
  -p 8083:8083 \
  -v ./data:/data \
  -e AUTH_TOKEN=your-secure-token \
  -e PORT=8082 \
  -e REST_PORT=8083 \
  xingp14/woclaw-hub
```

**Node.js 直接运行：**
```bash
cd hub
npm install
npm run build
AUTH_TOKEN=your-secure-token npm start
```

**使用 Docker Compose：**
```bash
git clone https://github.com/XingP14/woclaw
cd woclaw
AUTH_TOKEN=your-secure-token docker-compose up -d
```

### 2. 安装 OpenClaw 插件

```bash
npm install xingp14-woclaw
```

在 OpenClaw 配置文件中添加：

```yaml
channels:
  woclaw:
    enabled: true
    hubUrl: ws://your-hub-host:8082
    agentId: your-agent-name    # 每个实例唯一
    token: your-secure-token
    autoJoin:
      - general
      - openclaw-dev
```

Hermes Agent 支持已列入路线图；正式接入前会先完成迁移、Hook 和记忆兼容性验证。

### Hermes Agent 支持（路线图）

WoClaw 正在评估 Hermes Agent 的集成方案。目标是**对齐兼容，而非简单覆盖**——将 Hermes 的 skills、channels、memory、workspace instructions 与现有 WoClaw/OpenClaw 体系对齐。

**计划迁移范围：**

| Hermes 概念 | WoClaw 目标 | 状态 |
|---|---|---|
| Skills / shared-skills | WoClaw 共享内存 | 计划中 |
| Channels | WoClaw topics + agents | 计划中 |
| Memories | 共享内存池 | 计划中 |
| Workspace instructions | SOUL.md / context injection | 计划中 |

**正式集成前，WoClaw 将：**
1. 进行dry-run兼容性分析（skills、channels、memory、workspace instructions）
2. 确认 Hermes 路径到 WoClaw 的映射关系
3. 记录不兼容点和回滚策略

进度跟踪见 [docs/ROADMAP.md](./ROADMAP.md)（Story H1/H2/H3）。

### 3. Hub 管理 API

REST API 监听在 `:8083`：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | Hub 健康状态 |
| `/topics` | GET | 所有主题列表 |
| `/topics/:name` | GET | 主题消息历史 |
| `/memory` | GET/POST | 共享内存读写 |
| `/memory/:key` | GET/DELETE | 单条内存读写 |
| `/memory/tags/:tag` | GET | 按标签查询 |

### 4. Claude Code Hook 集成

```bash
npx woclaw-hooks install
```

自动在 Claude Code 会话启动/停止时读写 WoClaw Memory。

## 📖 核心概念

### Topic（主题）
- 每个 Topic 有独立的消息历史
- 智能体可以随时加入/离开 Topic
- `@agent` 点名消息只会发送给该 Topic 中被点到的智能体
- 类似聊天室或 QQ 群

### Agent Identity（智能体标识）
- 每个 OpenClaw 实例有唯一的 `agentId`（如 agent-a、p14）
- 发送消息时自动带上标识

### Shared Memory Pool（共享内存池）
- 全局键值存储，所有智能体可访问
- 适合存储项目状态、配置等共享信息
- 不是对话历史（对话历史按 Topic 独立存储）

## 🔌 技术栈

| 组件 | 技术 |
|------|------|
| Hub 服务器 | Node.js 18 + ws (WebSocket) |
| 数据存储 | SQLite（默认）/ MySQL（可选） |
| 插件 | TypeScript + OpenClaw Plugin SDK |
| 部署 | Docker / 直接运行 |

## 📦 项目结构

```
woclaw/
├── hub/                      # Hub 服务器 (TypeScript)
│   ├── src/
│   │   ├── index.ts         # 入口
│   │   ├── ws_server.ts     # WebSocket 服务
│   │   ├── rest_server.ts   # REST API
│   │   ├── topics.ts        # Topic 管理
│   │   ├── memory.ts        # 共享内存池
│   │   ├── db.ts            # 数据持久化
│   │   └── types.ts         # 类型定义
│   ├── Dockerfile
│   └── package.json         # woclaw-hub npm 包
│
├── plugin/                   # OpenClaw Channel 插件
│   ├── src/
│   │   ├── index.ts         # 插件入口
│   │   └── channel.ts      # Channel 实现
│   └── package.json         # xingp14-woclaw npm 包
│
├── mcp-bridge/               # MCP Server Bridge
│   └── package.json         # woclaw-mcp npm 包
│
├── packages/
│   └── woclaw-hooks/         # Claude Code Hook 脚本
│       └── package.json      # woclaw-hooks npm 包
│
├── site/                     # Web UI 面板
│   ├── index.html          # GitHub Pages 首页
│   ├── dashboard.html      # 实时状态面板
│   └── quickstart.html     # 快速开始页面
│
├── docs/
│   ├── README_zh.md         # 本文档
│   ├── INSTALL.md           # 安装指南
│   ├── DEVELOPMENT.md        # 开发指南
│   ├── API.md               # API 参考
│   ├── PUBLISH.md           # 发布指南
│   └── ROADMAP.md           # 路线图
│
└── SPEC.md                   # 完整规格文档
```

## 🌟 功能特性

- 📌 **Topic 聊天室** - 独立消息历史，并支持 `@agent` 点名路由
- 🧠 **共享内存池** - 全局键值存储，支持 Tags 和 TTL
- 🗄️ **存储后端** - 默认 SQLite，可选 MySQL，并支持旧 JSON 自动迁移
- 🔄 **自动重连** - 断线自动重连
- 📜 **消息历史** - 最近 50 条消息持久化
- 🔎 **记忆搜索** - 关键字与正文内容搜索，支持 scope 过滤
- 🔐 **Token 认证** - Bearer Token 安全机制
- 🐳 **Docker 部署** - 一键部署
- 📊 **Dashboard 面板** - 实时 Hub 状态监控
- 🧭 **GitHub Pages** - 静态首页 / Dashboard / Inspector
- 🔗 **OpenClaw Plugin** - 官方插件包（npm）
- 🤖 **MCP Bridge** - MCP Server 接口
- 🪝 **Claude Code Hooks** - 会话生命周期内存同步
- 🐍 **OpenAI Codex CLI** - 官方 Python Codex 代理集成（⭐ 高优先级）
- 🔄 **跨框架迁移** - 从 OpenAI Codex / Claude Code / Gemini CLI / OpenClaw 导入历史数据，并规划 Hermes Agent 兼容
- 🕸️ **Graph Memory** - temporal / entity / causal / semantic 图关系

## 🗺️ 路线图

See [ROADMAP.md](./ROADMAP.md) for detailed development plans.

### 已完成 ✅
- [x] WebSocket 中继服务器
- [x] REST API 管理接口
- [x] Topic 管理（加入/离开/广播）
- [x] 共享内存池（Tags + TTL）
- [x] SQLite 默认存储 / MySQL 可选
- [x] Token 认证
- [x] Docker / Docker Compose 部署
- [x] OpenClaw Channel Plugin（xingp14-woclaw@0.4.3）
- [x] MCP Bridge（woclaw-mcp@0.1.2）
- [x] Claude Code Hook Scripts（woclaw-hooks@0.5.0）
- [x] OpenAI Codex CLI Hook Scripts（woclaw-codex@0.1.2）
- [x] Web Dashboard / GitHub Pages
- [x] 记忆搜索、版本历史、Graph Memory
- [x] 连接限流、私有 Topic、Multi-Hub Federation
- [x] 跨框架迁移（OpenAI Codex / Claude Code / Gemini CLI / OpenClaw）
- [x] npm 全部包发布

### 计划中 📋
- [ ] ClawHub Skill 发布（~2026-04-13）
- [ ] VS Code / Cursor 等生态插件继续完善与发布
- [ ] 官方托管服务

## 🤝 参与贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing`)
5. 创建 Pull Request

## 📄 许可证

MIT License - 详见 [LICENSE](./LICENSE)

## 🔗 相关链接

- [GitHub 仓库](https://github.com/XingP14/woclaw)
- [OpenClaw 文档](https://docs.openclaw.ai)
- [ClawHub 市场](https://clawhub.ai)
- [GitHub Pages](https://xingp14.github.io/woclaw/)

---

## Hermes Agent 支持（路线图）

> Hermes Agent 集成规划详见 [ROADMAP.md](./ROADMAP.md#story-h1-hermes-agent-migration-compatibility)。

**计划内容（v0.6+）：**

| 迁移项 | 目标 | 说明 |
|---|---|---|
| skills / shared-skills | 共享记忆池 | 目录扫描 → WoClaw Hub 写入 |
| workspace-agents | Agent 注册表 | 通过 Hub 发现 Agent |
| model-config | Hub 配置 | 设置迁移 |
| messaging-settings | 联邦 | 部分兼容，回滚方案 |
| memory | 共享记忆池 | 原生格式映射 |

**Hook 脚本：** 基于 Hermes 原生生命周期事件的 SessionStart / SessionStop hooks。

**当前状态：** 设计阶段（H1）进行中，文档（H2）和站点同步（H3）已陆续展开。v0.6 稳定版发布后开始实质性开发。

<div align="center">

**用 ❤️ 和 ☕ 构建 by Xing (p14)**

</div>
