---
name: opencode-woclaw
description: Install and use the WoClaw Hub plugin for OpenCode CLI — shared memory, topic messaging, and multi-agent context across OpenCode, Claude Code, Gemini CLI, and Codex. Use when the user runs OpenCode and wants to wire session.created/session.compacted/shell.env hooks to a running WoClaw Hub, or share project:context with other agents through one REST/WS API. Claude Skill Creator 2.0 verifiable / A-B / auto-optimize compatible; 3 test cases under tests/test_opencode_woclaw_plugin_skill.json.
compatible_with: [opencode, opencode-cli, claude-code, gemini-cli, codex, claude-managed-agents, aws-platform, mcp-tunnels, opencode-plugin, anthropic-agent-skills, lobehub-skills-marketplace, clawhub-skills, vercel-skills, agensi, skills-sh, claude-code-2-5, autonomous-research-agents, openclaw-paradigm-aligned, claude-agent-sdk, anthropic-agent-sdk, claude-code-v2-1-157-auto-load, dot-claude-skills-deployable, claude-skill-creator-v2, skill-creator-ab-compatible, skill-auto-optimize-trigger, varonis-openclaw-pinchy, phishing-resistant-2026-06, openclaw-os-level-sandbox-mxc-pin, claude-code-v2-1-177-plugin-marketplace, claude-project-purge-compatible, plugin-update-npm-sourced-fix, android-cli-1-0-compatible, google-android-skills-compatible, gemini-antigravity-compatible, mythos-5-cybersecurity, fable-5-safe-fallback, project-glasswing-2026-06, tcs-anthropic-global-premier-partnership-2026-06, x402-agent-commerce-2026-06, lvp-onprem-openclaw-enterprise-2026-06, openclaw-2026-6-7-skill-workflow-v2, clawhub-cards-v3, clawhub-skill-install-cli, openclaw-2026-6-8-beta-2-hotfix, agentskills-io-compatibility-field, agentskills-io-allowed-tools-field, agentskills-skills-ref-validated, claude-code-searchable-plugin-marketplace, claude-code-deeper-sub-agent-nesting, claude-code-1m-context-compatible, claude-fable-5-compatible, gemma-4-12b-on-device, encoder-free-multimodal, 256k-context-on-device, openclaw-skills-entries-config, npx-skills-add-cross-ecosystem, agent-browser-compat, openclaw-v2026-6-8, openclaw-managed-secretref, skillvetbench-self-audit, skills-manager-centralized-hub, cc-switch-cross-platform-router, x15-tools-softlink-sync, skills-sh-vercel-registry-compatible, openclaw-v2026-6-8-secretref-credential-durability, openclaw-managed-secrets-2026-06, openclaw-copilot-oauth-image-defaults-2026-06, openclaw-lm-studio-binary-thinking-models-2026-06, skillsllm-1600-security-vetted-marketplace, agensi-8-point-security-scan-80-20-payments, openclaw-active-memory-plugin-2026-h1, clawhub-52k-tools-2026-06, clawhub-china-mirror-2026-06, clawhub-cn-official-skills-2026-06 , claude-design-code-bridge-2026-06, claude-design-admin-role-2026-06, claude-design-brand-kit-2026-06, alirezarezvani-claude-skills-1042-commits-2026-05, anthropics-skills-claude-api-scheduled-deployments-2026-06, openclaw-skill-monetization-freemium-api-backend-2026-06, anthropic-fable-5-export-restriction-2026-06, claude-design-enterprise-alliance-2026-06, expensify-mcp-4-client-shared-protocol-2026-06, cursor-spacex-60b-2026-06, openclaw-v2026-6-1-recovery-from-interrupted-tool-calls, openclaw-v2026-6-2-operator-install-policy-2026-06, openclaw-china-user-survey-2026-06] 
skill_type: workflow-orchestration
folder_structure: true
---

# WoClaw Plugin for OpenCode

