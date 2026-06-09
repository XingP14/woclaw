# Project Roadmap

This file exists because some OpenClaw runtime paths still look for `ROADMAP.md` at the repository root.

- Canonical roadmap: [`docs/ROADMAP.md`](./docs/ROADMAP.md)
- If the runtime reads this file directly, use it as the project entry point.

_Last updated: 2026-06-04 — RS-1 Step 1 done (woclaw-hub 仓拆分方案设计; see docs/RS-1-REPO-SPLIT-HUB-PLAN.md)_

## 候选待推进项 (cron 调研池)

- [2026-06-09 22:03 父亲心跳-市场调研] **woclaw-hooks 增加 Anthropic SKILL.md 合规 (Claude Code Skills 目录可发现)** — 2026-02 Anthropic 正式发布 Agent Skills 标准 (SKILL.md frontmatter + 动态发现, https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills), 2026-04 Claude Code 4 redesign + 2026-06 「Code with Claude 2026」5 new agent features 都把 skills 列为一等公民, 2026 第三方 skills 目录 (developersdigest 汇总) 列入 woclaw 同类候选; 现在 woclaw-hooks (0.5.0, 15-file tarball clean) 是最 skill-like 的包 (PreCompact/Stop event hooks), 加 1 个 SKILL.md (frontmatter: name/description + 安装/触发/输出) 即可被 Claude Code 动态发现, 不改 install.js 行为; 5min 步骤: 1 file (~50 行) + 1 README 引用; 下次轮转直接做。 ✅ **2026-06-09 22:23 完成** — `packages/woclaw-hooks/SKILL.md` (5.6 KB / ~120 行, frontmatter name+description + When-to-use / What-it-installs / Inputs / Outputs / Verification / Failure-modes / Source) + README.md 顶部 1 段引用 + package.json keywords 加 `agent-skills / claude-skills / anthropic-skills`。 不动 install.js / *.sh hook 脚本。

- [2026-06-09 23:23 父亲心跳-市场调研] **给 woclaw 其余 6 子包统一加 SKILL.md (Claude Code / OpenCode / Cursor / Copilot 多平台 skills 目录发现)** — 2026-06-08 菜鸟教程汇总 (https://www.runoob.com/claude-code/claude-agent-skills.html) 列 Claude Skills 已扩展至 Claude Code + Anthropic Agent SDK + VS Code Copilot (.github/skills/) + Cursor (.cursor/skills/) + OpenCode 全平台; 2026-05-27 CSDN 「GitHub 星标破万」+ 2026-04-07 「npx skills add <GitHub> --agent claude-code -g」一键安装命令普及, skills 目录已成 Claude Code 「一等公民」; woclaw monorepo 7 子包中 woclaw-hooks 已 ✅ 22:23 完成 SKILL.md, **剩 6 包**: `woclaw` (核心 daemon) / `woclaw-cli` / `woclaw-vscode` / `woclaw-mcp` (MCP server) / `woclaw-templates` (项目模板集) / `woclaw-hub` (web 调度); 每包加 1 个 SKILL.md (~80 行, 沿 woclaw-hooks 7 段模板: When-to-use / What-it-installs / Inputs / Outputs / Verification / Failure-modes / Source) + 1 段 README 顶部 callout 引用 + 1 个 package.json keyword, 即可让用户 `npx skills add XingP14/woclaw` 全局安装整套 woclaw skills; 5min 步骤 (挑 1 包先做 woclaw-cli, 沿 hooks 模板复制, 验证 publish + Claude Code skills 目录可发现); 后续 5 包各 5min 累进; 价值: 把 woclaw 整套 monorepo 推到 Claude Skills 生态第一线, 与 vercel-labs/skills / anthropics/skills 第三方汇总目录并列。 1 包估 5min, 7 包全套 30-35min (跨 7 轮 cron 完成, 每轮 1 包)。

