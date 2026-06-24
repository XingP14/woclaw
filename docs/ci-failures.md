## CI Failure 2026-06-11 09:03:27 — woclaw @ 33513f2
- run: https://github.com/XingP14/woclaw/actions/runs/27311237420
- failed jobs: Hub (lint + build + test)
- status: ⚠️ SUPERSEDED by 09:11 entry below — true root cause was db.ts storedValue, not vitest/config module load (see 06-11 09:11 entry)
### Error excerpt
```
167:failed to load config from /home/runner/work/woclaw/woclaw/vitest.config.ts
169:⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯
170:Error: Cannot find module 'vitest/config'
193:npm error Lifecycle script `test` failed with error:
194:npm error code 1
195:npm error path /home/runner/work/woclaw/woclaw/hub
196:npm error workspace woclaw-hub@0.5.0
197:npm error location /home/runner/work/woclaw/woclaw/hub
198:npm error command failed
199:npm error command sh -c vitest run
```

## CI Failure 2026-06-11 09:11 — woclaw @ ff3d358 / run 27316790587

**Failed jobs**: Hub (lint + build + test)
**Root cause**: 真实代码 bug — `hub/src/db.ts` line 591 `tx({ key, value, ... })` 传的是原始入参 `value`（明文），而非 line 520 计算的 `storedValue`（加密后）。导致 encryption-at-rest 在 `setMemory` 路径失效，DB 存的是明文。

**修复尝试 (09:14)**:
- 已修复 1 行：`tx({ key, value, ... })` → `tx({ key, value: storedValue, ... }`
- 修复后主路径（setMemory / getMemory）正确返回 ENC:v1: 前缀
- 但暴露**第二层 bug**：
  - `getMemoryVersions` 解密时拿到的是 `existing.value`（已被前一次 fix 加密的密文，存到 history），逻辑路径对，但下游测试期望"history 解出来是明文"——而 mp.recall 类业务路径在 encryption-at-rest 模式下**根本搜不到密文**
  - 这属于**架构问题**：encryption-at-rest 与可搜性冲突 — 当前实现选择前者（不可搜），但测试期望后者（既加密又可搜）
  - 需要 2 选 1：(a) 拆索引/值列（明文存索引列 + 密文存值列）或 (b) 文档化"encryption 模式下 recall 不可用"

**已回滚**: `git checkout hub/src/db.ts`（保留失败状态，避免引入更深的 bug）
**下一步建议**: 由许成拍板 (a) / (b) 哪个方向，再分 Story 处理

**自愈误判记录 (06-11 09:03)**:
- cicd-watch.sh 6c 规则把"Cannot find module 'vitest/config'"判为模块缺失自动 npm install -D vitest
- 但 vitest 已在 lock；问题不是这个
- 真实失败是测试断言（2 个 failed），由"setMemory 没用 storedValue" + "encryption 与 search 不可兼得"导致
- 改进：6c 规则应只在**没有测试失败**时认为是 lock 漂移；测试失败时降级为 6d

## CI Failure 2026-06-19 21:07 (UTC) / 06-20 05:07 (Asia/Shanghai) — woclaw @ 30875fa
- status: ✅ **FIXED** by 06-20 05:03 cron
- run: 06-19 22:03 cron 起持续 RED (~7h), workspace vitest run 时 2 失败
- failed file: `hub/test/openclaw_migrate.test.ts`
- failed tests: 2/2 (`discovers workspace roots` + `summarizes transcript metadata`)
- 错误: `Cannot find module '/root/.../woclaw/packages/packages/woclaw-hooks/openclaw-migrate.js'`
- 根因: `MIGRATOR_PATH = path.resolve(process.cwd(), '..', 'packages/woclaw-hooks/openclaw-migrate.js')` 用 `process.cwd()` 计算路径, 当 vitest 在 `packages/woclaw-vscode/` 触发 workspace-wide test run 时 cwd 嵌套 `packages/packages/...` 重复段
- 修复: 改用 `path.resolve(__dirname, '..', '..', 'packages', 'woclaw-hooks', 'openclaw-migrate.js')` 基于 `__dirname` (test 文件位于 `hub/test/`, 固定锚定) 替代 `process.cwd()`, 加详细注释说明 regression 上下文
- 验证: workspace vitest 20/20 suites 219/219 tests ✅
- 06-11 09:11 entry (encryption-at-rest 架构问题) **仍未解**, 等父亲拍板 (a) 拆索引/值列 / (b) 文档化 recall 不可用

## Status snapshot (2026-06-25 07:23 CST)
- 06-11 09:03: SUPERSEDED by 09:11 (true root cause = db.ts storedValue bug).
- 06-11 09:11: OPEN — encryption-at-rest vs recall 架构选型仍等父亲拍板 (a) 拆索引/值列 / (b) 文档化 recall 不可用.
- 06-19/06-20 (MIGRATOR_PATH): ✅ FIXED by 06-20 05:03 cron.
