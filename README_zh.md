# WoClaw

> **AI Agent 共享记忆与消息中枢** - 支持 OpenClaw、Claude Code、Gemini CLI、OpenAI Codex CLI、OpenCode 等多框架。

[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Stars](https://img.shields.io/github/stars/XingP14/woclaw?style=social)](https://github.com/XingP14/woclaw)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![npm (scoped)](https://img.shields.io/npm/v/woclaw-hub?label=woclaw-hub)](https://www.npmjs.com/package/woclaw-hub)
[![npm](https://img.shields.io/npm/v/xingp14-woclaw?label=xingp14-woclaw%400.4.3)](https://www.npmjs.com/package/xingp14-woclaw)
[![npm](https://img.shields.io/npm/v/woclaw-mcp?label=woclaw-mcp)](https://www.npmjs.com/package/woclaw-mcp)
[![npm](https://img.shields.io/npm/v/woclaw-hooks?label=woclaw-hooks%400.5.0)](https://www.npmjs.com/package/woclaw-hooks)

WoClaw 的当前定位是三层：
- **Hub** 负责记忆、Topic、Graph Memory、鉴权和存储
- **Agent 接入层** 负责 OpenClaw、Claude Code、Gemini CLI、Codex、OpenCode 的连接
- **文档与站点层** 负责 GitHub Pages、Dashboard、Inspector 和迁移说明

默认情况下，Hub 使用本地 SQLite；也可以切换到 MySQL。GitHub Pages 站点见 `https://xingp14.github.io/woclaw/`。

## 核心能力

- 共享记忆池，支持 Tags、TTL、版本历史、关键词搜索和 scope 过滤
- Topic 订阅发布，支持消息历史、私有 Topic、Federation
- 多框架接入：OpenClaw、Claude Code、Gemini CLI、OpenAI Codex CLI、OpenCode
- Hooks 和迁移工具：会话启动/结束/PreCompact、历史记忆导入
- Web UI：静态首页、Dashboard、Inspector
- Graph Memory：temporal / entity / causal / semantic 关系

## 最短上手

### 1. 启动 Hub

```bash
docker pull xingp14/woclaw-hub:latest
docker run -d \
  --name woclaw-hub \
  -p 8082:8082 -p 8083:8083 \
  -e AUTH_TOKEN=change-me \
  --restart unless-stopped \
  xingp14/woclaw-hub:latest
```

默认数据目录是 `/data/woclaw.sqlite`。如果要接 MySQL，设置 `DB_TYPE=mysql` 和对应的 `MYSQL_*` 环境变量。

### 2. 接入 Agent

- OpenClaw 插件：`npm install xingp14-woclaw`
- Claude Code / Gemini CLI / OpenCode：使用 `woclaw-hooks`
- OpenAI Codex CLI：使用 `woclaw-codex`
- MCP 客户端：使用 `woclaw-mcp`

详细安装和配置请看 [docs/README_zh.md](./docs/README_zh.md)。

### 3. 打开 Web UI

- GitHub Pages: `https://xingp14.github.io/woclaw/`
- 本地 Hub Dashboard: `http://your-hub:8084`

## 文档导航

- [详细中文文档](./docs/README_zh.md)
- [路线图](./docs/ROADMAP.md)
- [安装指南](./docs/INSTALL.md)
- [API 参考](./docs/API.md)
- [MCP Server 文档](./docs/MCP-SERVER.md)

## 相关链接

- [GitHub 仓库](https://github.com/XingP14/woclaw)
- [GitHub Pages](https://xingp14.github.io/woclaw/)
- Hub 运行实例：`ws://your-hub-host:8082` · `http://your-hub-host:8083`
