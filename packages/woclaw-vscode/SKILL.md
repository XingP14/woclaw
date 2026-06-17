---
name: woclaw-vscode
description: View and manage a running WoClaw Hub directly from VS Code — status bar indicator, topic/agent/memory browser, and quick memory peek. Use when the user wants to see whether a WoClaw Hub is alive, browse shared topics, list connected agents, or inspect a `project:context` memory key without leaving the editor.
compatible_with: [vscode, vs-code-marketplace, claude-code, claude-managed-agents, anthropic-agent-skills, lobehub-skills-marketplace, clawhub-skills, vercel-skills, agensi, skills-sh, claude-code-2-5, autonomous-research-agents, openclaw-paradigm-aligned, claude-agent-sdk, anthropic-agent-sdk, claude-code-v2-1-157-auto-load, dot-claude-skills-deployable, claude-skill-creator-v2, skill-creator-ab-compatible, skill-auto-optimize-trigger, varonis-openclaw-pinchy, phishing-resistant-2026-06, openclaw-os-level-sandbox-mxc-pin, claude-code-v2-1-177-plugin-marketplace, claude-project-purge-compatible, plugin-update-npm-sourced-fix, android-cli-1-0-compatible, google-android-skills-compatible, gemini-antigravity-compatible, mythos-5-cybersecurity, fable-5-safe-fallback, project-glasswing-2026-06, tcs-anthropic-global-premier-partnership-2026-06, x402-agent-commerce-2026-06, lvp-onprem-openclaw-enterprise-2026-06, openclaw-2026-6-7-skill-workflow-v2, clawhub-cards-v3, clawhub-skill-install-cli, openclaw-2026-6-8-beta-2-hotfix, agentskills-io-compatibility-field, agentskills-io-allowed-tools-field, agentskills-skills-ref-validated, claude-code-searchable-plugin-marketplace, claude-code-deeper-sub-agent-nesting, claude-code-1m-context-compatible, claude-fable-5-compatible, gemma-4-12b-on-device, encoder-free-multimodal, 256k-context-on-device, openclaw-skills-entries-config, npx-skills-add-cross-ecosystem, agent-browser-compat, openclaw-v2026-6-8, openclaw-managed-secretref, skillvetbench-self-audit, skills-manager-centralized-hub, cc-switch-cross-platform-router, x15-tools-softlink-sync, skills-sh-vercel-registry-compatible, openclaw-v2026-6-8-secretref-credential-durability, openclaw-managed-secrets-2026-06, openclaw-copilot-oauth-image-defaults-2026-06, openclaw-lm-studio-binary-thinking-models-2026-06, skillsllm-1600-security-vetted-marketplace, agensi-8-point-security-scan-80-20-payments, openclaw-active-memory-plugin-2026-h1, clawhub-52k-tools-2026-06, clawhub-china-mirror-2026-06, clawhub-cn-official-skills-2026-06 ] 
skill_type: code-templates
folder_structure: true
---

# WoClaw VS Code Extension

