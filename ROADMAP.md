# Project Roadmap

This file exists because some OpenClaw runtime paths still look for `ROADMAP.md` at the repository root.

- Canonical roadmap: [`docs/ROADMAP.md`](./docs/ROADMAP.md)
- If the runtime reads this file directly, use it as the project entry point.

_Last updated: 2026-06-04 — RS-1 Step 1 done (woclaw-hub 仓拆分方案设计; see docs/RS-1-REPO-SPLIT-HUB-PLAN.md)_

## 候选待推进项 (cron 调研池)

- [2026-06-09 22:03 父亲心跳-市场调研] **woclaw-hooks 增加 Anthropic SKILL.md 合规 (Claude Code Skills 目录可发现)** — 2026-02 Anthropic 正式发布 Agent Skills 标准 (SKILL.md frontmatter + 动态发现, https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills), 2026-04 Claude Code 4 redesign + 2026-06 「Code with Claude 2026」5 new agent features 都把 skills 列为一等公民, 2026 第三方 skills 目录 (developersdigest 汇总) 列入 woclaw 同类候选; 现在 woclaw-hooks (0.5.0, 15-file tarball clean) 是最 skill-like 的包 (PreCompact/Stop event hooks), 加 1 个 SKILL.md (frontmatter: name/description + 安装/触发/输出) 即可被 Claude Code 动态发现, 不改 install.js 行为; 5min 步骤: 1 file (~50 行) + 1 README 引用; 下次轮转直接做。 ✅ **2026-06-09 22:23 完成** — `packages/woclaw-hooks/SKILL.md` (5.6 KB / ~120 行, frontmatter name+description + When-to-use / What-it-installs / Inputs / Outputs / Verification / Failure-modes / Source) + README.md 顶部 1 段引用 + package.json keywords 加 `agent-skills / claude-skills / anthropic-skills`。 不动 install.js / *.sh hook 脚本。

