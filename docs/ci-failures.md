## CI Failure 2026-06-11 09:03:27 — woclaw @ 33513f2
- run: https://github.com/XingP14/woclaw/actions/runs/27311237420
- failed jobs: Hub (lint + build + test)
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
