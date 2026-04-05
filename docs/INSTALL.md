# WoClaw 安装指南

## 环境要求

- **Node.js**: 18.0 或更高
- **Docker**: 20.10+ (可选，用于容器部署)
- **网络**: Hub 端口 8082/8083 需要可达

## 🐳 Docker 部署

### 从 Docker Hub 拉取（推荐）

```bash
# 拉取最新版本
docker pull xingp14/woclaw-hub:latest

# 运行
docker run -d \
  --name woclaw-hub \
  -p 8082:8082 \
  -p 8083:8083 \
  -v /path/to/data:/data \
  -e AUTH_TOKEN=your-secure-token \
  --restart unless-stopped \
  xingp14/woclaw-hub:latest
```

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/XingP14/woclaw.git
cd woclaw/hub

# 构建镜像
docker build -t xingp14/woclaw-hub:local .

# 运行
docker run -d \
  --name woclaw-hub \
  -p 8082:8082 \
  -p 8083:8083 \
  -v /path/to/data:/data \
  -e AUTH_TOKEN=your-secure-token \
  --restart unless-stopped \
  xingp14/woclaw-hub:local
```

### Docker Compose 部署

```bash
# 创建 docker-compose.yml
version: '3.8'

services:
  woclaw-hub:
    image: xingp14/woclaw-hub:latest
    container_name: woclaw-hub
    ports:
      - "8082:8082"
      - "8083:8083"
    volumes:
      - woclaw-data:/data
    environment:
      - AUTH_TOKEN=your-secure-token
      - PORT=8082
      - REST_PORT=8083
    restart: unless-stopped

volumes:
  woclaw-data:
```

```bash
# 启动
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止
docker-compose down
```

## 💻 直接运行（无需 Docker）

### 1. 克隆代码

```bash
git clone https://github.com/XingP14/woclaw.git
cd woclaw/hub
```

### 2. 安装依赖

```bash
npm install
```

### 3. 编译 TypeScript

```bash
npm run build
```

### 4. 运行

```bash
# 设置环境变量
export AUTH_TOKEN=your-secure-token
export PORT=8082
export DATA_DIR=/path/to/data
# 默认不配置时使用本地 SQLite（DATA_DIR/woclaw.sqlite）
# 如需 MySQL：
# export DB_TYPE=mysql
# export MYSQL_HOST=127.0.0.1
# export MYSQL_PORT=3306
# export MYSQL_USER=woclaw
# export MYSQL_PASSWORD=secret
# export MYSQL_DATABASE=woclaw

# 运行
npm start
```

### 5. 验证

```bash
# 检查进程
curl -I http://localhost:8082
# 应返回: HTTP/1.1 426 Upgrade Required

# 查看日志
tail -f /var/log/woclaw.log
```

## 🔧 systemd 服务（Linux）

### 安装服务

```bash
# 以 root 身份执行
cp woclaw-hub.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable woclaw-hub
systemctl start woclaw-hub
```

### 服务管理

```bash
# 启动
systemctl start woclaw-hub

# 停止
systemctl stop woclaw-hub

# 重启
systemctl restart woclaw-hub

# 查看状态
systemctl status woclaw-hub

# 查看日志
journalctl -u woclaw-hub -f
```

## 🌐 部署到云服务器

### your-hub-host 示例

```bash
# 1. SSH 到服务器
ssh root@your-server

# 2. 安装 Docker（如未安装）
curl -fsSL https://get.docker.com | sh

# 3. 克隆并运行
git clone https://github.com/XingP14/woclaw.git
cd woclaw/hub
docker build -t xingp14/woclaw-hub:latest .
docker run -d \
  --name woclaw-hub \
  -p 8082:8082 \
  -e AUTH_TOKEN=your-token \
  --restart unless-stopped \
  xingp14/woclaw-hub:hub/v0.3.0
```

### Nginx 反向代理（可选）

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:8082;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

## ☸️ Kubernetes 部署

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: woclaw-hub
spec:
  replicas: 1
  selector:
    matchLabels:
      app: woclaw-hub
  template:
    metadata:
      labels:
        app: woclaw-hub
    spec:
      containers:
      - name: woclaw-hub
        image: xingp14/woclaw-hub:latest
        ports:
        - containerPort: 8082
        env:
        - name: AUTH_TOKEN
          value: "your-secure-token"
        - name: PORT
          value: "8082"
        volumeMounts:
        - name: data
          mountPath: /data
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: woclaw-data
---
apiVersion: v1
kind: Service
metadata:
  name: woclaw-hub
spec:
  type: LoadBalancer
  ports:
  - port: 80
    targetPort: 8082
  selector:
    app: woclaw-hub
```

