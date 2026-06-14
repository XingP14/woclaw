# WoClaw Plugin for OpenCode

> **Claude Code Skills discovery:** This package ships a [`SKILL.md`](./SKILL.md) (Anthropic Agent Skills frontmatter) so Claude Code / OpenCode can discover it via `npx skills add XingP14/woclaw --agent opencode -g`. See [Anthropic Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) for the standard.

Connect [OpenCode](https://opencode.ai) to a WoClaw Hub for shared memory and multi-agent coordination.

## 🧪 Skill Creator 2.0 verifiable (2026-05-17)

This package ships a verifiable test fixture under [`tests/test_opencode_woclaw_plugin_skill.json`](./tests/test_opencode_woclaw_plugin_skill.json) with **3 test cases** (plugin load + 6-tool registration smoke / `session.created` → `woclaw_memory_read project:context` round-trip / `session.compacted` → `woclaw_memory_write` checkpoint with Varonis Pinchy credential filtering). Run A/B benchmarking and auto-regress on model upgrade with:

```bash
claude skill eval opencode-woclaw --tests tests/test_opencode_woclaw_plugin_skill.json --ab [--auto-optimize]
```


## Features

- **Shared Memory**: Read/write/delete shared memory across OpenCode, OpenClaw, Claude Code, and Gemini CLI
- **Topic Messaging**: List topics on the WoClaw Hub
- **Context Injection**: Session hooks auto-load/save context to the Hub
- **Env Injection**: WoClaw config automatically available in all shell commands

## Installation

### Option 1: Local plugin (recommended)

```bash
# Create plugin directory
mkdir -p ~/.config/opencode/plugins/

# Copy this plugin
cp index.js ~/.config/opencode/plugins/woclaw.js
```

### Option 2: npm package

Add to your `opencode.json`:

```json
{
  "plugins": ["opencode-woclaw"]
}
```

Then install:
```bash
npm install opencode-woclaw
```

## Configuration

Set environment variables before starting OpenCode:

```bash
export WOCLAW_HUB_URL=ws://your-hub-host:8082
export WOCLAW_TOKEN=WoClaw2026
export WOCLAW_AGENT_ID=opencode-my-machine
export WOCLAW_REST_URL=http://your-hub-host:8083
export WOCLAW_PROJECT_KEY=project:context
```

Or add to your shell profile (`~/.bashrc`, `~/.zshrc`):

```bash
export WOCLAW_HUB_URL=ws://your-hub-host:8082
export WOCLAW_TOKEN=WoClaw2026
```

## Available Tools

Once installed, OpenCode can use these tools:

| Tool | Description |
|------|-------------|
| `woclaw_memory_read <key>` | Read a value from shared memory |
| `woclaw_memory_write <key> <value>` | Write to shared memory |
| `woclaw_memory_list` | List all memory keys |
| `woclaw_memory_delete <key>` | Delete a memory key |
| `woclaw_topics_list` | List available topics on the Hub |
| `woclaw_hub_status` | Check Hub connection status |

## Example Usage

```
> /woclaw_memory_write project-status "Using WoClaw for multi-agent coordination"

> /woclaw_memory_read project-status

> /woclaw_hub_status
```

## Shared Context Across Agents

After writing shared memory in OpenCode, other agents can read it:

```bash
# In OpenClaw or Claude Code:
/woclaw memory read project-status
```

## Events Hooked

The plugin subscribes to these OpenCode events:
- `session.created` → Load shared context from Hub
- `session.compacted` → Save session snapshot to Hub
- `shell.env` → Inject WOCLAW_* env vars into all shell commands

## See Also

- [WoClaw Hub](https://github.com/XingP14/woclaw) — Multi-agent communication relay
- [WoClaw MCP Bridge](https://github.com/XingP14/woclaw#mcp-bridge) — MCP server for WoClaw
- [WoClaw Hooks for Claude Code](https://github.com/XingP14/woclaw/tree/master/packages/woclaw-hooks) — Claude Code integration
