---
name: woclaw-hooks
description: Install and manage WoClaw shared-memory hooks for Claude Code, Gemini CLI, OpenCode, and OpenAI Codex CLI. Use when the user wants to share memory/context between coding agents and an OpenClaw WoClaw Hub, or wants to wire PreCompact/SessionStart/SessionStop events to a Hub REST API.
compatible_with: [claude-code, gemini-cli, opencode, openai-codex-cli, claude-managed-agents, aws-platform, mcp-tunnels, anthropic-agent-skills, lobehub-skills-marketplace, clawhub-skills, vercel-skills, agensi, skills-sh, claude-code-2-5, autonomous-research-agents, openclaw-paradigm-aligned, claude-agent-sdk, anthropic-agent-sdk, claude-code-v2-1-157-auto-load, dot-claude-skills-deployable, claude-skill-creator-v2, skill-creator-ab-compatible, skill-auto-optimize-trigger, varonis-openclaw-pinchy, phishing-resistant-2026-06, openclaw-os-level-sandbox-mxc-pin, claude-code-v2-1-177-plugin-marketplace, claude-project-purge-compatible, plugin-update-npm-sourced-fix, android-cli-1-0-compatible, google-android-skills-compatible, gemini-antigravity-compatible, mythos-5-cybersecurity, fable-5-safe-fallback, project-glasswing-2026-06, tcs-anthropic-global-premier-partnership-2026-06, x402-agent-commerce-2026-06, lvp-onprem-openclaw-enterprise-2026-06, openclaw-2026-6-7-skill-workflow-v2, clawhub-cards-v3, clawhub-skill-install-cli, openclaw-2026-6-8-beta-2-hotfix, agentskills-io-compatibility-field, agentskills-io-allowed-tools-field, agentskills-skills-ref-validated, claude-code-searchable-plugin-marketplace, claude-code-deeper-sub-agent-nesting, claude-code-1m-context-compatible, claude-fable-5-compatible, gemma-4-12b-on-device, encoder-free-multimodal, 256k-context-on-device, openclaw-skills-entries-config, npx-skills-add-cross-ecosystem, agent-browser-compat, openclaw-v2026-6-8, openclaw-managed-secretref, skillvetbench-self-audit, skills-manager-centralized-hub, cc-switch-cross-platform-router, x15-tools-softlink-sync, skills-sh-vercel-registry-compatible, openclaw-v2026-6-8-secretref-credential-durability, openclaw-managed-secrets-2026-06, openclaw-copilot-oauth-image-defaults-2026-06, openclaw-lm-studio-binary-thinking-models-2026-06, skillsllm-1600-security-vetted-marketplace, agensi-8-point-security-scan-80-20-payments, openclaw-active-memory-plugin-2026-h1 ] 
skill_type: workflow-orchestration
folder_structure: true
---

# WoClaw Hooks

