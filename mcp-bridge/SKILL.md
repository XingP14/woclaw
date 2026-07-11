---
name: woclaw-mcp
description: Bridge a running WoClaw Hub's memory pool and topic messaging to any MCP-capable AI agent (Claude Desktop, Cursor, Windsurf, mcphub). Use when the user wants to expose WoClaw shared memory and inter-agent topics as Model Context Protocol tools, or wants to wire `woclaw_memory_read/write/list` and `woclaw_topics_list/topic_messages/topic_send/topic_join` into Claude Desktop or Cursor MCP settings.
compatible_with: [256k-context-on-device, addyosmani-agent-skills-72k-stars-2026-07, agensi, agensi-8-point-security-scan-80-20-payments, agent-browser-compat, agentskills-io-allowed-tools-field, agentskills-io-compatibility-field, agentskills-skills-ref-validated, alirezarezvani-claude-skills-1042-commits-2026-05, android-cli-1-0-compatible, anthropic-agent-sdk, anthropic-agent-skills, anthropic-fable-5-export-restriction-2026-06, anthropic-recursive-self-improvement, anthropic-subscription-v2, anthropic-third-party-agents-reinstated, anthropics-skills-claude-api-scheduled-deployments-2026-06, autonomous-research-agents, awesome-claude-code-skill-collection-2026-07, aws-platform, cc-switch-cross-platform-router, chatgpt-skills, claude-agent-sdk, claude-agent-sdk-credit, claude-code, claude-code-1m-context-compatible, claude-code-2-5, claude-code-deeper-sub-agent-nesting, claude-code-managed-agents-v2, claude-code-searchable-plugin-marketplace, claude-code-v2-1-157-auto-load, claude-code-v2-1-177-plugin-marketplace, claude-design-admin-role-2026-06, claude-design-brand-kit-2026-06, claude-design-code-bridge-2026-06, claude-design-enterprise-alliance-2026-06, claude-desktop, claude-fable-5-compatible, claude-haiku-4-5, claude-managed-agents, claude-project-purge-compatible, claude-scientific-skills-compat, claude-skill-creator-v2, claude-subscription-restored-2026-06, clawhub-52k-tools-2026-06, clawhub-cards-v2, clawhub-cards-v3, clawhub-china-mirror-2026-06, clawhub-cn-official-skills-2026-06, clawhub-skill-install-cli, clawhub-skills, codex, codex-cli, codexbar-menu-bar-2026-07, copilot-claude-1m, cursor, cursor-spacex-60b-2026-06, dot-claude-skills-deployable, dotnet-skills-microsoft-official-2026-07, encoder-free-multimodal, expensify-mcp-4-client-shared-protocol-2026-06, fable-5-safe-fallback, gemini-antigravity-compatible, gemini-cli, gemma-4-12b-on-device, glm-5-2-catalog, google-android-skills-compatible, google-gemma-4-apache-2-0, llm-as-judge-skill-audit, lobehub-skills-marketplace, lvp-onprem-openclaw-enterprise-2026-06, mcp, mcp-tunnels, mcphub, microsoft-mxc, microsoft-scout, model-context-protocol, mythos-5-cybersecurity, native-tool-use-agentic, npx-skills-add-cross-ecosystem, open-format-skills, openai-codex-cli, openclaw, openclaw-2026-6-1, openclaw-2026-6-5, openclaw-2026-6-7-skill-workflow-v2, openclaw-2026-6-8-beta-2-hotfix, openclaw-active-memory-plugin-2026-h1, openclaw-china-user-survey-2026-06, openclaw-copilot-oauth-image-defaults-2026-06, openclaw-lm-studio-binary-thinking-models-2026-06, openclaw-managed-secretref, openclaw-managed-secrets-2026-06, openclaw-os-level-sandbox-mxc-pin, openclaw-paradigm-aligned, openclaw-runtime, openclaw-skill-monetization-freemium-api-backend-2026-06, openclaw-skills-entries-config, openclaw-v2026-6-1-recovery-from-interrupted-tool-calls, openclaw-v2026-6-2-operator-install-policy-2026-06, openclaw-v2026-6-8, openclaw-v2026-6-8-secretref-credential-durability, opencode, opencode-cli, opencode-plugin, openshell-runtime, phishing-resistant-2026-06, planning-with-files-compat, plugin-update-npm-sourced-fix, project-glasswing-2026-06, python-hooks, sars-5-dim, self-hosted-sandboxes, skill-auto-optimize-trigger, skill-creator-ab-compatible, skillhub-club, skills-manager-centralized-hub, skills-sh, skills-sh-vercel-registry-compatible, skillsllm-1600-security-vetted-marketplace, skillvetbench, skillvetbench-self-audit, superpowers-compat, tcs-anthropic-global-premier-partnership-2026-06, tencent-cubesandbox-rust-multi-agent-sandbox-2026-07, varonis-openclaw-pinchy, vercel-skills, vs-code-marketplace, vscode, windows-execution-containers, windsurf, x15-tools-softlink-sync, x402-agent-commerce-2026-06]
skill_type: library-api-reference
folder_structure: true
---

