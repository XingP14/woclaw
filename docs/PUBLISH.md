# Publishing to ClawHub - Step by Step Guide

> ClawHub is the public skill registry for OpenClaw

## Published Packages

| Package | Version | Status | Registry |
|---------|---------|--------|----------|
| `xingp14-woclaw` | 0.3.0 | ✅ Done | [npm](https://www.npmjs.com/package/xingp14-woclaw) |
| `woclaw-hub` | 0.3.0 | ✅ Done | [npm](https://www.npmjs.com/package/woclaw-hub) |
| `woclaw-mcp` | 0.1.2 | ✅ Done | [npm](https://www.npmjs.com/package/woclaw-mcp) |
| `woclaw-hooks` | 0.3.1 | ✅ Done | [npm](https://www.npmjs.com/package/woclaw-hooks) |
| `opencode-woclaw` | 0.1.0 | 🔲 Not published | npm |
| WoClaw Skill | — | ⏳ Blocked | ClawHub (~2026-04-13) |
| Docker Hub | latest | ✅ Done | [Docker Hub](https://hub.docker.com/r/xingp14/woclaw-hub) |

## npm Publishing Guide

### `xingp14-woclaw` (Plugin + Skill)

```bash
cd plugin
HOME=/home/node/.openclaw/tmp npm publish
```

### `woclaw-hub` (Server)

```bash
cd hub
HOME=/home/node/.openclaw/tmp npm publish
```

### npm Token

Token stored in GitHub Actions secrets: `NPM_TOKEN`

## ClawHub Publishing

### Prerequisites
- GitHub account connected to ClawHub
- Account age ≥ 14 days

**Estimated ready:** ~2026-04-13 (GitHub account created 2026-03-30, needs 14 days)

```bash
clawhub login
clawhub sync --all
```

## Docker Hub Publishing

### Build
```bash
cd hub
docker build -t xingp14/woclaw-hub:latest ./hub
docker tag xingp14/woclaw-hub:latest xingp14/woclaw-hub:0.1.0
```

### Login
```bash
docker login
```

### Push
```bash
docker push xingp14/woclaw-hub:latest
docker push xingp14/woclaw-hub:0.1.0
```

## GitHub Actions Auto-Sync

✅ **CI/CD Fully Configured** (2026-04-01):
- ✅ Auto-publish to npm on tag (`plugin/v*` → `xingp14-woclaw`, `hub/v*` → `woclaw-hub`, `hooks/v*` → `woclaw-hooks`)
- ✅ Auto-build and push Docker image on `hub/v*` tag
- ⏳ Auto-sync to ClawHub — pending GitHub account age ≥14 days (~2026-04-13)

## Current Status

- [x] Fix npm publish readiness (ESM, dist structure) - 2026-03-31
- [x] npm publish `xingp14-woclaw@0.3.0` - 2026-04-01
- [x] npm publish `woclaw-hub@0.2.0` - 2026-04-01
- [x] npm publish `woclaw-mcp@0.1.2` (via GitHub Actions)
- [x] npm publish `woclaw-hooks@0.3.1` (via GitHub Actions)
- [x] Set up GitHub Actions CI/CD (publish.yml, hub-publish.yml, docker-publish.yml)
- [x] Docker Hub credentials configured (DOCKERHUB_USERNAME + DOCKERHUB_TOKEN)
- [ ] Trigger Docker Hub publish (push `hub/v*` tag to GitHub)
- [ ] Publish to ClawHub (`clawhub sync`) — blocked until GitHub account age ≥14 days (~2026-04-13, GitHub created 2026-03-30)
