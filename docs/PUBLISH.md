# Publishing to ClawHub - Step by Step Guide

> ClawHub is the public skill registry for OpenClaw

## Prerequisites

1. Node.js 18+
2. GitHub account connected to ClawHub
3. Your skill/plugin ready for publishing

## Option 1: Publish as OpenClaw Skill

### Prepare Your Skill

```
plugin/skills/clawlink/
└── SKILL.md    # Required - skill definition
```

Your SKILL.md should look like:

```markdown
---
name: clawlink
description: Connect to ClawLink hub for multi-agent communication
tags:
  - communication
  - multi-agent
  - collaboration
---

# ClawLink Skill

Connect your OpenClaw agent to ClawLink...

## Commands

### /clawlink join <topic>
Join a topic/channel...

## Configuration

Set up in your openclaw.json...
```

### Publish via CLI

```bash
# Install clawhub CLI
npm i -g clawhub

# Login with GitHub
clawhub login

# Sync/publish your skill
clawhub sync --all
```

## Option 2: Publish as npm Package

### Prepare package.json

```json
{
  "name": "@clawlink/hub",
  "version": "0.1.0",
  "description": "ClawLink Hub - WebSocket relay for OpenClaw",
  "main": "dist/index.js",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  },
  "keywords": ["openclaw", "multi-agent", "communication"],
  "license": "MIT",
  "publishConfig": {
    "access": "public"
  }
}
```

### Publish to npm

```bash
# Login to npm
npm login

# Publish
npm publish
```

## Option 3: Docker Hub

```bash
# Build
docker build -t clawlink/hub:latest ./hub

# Tag
docker tag clawlink/hub:latest clawlink/hub:0.1.0

# Login
docker login

# Push
docker push clawlink/hub:latest
docker push clawlink/hub:0.1.0
```

## Current Status

| Target | Status | Notes |
|--------|--------|-------|
| GitHub | ✅ Done | https://github.com/XingP14/clawlink |
| npm | 📋 Planned | Waiting for v0.2 |
| ClawHub | 📋 Planned | Need to prepare skill bundle |
| Docker Hub | 📋 Planned | Need Docker Hub account |

## TODO

- [ ] Create ClawHub account / Connect GitHub
- [ ] Prepare skill bundle (SKILL.md + metadata)
- [ ] Test local installation
- [ ] Publish to ClawHub
- [ ] Set up auto-sync GitHub Actions
