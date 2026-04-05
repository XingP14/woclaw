# Gemini CLI Hooks Research — S1-1

**结论：✅ Gemini CLI 支持 Hook 系统（v0.26.0+）**

## 核心发现

### Hook 系统概述
- Gemini CLI 有完整的 hooks 框架（类似 Claude Code 但更规范）
- 通过 `~/.gemini/settings.json` 的 `hooks` 字段配置
- Hook 脚本通过 **stdin/stdout JSON** 通信（与 Claude Code 相同）
- 支持 **lifecycle hooks** 和 **tool-level hooks**

### 相关 Hook 事件（用于 WoClaw 集成）

| Hook | 触发时机 | Impact | WoClaw 用途 |
|------|----------|--------|-------------|
| **SessionStart** | 会话启动/恢复/清除时 | Context（注入上下文） | 从 Hub 读取 shared memory |
| **SessionEnd** | 会话结束时 | Advisory（建议性） | 将摘要写入 Hub memory |
| **PreCompress** | 上下文压缩前 | Advisory | 将关键信息写入 memory |
| **BeforeTool** | 工具执行前 | Block/Rewrite | 安全扫描（可选） |
| **AfterTool** | 工具执行后 | Block/Context | 处理结果（可选） |

### 配置格式
```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "woclaw-session-start",
            "type": "command",
            "command": "bash /path/to/gemini-session-start.sh"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "woclaw-session-end",
            "type": "command",
            "command": "bash /path/to/gemini-session-end.sh"
          }
        ]
      }
    ]
  }
}
```

### stdin 输入格式（Hook 接收的 JSON）
```json
{
  "sessionId": "string",
  "events": [...],
  "recentInteractions": [...,
  "currentDirectory": "string",
  ...
}
```

### stdout 输出格式（Hook 返回的 JSON）
```json
{
  "decision": "allow|deny|block",
  "systemMessage": "optional message to inject into context"
}
```

### 关键细节
1. **Silence is Mandatory**：stdout 只能输出 JSON，不能有普通文本
2. **Debug via stderr**：调试信息用 `echo "debug" >&2`
3. **Exit code 0** = 成功（即使是否决 `{decision: "deny"}`）
4. **Exit code 2** = System Block（严重拒绝，会终止操作）
5. **Project-level 配置**：`.gemini/settings.json` 优先级高于 `~/.gemini/settings.json`

## 实现方案

### Shell 脚本实现（推荐）

参考 Claude Code hook 脚本（`packages/woclaw-hooks/session-start.sh`）：

1. **gemini-session-start.sh**：
   - 读取环境变量 `WOCLAW_HUB_URL` + `WOCLAW_TOKEN`
   - curl GET `http://$WOCLAW_HUB_URL/memory/recent?limit=10`
   - 输出 JSON：`{"systemMessage": "..."}` 或空 `{}`
   - stderr 输出调试信息

2. **gemini-session-end.sh**：
   - 读取环境变量
   - 从 stdin 读取 hook 输入 JSON
   - curl POST session summary 到 WoClaw Hub
   - 输出 `{"decision": "allow"}`

### 安装方式
- 手动：复制脚本到 `~/.gemini/hooks/woclaw/` 并修改 `~/.gemini/settings.json`
- 自动化：`woclaw hook install --framework gemini-cli`

## 参考资料
- 官方文档：https://geminicli.com/docs/hooks/
- Writing Hooks：https://geminicli.com/docs/hooks/writing-hooks/
- Hooks Reference：https://geminicli.com/docs/hooks/reference/
- Google Developers Blog：https://developers.googleblog.com/tailor-gemini-cli-to-your-workflow-with-hooks/
