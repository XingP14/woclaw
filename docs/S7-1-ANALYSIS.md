# S7-1 分析：install.py vs install.js Codex 支持对比

## install.py（`packages/codex-woclaw/`）
- **定位**：Codex CLI 专用安装器（woclaw-codex npm 包）
- **安装脚本**：Python (`session_start.py`, `stop.py`, `precompact.py`) + bash 兼容脚本
- **hooks.json**：正确生成 Codex 原生 JSON hooks 结构（SessionStart/Stop/PreCompact）
- **config.toml**：自动追加 `[features] codex_hooks = true`
- **uninstall**：完整卸载支持（清除 hooks.json 中的 woclaw 条目）
- **发布状态**：`woclaw-codex@0.1.2` 已发布 npm

## install.js（`packages/woclaw-hooks/`）
- **定位**：多框架通用安装器（支持 claude-code/gemini/opencode/codex）
- **安装脚本**：bash 脚本（`codex-session-start.sh`, `codex-session-stop.sh`）
- **hooks.json**：生成相同结构（SessionStart/Stop），但 **不含 PreCompact**
- **config.toml**：提示用户手动添加，无自动追加
- **uninstall**：完整卸载支持
- **PreCompact 缺失**：settingsHint 中无 PreCompact 配置提示

## 结论

| 对比项 | install.py | install.js |
|--------|-----------|-----------|
| PreCompact hook | ✅ 完整支持 | ❌ 缺失 |
| config.toml 自动配置 | ✅ | ❌ 需手动 |
| uninstall 完整性 | ✅ | ✅ |
| 多框架支持 | ❌ 仅 Codex | ✅ 4种框架 |

**推荐方案**：`install.py` 作为 Codex 官方 installer（完整功能），`install.js --framework codex` 作为统一入口之一（多框架用户可用）。

**下一步（S7-2）**：统一 Codex 安装体验，建议在 `packages/woclaw-hooks/README.md` 明确说明推荐使用 `woclaw-codex`（install.py）或 `npx woclaw-hooks --framework codex`。