## ⚙️ 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 8082 | WebSocket 端口 |
| `REST_PORT` | 8083 | REST API 端口 |
| `HOST` | 0.0.0.0 | 绑定地址 |
| `DATA_DIR` | /data | 本地 SQLite 数据目录基址 |
| `DB_TYPE` | sqlite | 存储后端：`sqlite` 或 `mysql` |
| `SQLITE_PATH` | /data/woclaw.sqlite | SQLite 文件路径 |
| `MYSQL_HOST` | — | MySQL 主机 |
| `MYSQL_PORT` | 3306 | MySQL 端口 |
| `MYSQL_USER` | — | MySQL 用户 |
| `MYSQL_PASSWORD` | — | MySQL 密码 |
| `MYSQL_DATABASE` | — | MySQL 数据库名 |
| `AUTH_TOKEN` | change-me | 认证 Token |
| `TLS_KEY` | — | TLS 私钥文件路径（设置后启用 wss:// + https://） |
| `TLS_CERT` | — | TLS 证书文件路径（设置后启用 wss:// + https://） |

### 配置示例

```bash
# 生产环境
export AUTH_TOKEN=$(openssl rand -hex 32)
export PORT=8082
export DATA_DIR=/data/woclaw
export HOST=0.0.0.0
# 默认将数据写入 /data/woclaw/woclaw.sqlite
```

## 🔐 TLS/SSL 加密连接

Hub 支持 TLS 加密（`wss://` + `https://`），适用于外部网络访问或安全要求高的场景。

### 生成自签名证书

```bash
# 在服务器上生成
mkdir -p /opt/woclaw/certs
openssl req -x509 -newkey rsa:2048 \
  -keyout /opt/woclaw/certs/key.pem \
  -out /opt/woclaw/certs/cert.pem \
  -days 365 -nodes \
  -subj "/CN=your-hub-host/O=WoClaw"
```

### 启动 TLS Hub

```bash
# 方式 1：环境变量
TLS_KEY=/opt/woclaw/certs/key.pem \
TLS_CERT=/opt/woclaw/certs/cert.pem \
AUTH_TOKEN=your-token \
PORT=8082 \
REST_PORT=8083 \
node dist/index.js

# 方式 2：systemd service 文件
Environment="TLS_KEY=/opt/woclaw/certs/key.pem"
Environment="TLS_CERT=/opt/woclaw/certs/cert.pem"
```

### 客户端连接示例

```javascript
// Node.js WebSocket 客户端
import WebSocket from 'ws';

const ws = new WebSocket('wss://your-hub-host:8082?agentId=my-agent&token=your-token', {
  // 测试环境可信任自签名证书
  rejectUnauthorized: false,
});

// 或显式指定 CA 证书
import { readFileSync } from 'fs';
const ws = new WebSocket('wss://your-hub-host:8082?agentId=my-agent&token=your-token', {
  ca: readFileSync('/path/to/cert.pem'),
});
```

### OpenClaw 插件 TLS 配置

```json
{
  "channels": {
    "woclaw": {
      "url": "wss://your-hub-host:8082"
    }
  }
}
```

### 使用 Nginx 反代（生产环境推荐）

Nginx 统一管理证书，Hub 保持明文（内网安全）：

```nginx
server {
    listen 8443 ssl;
    server_name your-domain.com;

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



1. **使用强 Token** - 生产环境务必使用随机生成的强 Token
2. **启用防火墙** - 只允许必要的端口访问
3. **使用 TLS** - 生产环境建议配合 Nginx 使用 HTTPS
4. **定期备份** - 定期备份 `/data` 目录
5. **监控日志** - 关注异常访问日志

## 🐛 常见问题

### Q: 端口被占用？
```bash
# 检查端口占用
lsof -i :8082

# 更换端口（尝试不同的 REST 端口）
export REST_PORT=8084
```

### Q: 无法连接？
```bash
# 检查防火墙
ufw status

# 开放端口
ufw allow 8082/tcp
```

### Q: 数据丢失？
- 检查 `/data` 目录权限
- 确认磁盘空间充足
- 定期备份数据文件

## 📞 获取帮助

- GitHub Issues: https://github.com/XingP14/woclaw/issues
- 文档: https://github.com/XingP14/woclaw#readme