`woclaw-vscode` is a VS Code extension that surfaces a running [WoClaw Hub](https://github.com/XingP14/woclaw) inside the editor. It shows live Hub health in the status bar, exposes a sidebar tree of topics/agents/memory entries, and lets you peek at any `project:context` key with one click.

## When to use this skill

Use this skill when:

- A WoClaw Hub is already running (or the user is willing to start one) at `http://<host>:8083` with a shared auth token.
- The user wants a visual overview of Hub state (status, topics, agents, memory) inside VS Code.
- The user wants to verify that coding-agent sessions (Claude Code, Gemini CLI, OpenCode, Codex) are correctly posting to the Hub.
- The user mentions `woclaw.hubUrl`, `WOCLAW_HUB_URL`, or asks "is my Hub up?" / "what topics do I have?".

**Do not use** when:

- The user wants to **install** WoClaw hooks for Claude Code / Gemini / OpenCode / Codex — use the [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) skill instead (this extension only **reads** Hub state, it does not write hooks).
- The user wants **shared-memory lifecycle hooks** (SessionStart/SessionStop/PreCompact) wired into a CLI — use [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks).
- The user wants **OpenAI Codex CLI** with PreCompact + config.toml auto-enable — use [`woclaw-codex`](https://www.npmjs.com/package/woclaw-codex).
- **Claude Managed Agents users** — install this extension inside a VS Code window running inside a self-hosted sandbox and point it at a Hub reachable through an MCP tunnel so Managed Agents can peek Hub state from the editor.
- The user is on Cursor / Windsurf / Copilot — this extension is published for VS Code Marketplace only; the Hub REST API is the same, so a generic REST client works.

## What this skill installs

- A VS Code extension with:
  - A **status bar item** showing Hub health: 🟢 `WoClaw: up (N agents, M topics)` / 🔴 `WoClaw: down`.
  - A **sidebar tree view** under the "WoClaw" container with three sections:
    - **Topics** — name, message count, agent count.
    - **Agents** — id, connected-at, last-seen, topics joined.
    - **Memory** — key, tags, last-updated.
  - A **command palette** entry `WoClaw: Peek Memory Key` that opens any memory entry in a read-only editor.
  - Configurable poll interval (default 30s) and Hub URL (default `http://localhost:8083`).

## Install

```bash
#1. Install from VS Code Marketplace (search "WoClaw") OR from the .vsix:
code --install-extension woclaw-vscode-0.1.0.vsix

#2. Set the Hub URL (if not running on localhost)
#    VS Code Settings → search "woclaw" → set `Woclaw: Hub Url`

#3. (Optional) Disable the status bar or change poll interval
#    `woclaw.statusBar: false`
#    `woclaw.pollInterval: 60`

#4. Reload VS Code; the status bar should turn green if Hub is reachable.
```

## Inputs the skill expects

| Input | Default | Notes |
|-------|---------|-------|
| `woclaw.hubUrl` setting | `http://localhost:8083` | Hub REST API base URL. Must match the running Hub. |
| `woclaw.statusBar` setting | `true` | Whether to show the status bar item. |
| `woclaw.pollInterval` setting | `30` | Seconds between Hub polls. |
| Hub bearer token | (none) | If Hub has `WOCLAW_TOKEN` set, the extension reads `WOCLAW_TOKEN` from the user's shell env or `~/.woclaw/.env` automatically. |

## Outputs the skill produces

- One HTTP `GET /health` every `woclaw.pollInterval` seconds.
- One HTTP `GET /topics`, `GET /agents`, `GET /memory` on tree refresh (manual or auto every interval).
- One read-only editor tab when `WoClaw: Peek Memory Key` is invoked (no writes).

## Verification

After install:

```bash
#1. Confirm Hub is up:
curl http://localhost:8083/health
# Expect: {"status":"ok", ...}

#2. Open VS Code → status bar bottom-right should show:
#    🟢 WoClaw: up (0 agents, 0 topics)

#3. Open the "WoClaw" sidebar → refresh button (or wait one poll cycle) → topics/agents/memory should appear.

#4. Run command palette: `WoClaw: Peek Memory Key` → enter `project:context` → read-only preview opens.
```

If status bar is red, check `woclaw.hubUrl` and that `curl http://<host>:8083/health` returns `{"status":"ok"}`.

## Failure modes

- **Hub unreachable**: status bar shows 🔴 `WoClaw: down` and the sidebar tree shows an error placeholder. Fix: start Hub or correct `woclaw.hubUrl`.
- **Hub token mismatch**: Hub returns 401; tree view shows "auth error" tooltip. Fix: align `WOCLAW_TOKEN` in the user shell env / `~/.woclaw/.env` with the Hub's `WOCLAW_TOKEN` env.
- **Hub at non-default port**: change `woclaw.hubUrl` to `http://<host>:<port>`. The extension does not auto-discover ports.
- **VS Code version too old**: requires VS Code ≥ 1.75 (engines.vscode). Older versions cannot install.

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

- Package: [`woclaw-vscode`](https://marketplace.visualstudio.com/items?itemName=XingP14.woclaw-vscode) (v0.1.0)
- Repo: [`packages/woclaw-vscode/`](https://github.com/XingP14/woclaw/tree/master/packages/woclaw-vscode)
- Hub: [`WoClaw`](https://github.com/XingP14/woclaw)
- Companion skills: [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) (install hooks), [`woclaw-codex`](https://www.npmjs.com/package/woclaw-codex) (OpenAI Codex CLI)
- Standard: [Anthropic Agent Skills — SKILL.md frontmatter](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- Discover on: [LobeHub](https://lobehub.com/skills) · [ClawHub](https://clawhub.ai) · [SkillHub.club](https://skillhub.club) · [Vercel (vercel-labs/skills)](https://github.com/vercel-labs/skills) · [Agensi](https://www.agensi.io) · [Skills.sh](https://skills.sh) — 8-marketplace coverage (publish on 2: one free-browsing + one vetted-paid).
- **Claude Code v2.1.157 auto-load (2026-05-29)** — drop `packages/woclaw-vscode/*` into `<project>/.claude/skills/woclaw-vscode/` and Claude Code v2.1.157+ auto-loads the VS Code status-bar UI skill on startup with no marketplace step.
- **Varonis Pinchy phishing-resistant compatible (2026-06-10)** — Varonis Threat Labs proved OpenClaw agents can be socially engineered into forwarding credentials; the VS Code status-bar UI refuses to render "forward credentials to …" prompts and the underlying `woclaw` channel filters payloads matching AWS_/SECRET/SSH-KEY/DB-PASS without `--allow-credential-forward`; `WOCLAW_AUDIT_LOG=1` is on by default so enterprise security teams can audit what was sent — `phishing-resistant-2026-06` / `varonis-openclaw-pinchy` / `openclaw-os-level-sandbox-mxc-pin`.
- **Claude Code v2.1.177 plugin marketplace compatible (2026-06-13)** — Claude Code plugin marketplace entered a daily-iteration regime (v2.1.177 = 8th release in 16 days since v2.1.157); `claude project purge [path]` lets woclaw-vscode users preview-cleanup status-bar + sidebar tree state on uninstall; `/plugin update` correctly detects woclaw-vscode Marketplace version bumps; Bedrock default-model region-prefix fix stabilises AWS Bedrock Hub routing from VS Code — `claude-code-v2-1-177-plugin-marketplace` / `claude-project-purge-compatible` / `plugin-update-npm-sourced-fix`.

## Skill Creator 2.0 verifiable (2026-05-17, 评测 / A-B / auto-optimize)

This SKILL.md ships with a verifiability fixture at `tests/test_woclaw_vscode_skill.json` consumable by Anthropic **Skill Creator 2.0** (released 2026-05-17), which added three capabilities: (a) **eval** — Claude auto-generates test inputs, runs the Skill-on vs Skill-off pair, and quantifies pass-rate / failure / delta; (b) **A/B benchmarks** — same input set under loaded-vs-unloaded Skill, blind side-by-side, decision rule (regress → drop / slight lead → keep / large lead → expand); (c) **auto-optimize trigger** — Skill Creator 2.0 re-runs the suite on model upgrade or scene change without human prompting.

Run against this skill from CI:

```bash
# baseline vs skill-on delta
claude skill eval woclaw-vscode --tests packages/woclaw-vscode/tests/test_woclaw_vscode_skill.json
# A/B mode
claude skill eval woclaw-vscode --tests packages/woclaw-vscode/tests/test_woclaw_vscode_skill.json --ab
# auto-optimize on regression
claude skill eval woclaw-vscode --tests packages/woclaw-vscode/tests/test_woclaw_vscode_skill.json --ab --auto-optimize
```

Three woclaw-vscode verifiability cases ship in the fixture:
- **tc-01-status-bar-health-up** — stub a Hub `GET /health` returning `{"status":"ok"}` and assert the extension's status-bar item resolves to 🟢 `WoClaw: up (N agents, M topics)` after one poll cycle (status-bar Hub probe correctness).
- **tc-02-sidebar-tree-topics** — stub `GET /topics` returning a 2-topic payload and assert the "WoClaw" sidebar tree renders both topics with name + message_count + agent_count (tree-view Hub read correctness).
- **tc-03-peek-memory-key-readonly** — invoke `WoClaw: Peek Memory Key` with key `project:context`, stub `GET /memory/project:context` returning a 200 with body, and assert the editor tab opens in **read-only** mode (no edits allowed, prevents credential exfiltration via editor save-as — Varonis Pinchy phishing-resistant guarantee).

Decision rule per case: `skill_score >= baseline_score + delta_threshold` (delta_threshold = 0.5). The fixture is part of the npm tarball (`files: ["tests/**/*"]` in `packages/woclaw-vscode/package.json`) so a `npm install woclaw-vscode` user (or VS Code Marketplace install) gets the fixture immediately for Skill Creator 2.0 CI eval.


## Compatible with (ClawHub 52.7k tools 6 倍爆发 + 中国镜像站首日入口 + 中国官方 Skill 三件套 compatible)

ClawHub 52.7k tools (180k users + 12M downloads + 4.8 avg rating) + China mirror-cn.clawhub.com + 36氪/百度优选/万兴科技中国官方 Skill 三件套 compatible (2026-06-14 OpenClaw 中国可发现性 + 50k+ 主流 marketplace 锚定首批)

## Compatible with (cross-ecosystem)

- **Google Gemma 4 12B on-device (2026-06-03, Apache 2.0, 16GB VRAM)** — Gemma 4 12B 是 2026-06-03 Google 发布的 11.95B 多模态开源模型 (encoder-free Unified 架构 + 256K context + native agentic tool-use + 16GB VRAM 本地可跑), 在 VS Code 内 `woclaw-vscode` 状态栏 + 侧边栏可探测本地 `woclaw-hub` 状态, 当 hub 配置为 `WOCLAW_AGENT_PROVIDER=local-gemma-4-12b` 时, status-bar 显示本地 Gemma 4 12B agent 的 on-device 运行状态, 16GB 笔记本开发者无需云 API 即可监控本地 OpenClaw agent — `gemma-4-12b-on-device` / `encoder-free-multimodal` / `256k-context-on-device`.