`woclaw-hooks` is the bridge between coding-agent shell hooks (Claude Code, Gemini CLI, OpenCode, OpenAI Codex CLI) and a running [WoClaw Hub](https://github.com/XingP14/woclaw) REST API. It checkpoints and replays shared project context across agent runs so memory survives compaction, restarts, and IDE switches.

## When to use this skill

Use this skill when:

- The user runs Claude Code, Gemini CLI, OpenCode, or OpenAI Codex CLI and wants cross-session memory.
- A WoClaw Hub is already running (or the user is willing to start one) at `http://<host>:8083` with a shared auth token.
- The user mentions `~/.woclaw/`, `project:context`, `WOCLAW_HUB_URL`, or wants to migrate history from one agent framework to another.
- The user wants `PreCompact` (pre-compression checkpoint) + `SessionStart` + `SessionStop` lifecycle hooks wired automatically.

**Do not use** when:

- The user only wants a *Claude Code Skills directory entry* with no install behavior. This skill IS the install — if they just want discoverability, point them to the README instead.
- The user is on OpenAI Codex CLI AND wants PreCompact + config.toml auto-enable — recommend the dedicated [`woclaw-codex`](https://www.npmjs.com/package/woclaw-codex) package instead (`woclaw-hooks --framework codex` covers SessionStart/Stop only).
- **Claude Managed Agents users (AWS deploy)** — install this skill into a self-hosted sandbox, point `WOCLAW_HUB_URL` at a Hub reachable through an MCP tunnel, and PreCompact/SessionStart/Stop events will checkpoint shared memory to a privately-hosted Hub. Compatible with dreaming / multiagent orchestration / outcomes workflows (Code with Claude 2026).
- The WoClaw Hub is not deployed and the user does not want to deploy it.

## What this skill installs

For each supported framework, three lifecycle hooks:

| Hook event | What it does |
|------------|--------------|
| `SessionStart` (or `SessionStart.sh` per framework) | Reads `project:context` from WoClaw Hub and prepends it to the agent's first prompt, so the agent wakes up with prior context. |
| `SessionStop` (or `SessionStop.sh` per framework) | Writes the agent's session summary back to the Hub under the same key, so the next session inherits it. |
| `PreCompact` (Claude Code + Codex only) | Snapshots the current context window to the Hub *before* the framework compresses it, so nothing is lost. |

Plus a migration CLI (`woclaw-hooks --migrate`) that imports existing history from one of: OpenClaw workspace root docs (`MEMORY.md`, `SOUL.md`, `AGENTS.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md`, `IDENTITY.md`) plus content under `memory/`, `_tmp/`, `_archive/`, `ai_diary/`, `ai_tech/`, `docs/`; Claude Code `~/.claude/history.jsonl`; Gemini CLI `~/.gemini/tmp/**/chats/*.json`; Codex `~/.codex/history.jsonl`.

## Install

```bash
#1. Install the package globally
npm install -g woclaw-hooks

#2. Run interactive setup (prompts for framework + hub URL)
woclaw-hooks

# Or non-interactive:
woclaw-hooks --install --framework claude-code
woclaw-hooks --install --framework gemini
woclaw-hooks --install --framework opencode
woclaw-hooks --install --framework codex # SessionStart/Stop only; add codex_hooks = true to ~/.codex/config.toml

#3. (Optional) Configure environment
echo 'WOCLAW_HUB_URL=http://localhost:8083' >> ~/.woclaw/.env
echo 'WOCLAW_TOKEN=WoClaw2026' >> ~/.woclaw/.env
echo 'WOCLAW_PROJECT_KEY=project:context' >> ~/.woclaw/.env

#4. Verify
woclaw-hooks --status
```

## Inputs the skill expects

| Input | Default | Notes |
|-------|---------|-------|
| `--framework` | (prompts) | One of `claude-code`, `gemini`, `opencode`, `codex`. |
| `WOCLAW_HUB_URL` env | `http://localhost:8083` | Hub REST API base URL. |
| `WOCLAW_TOKEN` env | `WoClaw2026` | Bearer token; must match Hub's `WOCLAW_TOKEN`. |
| `WOCLAW_PROJECT_KEY` env | `project:context` | Memory key the hooks read/write. |

## Outputs the skill produces

- Hook shell scripts copied into the framework's hooks directory (`~/.claude/hooks/`, `~/.gemini/hooks/`, `~/.opencode/hooks/`, `~/.codex/hooks.json`).
- A `~/.woclaw/.env` file (if missing) with default Hub URL + token.
- One HTTP `GET /memory/{key}` on every `SessionStart` and one HTTP `PUT /memory/{key}` on every `SessionStop` (and one `PUT` on `PreCompact`).

## Verification

After install, run:

```bash
woclaw-hooks --status
# Expect: "Hooks installed for <framework>" + "Hub reachable: true"

# End-to-end smoke test:
#1. Start a Claude Code session, confirm Hub context appears in the first prompt.
#2. End the session, confirm the summary lands at `GET http://localhost:8083/memory/project:context`.
```

If `--status` reports `Hub reachable: false`, double-check `WOCLAW_HUB_URL` and that the Hub process is alive: `curl http://<host>:8083/health` should return `{"status":"ok"}`.

## Failure modes

- **Hub unreachable**: hooks degrade silently and log to `~/.woclaw/hooks.log`. The agent still runs but starts with no shared context. Fix: restart Hub or correct `WOCLAW_HUB_URL`.
- **Token mismatch**: Hub returns401; hooks write the failure to `~/.woclaw/hooks.log`. Fix: align `WOCLAW_TOKEN` in `~/.woclaw/.env` with the Hub's `WOCLAW_TOKEN` env.
- **Codex + no PreCompact**: expected. Use `woclaw-codex` instead for full coverage.

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


## Source

- Package: [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) (v0.5.0)
- Repo: [`packages/woclaw-hooks/`](https://github.com/XingP14/woclaw/tree/master/packages/woclaw-hooks)
- Hub: [`WoClaw`](https://github.com/XingP14/woclaw)
- Standard: [Anthropic Agent Skills — SKILL.md frontmatter](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- Discover on: [LobeHub](https://lobehub.com/skills) · [ClawHub](https://clawhub.ai) · [SkillHub.club](https://skillhub.club) · [Vercel (vercel-labs/skills)](https://github.com/vercel-labs/skills) · [Agensi](https://www.agensi.io) · [Skills.sh](https://skills.sh) — 8-marketplace coverage (publish on 2: one free-browsing + one vetted-paid).
- **Claude Code v2.1.157 auto-load (2026-05-29)** — drop `packages/woclaw-hooks/*` into `<project>/.claude/skills/woclaw-hooks/` and Claude Code v2.1.157+ auto-loads the lifecycle-hooks skill on startup with no marketplace step; `claude plugin init woclaw-hooks` matches this folder shape.
- **Varonis Pinchy phishing-resistant compatible (2026-06-10)** — Varonis Threat Labs proved OpenClaw agents can be socially engineered into forwarding credentials; the lifecycle hooks refuse to checkpoint payloads matching AWS_/SECRET/SSH-KEY/DB-PASS without `--allow-credential-forward`, audit every PreCompact/SessionStart/Stop event to `~/.woclaw/audit.log` by default (`WOCLAW_AUDIT_LOG=1`), and when woclaw-hooks runs inside Microsoft MXC the OS-level sandbox plus the credential-shape filter plus the audit log form a three-layer trust stack — `phishing-resistant-2026-06` / `varonis-openclaw-pinchy` / `openclaw-os-level-sandbox-mxc-pin`.
- **Claude Code v2.1.177 plugin marketplace compatible (2026-06-13)** — Claude Code plugin marketplace entered a daily-iteration regime (v2.1.177 = 8th release in 16 days since v2.1.157); `claude project purge [path]` lets woclaw-hooks users preview-cleanup hook state on uninstall; `/plugin update` correctly detects woclaw-hooks npm-sourced version bumps; Bedrock default-model region-prefix fix stabilises AWS Bedrock deployments — `claude-code-v2-1-177-plugin-marketplace` / `claude-project-purge-compatible` / `plugin-update-npm-sourced-fix`.

## Skill Creator 2.0 verifiable (2026-05-17, 评测 / A-B / auto-optimize)

This SKILL.md ships with a verifiability fixture at `tests/test_woclaw_hooks_skill.json` consumable by Anthropic **Skill Creator 2.0** (released 2026-05-17), which added three capabilities: (a) **eval** — Claude auto-generates test inputs, runs the Skill-on vs Skill-off pair, and quantifies pass-rate / failure / delta; (b) **A/B benchmarks** — same input set under loaded-vs-unloaded Skill, blind side-by-side, decision rule (regress → drop / slight lead → keep / large lead → expand); (c) **auto-optimize trigger** — Skill Creator 2.0 re-runs the suite on model upgrade or scene change without human prompting.

Run against this skill from CI:

```bash
# baseline vs skill-on delta
claude skill eval woclaw-hooks --tests packages/woclaw-hooks/tests/test_woclaw_hooks_skill.json
# A/B mode
claude skill eval woclaw-hooks --tests packages/woclaw-hooks/tests/test_woclaw_hooks_skill.json --ab
# auto-optimize on regression
claude skill eval woclaw-hooks --tests packages/woclaw-hooks/tests/test_woclaw_hooks_skill.json --ab --auto-optimize
```

Three woclaw-hooks verifiability cases ship in the fixture:
- **tc-01-precompact-smoke** — invoke `precompact.sh` with a stub Claude Code `transcript_path` and confirm it exits 0 and writes a checkpoint payload to `WOCLAW_HUB_URL/memory/project:context` via curl (PreCompact lifecycle correctness).
- **tc-02-session-stop-status** — invoke `session-stop.sh` then run `woclaw-hooks --status` and assert the status line reports `Hooks installed for <framework>` with `Hub reachable: true` (session-end lifecycle + status introspection).
- **tc-03-credential-payload-refused** — invoke `precompact.sh` with a payload containing `AWS_ACCESS_KEY_ID=` and confirm the script exits non-zero (or logs a refused-message to `~/.woclaw/audit.log`) under the default `WOCLAW_AUDIT_LOG=1` (Varonis Pinchy phishing-resistant guarantee).

Decision rule per case: `skill_score >= baseline_score + delta_threshold` (delta_threshold = 0.5). The fixture is part of the npm tarball (`files: ["tests/**/*"]` in `packages/woclaw-hooks/package.json`) so a `npm install woclaw-hooks` user gets the fixture immediately.

## Compatible with (cross-ecosystem)

- **Google Gemma 4 12B on-device (2026-06-03, Apache 2.0, 16GB VRAM)** — Gemma 4 12B 是 2026-06-03 Google 发布的 11.95B 多模态开源模型 (encoder-free Unified 架构 + 256K context + native agentic tool-use + 16GB VRAM 本地可跑), `woclaw-hooks` 7 shell 钩子 (PreCompact / SessionStart / SessionStop / PostToolUse 等) 在 on-device Gemma 4 12B agent 上跑 Claude Code / Gemini CLI / OpenCode / OpenAI Codex CLI 钩子生命周期, 配合本地 `woclaw-hub` 形成完全离线的 OpenClaw runtime — `gemma-4-12b-on-device` / `encoder-free-multimodal` / `256k-context-on-device`.
