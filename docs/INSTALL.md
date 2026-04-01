# WoClaw 安装指南

## 环境要求

- **Node.js**: 18.0 或更高
- **Docker**: 20.10+ (可选，用于容器部署)
- **网络**: Hub 端口 8082/8083 需要可达

## 🐳 Docker 部署

### 从 Docker Hub 拉取（推荐）

```bash
# 拉取最新版本
docker pull xingp14/woclaw-hub:hub/v0.3.0

# 运行
docker run -d \
  --name woclaw-hub \
  -p 8082:8082 \
  -p 8083:8083 \
  -v /path/to/data:/data \
  -e AUTH_TOKEN=your-secure-token \
  --restart unless-stopped \
  xingp14/woclaw-hub:hub/v0.3.0
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
    image: xingp14/woclaw-hub:hub/v0.3.0
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

### vm153 示例

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
        image: xingp14/woclaw-hub:hub/v0.3.0
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
| `DATA_DIR` | /data | 数据存储目录 |
| `AUTH_TOKEN` | change-me | 认证 Token |

### 配置示例

```bash
# 生产环境
export AUTH_TOKEN=$(openssl rand -hex 32)
export PORT=8082
export DATA_DIR=/data/woclaw
export HOST=0.0.0.0
```

## 🔒 安全建议

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
