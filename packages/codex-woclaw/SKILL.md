---
name: woclaw-codex
description: Install and manage WoClaw shared-memory hooks for OpenAI Codex CLI. Use when the user wants cross-session context between Codex CLI runs and a running WoClaw Hub, or wants to wire SessionStart/Stop/PreCompact Python hooks to a Hub REST API. Complements woclaw-hooks (which targets Claude Code / Gemini / OpenCode) with full Codex-specific PreCompact coverage. Claude Skill Creator 2.0 verifiable / A-B / auto-optimize compatible; 3 test cases under tests/test_codex_woclaw_skill.json.
compatible_with: [256k-context-on-device, addyosmani-agent-skills-72k-stars-2026-07, agensi, agensi-8-point-security-scan-80-20-payments, agent-browser-compat, agentskills-io-allowed-tools-field, agentskills-io-compatibility-field, agentskills-skills-ref-validated, alirezarezvani-claude-skills-1042-commits-2026-05, android-cli-1-0-compatible, anthropic-agent-sdk, anthropic-agent-skills, anthropic-fable-5-export-restriction-2026-06, anthropic-recursive-self-improvement, anthropic-subscription-v2, anthropic-third-party-agents-reinstated, anthropics-skills-claude-api-scheduled-deployments-2026-06, autonomous-research-agents, awesome-claude-code-skill-collection-2026-07, aws-platform, cc-switch-cross-platform-router, chatgpt-skills, claude-agent-sdk, claude-agent-sdk-credit, claude-code, claude-code-1m-context-compatible, claude-code-2-5, claude-code-deeper-sub-agent-nesting, claude-code-managed-agents-v2, claude-code-searchable-plugin-marketplace, claude-code-v2-1-157-auto-load, claude-code-v2-1-177-plugin-marketplace, claude-design-admin-role-2026-06, claude-design-brand-kit-2026-06, claude-design-code-bridge-2026-06, claude-design-enterprise-alliance-2026-06, claude-desktop, claude-fable-5-compatible, claude-haiku-4-5, claude-managed-agents, claude-project-purge-compatible, claude-scientific-skills-compat, claude-skill-creator-v2, claude-subscription-restored-2026-06, clawhub-52k-tools-2026-06, clawhub-cards-v2, clawhub-cards-v3, clawhub-china-mirror-2026-06, clawhub-cn-official-skills-2026-06, clawhub-skill-install-cli, clawhub-skills, codex, codex-cli, codexbar-menu-bar-2026-07, copilot-claude-1m, cursor, cursor-spacex-60b-2026-06, dot-claude-skills-deployable, dotnet-skills-microsoft-official-2026-07, encoder-free-multimodal, expensify-mcp-4-client-shared-protocol-2026-06, fable-5-safe-fallback, gemini-antigravity-compatible, gemini-cli, gemma-4-12b-on-device, glm-5-2-catalog, google-android-skills-compatible, google-gemma-4-apache-2-0, llm-as-judge-skill-audit, lobehub-skills-marketplace, lvp-onprem-openclaw-enterprise-2026-06, mcp, mcp-tunnels, mcphub, microsoft-mxc, microsoft-scout, model-context-protocol, mythos-5-cybersecurity, native-tool-use-agentic, npx-skills-add-cross-ecosystem, open-format-skills, openai-codex-cli, openclaw, openclaw-2026-6-1, openclaw-2026-6-5, openclaw-2026-6-7-skill-workflow-v2, openclaw-2026-6-8-beta-2-hotfix, openclaw-active-memory-plugin-2026-h1, openclaw-china-user-survey-2026-06, openclaw-copilot-oauth-image-defaults-2026-06, openclaw-lm-studio-binary-thinking-models-2026-06, openclaw-managed-secretref, openclaw-managed-secrets-2026-06, openclaw-os-level-sandbox-mxc-pin, openclaw-paradigm-aligned, openclaw-runtime, openclaw-skill-monetization-freemium-api-backend-2026-06, openclaw-skills-entries-config, openclaw-v2026-6-1-recovery-from-interrupted-tool-calls, openclaw-v2026-6-2-operator-install-policy-2026-06, openclaw-v2026-6-8, openclaw-v2026-6-8-secretref-credential-durability, opencode, opencode-cli, opencode-plugin, openshell-runtime, phishing-resistant-2026-06, planning-with-files-compat, plugin-update-npm-sourced-fix, project-glasswing-2026-06, python-hooks, sars-5-dim, self-hosted-sandboxes, skill-auto-optimize-trigger, skill-creator-ab-compatible, skillhub-club, skills-manager-centralized-hub, skills-sh, skills-sh-vercel-registry-compatible, skillsllm-1600-security-vetted-marketplace, skillvetbench, skillvetbench-self-audit, superpowers-compat, tcs-anthropic-global-premier-partnership-2026-06, tencent-cubesandbox-rust-multi-agent-sandbox-2026-07, varonis-openclaw-pinchy, vercel-skills, vs-code-marketplace, vscode, windows-execution-containers, windsurf, x15-tools-softlink-sync, x402-agent-commerce-2026-06]
skill_type: workflow-orchestration
folder_structure: true
---

