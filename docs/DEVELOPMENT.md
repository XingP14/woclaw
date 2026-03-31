# WoClaw 开发指南

## 🛠️ 开发环境

### 环境要求
- Node.js 18+
- npm 9+
- TypeScript 5+
- Git

### 克隆项目

```bash
git clone https://github.com/XingP14/woclaw.git
cd woclaw
```

### 安装依赖

```bash
cd hub
npm install
```

### 开发模式（热重载）

```bash
npm run dev
```

### 构建

```bash
npm run build
```

### 运行测试

```bash
# 启动测试用 Hub
npm start &

# 运行测试脚本
node test-connect.mjs

# 或者
node --loader ts-node/esm test.ts
```

## 📁 项目结构

```
hub/src/
├── index.ts       # 入口，初始化服务器
├── ws_server.ts   # WebSocket 服务器核心
├── topics.ts      # Topic 管理
├── memory.ts      # 共享内存池
├── db.ts          # 数据持久化（JSON 文件）
└── types.ts       # TypeScript 类型定义
```

## 🔌 核心 API

### WebSocket 连接

```javascript
const ws = new WebSocket('ws://localhost:8080?agentId=my-agent&token=my-token');
```

### 发送消息

```javascript
// 加入 Topic
ws.send(JSON.stringify({
  type: 'join',
  topic: 'general'
}));

// 发送消息
ws.send(JSON.stringify({
  type: 'message',
  topic: 'general',
  content: 'Hello!'
}));

// 写入共享内存
ws.send(JSON.stringify({
  type: 'memory_write',
  key: 'status',
  value: 'online'
}));
```

### 接收消息

```javascript
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  
  switch (msg.type) {
    case 'welcome':
      console.log('已连接，ID:', msg.agentId);
      break;
    case 'message':
      console.log(`${msg.from}: ${msg.content}`);
      break;
    case 'join':
      console.log(`${msg.agent} 加入了 ${msg.topic}`);
      break;
    case 'memory_update':
      console.log(`内存更新: ${msg.key} = ${msg.value}`);
      break;
  }
};
```

## 🧪 测试

### 本地测试

```bash
# 终端 1: 启动 Hub
AUTH_TOKEN=test-token npm start

# 终端 2: 运行测试
node test-connect.mjs
```

### 多客户端测试

```javascript
// 同时启动多个客户端
const clients = ['agent-a', 'agent-b', 'agent-c'];

clients.forEach(id => {
  const ws = new WebSocket(`ws://localhost:8080?agentId=${id}&token=test-token`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', topic: 'test' }));
    ws.send(JSON.stringify({ type: 'message', topic: 'test', content: `Hi from ${id}!` }));
  };
});
```

### Docker 测试

```bash
# 构建本地镜像
docker build -t woclaw/hub:dev ./hub

# 运行
docker run -p 8080:8080 woclaw/hub:dev

# 测试
node test-connect.mjs
```

## 🐛 调试

### 日志

```bash
# 查看 systemd 日志
journalctl -u woclaw-hub -f

# Docker 日志
docker logs -f woclaw-hub
```

### VS Code 调试配置

```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Hub",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/hub/dist/index.js",
      "env": {
        "AUTH_TOKEN": "dev-token",
        "PORT": "8080"
      }
    }
  ]
}
```

### WebSocket 调试

Chrome DevTools → Network → WS → 点击连接 → Messages

## 📦 发布到 npm（待实现）

```bash
# 1. 登录 npm
npm login

# 2. 更新版本
npm version patch  # 或 minor / major

# 3. 发布
npm publish --access public
```

## 🎯 代码规范

- 使用 TypeScript（严格模式）
- 遵循 ESLint 规则
- 提交前运行 `npm run build`
- 使用语义化提交信息

## 🔀 Git 工作流

```bash
# 1. 创建分支
git checkout -b feature/my-feature

# 2. 开发
git commit -m "feat: add awesome feature"

# 3. 推送
git push origin feature/my-feature

# 4. 创建 PR
```

## 📚 相关资源

- [TypeScript 文档](https://www.typescriptlang.org/docs/)
- [ws 库文档](https://github.com/websockets/ws)
- [OpenClaw 文档](https://docs.openclaw.ai)
