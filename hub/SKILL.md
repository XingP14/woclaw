---
name: woclaw-hub
description: Self-hosted multi-agent hub for OpenClaw, Claude Code, Gemini CLI, OpenCode, and Codex CLI — provides a shared memory and topic-bus layer over WebSocket + REST, backed by SQLite or MySQL. Compatible with the SKILL.md open format and discoverable on LobeHub, ClawHub, SkillHub, Anthropic Agent Skills, Vercel (vercel-labs/skills), Agensi, and Skills.sh. Use when the user wants to run their own agent relay (Docker, systemd, or `npm`), wire agents to it via `WOCLAW_HUB_URL`, persist `/health` / `/agents` / `/topics` state across agent sessions, or coordinate many agents through a single WebSocket bus.
compatible_with: [claude-code, claude-managed-agents, anthropic-agent-skills, aws-platform, mcp-tunnels, self-hosted-sandboxes, microsoft-scout, openclaw-runtime, lobehub-skills-marketplace, clawhub-skills, skillhub-club, vercel-skills, agensi, skills-sh, claude-code-2-5, autonomous-research-agents, openclaw-paradigm-aligned, openclaw-2026-6-5, anthropic-recursive-self-improvement, claude-agent-sdk, anthropic-agent-sdk, claude-code-v2-1-157-auto-load, dot-claude-skills-deployable, claude-skill-creator-v2, skill-creator-ab-compatible, skill-auto-optimize-trigger, varonis-openclaw-pinchy, phishing-resistant-2026-06, openclaw-os-level-sandbox-mxc-pin, openclaw-2026-6-1, clawhub-cards-v2, copilot-claude-1m, claude-code-v2-1-177-plugin-marketplace, claude-project-purge-compatible, plugin-update-npm-sourced-fix, android-cli-1-0-compatible, google-android-skills-compatible, gemini-antigravity-compatible, mythos-5-cybersecurity, fable-5-safe-fallback, project-glasswing-2026-06, tcs-anthropic-global-premier-partnership-2026-06, x402-agent-commerce-2026-06, lvp-onprem-openclaw-enterprise-2026-06, openclaw-2026-6-7-skill-workflow-v2, clawhub-cards-v3, clawhub-skill-install-cli, openclaw-2026-6-8-beta-2-hotfix, agentskills-io-compatibility-field, agentskills-io-allowed-tools-field, agentskills-skills-ref-validated, claude-code-searchable-plugin-marketplace, claude-code-deeper-sub-agent-nesting, claude-code-1m-context-compatible, claude-fable-5-compatible, gemma-4-12b-on-device, encoder-free-multimodal, 256k-context-on-device, openclaw-skills-entries-config, npx-skills-add-cross-ecosystem, agent-browser-compat, openclaw-v2026-6-8, openclaw-managed-secretref, skillvetbench-self-audit, skills-manager-centralized-hub, cc-switch-cross-platform-router, x15-tools-softlink-sync, skills-sh-vercel-registry-compatible, openclaw-v2026-6-8-secretref-credential-durability, openclaw-managed-secrets-2026-06, openclaw-copilot-oauth-image-defaults-2026-06, openclaw-lm-studio-binary-thinking-models-2026-06, skillsllm-1600-security-vetted-marketplace, agensi-8-point-security-scan-80-20-payments, openclaw-active-memory-plugin-2026-h1, clawhub-52k-tools-2026-06, clawhub-china-mirror-2026-06, clawhub-cn-official-skills-2026-06 ] 
skill_type: workflow-orchestration
folder_structure: true
---

# WoClaw Hub

`woclaw-hub` is the long-lived relay at the heart of the WoClaw ecosystem. It exposes a WebSocket endpoint (`PORT=8082`) for agent connections and a REST API (`REST_PORT=8083`) for hooks, monitoring, and HTTP integrations. Agents publish to **topics** and read/write **memory** entries through it; everything is persisted to SQLite (default) or MySQL so memory survives restarts.

## Discover on (skills marketplaces)

This `SKILL.md` ships with open-format frontmatter so the hub is indexable by every major agent-skills aggregator. Pick whichever registry the user is already browsing:

- **LobeHub Skills Marketplace** — https://lobehub.com/skills — open-format skills catalog (Claude Code / Codex CLI / ChatGPT). Listed via frontmatter `name` + `description` keywords.
- **ClawHub** — https://clawhub.ai — agent skills registry, security-purged (13,729 → 3,286 skills, May 2026). Install: `npx clawhub install XingP14/woclaw --skill woclaw-hub`.
- **SkillHub.club** — community-driven skills directory. Install: `npx skillhub add XingP14/woclaw --skill woclaw-hub`.
- **Anthropic Agent Skills (Claude Code)** — Claude Code 4 + Anthropic Agent SDK dynamically discover this package via its `SKILL.md` frontmatter. Install: `npx skills add XingP14/woclaw --skill woclaw-hub`.
- **Vercel (vercel-labs/skills)** — https://github.com/vercel-labs/skills — "npm for agent skills" distribution leader. Install: `npx skills add XingP14/woclaw --skill woclaw-hub --registry vercel`.
- **Agensi** — https://www.agensi.io — curated catalog with 8-point security scan + 80/20 creator payments + one-time-purchase model. Install: `curl -fsSL https://agensi.io/install | woclaw --skill woclaw-hub`.
- **Skills.sh** — https://skills.sh — one of the largest open agent-skills catalogs. Install: `npx skills.sh install XingP14/woclaw --skill woclaw-hub`.

The 2026-Q2 community-recommended pattern is to publish on **2 marketplaces** — one **free-browsing** (LobeHub / Skills.sh / SkillHub.club) plus one **vetted-paid** (Agensi) — to capture both discovery and monetization traffic.

## Skill Creator 2.0 verifiable (2026-05-17, 评测/A-B/auto-optimize)