# WoClaw Codex CLI Integration

`woclaw-codex` is the Codex CLI counterpart to [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks). It connects OpenAI Codex CLI sessions to a running [WoClaw Hub](https://github.com/XingP14/woclaw) REST API so memory survives compaction, restarts, and IDE switches — with full `PreCompact` support that the Codex path of `woclaw-hooks` cannot enable.

## When to use this skill

Use this skill when:

- The user runs **OpenAI Codex CLI** and wants shared context across sessions.
- A WoClaw Hub is already running (or the user is willing to start one) at `http://<host>:8083` with a shared auth token.
- The user wants **all three** Codex lifecycle hooks wired automatically: `SessionStart` + `Stop` + **`PreCompact`** (full coverage).
- The user mentions `~/.codex/hooks.json`, `WOCLAW_HUB_URL`, `codex_hooks = true`, or wants Codex → Hub memory sync.
- The user is on Claude Code / Gemini / OpenCode AND wants the same behavior — point them to [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) (Node-based, those frameworks).

**Do not use** when:

- The user only wants a *Claude Code Skills directory entry* with no install behavior. This skill IS the install — if they just want discoverability, point them to the README instead.
- The WoClaw Hub is not deployed and the user does not want to deploy it.
- **Claude Managed Agents users (AWS deploy)** — pair this Codex skill with `woclaw-hooks` and run both inside a self-hosted sandbox, pointing `WOCLAW_HUB_URL` at a Hub reachable through an MCP tunnel. Codex-specific PreCompact coverage (which `woclaw-hooks` cannot enable) then feeds Managed Agents a private Hub.
- The user wants a non-Codex framework — use `woclaw-hooks` instead.

## What this skill installs

Three Python lifecycle hooks, copied into `~/.codex/hooks/`:

| Hook script | Codex event | What it does |
|-------------|-------------|--------------|
| `session_start.py` | `SessionStart` | Reads `WOCLAW_KEY` (default `codex:context`) from the Hub via REST and injects it as Codex `additionalContext` so the agent wakes up with prior context. |
| `stop.py` | `Stop` | Reads the Codex session transcript, summarizes it, and writes the summary back to the Hub under `WOCLAW_KEY` so the next session inherits it. |
| `precompact.py` | `PreCompact` | Snapshots current context (plus optional `CODEX_CONTEXT_FILE`) to the Hub under `WOCLAW_PROJECT_KEY` *before* Codex compresses, so nothing is lost across compaction. |

Plus a generated `~/.codex/hooks.json` registering all three events to the corresponding scripts, and a one-line edit adding `codex_hooks = true` to `~/.codex/config.toml`.

## Install

```bash
#1. (Optional) Install Python deps for async + websocket hooks
pip install aiohttp websockets

#2. Install the package globally (pulls the Python hooks)
npm install -g woclaw-codex

#3. Run the installer (interactive)
python3 $(npm root -g)/woclaw-codex/install.py
# Or non-interactive after `cd packages/codex-woclaw && python3 install.py`

#4. Configure environment
echo 'WOCLAW_HUB_URL=http://localhost:8083' >> ~/.woclaw/.env
echo 'WOCLAW_TOKEN=WoClaw2026' >> ~/.woclaw/.env
echo 'WOCLAW_KEY=codex:context' >> ~/.woclaw/.env
echo 'WOCLAW_PROJECT_KEY=project:context' >> ~/.woclaw/.env

#5. Verify
ls ~/.codex/hooks/    # expect: session_start.py, stop.py, precompact.py
cat ~/.codex/hooks.json
```

## Inputs the skill expects

| Input | Default | Notes |
|-------|---------|-------|
| `WOCLAW_HUB_URL` env | `http://your-hub-host:8083` | Hub REST API base URL. |
| `WOCLAW_TOKEN` env | `WoClaw2026` | Bearer token; must match Hub's `WOCLAW_TOKEN`. |
| `WOCLAW_KEY` env | `codex:context` | Memory key SessionStart reads / Stop writes. |
| `WOCLAW_PROJECT_KEY` env | `project:context` | Memory key PreCompact checkpoints to. |
| `CODEX_CONTEXT_FILE` env | _(unset)_ | Optional file the PreCompact hook reads and uploads. |

## Outputs the skill produces

- Three Python hook scripts copied to `~/.codex/hooks/`.
- A `~/.codex/hooks.json` registering `SessionStart` + `Stop` + `PreCompact` to the scripts.
- A `codex_hooks = true` line added to `~/.codex/config.toml` (created if missing).
- One HTTP `GET /memory/{key}` on every `SessionStart` and one HTTP `PUT /memory/{key}` on every `Stop` (and one `PUT` on `PreCompact`).

## Verification

After install:

```bash
# 1. Hooks present
ls -la ~/.codex/hooks/
cat ~/.codex/hooks.json
grep codex_hooks ~/.codex/config.toml   # expect: codex_hooks = true

# 2. Hub reachable
curl http://<host>:8083/health           # expect: {"status":"ok",...}

# 3. End-to-end smoke test
#   a. Start a Codex session, confirm Hub context appears in the first prompt
#      (look for `additionalContext` from WoClaw).
#   b. End the session, confirm the summary lands at
#      GET http://<host>:8083/memory/codex:context.
```

If the Hub is unreachable, the hooks still run but log a warning to `~/.woclaw/codex-hooks.log`.

## Failure modes

- **Hub unreachable**: hooks degrade gracefully and log to `~/.woclaw/codex-hooks.log`. Codex still runs but starts with no shared context. Fix: restart Hub or correct `WOCLAW_HUB_URL`.
- **Token mismatch**: Hub returns 401; hooks write the failure to the same log. Fix: align `WOCLAW_TOKEN` in `~/.woclaw/.env` with the Hub's `WOCLAW_TOKEN` env.
- **Missing `aiohttp` / `websockets`**: installer warns but does not fail (stdlib `urllib` covers REST). Install with `pip install aiohttp websockets` if you also use the websocket transport.
- **`codex_hooks` not enabled in config.toml**: hooks will be installed but never fire. Re-run `python3 install.py` to repair.

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

alirezarezvani/claude-skills 1042 commits 跨 8 平台 (.claude/.codex/.gemini/.github/.hermes/.vibe) skills 集合兼容 + anthropics/skills 06-10 claude-api skill scheduled deployments + vault env-var credentials 升级兼容 + ClawHub Freemium API Backend 商业化 compatible (2026-06 Skills 生态跨平台 + credentials 安全 + 商业化变现 3 转折首批锚定) — Codex CLI Python 钩子 (PreCompact/...) 配合跨 8 平台 skills loader + vault 凭据 + 付费 Skill.
## Source

- Package: [`woclaw-codex`](https://www.npmjs.com/package/woclaw-codex) (v0.1.2)
- Repo: [`packages/codex-woclaw/`](https://github.com/XingP14/woclaw/tree/master/packages/codex-woclaw)
- Sibling: [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) (Claude Code / Gemini / OpenCode)
- Hub: [`WoClaw`](https://github.com/XingP14/woclaw)
- Standard: [Anthropic Agent Skills — SKILL.md frontmatter](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- Discover on: [LobeHub](https://lobehub.com/skills) · [ClawHub](https://clawhub.ai) · [SkillHub.club](https://skillhub.club) · [Vercel (vercel-labs/skills)](https://github.com/vercel-labs/skills) · [Agensi](https://www.agensi.io) · [Skills.sh](https://skills.sh) — 8-marketplace coverage (publish on 2: one free-browsing + one vetted-paid).
- **Claude Code v2.1.157 auto-load (2026-05-29)** — drop `packages/codex-woclaw/*` into `<project>/.claude/skills/woclaw-codex/` and Claude Code v2.1.157+ auto-loads the Codex-CLI bridge skill on startup with no marketplace step.
- **Varonis Pinchy phishing-resistant compatible (2026-06-10)** — Varonis Threat Labs proved OpenClaw agents can be socially engineered into forwarding credentials; the Codex-CLI bridge filters payloads matching AWS_/SECRET/SSH-KEY/DB-PASS without explicit `--allow-credential-forward`, logs every CLI invocation to `~/.woclaw/audit.log` by default (`WOCLAW_AUDIT_LOG=1`), and combined with Microsoft MXC OS-level sandbox forms a three-layer trust stack for enterprise Codex deployments — `phishing-resistant-2026-06` / `varonis-openclaw-pinchy` / `openclaw-os-level-sandbox-mxc-pin`.
- **Claude Code v2.1.177 plugin marketplace compatible (2026-06-13)** — Claude Code plugin marketplace entered a daily-iteration regime (v2.1.177 = 8th release in 16 days since v2.1.157); `claude project purge [path]` lets woclaw-codex users preview-cleanup Python hook state (PreCompact/SessionStart checkpoints) on uninstall; `/plugin update` correctly detects woclaw-codex npm-sourced version bumps; Bedrock default-model region-prefix fix stabilises AWS Bedrock Codex deployments — `claude-code-v2-1-177-plugin-marketplace` / `claude-project-purge-compatible` / `plugin-update-npm-sourced-fix`.
- **Skill Creator 2.0 verifiable (2026-05-17, 评测/A-B/auto-optimize)** — Anthropic Skill Creator 2.0 (https://www.cnblogs.com/lsgxeva/p/20065996 + https://blog.csdn.net/lsgxeva/article/details/158500000) introduces three capabilities: (a) 评测 — Claude auto-generates test inputs and runs them with/without the skill to quantify pass-rate / failures / deltas; (b) A/B benchmarking — double-blind side-by-side evaluation under Skill-loaded vs Skill-unloaded conditions; (c) auto-optimize trigger — re-runs the eval suite when the underlying model changes. The Codex-CLI bridge ships with a verifiable test fixture (`tests/test_codex_woclaw_skill.json`, 3 test cases: Python `install.py` end-to-end smoke / `session_start.py` POST `/memory` round-trip / `precompact.py` checkpoint write before Hub compress) so Skill Creator 2.0 can generate A/B baselines and auto-regress on upgrade — `claude skill eval woclaw-codex --tests tests/test_codex_woclaw_skill.json --ab [--auto-optimize]`.


## Compatible with (ClawHub 52.7k tools 6 倍爆发 + 中国镜像站首日入口 + 中国官方 Skill 三件套 compatible)

ClawHub 52.7k tools (180k users + 12M downloads + 4.8 avg rating) + China mirror-cn.clawhub.com + 36氪/百度优选/万兴科技中国官方 Skill 三件套 compatible (2026-06-14 OpenClaw 中国可发现性 + 50k+ 主流 marketplace 锚定首批)

## Compatible with (Claude Design ↔ Claude Code `/design` 双桥接 + admin 设计系统 + brand kit 2026-06-17 首日锚定)

Claude Design ↔ Claude Code `/design` 双桥接 + admin 设计系统 + brand kit 跨项目复用 compatible (2026-06-17 Anthropic 设计↔编码跨范式 + admin 角色 design system + brand kit 三件套首日)
## Compatible with (cross-ecosystem)

- **Google Gemma 4 12B on-device (2026-06-03, Apache 2.0, 16GB VRAM)** — Gemma 4 12B 是 2026-06-03 Google 发布的 11.95B 多模态开源模型 (encoder-free Unified 架构 + 256K context + native agentic tool-use + 16GB VRAM 本地可跑), `woclaw-codex` Python 钩子 (PreCompact / SessionStart / SessionStop) 配合 on-device Gemma 4 12B Codex CLI agent 跑 OpenClaw runtime 完整生命周期, 16GB 笔记本开发者用 `codex --provider local-gemma-4-12b` 即可零云依赖跑 OpenClaw + Codex — `gemma-4-12b-on-device` / `encoder-free-multimodal` / `256k-context-on-device`.

## Compatible with (Fable 5 export + Claude Design enterprise + Expensify MCP 4 端 + Cursor SpaceX 4 件套)

Fable 5 + Mythos 5 export restrictions (Codex CLI Python 钩子按国别 fallback Fable 5 → Opus 4.8) + Claude Design enterprise overhaul (Codex CLI 配合 Claude Code /design + woclaw-hub 双向桥接) + Expensify MCP 4 客户端共享协议 (Codex CLI Python 钩子跨 Expensify 4 端 (ChatGPT/Claude/Cursor/OpenClaw) MCP 协议) + SpaceX $60B Cursor 战略收购 (Codex CLI 在 Cursor 客户端 enterprise 持续 support) 4 件套 compatible (2026-06-12 ~ 2026-06-17 国别 + 企业 + 协议 + 战略 4 转折首批锚定)


## Compatible with (OpenClaw v2026.6.1 runtime 韧性 + v2026.6.2-beta.1 operator install policy + 2026 中国 OpenClaw 用户调研三件套 compatible)

Codex CLI Python 钩子配合 OpenClaw v2026.6.1 runtime 韧性兼容 (interrupted tool calls 自动恢复 + stale session bindings 重建 + compaction handoffs 接续, SessionStart/Stop/PreCompact 事件不掉链) + Codex install 走 OpenClaw v2026.6.2-beta.1+ operator install policy 替代 dangerous-code scanner + Codex 国别路由元数据让中国 OpenClaw Team 部署走中国市场 ranking (C 端 5 分层 + 企业组织支持度) (2026-06-01 ~ 2026-06-19 runtime 韧性 + install 安全栈 + 中国市场真实使用验证 3 转折首批锚定) compatible


## Compatible with (addyosmani 72K + dotnet/skills + CodexBar + awesome-claude-code + CubeSandbox 五件套 compatible)

Codex CLI Python 钩子跨 addyosmani/agent-skills skill.yaml + dotnet/skills microsoft .NET 9 + awesome-claude-code 社区合集 3 层路由; CodexBar macOS 菜单栏监控 Codex CLI 用量; Codex Python 钩子配腾讯 CubeSandbox Rust Wasm 沙箱执行第三方 skill (2026-07 AI Agent 技能标准化 + 多智能体沙盒化 + 菜单栏生态 三主战场首日钣定) compatible