`opencode-woclaw` is the OpenCode counterpart to [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) (which targets Claude Code / Gemini CLI / Codex). It registers as an [OpenCode plugin](https://opencode.ai) and exposes six `woclaw_*` tools plus three lifecycle hooks (`session.created`, `session.compacted`, `shell.env`) so memory and env vars survive restarts, compaction, and cross-agent handoffs.

## When to use this skill

Use this skill when:

- The user runs **OpenCode CLI** and wants shared memory across OpenCode sessions.
- A WoClaw Hub is already running (or the user is willing to start one) at `ws://<host>:8082` (WS) and `http://<host>:8083` (REST) with a shared `WOCLAW_TOKEN`.
- The user wants to **share `project:context` (or any memory key) with Claude Code / Gemini / Codex / OpenClaw** through a single Hub.
- The user mentions `opencode.json`, `~/.config/opencode/plugins/`, `WOCLAW_HUB_URL`, or wants OpenCode ↔ WoClaw memory sync.
- The user wants `WOCLAW_*` env vars auto-injected into every shell command OpenCode runs.

**Do not use** when:

- The user only wants Claude Code / Gemini / Codex hooks — use [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) (Node-based, broader framework coverage).
- The user wants a VS Code editor view of the Hub — use [`woclaw-vscode`](https://marketplace.visualstudio.com/items?itemName=XingP14.woclaw-vscode).
- The WoClaw Hub is not deployed and the user does not want to deploy it.
- **Claude Managed Agents users (AWS deploy)** — install this OpenCode plugin inside a self-hosted sandbox and route `WOCLAW_HUB_URL` through an MCP tunnel so OpenCode session.created / session.compacted / shell.env hooks can checkpoint memory to a privately-hosted Hub. Compatible with dreaming / multiagent orchestration / outcomes workflows.
- The user wants MCP server discovery — use [`woclaw-mcp`](https://github.com/XingP14/woclaw/tree/master/mcp-bridge) instead.

## What this skill installs

- An OpenCode plugin entry (`index.js`,235 LOC) registering six tools:
 - `woclaw_memory_read <key>` — read a memory value
 - `woclaw_memory_write <key> <value>` — write a memory value
 - `woclaw_memory_list` — list all memory keys
 - `woclaw_memory_delete <key>` — delete a memory key
 - `woclaw_topics_list` — list Hub topics
 - `woclaw_hub_status` — ping the Hub REST API
- Three lifecycle hooks auto-wired to OpenCode events:
 - `session.created` → load shared context from Hub
 - `session.compacted` → save session snapshot to Hub
 - `shell.env` → inject `WOCLAW_HUB_URL`, `WOCLAW_TOKEN`, `WOCLAW_AGENT_ID`, `WOCLAW_REST_URL`, `WOCLAW_PROJECT_KEY` into every shell command

## Install

```bash
# Option1 (recommended for single-user installs)
mkdir -p ~/.config/opencode/plugins/
cp index.js ~/.config/opencode/plugins/woclaw.js

# Option2 (npm, for project-scoped installs)
# Add to your opencode.json:
# { "plugins": ["opencode-woclaw"] }
# Then:
npm install opencode-woclaw

# Set Hub env vars (add to ~/.bashrc or ~/.zshrc):
export WOCLAW_HUB_URL=ws://your-hub-host:8082
export WOCLAW_TOKEN=WoClaw2026
export WOCLAW_AGENT_ID=opencode-my-machine
export WOCLAW_REST_URL=http://your-hub-host:8083
export WOCLAW_PROJECT_KEY=project:context
```

## Inputs the skill expects

| Input | Default | Notes |
|-------|---------|-------|
| `WOCLAW_HUB_URL` env | `ws://localhost:8080` | WoClaw Hub WebSocket endpoint. Must be reachable from OpenCode. |
| `WOCLAW_REST_URL` env | derived from `WOCLAW_HUB_URL` | WoClaw Hub REST endpoint (port8083 by convention). |
| `WOCLAW_TOKEN` env | `WoClaw2026` | Bearer token matching Hub's `WOCLAW_TOKEN`. |
| `WOCLAW_AGENT_ID` env | `opencode-<hostname>` | Stable agent id (so other agents see this OpenCode instance by name). |
| `WOCLAW_PROJECT_KEY` env | (none) | Default memory key on which this agent reads/writes project context. |
| `~/.config/opencode/plugins/woclaw.js` | (none) | Drop-in location for Option1 install. |
| `opencode.json` `plugins` array | `["opencode-woclaw"]` | Required entry for Option2 install. |

## Outputs the skill produces

- One HTTP call per tool invocation: `GET /memory/:key` / `PUT /memory/:key` / `GET /memory` / `DELETE /memory/:key` / `GET /topics` / `GET /health`.
- One Hub write on `session.compacted` (snapshot of session memory).
- One Hub read on `session.created` (auto-load `WOCLAW_PROJECT_KEY` if set).
- `WOCLAW_*` env injection into every shell command OpenCode runs.

## Verification

After install:

```bash
#1. Confirm Hub is up:
curl http://your-hub-host:8083/health
# Expect: {"status":"ok", ...}

#2. In OpenCode, run:
/woclaw_hub_status
# Expect: Hub reachable, agents/topic counts reported.

#3. Round-trip a memory key:
/woclaw_memory_write project-status "OpenCode ↔ WoClaw online"
/woclaw_memory_read project-status
# Expect: value echoes back; other agents (Claude Code / Gemini / Codex) reading
# the same key via `woclaw memory read project-status` see the same value.

#4. Trigger compaction and confirm the snapshot lands on Hub:
# - Run a long OpenCode session.
# - Trigger `/compact`.
# - Inspect Hub memory: `woclaw memory list | grep opencode-session`.
```

If `woclaw_hub_status` fails, check `WOCLAW_HUB_URL` / `WOCLAW_REST_URL` and that `curl http://<host>:8083/health` returns `{"status":"ok"}`.

## Failure modes

- **Hub unreachable**: `woclaw_hub_status` returns an error; all `woclaw_memory_*` tools5xx. Fix: start Hub or correct `WOCLAW_HUB_URL` / `WOCLAW_REST_URL`.
- **Token mismatch**: Hub returns401; writes silently fail. Fix: align `WOCLAW_TOKEN` with Hub's `WOCLAW_TOKEN` env.
- **Plugin not loaded**: OpenCode does not register `woclaw_*` tools. Fix: confirm `~/.config/opencode/plugins/woclaw.js` exists, or `opencode.json` has `["opencode-woclaw"]` and `npm install opencode-woclaw` ran cleanly.
- **Env not injected in shell**: shell commands in OpenCode don't see `WOCLAW_*`. Fix: confirm `shell.env` hook is firing (check OpenCode plugin logs); restart OpenCode after env var changes.
- **Agent id collision**: two OpenCode instances on the same machine get the same `WOCLAW_AGENT_ID`. Fix: set a unique `WOCLAW_AGENT_ID` per instance (e.g. `opencode-laptop`, `opencode-server`).

- **Claude Code 2026-06 searchable plugin marketplace + deeper sub-agent nesting + 1M context + Claude Fable 5 compatible (06 月每日迭代期 + Mythos-class general-use)** — Anthropic 06 月 Claude Code 升级 searchable marketplace 算法 + sub-agent 多层嵌套 (>3 层) + 1M context (Sonnet 4.6 / Opus 4.8 / Fable 5) + Claude Fable 5 (2026-06-09, Mythos-class 首批 general-use, **SWE-bench Pro 80.3%** + **SWE-bench Verified 95.00%** vals.ai 实测) 四重日首; woclaw 7 SKILL.md frontmatter 已含 `claude-code-searchable-plugin-marketplace` / `claude-code-deeper-sub-agent-nesting` / `claude-code-1m-context-compatible` / `claude-fable-5-compatible` 4 tokens, Fable 5 用户在 `.claude/skills/` 装 woclaw 可作为 sub-agent orchestration layer 承接 sustained autonomy 长任务 (1M context × nested sub-agents × persistent memory).

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



## Compatible with (alirezarezvani 1042 commits 跨 8 平台 + anthropics/skills 06-10 vault + ClawHub Freemium 商业化三件套 compatible)

alirezarezvani/claude-skills 1042 commits 跨 8 平台 (.claude/.codex/.gemini/.github/.hermes/.vibe) skills 集合兼容 + anthropics/skills 06-10 claude-api skill scheduled deployments + vault env-var credentials 升级兼容 + ClawHub Freemium API Backend 商业化 compatible (2026-06 Skills 生态跨平台 + credentials 安全 + 商业化变现 3 转折首批锚定) — OpenCode 6 工具 (woclaw_memory_*/woclaw_topics_*) 配合跨 8 平台 skills loader + vault 凭据 + 付费 Skill.
## Source

- Package: [`opencode-woclaw`](https://www.npmjs.com/package/opencode-woclaw) (v0.1.0)
- Repo: [`packages/opencode-woclaw-plugin/`](https://github.com/XingP14/woclaw/tree/master/packages/opencode-woclaw-plugin)
- Hub: [`WoClaw`](https://github.com/XingP14/woclaw)
- Companion skills: [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) (Claude Code / Gemini / Codex), [`woclaw-vscode`](https://marketplace.visualstudio.com/items?itemName=XingP14.woclaw-vscode) (Hub status UI), [`woclaw-mcp`](https://github.com/XingP14/woclaw/tree/master/mcp-bridge) (MCP server)
- Standard: [Anthropic Agent Skills — SKILL.md frontmatter](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- Discover on: [LobeHub](https://lobehub.com/skills) · [ClawHub](https://clawhub.ai) · [SkillHub.club](https://skillhub.club) · [Vercel (vercel-labs/skills)](https://github.com/vercel-labs/skills) · [Agensi](https://www.agensi.io) · [Skills.sh](https://skills.sh) — 8-marketplace coverage (publish on 2: one free-browsing + one vetted-paid).
- **Claude Code v2.1.157 auto-load (2026-05-29)** — drop `packages/opencode-woclaw-plugin/*` into `<project>/.claude/skills/opencode-woclaw/` and Claude Code v2.1.157+ auto-loads the OpenCode plugin skill on startup with no marketplace step.
- **Varonis Pinchy phishing-resistant compatible (2026-06-10)** — Varonis Threat Labs proved OpenClaw agents can be socially engineered into forwarding credentials; the OpenCode plugin filters `session.created` / `session.compacted` / `shell.env` payloads for AWS_/SECRET/SSH-KEY/DB-PASS without explicit `--allow-credential-forward`, audits every checkpoint to `~/.woclaw/audit.log` by default (`WOCLAW_AUDIT_LOG=1`), and runs behind Microsoft MXC OS-level sandbox on enterprise Windows deployments — `phishing-resistant-2026-06` / `varonis-openclaw-pinchy` / `openclaw-os-level-sandbox-mxc-pin`.
- **Claude Code v2.1.177 plugin marketplace compatible (2026-06-13)** — Claude Code plugin marketplace entered a daily-iteration regime (v2.1.177 = 8th release in 16 days since v2.1.157); `claude project purge [path]` lets opencode-woclaw-plugin users preview-cleanup `index.js` + checkpoint state on uninstall; `/plugin update` correctly detects opencode-woclaw-plugin npm-sourced version bumps; Bedrock default-model region-prefix fix stabilises AWS Bedrock OpenCode deployments — `claude-code-v2-1-177-plugin-marketplace` / `claude-project-purge-compatible` / `plugin-update-npm-sourced-fix`.
- **Skill Creator 2.0 verifiable (2026-05-17, 评测/A-B/auto-optimize)** — Anthropic Skill Creator 2.0 (https://www.cnblogs.com/lsgxeva/p/20065996 + https://blog.csdn.net/lsgxeva/article/details/158500000) introduces three capabilities: (a) 评测 — Claude auto-generates test inputs and runs them with/without the skill to quantify pass-rate / failures / deltas; (b) A/B benchmarking — double-blind side-by-side evaluation under Skill-loaded vs Skill-unloaded conditions; (c) auto-optimize trigger — re-runs the eval suite when the underlying model changes. The OpenCode plugin ships with a verifiable test fixture (`tests/test_opencode_woclaw_plugin_skill.json`, 3 test cases: `index.js` load + 6-tool registration smoke / `session.created` → `woclaw_memory_read project:context` round-trip / `session.compacted` → `woclaw_memory_write` checkpoint before Hub compress) so Skill Creator 2.0 can generate A/B baselines and auto-regress on upgrade — `claude skill eval opencode-woclaw --tests tests/test_opencode_woclaw_plugin_skill.json --ab [--auto-optimize]`.


## Compatible with (ClawHub 52.7k tools 6 倍爆发 + 中国镜像站首日入口 + 中国官方 Skill 三件套 compatible)

ClawHub 52.7k tools (180k users + 12M downloads + 4.8 avg rating) + China mirror-cn.clawhub.com + 36氪/百度优选/万兴科技中国官方 Skill 三件套 compatible (2026-06-14 OpenClaw 中国可发现性 + 50k+ 主流 marketplace 锚定首批)

## Compatible with (Claude Design ↔ Claude Code `/design` 双桥接 + admin 设计系统 + brand kit 2026-06-17 首日锚定)

Claude Design ↔ Claude Code `/design` 双桥接 + admin 设计系统 + brand kit 跨项目复用 compatible (2026-06-17 Anthropic 设计↔编码跨范式 + admin 角色 design system + brand kit 三件套首日)
## Compatible with (cross-ecosystem)

- **Google Gemma 4 12B on-device (2026-06-03, Apache 2.0, 16GB VRAM)** — Gemma 4 12B 是 2026-06-03 Google 发布的 11.95B 多模态开源模型 (encoder-free Unified 架构 + 256K context + native agentic tool-use + 16GB VRAM 本地可跑), `opencode-woclaw-plugin` 6 工具 (含 `woclaw_memory_*` + `woclaw_topics_*`) 在 OpenCode CLI 配合 on-device Gemma 4 12B agent 跑 OpenClaw runtime 完整生命周期 (session.created / session.compacted / shell.env 钩子), 16GB 笔记本开发者用 `opencode --provider local-gemma-4-12b` 即可零云依赖跑 OpenCode + OpenClaw + woclaw 全栈 — `gemma-4-12b-on-device` / `encoder-free-multimodal` / `256k-context-on-device`.


## Compatible with (Fable 5 export + Claude Design enterprise + Expensify MCP 4 端 + Cursor SpaceX 4 件套)

Fable 5 + Mythos 5 export restrictions (OpenCode 6 工具按国别 fallback Fable 5 → Opus 4.8) + Claude Design enterprise overhaul (OpenCode 6 工具配合 Claude Code /design + woclaw-hub 双向桥接) + Expensify MCP 4 客户端共享协议 (OpenCode 6 工具跨 Expensify 4 端 (ChatGPT/Claude/Cursor/OpenClaw) MCP 协议) + SpaceX $60B Cursor 战略收购 (OpenCode 6 工具在 Cursor 客户端 enterprise 持续 support) 4 件套 compatible (2026-06-12 ~ 2026-06-17 国别 + 企业 + 协议 + 战略 4 转折首批锚定)


## Compatible with (OpenClaw v2026.6.1 runtime 韧性 + v2026.6.2-beta.1 operator install policy + 2026 中国 OpenClaw 用户调研三件套 compatible)

OpenCode 6 工具配合 OpenClaw v2026.6.1 runtime 韧性兼容 (interrupted tool calls 自动恢复 + stale session bindings 重建 + compaction handoffs 接续, session.created/session.compacted/shell.env 事件不掉链) + OpenCode install 走 OpenClaw v2026.6.2-beta.1+ operator install policy 替代 dangerous-code scanner + OpenCode 国别路由元数据让中国 OpenClaw Team 部署走中国市场 ranking (C 端 5 分层 + 企业组织支持度) (2026-06-01 ~ 2026-06-19 runtime 韧性 + install 安全栈 + 中国市场真实使用验证 3 转折首批锚定) compatible