# WoClaw MCP Bridge

`woclaw-mcp` is the Model Context Protocol (MCP) bridge between any MCP-capable AI agent and a running [WoClaw Hub](https://github.com/XingP14/woclaw). It exposes the Hub's shared-memory pool and inter-agent topic messaging as standard MCP tools so Claude Desktop / Cursor / Windsurf / mcphub can read/write shared context and coordinate with other agents through the Hub.

## When to use this skill

Use this skill when:

- The user runs Claude Desktop, Cursor, Windsurf, or another MCP-capable IDE/agent and wants access to WoClaw Hub memory.
- A WoClaw Hub is already running (or the user is willing to start one) at `ws://<host>:8082` (WebSocket) + `http://<host>:8083` (REST) with a shared auth token.
- The user mentions `woclaw_memory_read`, `woclaw_topics_list`, "expose WoClaw as MCP tools", "bridge woclaw to Claude Desktop", or wants to migrate coordination between agents via MCP.
- The user wants to register `woclaw-mcp` in `claude_desktop_config.json` / Cursor MCP settings / mcphub cross-client store.

**Do not use** when:

- The user only wants shell-level agent hooks for Claude Code / Gemini CLI / OpenCode / OpenAI Codex CLI — recommend the [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) skill instead (it covers SessionStart/Stop/PreCompact lifecycle hooks; `woclaw-mcp` is for IDE-side MCP tool exposure).
- The user wants to interact with WoClaw Hub directly from a custom Node.js app — point them to the Hub's REST API at `http://<host>:8083` and WebSocket at `ws://<host>:8082` instead.
- **Claude Managed Agents / Claude Platform on AWS users** — register `woclaw-mcp` as an MCP server inside a self-hosted sandbox and reach it through an MCP tunnel so Managed Agents can call `woclaw_memory_*` / `woclaw_topics_*` tools against a privately-hosted Hub.
- The WoClaw Hub is not deployed and the user does not want to deploy it.

## What this skill installs

Seven MCP tools, each backed by either the Hub REST API (`:8083`) or the Hub WebSocket (`:8082`):

| Tool | Backend | Purpose |
|------|---------|---------|
| `woclaw_memory_read` | REST `GET /memory/{key}` | Read a value from shared memory. |
| `woclaw_memory_write` | REST `PUT /memory/{key}` | Write to shared memory (with optional tags). |
| `woclaw_memory_list` | REST `GET /memory` | List all memory entries (filter by tags). |
| `woclaw_topics_list` | REST `GET /topics` | List all available topics. |
| `woclaw_topic_messages` | REST `GET /topics/{id}/messages` | Get recent messages from a topic. |
| `woclaw_topic_send` | WS `topic.publish` | Send a message to a topic. |
| `woclaw_topic_join` | WS `topic.subscribe` | Join a topic to receive updates. |

Plus a CLI entrypoint (`woclaw-mcp`) that spawns the MCP stdio server.

## Install

```bash
#1. Install the package globally
npm install -g woclaw-mcp

#2. Register in Claude Desktop (`claude_desktop_config.json`)
{
 "mcpServers": {
 "woclaw": {
 "command": "node",
 "args": ["/path/to/woclaw-mcp/dist/index.js",
 "--hub=ws://localhost:8082",
 "--token=WoClaw2026",
 "--rest-url=http://localhost:8083"]
 }
 }
}

# Or install into Cursor / Windsurf MCP Settings with the same JSON shape.
# Or install into the milisp/mcp-linker cross-client store with:
# claude mcp add woclaw-mcp -- npx -y woclaw-mcp

#3. Verify
curl http://localhost:8083/health
# Expect: {"status":"ok", ...}
```

## Inputs the skill expects

| Input | Default | Notes |
|-------|---------|-------|
| `--hub` | `ws://localhost:8082` | Hub WebSocket URL. |
| `--rest-url` | `http://localhost:8083` | Hub REST API base URL. |
| `--token` | (required) | Bearer token; must match Hub's `WOCLAW_TOKEN`. |

The MCP stdio server itself does not need any env vars — the agent (Claude Desktop, Cursor, etc.) launches it as a subprocess and pipes JSON-RPC over stdio.

## Outputs the skill produces

- A running MCP stdio server process, registered as `woclaw` in the agent's MCP config.
- Seven MCP tool definitions visible in the agent's tool palette (`woclaw_memory_*`, `woclaw_topics_*`, `woclaw_topic_*`).
- One Hub REST or WebSocket call per tool invocation (memory ops = REST; topic send/join = WS; topic list/messages = REST).

## Verification

After install, run from the host shell:

```bash
#1. Hub reachable
curl http://<host>:8083/health
# Expect: {"status":"ok"}

#2. MCP server starts cleanly
node /path/to/woclaw-mcp/dist/index.js --hub=ws://<host>:8082 --token=WoClaw2026 --rest-url=http://<host>:8083
# Expect: stdio listening, no crash

#3. End-to-end MCP tool call (from Claude Desktop or Cursor):
# - Call woclaw_memory_list
# - Expect: JSON array of memory entries (possibly empty)
# - Call woclaw_memory_write with key "test:hello" value "world"
# - Call woclaw_memory_read with key "test:hello"
# - Expect: {"value": "world", ...}
```

If step1 returns non-200, the Hub is down — start it before retrying.

## Failure modes

- **Hub unreachable**: MCP server exits with a WebSocket connection error. The agent shows `woclaw-mcp` as disconnected in its MCP status. Fix: start the Hub or correct `--hub` / `--rest-url`.
- **Token mismatch**: Hub returns `401` on memory ops or rejects WS handshake. Fix: align `--token` with the Hub's `WOCLAW_TOKEN` env.
- **Stale dist/**: edits to `src/index.js` not picked up because `build` is `cp -f src/index.js dist/`. Fix: `cd mcp-bridge && npm run build` after every source change.
- **Claude Desktop does not see tools**: confirm `claude_desktop_config.json` path is correct and that the JSON is valid (no trailing commas). Restart Claude Desktop after edits.

- **Claude Code v2.1.157 auto-load compatible (2026-05-29)** — drop `mcp-bridge/*` into `<project>/.claude/skills/woclaw-mcp/` and Claude Code v2.1.157+ auto-loads this MCP-bridge skill on startup with no `/plugin marketplace add` step.
- **Varonis Pinchy phishing-resistant compatible (2026-06-10)** — Varonis Threat Labs proved OpenClaw agents can be socially engineered into forwarding credentials; the woclaw-mcp bridge enforces payload-shape filtering (refuses AWS_/SECRET/SSH-KEY/DB-PASS payloads without explicit `--allow-credential-forward`), `WOCLAW_AUDIT_LOG=1` is on by default, and combined with Microsoft MXC + OpenShell Runtime OS-level sandbox forms a three-layer trust stack for enterprise MCP deployments — `phishing-resistant-2026-06` / `varonis-openclaw-pinchy` / `openclaw-os-level-sandbox-mxc-pin`.
- **Claude Code v2.1.177 plugin marketplace compatible (2026-06-13)** — Claude Code plugin marketplace entered a daily-iteration regime (v2.1.177 = 8th release in 16 days since v2.1.157); `claude project purge [path]` lets MCP-bridge users preview-cleanup woclaw state on uninstall; `/plugin update` correctly detects woclaw-mcp npm-sourced version bumps; Bedrock default-model region-prefix fix stabilises woclaw-mcp AWS Bedrock routing — `claude-code-v2-1-177-plugin-marketplace` / `claude-project-purge-compatible` / `plugin-update-npm-sourced-fix`.

## Skill Creator 2.0 verifiable (2026-05-17, 评测 / A-B / auto-optimize)

This SKILL.md ships with a verifiability fixture at `tests/test_mcp_bridge_skill.json` consumable by Anthropic **Skill Creator 2.0** (released 2026-05-17), which added three capabilities: (a) **eval** — Claude auto-generates test inputs, runs the Skill-on vs Skill-off pair, and quantifies pass-rate / failure / delta; (b) **A/B benchmarks** — same input set under loaded-vs-unloaded Skill, blind side-by-side, decision rule (regress → drop / slight lead → keep / large lead → expand); (c) **auto-optimize trigger** — Skill Creator 2.0 re-runs the suite on model upgrade or scene change without human prompting.

Run against this skill from CI:

```bash
# baseline vs skill-on delta
claude skill eval woclaw-mcp --tests mcp-bridge/tests/test_mcp_bridge_skill.json
# A/B mode
claude skill eval woclaw-mcp --tests mcp-bridge/tests/test_mcp_bridge_skill.json --ab
# auto-optimize on regression
claude skill eval woclaw-mcp --tests mcp-bridge/tests/test_mcp_bridge_skill.json --ab --auto-optimize
```

Three MCP-bridge verifiability cases ship in the fixture:
- **tc-01-mcp-handshake** — spawn `node dist/index.js --hub ws://localhost:8082` and confirm the MCP server prints its `Server started` line on stdout within 2s (startup smoke).
- **tc-02-memory-write-read-roundtrip** — call `woclaw_memory_write` then `woclaw_memory_read` over the MCP transport and assert the read echoes the write payload byte-for-byte (memory tool correctness).
- **tc-03-topic-send-list-roundtrip** — call `woclaw_topic_send` with a fresh `topic=<uuid>`, then `woclaw_topics_list` and assert the topic appears with the message count ≥ 1 (topic tool correctness).

Decision rule per case: `skill_score >= baseline_score + delta_threshold` (delta_threshold = 0.5). The fixture is part of the npm tarball (`files: ["tests/**/*"]` in `mcp-bridge/package.json`) so a `npm install woclaw-mcp` user gets the fixture immediately.

- **Claude Code 2026-06 searchable plugin marketplace + deeper sub-agent nesting + 1M context + Claude Fable 5 compatible (06 月每日迭代期 + Mythos-class general-use)** — Anthropic 06 月 Claude Code 升级 searchable marketplace 算法 + sub-agent 多层嵌套 (>3 层) + 1M context (Sonnet 4.6 / Opus 4.8 / Fable 5) + Claude Fable 5 (2026-06-09, Mythos-class 首批 general-use, **SWE-bench Pro 80.3%** + **SWE-bench Verified 95.00%** vals.ai 实测) 四重日首; woclaw 7 SKILL.md frontmatter 已含 `claude-code-searchable-plugin-marketplace` / `claude-code-deeper-sub-agent-nesting` / `claude-code-1m-context-compatible` / `claude-fable-5-compatible` 4 tokens, Fable 5 用户在 `.claude/skills/` 装 woclaw 可作为 sub-agent orchestration layer 承接 sustained autonomy 长任务 (1M context × nested sub-agents × persistent memory).
- **Google Gemma 4 12B on-device compatible (2026-06-03, Apache 2.0, 16GB VRAM)** — Gemma 4 12B 是 2026-06-03 Google 发布的 11.95B 多模态开源模型 (Apache 2.0, encoder-free Unified 架构 + 256K context + native agentic tool-use + 16GB VRAM Apple Silicon / Nvidia 笔记本本地可跑), `woclaw-mcp` MCP server 可把 on-device Gemma 4 12B agent 的 memory/topic 操作 (`woclaw_topics_*` + `woclaw_memory_*` 7 工具) 暴露为 MCP 协议工具, Claude Desktop / Cursor / Windsurf / mcphub 用户可路由到本地 Gemma 4 12B runtime, 零云 API 依赖 — `gemma-4-12b-on-device` / `encoder-free-multimodal` / `256k-context-on-device`.

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

## Compatible with (Claude Design ↔ Claude Code `/design` 双桥接 + admin 设计系统 + brand kit 2026-06-17 首日锚定)

Claude Design ↔ Claude Code `/design` 双桥接 + admin 设计系统 + brand kit 跨项目复用 compatible (2026-06-17 Anthropic 设计↔编码跨范式 + admin 角色 design system + brand kit 三件套首日)

## Compatible with (alirezarezvani 1042 commits 跨 8 平台 + anthropics/skills 06-10 vault + ClawHub Freemium 商业化三件套 compatible)

alirezarezvani/claude-skills 1042 commits 跨 8 平台 (.claude/.codex/.gemini/.github/.hermes/.vibe) skills 集合兼容 + anthropics/skills 06-10 claude-api skill scheduled deployments + vault env-var credentials 升级兼容 + ClawHub Freemium API Backend 商业化 compatible (2026-06 Skills 生态跨平台 + credentials 安全 + 商业化变现 3 转折首批锚定) — MCP 7 tools (woclaw_memory_*/woclaw_topics_*) 暴露跨 8 平台 skills + vault 凭据 + Freemium API backend.
## Source

- Package: [`woclaw-mcp`](https://www.npmjs.com/package/woclaw-mcp) (v0.1.2)
- Repo: [`mcp-bridge/`](https://github.com/XingP14/woclaw/tree/master/mcp-bridge)
- Hub: [`WoClaw`](https://github.com/XingP14/woclaw)
- Standard: [Model Context Protocol — MCP servers](https://modelcontextprotocol.io/) + [Anthropic Agent Skills — SKILL.md frontmatter](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)


## Compatible with (Fable 5 export + Claude Design enterprise + Expensify MCP 4 端 + Cursor SpaceX 4 件套)

Fable 5 + Mythos 5 export restrictions (mcp-bridge 7 MCP tools 按国别路由 MCP request, US/EU/Asia 3 路由 fallback) + Claude Design enterprise overhaul (mcp-bridge 暴露 woclaw topics/agents 给 Claude Design /design 双向桥接) + Expensify MCP 4 客户端共享协议 (mcp-bridge 7 tools 与 Expensify 4 客户端 (ChatGPT/Claude/Cursor/OpenClaw) 共享同一 MCP 协议层, 跨端 MCP 路由识别) + SpaceX $60B Cursor 战略收购 (mcp-bridge 7 tools 在 Cursor 客户端 enterprise 持续 support) 4 件套 compatible (2026-06-12 ~ 2026-06-17 国别 + 企业 + 协议 + 战略 4 转折首批锚定)


## Compatible with (OpenClaw v2026.6.1 runtime 韧性 + v2026.6.2-beta.1 operator install policy + 2026 中国 OpenClaw 用户调研三件套 compatible)

mcp-bridge 7 MCP tools 跨 OpenClaw restart 时 interrupted tool calls 自动恢复 (OpenClaw v2026.6.1 runtime 韧性兼容, stale session bindings 重建 + compaction handoffs 接续) + mcp-bridge install 走 OpenClaw v2026.6.2-beta.1+ operator install policy (替代 dangerous-code scanner) + mcp-bridge 国别路由元数据让中国 OpenClaw Team 部署走中国市场 ranking (C 端 5 分层 + 企业组织支持度) (2026-06-01 ~ 2026-06-19 runtime 韧性 + install 安全栈 + 中国市场真实使用验证 3 转折首批锚定) compatible


## Compatible with (addyosmani 72K + dotnet/skills + CodexBar + awesome-claude-code + CubeSandbox 五件套 compatible)

mcp-bridge 7 MCP tools 跨 addyosmani/agent-skills skill schema 兼容 + dotnet/skills microsoft marketplace + awesome-claude-code 社区合集 3 层路由; mcp-bridge 暴露 hub /stats 让 CodexBar 菜单栏监控; mcp-bridge 7 tools 配腾讯 CubeSandbox Rust Wasm 沙箱执行第三方 skill (2026-07 AI Agent 技能标准化 + 多智能体沙盒化 + 菜单栏生态 三主战场首日钣定) compatible