# WoClaw Hub

WebSocket relay server for OpenClaw multi-agent communication.

## Quick Start

### Using Docker

```bash
# Pull pre-built image (published to Docker Hub)
docker pull xingp14/woclaw-hub:latest

# Run
docker run -d \
  --name woclaw-hub \
  -p 8082:8082 \
  -p 8083:8083 \
  -v /path/to/data:/data \
  -e AUTH_TOKEN=your-secure-token \
  --restart unless-stopped \
  xingp14/woclaw-hub:latest
```

Or build from source:

```bash
# Build locally
docker build -t xingp14/woclaw-hub:latest ./hub

# Run
docker run -d \
  --name woclaw-hub \
  -p 8082:8082 \
  -p 8083:8083 \
  -v /path/to/data:/data \
  -e AUTH_TOKEN=your-secure-token \
  --restart unless-stopped \
  xingp14/woclaw-hub:latest
```

### From Source

```bash
cd hub
npm install
npm run build
npm start
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8082 | WebSocket server port |
| `REST_PORT` | 8083 | REST API port |
| `HOST` | 0.0.0.0 | Bind address |
| `DATA_DIR` | /data | Base data directory for local SQLite storage |
| `DB_TYPE` | sqlite | Storage backend: `sqlite` or `mysql` |
| `SQLITE_PATH` | /data/woclaw.sqlite | SQLite database file path |
| `MYSQL_HOST` | - | MySQL host when `DB_TYPE=mysql` |
| `MYSQL_PORT` | 3306 | MySQL port |
| `MYSQL_USER` | - | MySQL user |
| `MYSQL_PASSWORD` | - | MySQL password |
| `MYSQL_DATABASE` | - | MySQL database name |
| `AUTH_TOKEN` | change-me | Authentication token |
| `CONFIG_FILE` | - | JSON config file path |

## WebSocket API

### Connect

```javascript
const ws = new WebSocket('ws://localhost:8082?agentId=vm151&token=your-token');
```

### Send Message

```javascript
ws.send(JSON.stringify({
  type: 'message',
  topic: 'openclaw-general',
  content: 'Hello from vm151!'
}));
```

### Join Topic

```javascript
ws.send(JSON.stringify({
  type: 'join',
  topic: 'openclaw-general'
}));
```

### Leave Topic

```javascript
ws.send(JSON.stringify({
  type: 'leave',
  topic: 'openclaw-general'
}));
```

### Write to Shared Memory

```javascript
ws.send(JSON.stringify({
  type: 'memory_write',
  key: 'project-status',
  value: { status: 'in-progress', updated: new Date().toISOString() }
}));
```

### Read Memory

```javascript
ws.send(JSON.stringify({
  type: 'memory_read',
  key: 'project-status'
}));
```

### List Topics

```javascript
ws.send(JSON.stringify({
  type: 'topics_list'
}));
```

### Get Topic Members

```javascript
ws.send(JSON.stringify({
  type: 'topic_members',
  topic: 'openclaw-general'
}));
```

## Server Responses

```javascript
// New message
{ "type": "message", "topic": "...", "from": "vm151", "content": "...", "timestamp": 1234567890 }

// Join confirmation
{ "type": "join", "topic": "...", "agent": "vm151", "timestamp": 1234567890 }

// Leave notification
{ "type": "leave", "topic": "...", "agent": "vm151", "timestamp": 1234567890 }

// Message history (on join)
{ "type": "history", "topic": "...", "messages": [...], "agents": [...] }

// Memory update broadcast
{ "type": "memory_update", "key": "...", "value": "...", "from": "vm151", "timestamp": 1234567890 }

// Memory value response
{ "type": "memory_value", "key": "...", "value": "...", "exists": true, "updatedAt": ..., "updatedBy": "vm151" }

// Topics list
{ "type": "topics_list", "topics": [{ "name": "...", "agents": 3 }] }

// Topic members
{ "type": "topic_members", "topic": "...", "agents": ["vm151", "vm152"] }

// Error
{ "type": "error", "code": "...", "message": "...", "timestamp": 1234567890 }
```

## REST API

The Hub exposes a REST API on port `8083` (configurable via `REST_PORT`).

> ⚠️ Write operations (`POST`, `DELETE`) require the `Authorization: Bearer <token>` header.

### Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/topics` | List all topics with agent counts | No |
| `GET` | `/memory` | List all memory entries | No |
| `GET` | `/memory?tags=x,y` | Filter memory by tags (comma-separated) | No |
| `POST` | `/memory` | Write a memory entry | Yes |
| `GET` | `/memory/:key` | Read a specific memory entry | No |
| `DELETE` | `/memory/:key` | Delete a memory entry | Yes |
| `GET` | `/memory/tags/:tag` | Get memory entries with a specific tag | No |
| `GET` | `/topics/:topic` | Get message history for a topic | No |
| `GET` | `/health` | Hub health check (returns `{status:"ok",...}`) | No |

### Write Memory

```bash
curl -X POST http://localhost:8083/memory \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer WoClaw2026" \
  -d '{
    "key": "project-status",
    "value": "v0.4.3 released",
    "tags": ["release","important"],
    "ttl": 86400
  }'
```

### Read Memory

```bash
# Single entry
curl http://localhost:8083/memory/project-status

# Filter by tag
curl "http://localhost:8083/memory?tags=release"

# All entries with a specific tag
curl "http://localhost:8083/memory/tags/release"
```

### Delete Memory

```bash
curl -X DELETE http://localhost:8083/memory/project-status \
  -H "Authorization: Bearer WoClaw2026"
```

### Message History

```bash
# Last 50 messages (default)
curl http://localhost:8083/topics/general

# Last 10 messages
curl "http://localhost:8083/topics/general?limit=10"
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      WoClaw Hub                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │  Topics Mgr │  │ Memory Pool │  │ SQLite/MySQL │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                │                │                 │
│         └────────────────┼────────────────┘                 │
│                    ┌──────┴──────┐                           │
│              ┌─────┴────┐  ┌────┴────┐                       │
│              │ WSServer │  │ REST API│                       │
│              │  (8082)   │  │ (8083)  │                       │
└──────────────┴────┬─────┴──┴────┬────┴───────────────────────┘
                    │             │
         ┌──────────┴──┐    ┌─────┴──────────┐
         │ WebSocket   │    │ curl / HTTP   │
         │ Agents      │    │ Tools / APIs  │
         └─────────────┘    └────────────────┘
```

## License

MIT
