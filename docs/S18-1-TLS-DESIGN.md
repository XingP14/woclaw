# TLS/SSL 支持设计 — S18

## 目标
为 WoClaw Hub 添加 `wss://` (WebSocket Secure) 支持，实现加密通信。

## 方案选择

### 推荐方案：双模式监听
- **ws://** (8082) — 内部网络，纯明文，快速连接
- **wss://** (8443) — TLS 加密，支持外部安全访问
- 两套端口并存，客户端按需选择

### 为什么不只用 wss://？
- 内部网络（192.168.x.x）性能损耗不必要
- 保持向后兼容，不破坏现有连接
- 支持混合部署（内部用 ws，外部用 wss）

## 实现步骤

### 1. Config 扩展（types.ts）
```typescript
export interface Config {
  // 现有字段...
  tlsCert?: string;  // TLS cert file path (PEM)
  tlsKey?: string;   // TLS key file path (PEM)
}
```

### 2. ws_server.ts 改造
```typescript
import { createServer } from 'https';
import { readFileSync } from 'fs';

constructor(config: Config, ...) {
  if (config.tlsCert && config.tlsKey) {
    // TLS 模式：wss://
    const httpsServer = createServer({
      cert: readFileSync(config.tlsCert),
      key: readFileSync(config.tlsKey),
    });
    this.wss = new WebSocketServer({ server: httpsServer });
    httpsServer.listen(8443);
    console.log(`[WoClaw] WSS server running on wss://${config.host}:8443`);
  }
  // 始终保留 ws:// (8082)
  this.wss = new WebSocketServer({ port: config.port });
}
```

⚠️ `ws` 库只支持在一个端口监听。方案改为：
- 两个 WSServer 实例：一个 ws://(8082)，一个 wss://(8443)
- 或者：只用 wss://，ws:// 通过 nginx 反代实现

### 3. 证书生成（自签名）
```bash
# 在 your-hub-host 上生成
mkdir -p /opt/woclaw/certs
openssl req -x509 -newkey rsa:2048 \
  -keyout /opt/woclaw/certs/key.pem \
  -out /opt/woclaw/certs/cert.pem \
  -days 365 -nodes \
  -subj "/CN=your-hub-host/O=WoClaw"

# 分发 CA cert 给客户端
scp /opt/woclaw/certs/cert.pem user@client:/path/to/woclaw-ca.crt
```

### 4. 客户端配置
```javascript
// 信任自签名 CA
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // 仅测试用

// 或显式指定 CA
const ws = new WebSocket('wss://your-hub-host:8443', {
  ca: readFileSync('./woclaw-ca.crt')
});
```

### 5. OpenClaw 插件 TLS 支持
```json
{
  "channels": {
    "woclaw": {
      "url": "wss://your-hub-host:8443"
    }
  }
}
```

## 替代方案：nginx 反代（推荐生产环境）
```nginx
server {
    listen 8443 ssl;
    server_name your-hub-host;
    ssl_certificate /etc/ssl/certs/woclaw.crt;
    ssl_certificate_key /etc/ssl/private/woclaw.key;
    
    location / {
        proxy_pass http://127.0.0.1:8082;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```
优点：nginx 统一管理证书，WoClaw 代码无需改动

## 待决定
- [ ] 实现方式：代码内置 TLS vs nginx 反代
- [ ] 证书管理：自签名 vs Let's Encrypt（需域名）
- [ ] 端口选择：wss:// 单独 8443 还是复用 8082

## 下一步
- S18-2：实现 ws_server.ts TLS 代码
- S18-3：更新文档 + 客户端示例
