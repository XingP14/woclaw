# S8-2 设计方案：woclaw mcp serve 实现

**日期**: 2026-04-03
**步骤**: S8-2 ✅

## 结论：选择方案 B — 独立子进程 + woclaw-mcp peer dependency

### 三种方案对比

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A: require('woclaw-mcp')** | plugin/node_modules 包含 woclaw-mcp | 无需单独安装 | plugin 包体积增大，版本耦合 |
| **B: spawn subprocess** | woclaw CLI spawn woclaw-mcp 子进程 | 解耦，版本独立，维护简单 | 需要 woclaw-mcp 全局可访问或本地 resolve |
| **C: 嵌入源码** | 将 mcp-bridge/src/index.js 逻辑复制到 CLI | 无外部依赖 | 代码重复，维护成本高 |

**选择方案 B**。

### 实现方案 B 的两个子路径

#### 子路径 B1：woclaw-mcp 作为 plugin peer dependency
- plugin/package.json 添加 `"woclaw-mcp": "workspace:*"` 或 `"*"` 作为 peer dependency
- 当用户 `npm install -g xingp14-woclaw` 或本地安装时，woclaw-mcp 也被安装
- woclaw CLI 中 `spawn('node', [require.resolve('woclaw-mcp'), 'serve', ...])`

#### 子路径 B2：直接引用 mcp-bridge 源码
- plugin 和 mcp-bridge 在同一个 monorepo（当前就是）
- woclaw CLI 通过相对路径 `../mcp-bridge/dist/index.js` spawn subprocess
- 无需额外 npm 安装

### 推荐：子路径 B2（当前 repo 结构最简单）

当前 `woclaw/` monorepo 结构：
```
woclaw/
  plugin/          # xingp14-woclaw npm 包
    bin/woclaw.js  # ← 添加 `woclaw mcp serve` 命令
  mcp-bridge/      # woclaw-mcp npm 包
    dist/index.js  # ← 直接 spawn 这个文件
```

**woclaw.js 中的实现**：
```javascript
// bin/woclaw.js 中新增：
else if (command === 'mcp') {
  const sub = cmdArgs[0];
  if (sub === 'serve') {
    const { spawn } = require('child_process');
    // 从 plugin 目录相对路径找到 mcp-bridge
    const mcpPath = path.resolve(__dirname, '../../mcp-bridge/dist/index.js');
    // 传递 hub/ws/token 参数
    const mcpArgs = [
      mcpPath,
      `--hub=${HUB_WS}`,
      `--token=${HUB_TOKEN}`,
      `--rest-url=${HUB_REST}`,
    ];
    const child = spawn('node', mcpArgs, { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code || 0));
    return;
  } else {
    // mcp help
    console.log('WoClaw MCP commands:\n  serve  Start WoClaw MCP server (stdio JSON-RPC)');
    return;
  }
}
```

### 使用方式（用户视角）

```bash
# 方式1：通过 woclaw CLI（S8-3 实现目标）
woclaw mcp serve
# 或者带参数
woclaw mcp serve --hub ws://your-hub-host:8082 --token WoClaw2026 --rest-url http://your-hub-host:8083

# 方式2：直接用 woclaw-mcp
woclaw-mcp --hub ws://your-hub-host:8082 --token WoClaw2026 --rest-url http://your-hub-host:8083
```

### 帮助信息更新

bin/woclaw.js 的 usage() 函数需新增一行：
```
log('  ' + cyan('mcp serve') + '            Start MCP server (for Claude Desktop/Cursor)');
```

### 测试验证

```bash
# 测试 woclaw mcp serve
cd /home/node/.openclaw/workspace/woclaw/plugin
node bin/woclaw.js mcp serve --hub ws://your-hub-host:8082 --token WoClaw2026 --rest-url http://your-hub-host:8083

# 单独测试 woclaw-mcp
cd /home/node/.openclaw/workspace/woclaw/mcp-bridge
node dist/index.js --hub ws://your-hub-host:8082 --token WoClaw2026 --rest-url http://your-hub-host:8083
```

## 后续步骤

- **S8-3（10min）**: 在 bin/woclaw.js 添加 `mcp serve` 子命令
- **S8-4（10min）**: 测试 `woclaw mcp serve` + 更新 package.json peerDependencies（如需要）
