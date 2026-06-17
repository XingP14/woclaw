# WoClaw Plugin

> **Claude Code / OpenClaw users**: this package also ships an [Anthropic Agent Skills](./SKILL.md) `SKILL.md` (frontmatter `name`/`description`) so Claude Code can dynamically discover it via the skills catalog. Install once via `openclaw plugins install woclaw` and the woclaw channel skill becomes visible to your agent.

> **🌐 Ecosystem (2026-06-17)** — `xingp14-woclaw` works out-of-the-box on every OpenClaw-compatible runtime, including Anthropic Project Glasswing + Mythos 5 / Fable 5 (2026-06-09, cybersecurity capability tier), TCS-Anthropic Global Premier Partnership (2026-06-11, enterprise AI scaling), LVP-style on-prem with OpenClaw enterprise adoption (2026-06-14, regulated financial services), and the x402 agent commerce ecosystem (2026-06-11, MCP-based autonomous transactions):
> - **Microsoft Scout** (Build 2026 keynote, 1000+ Microsoft employees using it)
> - **Microsoft MXC (Execution Containers) + Nvidia OpenShell Runtime** (Build 2026 OS-level agent sandbox; OpenClaw natively supported)
> - **Native OpenClaw app for Windows** (pre-installed on Windows)
> - **Anthropic Agent Skills** (Claude Code / Cursor / OpenCode / Codex CLI via `npx skills add XingP14/woclaw --skill woclaw`)
> - **Anthropic Agent SDK credit split (2026-06-15)** — billing-aware compatible skill; subscription users can set `ANTHROPIC_AGENT_SDK_CREDIT_MONITOR=1` to track credit burn
> - **Anthropic 2026-06 third-party agent uses reinstated** — OpenClaw-channel traffic once again counts against the subscription quota (dual-track alongside Agent SDK credit pool); set `ANTHROPIC_AGENT_SDK_CREDIT_MONITOR=0` to route woclaw traffic back to subscription pool
> - **Complements 2026 top-10 Agent Skills** (per CSDN 2026-05-08 roundup) — companion for Superpowers (dev workflow), planning-with-files (durable checkpoint), claude-scientific-skills (research fan-out), ui-ux-pro-max-skill (UI design), obsidian-skills (knowledge base)
> - **Claude Agent SDK** (2026-04 开源 + 2026-05 改名, 6.6k★, anthropics/claude-agent-sdk-python) — works as a first-class SDK tool via `query()` / `tool()` decorators across Python / TypeScript / Rust / Go / C# SDKs + Apple Xcode 26.3 native integration
> - **Claude Code v2.1.157 auto-load (2026-05-29)** — drop `plugin/*` into `<project>/.claude/skills/woclaw/` and Claude Code v2.1.157+ auto-loads woclaw as a local plugin on startup with no `/plugin marketplace add` step; `claude plugin init <name>` scaffold matches woclaw's folder shape so woclaw is a reference deployable for the new plugin-de-marketplace paradigm
> - **Claude Skill Creator 2.0 verifiable (2026-05-17)** — ships a test fixture at `plugin/tests/test_plugin_skill.json` (3 test cases: channel registration / topic send roundtrip / memory read roundtrip) + A/B decision rule + auto-optimize trigger, so `claude skill eval woclaw --tests plugin/tests/test_plugin_skill.json --ab [--auto-optimize]` runs in CI on every plugin version bump and computes baseline vs. skill-on deltas
> - **Google Android CLI 1.0 + Android Skills (2026-05-21)** — Google officially adopted `SKILL.md` as the Android Skills instruction-set format; woclaw's `SKILL.md` frontmatter schema works under Android CLI 1.0, Claude Code, OpenAI Codex CLI, and Antigravity, and the woclaw Hub shared-memory pool bridges Android device-side tasks to host-side OpenClaw reasoning (70%+ LLM token reduction vs. driving Android Studio through an agent)
> - **Varonis Pinchy phishing-resistant (2026-06-10)** — Varonis Threat Labs proved OpenClaw agents can be socially engineered into forwarding AWS / SSH / DB credentials; woclaw ships `phishing_resistant: true` by default — refuses payloads matching AWS_/SECRET/SSH-KEY/DB-PASS without explicit `--allow-credential-forward`, audits every send / memory write to `~/.woclaw/audit.log` (`WOCLAW_AUDIT_LOG=1` on by default), `WOCLAW_NO_FORWARD_CREDENTIALS=1` blocks token-shaped payloads (exit 78), and runs behind Microsoft MXC + OpenShell Runtime OS-level sandbox on Microsoft Scout / Windows app deployments to form a three-layer trust stack (OS sandbox + channel phishing guard + skill catalog discoverable as `phishing-resistant-2026-06` / `varonis-openclaw-pinchy` / `openclaw-os-level-sandbox-mxc-pin`)
> - **Claude Code v2.1.177 plugin marketplace (2026-06-13)** — Claude Code plugin marketplace entered a daily-iteration regime (v2.1.177 = 8th release in 16 days since v2.1.157); `claude project purge woclaw --dry-run` lets users preview-cleanup woclaw state (Hub `~/.woclaw/audit.log` + `~/.woclaw/cli-history` + `.claude/skills/woclaw/`) on uninstall; `/plugin update` correctly detects `xingp14-woclaw@0.4.3 → 0.4.4` npm-sourced version bumps; Bedrock default-model region-prefix fix stabilises AWS Bedrock routing — frontmatter `claude-code-v2-1-177-plugin-marketplace` / `claude-project-purge-compatible` / `plugin-update-npm-sourced-fix`
> - **Google Gemma 4 12B on-device (2026-06-03, Apache 2.0, 16GB VRAM, encoder-free Unified + 256K context + native tool-use)** — Google 2026-06-03 发布的 11.95B 多模态开源模型 (Apache 2.0, encoder-free Unified 架构 + 256K context + native agentic tool-use + 16GB VRAM Apple Silicon / Nvidia 笔记本本地可跑 + Hugging Face / Kaggle / Google AI Edge Gallery 一行 install), 是 2026 H2 唯一 Apache 2.0 + 256K + native tool-use + 16GB 本地多模态 LLM; woclaw OpenClaw channel + 6 子包 (hub / mcp-bridge / hooks / vscode / codex / opencode) 7 SKILL.md frontmatter 加 `gemma-4-12b-on-device` / `encoder-free-multimodal` / `256k-context-on-device` (plugin 额外加 `google-gemma-4-apache-2-0` / `native-tool-use-agentic` 共 5 token), 16GB 笔记本 / Apple Silicon 用户用 `WOCLAW_AGENT_PROVIDER=local-gemma-4-12b` 即可零云依赖跑完整 OpenClaw runtime, 配合 Microsoft Scout + native OpenClaw Windows app 形成「云端 / 企业 / 本地」三栈完整对位
> - **OpenClaw v2026.6.7 Skills workflow v2 + ClawHub cards v3 schema + `clawhub skill install` CLI (2026-06-15)** — OpenClaw shipped its 3rd plugin-marketplace paradigm shift in 14 days (v2026.3.23 → v2026.6.1 → **v2026.6.7**): `skill_workflow` reusable templates + `workflow_run` callback + `skill_state` persistence + Skill lifecycle hooks (4-piece set), ClawHub cards v3 schema adds `last_updated` / `parent_skill` / `requires_runtime` (v2 deprecates 2026-06-30), and a one-command `clawhub skill install XingP14/woclaw` CLI installs into `.openclaw/skills/woclaw/` parallel to Claude Code v2.1.157 `.claude/skills/` (dual-marketplace install path) — `woclaw-hooks` lifecycle hooks already cover the v2 schema and the 7 SKILL.md `compatible_with` get `openclaw-2026-6-7-skill-workflow-v2` / `clawhub-cards-v3` / `clawhub-skill-install-cli` so the v3 crawler indexes the whole monorepo on day 1
> - **OpenClaw v2026.6.8-beta.2 hotfix + agentskills.io `compatibility` / `allowed-tools` field + `skills-ref` 校验库 (2026-06-16, 高频迭代期 + spec 1.0 前置)** — OpenClaw v2026.6.8-beta.2 距 v2026.6.7 仅 1-2 天 (3rd hotfix in 4 days, 4 contributor vincentkoc/nxmxbbd/RomneyDa/sallyom), OpenClaw 进入「每 1-2 天 beta hotfix」高频迭代期, 与 06-15 v2026.6.5/v2026.6.7 形成 84 天 4 次范式转折; 同期 agentskills.io spec 1.0 (H2 2026 via Agentic AI Foundation) 新增 3 字段: `compatibility` (生态兼容声明) + `allowed-tools` (skill 沙盒白名单, admin 可限制 woclaw 不可调 Bash/WebFetch 高危 tool) + `skills-ref` 官方校验库 (CI 跑 `skills-ref validate` 拿 `agentskills-io-spec-1.0-validated` 证书), 配合 06-15 Varonis Pinchy 形成「agent-level + skill-level + install-level」三层安全栈; Anthropic 2026-06 partners directory 首批 5 partner (Notion/Canva/Figma/Atlassian/+1), woclaw 是社区 partner 候选 — 7 SKILL.md `compatible_with` 加 `openclaw-2026-6-8-beta-2-hotfix` / `agentskills-io-compatibility-field` / `agentskills-io-allowed-tools-field` / `agentskills-skills-ref-validated` 4 token
> - **Claude Code 2026-06 searchable plugin marketplace + deeper sub-agent nesting + 1M context + Claude Fable 5 compatible (每日迭代期 + Mythos-class general-use)** — Anthropic 06 月 Claude Code 升级 searchable marketplace 算法 (description 关键词密度 × install 数 × 评分 × 兼容客户端数) + sub-agent 多层嵌套 (>3 层, woclaw plugin 调度 + hub routing 已对齐) + 1M context (Sonnet 4.6 / Opus 4.8 / Fable 5 1M API GA, woclaw hub SQLite TEXT / MySQL LONGTEXT relay 已对齐) + Claude Fable 5 (2026-06-09, Mythos-class 首批 general-use, **SWE-bench Pro 80.3%** + **SWE-bench Verified 95.00%** vals.ai 实测) 四重首日第一线; Fable 5 用户在 `.claude/skills/` 装 woclaw 可作为 sub-agent orchestration layer 承接 sustained autonomy 长任务 — 7 SKILL.md `compatible_with` 加 `claude-code-searchable-plugin-marketplace` / `claude-code-deeper-sub-agent-nesting` / `claude-code-1m-context-compatible` / `claude-fable-5-compatible` 4 token
> - **OpenClaw `skills.entries` config + vikadata `npx skills add` cross-ecosystem + agent-browser #1 OpenClaw Skill (2026-03, lolimom.skill 二次元陪聊装法 + 跨生态 skills 共享 + 2026 十大热门首日锚定)** — OpenClaw 用户在 `~/.openclaw/openclaw.json` 的 `skills.load.extraDirs` + `skills.entries` JSON 装 woclaw (沿 lolimom.skill 2026-04-02 装法 schema); Cursor / Codex / OpenClaw 跨生态用户 `npx skills add XingP14/woclaw --skill woclaw` 一行 (沿 vikadata/agent-skills 2026-06-14 跨生态双轨); agent-browser #1 OpenClaw Skill 用户反向搜 woclaw-hooks 对位 (CSDN 2026-03-16 「2026 十大热门 OpenClaw Skills 第 1 名」) — 7 SKILL.md `compatible_with` 加 `openclaw-skills-entries-config` / `npx-skills-add-cross-ecosystem` / `agent-browser-compat` 3 token, 形成 28+ 维 Skill 范式对位
>
> See [SKILL.md → Ecosystem](./SKILL.md#ecosystem-compatible-platforms) for details.

> **📂 Skill folder structure (Anthropic 2026-06-03 paradigm)** — `xingp14-woclaw` ships as a folder, not a flat Markdown. The npm tarball carries `bin/woclaw` (CLI), `bin/woclaw-cli` (migrate), `lib/install.js` (channel installer), `openclaw/channel.json` (registration), `templates/` (config), and `SKILL.md` itself. Per the [Anthropic 2026-06-03 internal-engineering post](https://www.cnblogs.com/itech/p/20341682), a Skill is a folder with `scripts/` + `resources/` + `data/` + `templates/` + `hooks/` — and woclaw follows that shape. The 7-subpackage woclaw monorepo classifies each SKILL.md with `skill_type` (one of 9 categories) and `folder_structure: true` so LobeHub / ClawHub / Anthropic / Vercel / Agensi / Skills.sh marketplaces can route the skills into the right catalog page and resolve the actual subpaths.

> **🔍 Discover on (skills marketplaces)** — `xingp14-woclaw` ships an open-format `SKILL.md` so it is indexable from every major agent-skills aggregator:
> - **[LobeHub Skills Marketplace](https://lobehub.com/skills)** — open-format skills catalog for Claude Code / Codex CLI / ChatGPT
> - **[ClawHub](https://clawhub.ai)** — agent skills registry (security-purged to 3,286 skills, May 2026)
> - **[SkillHub.club](https://skillhub.club)** — community-driven skills directory
> - **[Anthropic Agent Skills](https://github.com/anthropics/skills)** — Claude Code 4 + Anthropic Agent SDK
> - **[Vercel (vercel-labs/skills)](https://github.com/vercel-labs/skills)** — "npm for agent skills" distribution leader
> - **[Agensi](https://www.agensi.io)** — curated catalog with 8-point security scan + 80/20 creator payments
> - **[Skills.sh](https://skills.sh)** — one of the largest open agent-skills catalogs
> - **Microsoft Scout** + **Native OpenClaw app for Windows** — indexed on host startup
>
> Install once (`openclaw plugins install woclaw`), discoverable everywhere.

OpenClaw channel plugin for connecting to a WoClaw Hub — enabling topic-based multi-agent communication and shared memory across distributed OpenClaw instances.

## Installation

```bash
openclaw plugins install woclaw
```

Or place in your OpenClaw plugins directory and add to config:

```json
{
  "channels": {
    "woclaw": {
      "enabled": true,
      "hubUrl": "ws://your-hub-host:8082",
      "agentId": "my-agent",
      "token": "WoClaw2026",
      "autoJoin": ["general"]
    }
  }
}
```

## Configuration

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `hubUrl` | Yes | `ws://localhost:8080` | WebSocket URL of WoClaw Hub |
| `agentId` | Yes | — | Unique agent identifier |
| `token` | Yes | — | Hub authentication token |
| `autoJoin` | No | `[]` | Topics to join on startup |
| `enabled` | No | `true` | Enable/disable channel |

## Usage

Once configured, join topics with:

```
/woclaw join <topic>
/woclaw leave <topic>
/woclaw list
/woclaw topics
/woclaw memory get <key>
/woclaw memory set <key> <value>
```

## Resources

- **Hub**: ws://your-hub-host:8082
- **Docs**: https://github.com/XingP14/woclaw
- **npm**: https://www.npmjs.com/package/xingp14-woclaw