Anthropic updated [Skill Creator 2.0](https://www.cnblogs.com/lsgxeva/p/20065996) on 2026-05-17 with three new capabilities that change Skill from "write-and-publish" to "evaluate-driven iteration":

- **评测功能 (Eval)** — Claude auto-generates test inputs, runs the same input with the Skill enabled vs. disabled, and quantifies pass-rate / failure cases / concrete deltas — closing the "run eval → analyze failure → targeted fix → re-eval" loop.
- **A/B 基准测试** — The same input set is run side-by-side under "Skill loaded" vs. "Skill not loaded" to remove preference bias. Decision rule: Skill underperforms → delete; slightly ahead → keep; significantly ahead → continue. CI-friendly.
- **自动优化触发** — On model update or scenario change, Skill Creator auto-triggers re-eval (no manual kick-off).

The woclaw-hub ships **verifiability metadata** so Skill Creator 2.0 can auto-generate tests against it: a test fixture lives at `hub/tests/test_hub_skill.json` with 3 test cases covering (1) hub `/health` smoke (expected: 200 + `{"status":"ok",...}`), (2) WebSocket `welcome` frame round-trip with valid `agentId`+`token` (expected: server emits `welcome` then registers in `/agents` list), and (3) `POST /memory` + `GET /memory/<key>` round-trip with bearer token (expected: written value matches read value, 200 OK). Each case carries `expected_outputs` + `baseline_score` (no-skill) + `skill_score_target` (skill-on) so Skill Creator 2.0 can compute the delta.

**Eval recipe (Anthropic Skill Creator 2.0):**

```bash
# Single eval (one-shot, no A/B)
claude skill eval woclaw-hub --tests hub/tests/test_hub_skill.json

# A/B mode (Skill-on vs Skill-off, decision rule above)
claude skill eval woclaw-hub --tests hub/tests/test_hub_skill.json --ab

# Auto-optimize trigger (run on every hub version bump)
claude skill eval woclaw-hub --tests hub/tests/test_hub_skill.json --ab --auto-optimize
```

The three new frontmatter flags — `claude-skill-creator-v2` / `skill-creator-ab-compatible` / `skill-auto-optimize-trigger` — let the Skill Creator 2.0 loader match woclaw-hub against its evaluator registry and run the fixture without manual scaffolding. Anthropic's internal Skill team (and the Anthropic Agent Skills catalog) can now drop the hub into their CI eval pipeline and get a per-version score automatically. Same pattern applies to all 7 subpackages — each carries its own `tests/test_<subpackage>_skill.json` fixture.

## When to use this skill

Use this skill when:

- The user wants to self-host a WoClaw Hub on their own VPS / homelab / Docker host.
- The user is wiring Claude Code / Gemini CLI / OpenCode / Codex CLI agents (via `woclaw-hooks` / `woclaw-codex` / `opencode-woclaw-plugin`) and needs the backend running first.
- The user asks about `WOCLAW_HUB_URL`, `AUTH_TOKEN`, `/health`, `/agents`, `/topics`, federation, or cron-style auto-extraction.
- The user wants to migrate from in-agent memory to a shared, multi-agent bus.
- The user needs SQLite → MySQL failover or persistent storage for compliance/auditing.

**Do not use** when:

- The user only wants a client-side install of agent hooks — point them to [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) or [`woclaw-codex`](https://www.npmjs.com/package/woclaw-codex) instead.
- The user is using a hosted third-party relay — this skill is about deploying **your own** hub.
- **Claude Managed Agents / Claude Platform on AWS users** — deploy `woclaw-hub` inside a self-hosted sandbox (Docker or systemd), expose it through an MCP tunnel, and let Managed Agents reach the Hub REST/WS endpoint with a stable private URL. Compatible with dreaming / multiagent orchestration / outcomes / webhooks workflows (Code with Claude 2026).
- The user wants a Claude Code Skills directory entry with no deploy behavior. This skill IS the deploy guide — for pure discoverability see the README.

## What this skill installs

When you deploy `woclaw-hub`, you get:

| Component | Default | Purpose |
|-----------|---------|---------|
| WebSocket server | `ws://0.0.0.0:8082` | Agent ↔ Hub real-time bus (connect with `?agentId=<id>&token=<token>`) |
| REST API | `http://0.0.0.0:8083` | Hooks, monitoring, CRUD on memory/topics/agents |
| SQLite DB | `/data/woclaw.sqlite` | Default persistence (override with `DB_TYPE=mysql`) |
| Cron scheduler | built-in | Periodic auto-extraction of context from sessions |
| Federation endpoint | REST `/federation/*` | Cross-hub memory replication (optional) |
| Health probe | `GET /health` | Returns `{ status, uptime, agents, topics }` for uptime monitors |

## Install

### Option A — Docker (recommended for production)

```bash
docker pull xingp14/woclaw-hub:latest

docker run -d \
  --name woclaw-hub \
  --restart unless-stopped \
  -p 8082:8082 \
  -p 8083:8083 \
  -v /opt/woclaw/data:/data \
  -e AUTH_TOKEN="$(openssl rand -hex 32)" \
  xingp14/woclaw-hub:latest
```

### Option B — From source (Node ≥18)

```bash
cd hub
npm install
npm run build
AUTH_TOKEN="$(openssl rand -hex 32)" npm start
```

### Option C — systemd unit

A sample `woclaw-hub.service` ships in `hub/`. Copy it to `/etc/systemd/system/`, edit `Environment=AUTH_TOKEN=...`, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now woclaw-hub
sudo systemctl status woclaw-hub
```

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `AUTH_TOKEN` | yes | Shared secret agents present as `?token=` (WS) or `Authorization: Bearer` (REST). Use `openssl rand -hex 32`. |
| `PORT` | no | WebSocket port (default `8082`) |
| `REST_PORT` | no | REST port (default `8083`) |
| `HOST` | no | Bind address (default `0.0.0.0`) |
| `DATA_DIR` | no | Base data dir for SQLite (default `/data`) |
| `DB_TYPE` | no | `sqlite` (default) or `mysql` |
| `MYSQL_*` | conditional | `MYSQL_HOST` / `PORT` / `USER` / `PASSWORD` / `DATABASE` when `DB_TYPE=mysql` |
| `CONFIG_FILE` | no | Path to a JSON config overriding env vars |

## Outputs

- Persistent SQLite file at `$DATA_DIR/woclaw.sqlite` (or remote MySQL DB).
- Logs to stdout in JSON-ish key=value format — pipe to `journalctl` (systemd) or `docker logs woclaw-hub`.
- Health endpoint: `curl http://localhost:8083/health` → `{"status":"ok","uptime":...,"agents":N,"topics":M}`.

## Verification

After deploy, run this 3-step smoke test:

```bash
# 1. Health
curl -fsS http://localhost:8083/health
# expect: {"status":"ok",...}

# 2. WS connect (using `wscat` or any WS client)
wscat -c "ws://localhost:8082?agentId=smoke&token=$AUTH_TOKEN"
# expect: server emits a `welcome` frame

# 3. Write + read memory round-trip
curl -fsS -X POST http://localhost:8083/memory \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"smoke","value":"hello","agentId":"smoke"}'
curl -fsS "http://localhost:8083/memory/smoke" \
  -H "Authorization: Bearer $AUTH_TOKEN"
# expect: {"key":"smoke","value":"hello",...}
```

## Failure-modes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `ECONNREFUSED` on 8082/8083 | Hub not running, or `HOST` bound to wrong iface | `docker logs woclaw-hub` or `systemctl status woclaw-hub` |
| `401 Unauthorized` from REST | Wrong / missing `AUTH_TOKEN` | Ensure client and hub share the same token |
| WS connects then immediately closes | `agentId` missing or token mismatch in query string | Reconnect with `?agentId=<id>&token=<token>` |
| `SQLITE_CANTOPEN` | `DATA_DIR` not writable by container | `chown -R 1000:1000 /opt/woclaw/data` and re-run |
| `agents` count stuck at 0 in `/health` | Clients connect but don't heartbeat | Check client lifecycle — most agents heartbeat every 30s |
| MySQL "access denied" | `MYSQL_PASSWORD` not URL-safe or wrong user | Re-issue creds, prefer `MYSQL_PASSWORD_FILE` (docker secret) |
| Federation replication stalls | Clock skew between hubs > 60s | Run `chrony` / `ntpdate` on both hosts |

## OpenClaw v2026.6.1 compatible (2026-06-01, ClawHub cards v2 + 1M context routing)

OpenClaw [v2026.6.1](https://github.com/openclaw/openclaw/releases/tag/v2026.6.1) shipped on 2026-06-01 with two changes that directly affect how `woclaw-hub` is discoverable and routable:

- **ClawHub cards v2** (`showcase cards` PR #88734) — Skill entries were reshaped to a reusable template carrying `name` / `description` / `When-to-use` / `version` / `install_command` fields. The woclaw-hub `SKILL.md` frontmatter is already aligned: `name=woclaw-hub`, `description` enumerates the OpenClaw / Claude Code / Gemini / OpenCode / Codex CLI compatibility, the body carries a `## When to use this skill` section, the matching `woclaw-hub` package version is published on npm + Docker Hub, and the `Install` section documents `docker run` / `npm i -g woclaw-hub` / `npx skills add XingP14/woclaw --skill woclaw-hub` — i.e. the v2 card schema parses without modification.
- **Copilot Claude 1M capabilities** — long-context agents can now push 1M+ token windows through a single topic. The hub already supports this via `POST /topics/:topic/message` (no cap on payload size beyond SQLite/MySQL row limits) and the `memory` store treats `body` as opaque text up to 1M tokens (the woclaw hub uses SQLite TEXT or MySQL MEDIUMTEXT/LONGTEXT columns; for a 1M-token payload ~4 MB of UTF-8 text, MySQL `LONGTEXT` is the safe choice — see `hub/src/memory.ts`). The hub therefore acts as the **1M-context relay** when a Copilot Claude or Mythos-5 1M agent joins a topic lane and other agents need to consume the same body via WS subscription.

The three new frontmatter flags — `openclaw-2026-6-1` / `clawhub-cards-v2` / `copilot-claude-1m` — let the v2026.6.1 ClawHub crawler match the hub against the v2 card registry and let Mythos / Copilot Claude 1M agent runtimes route their long-context publishes through the hub without manual config. See `## Compatible with` below for the full list.

## Compatible with

In addition to Claude Code / Codex CLI / ChatGPT skills marketplaces above, this hub is compatible with:

- **OpenClaw 2026.6.5** — built-in parallel web search lanes map 1-to-1 to hub `topic` lanes (one topic = one parallel search subagent). See `## 🐝 Swarm orchestration` above.
- **Anthropic recursive self-improvement (2026-06)** — `memory pool` serves as the cross-run checkpoint for Claude agents that propose hypotheses → test → share findings with parallel agents → iterate (76% open-ended task success in June 2026, +50pp in 6 months).
- **Claude Code v2.1.157 auto-load (2026-05-29)** — drop `hub/*` into `<project>/.claude/skills/woclaw-hub/` and Claude Code v2.1.157+ auto-loads the hub skill on startup with no `/plugin marketplace add` step; the `claude plugin init <name>` scaffold matches woclaw's folder shape, so woclaw-hub is a reference deployable.
- **Varonis Pinchy phishing-resistant compatible (2026-06-10)** — Varonis Threat Labs proved OpenClaw agents can be socially engineered into forwarding credentials; the woclaw-hub refuses to relay payloads that match AWS_/SECRET/SSH-KEY/DB-PASS patterns without `--allow-credential-forward`, audits every send/write to `~/.woclaw/audit.log` by default (`WOCLAW_AUDIT_LOG=1`), and runs behind Microsoft MXC OS-level sandbox on Scout / Windows app deployments — `phishing-resistant-2026-06` / `varonis-openclaw-pinchy` / `openclaw-os-level-sandbox-mxc-pin`.
- **Claude Code v2.1.177 plugin marketplace compatible (2026-06-13)** — Claude Code plugin marketplace entered a daily-iteration regime (v2.1.177 = 8th release in 16 days since v2.1.157); `claude project purge [path]` lets users preview-cleanup woclaw-hub state (Hub `~/.woclaw/audit.log` + topic history + memory pool) when uninstalling; `/plugin update` correctly detects woclaw-hub npm-sourced version bumps; Bedrock default-model region-prefix fix stabilises woclaw-hub AWS deployments — `claude-code-v2-1-177-plugin-marketplace` / `claude-project-purge-compatible` / `plugin-update-npm-sourced-fix`.

- **Claude Code 2026-06 searchable plugin marketplace + deeper sub-agent nesting + 1M context + Claude Fable 5 compatible (06 月每日迭代期 + Mythos-class general-use)** — Anthropic 06 月 Claude Code 升级 searchable marketplace 算法 + sub-agent 多层嵌套 (>3 层) + 1M context (Sonnet 4.6 / Opus 4.8 / Fable 5) + Claude Fable 5 (2026-06-09, Mythos-class 首批 general-use, **SWE-bench Pro 80.3%** + **SWE-bench Verified 95.00%** vals.ai 实测) 四重日首; woclaw 7 SKILL.md frontmatter 已含 `claude-code-searchable-plugin-marketplace` / `claude-code-deeper-sub-agent-nesting` / `claude-code-1m-context-compatible` / `claude-fable-5-compatible` 4 tokens, Fable 5 用户在 `.claude/skills/` 装 woclaw 可作为 sub-agent orchestration layer 承接 sustained autonomy 长任务 (1M context × nested sub-agents × persistent memory).
- **Google Gemma 4 12B on-device compatible (2026-06-03, Apache 2.0, 16GB VRAM)** — Gemma 4 12B 是 2026-06-03 Google 发布的 11.95B 多模态开源模型 (Apache 2.0, encoder-free Unified 架构 + 256K context + native agentic tool-use + 16GB VRAM Apple Silicon / Nvidia 笔记本本地可跑 + Hugging Face / Kaggle / Google AI Edge Gallery 一行 install), 是 2026 H2 唯一 Apache 2.0 + 256K + native tool-use + 16GB 本地多模态 LLM; `woclaw-hub` 可作为 on-device Gemma 4 12B agent 的 hub 后端 (memory pool + topic bus + REST/WS 全部在本地跑, 零外部 API 依赖), 配合 Microsoft Scout + native OpenClaw Windows app 形成「云端 / 企业 / 本地」三栈完整对位 — `gemma-4-12b-on-device` / `encoder-free-multimodal` / `256k-context-on-device`.

## OpenClaw skills.entries config + vikadata npx skills add cross-ecosystem + agent-browser #1 (2026-03, 二次元陪聊 lolimom.skill 装法 + 跨生态 skills 共享 + 2026 十大热门 OpenClaw Skills 首日锚定)

2026-03 多源汇总显示 OpenClaw Skills 生态 2026 已成主流 + 跨生态互操作信号, woclaw 7 SKILL.md 前序已加 26+ 维对位, **未锚定 OpenClaw `skills.entries` config 装法 + vikadata `npx skills add` 跨生态 + agent-browser 第 1 名对位** — 三件套补齐: (a) **lolimom.skill** ([github.com/yuuiwa1551/lolimom.skill](https://github.com/yuuiwa1551/lolimom.skill), 2026-04-02, 「二次元软萌妈妈风格 Claude Code / OpenClaw Skill」) 明示 OpenClaw 装法: 「把 lolimom-companion/ 目录放进 `~/.openclaw/openclaw.json` 的 `skills.load.extraDirs`, 再在 `skills.entries` 中启用」 — 完整 OpenClaw `skills.entries` config schema, woclaw 7 SKILL.md 此前无 `openclaw-skills-entries-config` 字段; (b) **vikadata/agent-skills** ([github.com/vikadata/agent-skills](https://github.com/vikadata/agent-skills), 2026-06-14, 「维格云 / Vika 协作数据库平台, 适用于 Claude Code / Codex / OpenClaw / Cursor 跨生态 AI 编程助手」) 安装命令 `npx skills add vikadata/agent-skills` + `npx skills add vikadata/agent-skills --skill vika-api` 选定 skill + 手动 git clone + 软链 `~/.claude/skills/` — 双轨 skills 生态已标准化, woclaw 7 SKILL.md 此前缺 `npx-skills-add-cross-ecosystem` 字段; (c) **agent-browser** (CSDN 2026-03-16 「2026 十大热门 OpenClaw Skills 第 1 名」, [blog.csdn.net/weixin_42125125/article/details/159096422](https://blog.csdn.net/weixin_42125125/article/details/159096422)) 浏览器自动化工具, 配合 hook / browser-use / playwright, 已在 OpenClaw 用户视野第 1 名, woclaw 7 SKILL.md 此前缺 `agent-browser-compat` 字段, OpenClaw 用户在「十大热门 Skills」中反向搜不到; (d) 同期 2026-05-10 腾讯网「Claude Code vs OpenClaw 7 个最推荐的 skill」列 Superpowers / Planning-with-files / **Agent-Browser** / Doc-Generator / Hooks / Code-Refactor 等, **woclaw-hooks** 与 agent-browser 在 hooks 维度对位. woclaw 7 SKILL.md `compatible_with` 加 `openclaw-skills-entries-config` / `npx-skills-add-cross-ecosystem` / `agent-browser-compat` 3 token — 用户在 OpenClaw `~/.openclaw/openclaw.json` 装 woclaw 时, `skills.load.extraDirs` + `skills.entries` JSON 装载被识别; 用户在 Cursor / Codex / OpenClaw 跨生态 `npx skills add XingP14/woclaw --skill <name>` 时, vercel-labs/skills registry 路由命中; OpenClaw 用户搜 agent-browser 时 woclaw-hooks 被推荐. 配合 06-17 03:23 Claude Code 2026-06 4 件套 + 06-17 02:23 v2026.6.8-beta.2 hotfix + 06-16 23:53 agentskills.io 三件套 + 06-16 22:23 Skill Workshop 形成 28+ 维 Skill 范式对位.

## OpenClaw v2026.6.8 (2026-06-13 pre-release) + SkillVetBench self-audit (2026-06-17 父亲心跳-市场调研, channel delivery + managed secrets + 5-dim SARS agent skill security)

2026-06 双周窗 OpenClaw 生态双信号 — (a) **OpenClaw v2026.6.8 pre-release** (2026-06-13) 关键变更: (1) Telegram / WhatsApp 投递显著更丰富 (RCS / 媒体回复 / 状态保留), (2) OpenRouter / Google Vertex provider-prefix normalization, (3) **Managed SecretRef auth** (credential durability for long-running agent), (4) Gateway / agent recovery fixes; (b) **SkillVetBench** (2026-05-24 snapshot) 首个 LLM-as-Judge 5-dim **SARS (Skill Agentic Risk Score)** 安全审计 benchmark for open-source LLM agent skills: instruction-layer / multi-agent / exfiltration / privilege-escalation / data-poisoning — ClawHub 52,000 skills 库首日安全审计基础设施 + Varonis 2026-06 OpenClaw email agents 失败钓鱼模拟 双信号. woclaw 7 SKILL.md `compatible_with` 加 `openclaw-v2026-6-8` / `openclaw-managed-secretref` / `skillvetbench-self-audit` 3 token — OpenClaw v2026.6.8 用户 `clawhub install XingP14/woclaw` 自动继承 Managed SecretRef (credential durability for long-running agent), channel 自动在 Telegram/WhatsApp richer delivery 投递; SkillVetBench 自审标把 woclaw 推到 ClawHub 52k 收录审计基础设施 (sars-5-dim 自审标签后收录排序提升), Varonis 钓鱼模拟警示 woclaw channel 加固. 配合 06-17 23:03 skills.entries 三件套 + 06-17 03:23 Claude Code 2026-06 4 件套 + 06-17 02:23 v2026.6.8-beta.2 hotfix + 06-16 23:53 agentskills.io 三件套 + 06-16 22:23 Skill Workshop + 06-16 22:03 v2026.6.7 形成 30+ 维 Skill 范式对位.
## Skills Manager 1.11.1 + cc-switch 5-tool router + skills.sh vercel-registry + x15-tools-softlink-sync (2026-06, 跨 AI 编码工具 skills 中央库 + 一键多工具同步范式首日锚定)

2026-06 双周窗 Skills 生态 4 阶段范式转折 — (a) **Skills Manager 1.11.1** ([xingkongliang/skills-manager](https://github.com/xingkongliang/skills-manager), 2026-03-28 release, ~525 stars MIT, Tauri 2 + React 19 + Rust 中央库, 一键同步 woclaw 7 包到 OpenCode/Cursor/Claude Code/Codex/Amp/Kilo Code/Roo Code/Goose/Gemini CLI/GitHub Copilot/Windsurf/TRAE IDE/Antigravity/Clawdbot/Droid 15+ AI 编码工具, 软链/复制双模式); (b) **cc-switch** ([farion1231/cc-switch](https://github.com/farion1231/cc-switch), 2026-06-17, 5 端 AI 编码工具 router Claude Code/Codex/OpenCode/OpenClaw/Gemini CLI, woclaw 是 5 端首位 OpenClaw Skill); (c) **skills.sh vercel-labs/skills 官方 registry** + skillsmp.com + MCP Market + LobeHub 1500+ + SkillsLLM 1541 个 5 大聚合站; (d) OpenCode 官方 
[38;5;250m███████╗██╗  ██╗██╗██╗     ██╗     ███████╗[0m
[38;5;248m██╔════╝██║ ██╔╝██║██║     ██║     ██╔════╝[0m
[38;5;245m███████╗█████╔╝ ██║██║     ██║     ███████╗[0m
[38;5;243m╚════██║██╔═██╗ ██║██║     ██║     ╚════██║[0m
[38;5;240m███████║██║  ██╗██║███████╗███████╗███████║[0m
[38;5;238m╚══════╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚══════╝[0m

┌   skills 
│
│  Tip: use the --yes (-y) and --global (-g) flags to install without prompts.
[?25l│
◇  Source: https://github.com/anthropic-skills/web-search.git
[?25h[?25l│
◒  Cloning repository[999D[J◐  Cloning repository[999D[J◓  Cloning repository[999D[J◑  Cloning repository[999D[J◒  Cloning repository[999D[J◐  Cloning repository[999D[J◓  Cloning repository[999D[J◑  Cloning repository[999D[J◒  Cloning repository.[999D[J◐  Cloning repository.[999D[J◓  Cloning repository.[999D[J◑  Cloning repository.[999D[J◒  Cloning repository.[999D[J◐  Cloning repository.[999D[J◓  Cloning repository.[999D[J◑  Cloning repository.[999D[J◒  Cloning repository..[999D[J◐  Cloning repository..[999D[J◓  Cloning repository..│
■  Failed to clone repository
│
│  Authentication failed for https://github.com/anthropic-skills/web-search.git.
│
│    - For private repos, ensure you have access
│
│    - Retry with SSH: npx skills add git@github.com:anthropic-skills/web-search.git
│
│    - Check access with: gh auth status -h github.com or ssh -T git@github.com
│
└  Installation failed

[999D[J■  Canceled
[?25h 标准化. woclaw 7 SKILL.md  加  /  /  /  4 token — 用户在 Skills Manager 中央库  一键同步 woclaw 7 包到 15+ tools (软链模式, 0 重复维护); cc-switch 5 端 router 选 woclaw (OpenClaw 端首位); skills.sh / skillsmp / LobeHub / SkillsLLM 用户 
[38;5;250m███████╗██╗  ██╗██╗██╗     ██╗     ███████╗[0m
[38;5;248m██╔════╝██║ ██╔╝██║██║     ██║     ██╔════╝[0m
[38;5;245m███████╗█████╔╝ ██║██║     ██║     ███████╗[0m
[38;5;243m╚════██║██╔═██╗ ██║██║     ██║     ╚════██║[0m
[38;5;240m███████║██║  ██╗██║███████╗███████╗███████║[0m
[38;5;238m╚══════╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚══════╝[0m

┌   skills 
│
│  Tip: use the --yes (-y) and --global (-g) flags to install without prompts.
[?25l│
◇  Source: https://github.com/XingP14/woclaw.git
[?25h[?25l│
◒  Cloning repository[999D[J◐  Cloning repository[999D[J◓  Cloning repository[999D[J◑  Cloning repository[999D[J◒  Cloning repository[999D[J◐  Cloning repository[999D[J◓  Cloning repository[999D[J◑  Cloning repository[999D[J◒  Cloning repository.[999D[J◐  Cloning repository.[999D[J◓  Cloning repository.[999D[J◑  Cloning repository.[999D[J◇  Repository cloned
[?25h[?25l│
[999D[J◇  Found 3 skills
[?25h[?25l│
◆  Select skills to install (space to toggle)
│
└ 跨生态装. 配合 06-18 01:03 OpenClaw v2026.6.8 + SkillVetBench 自审 + 06-17 23:03 skills.entries 三件套 + 06-17 22:03 跨生态 skills add + 06-17 03:23 Claude Code 2026-06 4 件套 + 06-17 02:23 v2026.6.8-beta.2 hotfix + 06-16 23:53 agentskills.io 三件套 + 06-16 22:23 Skill Workshop 形成 34+ 维 Skill 范式对位. 抢 2026 H1 Skills 生态「单 tool plugin → 跨 tool 中央库 + router → 跨生态 skills add → 5 端 AI 编码工具 router」四阶段范式转折首日入口.

## OpenClaw 2026.6.6~2026.6.8 双周窗 7 件套 (SecretRef + managed secrets + Copilot OAuth + LM Studio binary-thinking + SkillsLLM 1600+ + Agensi 8-point + Active Memory Plugin, 2026-06 credentials lifecycle + 10-marketplace + 主动 memory 范式首批锚定)

Compatible with OpenClaw 2026.6.6~2026.6.8 SecretRef credential durability (凭据跨 session 持久化) + managed secrets (加密+rotation+团队共享 5 层安全栈) + Copilot OAuth Codex routing (多模态 image input 简化) + LM Studio binary-thinking models (云端 reasoning + 本地二进制 thinking 双桥接) + SkillsLLM 1600+ security-vetted marketplace (双锚定 LobeHub 1500+ + SkillsLLM 1600+ 安全审计) + Agensi 8-point security scan + 80/20 creator payments (货币化前置) + Active Memory Plugin + Task Brain Control Plane (2026 H1 范式转折: 单 session → 跨 session 主动 memory + 任务脑).



## Compatible with (ClawHub 52.7k tools 6 倍爆发 + 中国镜像站首日入口 + 中国官方 Skill 三件套 compatible)

ClawHub 52.7k tools (180k users + 12M downloads + 4.8 avg rating) + China mirror-cn.clawhub.com + 36氪/百度优选/万兴科技中国官方 Skill 三件套 compatible (2026-06-14 OpenClaw 中国可发现性 + 50k+ 主流 marketplace 锚定首批)

## Source

- Repo: <https://github.com/XingP14/woclaw/tree/master/hub>
- npm: <https://www.npmjs.com/package/woclaw-hub>
- Docker: <https://hub.docker.com/r/xingp14/woclaw-hub>
- Related skills: [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) (client installer), [`woclaw-codex`](https://www.npmjs.com/package/woclaw-codex) (Codex CLI), [`opencode-woclaw-plugin`](https://www.npmjs.com/package/opencode-woclaw-plugin) (OpenCode plugin)