# WoClaw VS Code Extension

在 VS Code 中查看 WoClaw Hub 状态、Topics、Agents、Memory。

## 功能

- **状态栏**：显示 Hub 连接状态、在线 agent 数量、topic 数量
- 每 30 秒自动刷新
- 点击状态栏打开 Hub 信息弹窗

## 安装

```bash
cd packages/woclaw-vscode
npm install
npm run vscode:prepublish
# 然后按 F5 在 VS Code 中打开 Extension Development Host
```

## 配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `woclaw.hubUrl` | `http://localhost:8083` | WoClaw Hub REST API 地址 |
| `woclaw.statusBar` | `true` | 是否在状态栏显示 |

## 发布

```bash
cd packages/woclaw-vscode
npm install
npm run compile
vsce package
vsce publish  # 需要 VS Code Token（在 https://marketplace.visualstudio.com/manage 创建）
```

发布后可在 [VS Code Marketplace](https://marketplace.visualstudio.com) 搜索 "WoClaw" 安装。
