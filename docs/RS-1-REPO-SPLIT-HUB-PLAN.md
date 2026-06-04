# RS-1: Repo 拆分 — woclaw-hub 方案

> Step 1 of Story RS-1 — 评估将 `hub/` 拆为独立 repo [XingP14/woclaw-hub](https://github.com/XingP14/woclaw-hub) 的可行性与步骤

> **背景**：当前 WoClaw 是 monorepo（hub + plugin + mcp-bridge + packages/），但 `hub/` 已经基本独立 —— 独立 package.json、独立 Dockerfile、独立 README、独立 test 目录、独立 systemd unit、独立 CI workflow。把它从 monorepo 拆成独立 repo 可让 hub 走自己的发布周期（当前 0.5.0 已经领先 workspace meta-package），同时简化主仓关注点。
> 拆分顺序（来自 ROADMAP `Repo 拆分计划`）：**hub（核心）→ codex/hooks/mcp（集成）→ vscode/plugin（生态）→ meta repo**。本文件仅设计 hub 拆分。

## 📊 现状审计（hub/ 是否已可独立）

### ✅ 已自包含的部分

| 资源 | 位置 | 状态 |
|------|------|------|
| `package.json` | `hub/package.json` | ✅ name=`woclaw-hub` v0.5.0，独立依赖（better-sqlite3 / mysql2 / node-cron / uuid / ws） |
| `tsconfig.json` | `hub/tsconfig.json` | ✅ 独立 TS 配置 |
| `Dockerfile` | `hub/Dockerfile` | ✅ node:20-bookworm-slim，8082/8083 双端口 |
| `README.md` | `hub/README.md` | ✅ Hub 独立文档 |
| `test/` | `hub/test/*.test.ts` | ✅ Vitest 单元测试 + 集成测试 |
| `public/` | `hub/public/index.html` | ✅ Web UI（Dashboard 静态文件） |
| systemd unit | `hub/woclaw-hub.service` | ✅ 服务化部署文件 |
| `test-connect.mjs` / `test-hub.mjs` | `hub/` | ✅ smoke 脚本 |
| CI workflow | `.github/workflows/ci.yml` | ✅ `working-directory: hub`（lint + build + test） |
| Docker workflow | `.github/workflows/docker.yml` + `docker-publish.yml` | ✅ `working-directory: hub` |
| npm publish workflow | `.github/workflows/hub-publish.yml` | ✅ `hub/v*` tag → `woclaw-hub@*` |
| 已发布 | npm `woclaw-hub@0.5.0` | ✅ 独立发布历史（0.1.0 → 0.5.0） |
| 已发布 | Docker Hub `xingp14/woclaw-hub` | ✅ 独立镜像 |

### ⚠️ 需要在 split 阶段处理

| 资源 | 位置 | 处理方式 |
|------|------|---------|
| `.github/workflows/{ci,docker,docker-publish,hub-publish}.yml` | monorepo 根 | 主仓保留，但删除 `hub/*` 工作流；`XingP14/woclaw-hub` 新仓照搬 |
| `docs/PUBLISH.md` hub 章节 | `docs/PUBLISH.md` | 主仓保留发布流程，但 hub 段加链接指向新仓 |
| `docs/README.md` / `docs/README_zh.md` hub 介绍 | docs/ | 改写为 "woclaw-hub 独立仓 + npm 包 + Docker 镜像"，不再指向 `hub/` |
| `docs/INSTALL.md` docker 命令 | docs/ | 同上，hub 部署命令改指向新仓 |
| `plugin/`、`mcp-bridge/`、`packages/` 等对 `hub/` 的引用 | monorepo 根 | 这些会拆为独立仓，跨仓引用通过 npm 包名 `woclaw-hub` |
| git history | 全 monorepo | 用 `git filter-repo --subdirectory-filter hub` 提取 hub/ 完整历史到新仓 |

### ❌ 不需要处理（hub 本身已干净）

- `hub/src/**` 不引用 monorepo 其他子包（`ws_server.ts` / `rest_server.ts` / `extraction/engine.ts` 等都是纯内部模块）
- `hub/test/**` 不引用 monorepo 兄弟包
- `hub/public/index.html` 是纯静态（fetch 自身 REST API）

## 🛠️ Split 步骤设计（待后续 Step 执行）

> 仅设计，本 Step 不实际执行。下面是预估的 3 个 Step 拆分，**每个 Step 不超过 10 分钟**，符合心跳约束。

### Step 2 (10min)：准备新仓 XingP14/woclaw-hub
- 在 GitHub 创建新 repo `XingP14/woclaw-hub`（空仓，README/LICENSE 由 filter-repo 注入）
- 配置 GitHub Secrets：`NPM_TOKEN`、`DOCKERHUB_USERNAME`、`DOCKERHUB_TOKEN`
- 配置 GitHub branch protection（master/main）

### Step 3 (10min)：用 `git filter-repo` 提取 hub/ 历史
```bash
# 假设主仓叫 'woclaw'，要拆的子目录是 hub/
cd /tmp
git clone --no-hardlinks https://github.com/XingP14/woclaw.git woclaw-hub-extract
cd woclaw-hub-extract
git filter-repo --subdirectory-filter hub/ --force
# 此时仓库只剩 hub/ 内容（含完整 git history）
git remote add origin https://github.com/XingP14/woclaw-hub.git
git push -u origin master
```
- 验证：新仓 git log 与主仓 `hub/` 历史一致
- 验证：CI workflow 全部运行通过

### Step 4 (10min)：主仓调整引用
- 删除主仓 `.github/workflows/{docker,docker-publish,hub-publish}.yml`（或保留但加 deprecation comment）
- `docs/PUBLISH.md`、`docs/INSTALL.md`、`docs/README.md`、`docs/README_zh.md` 全文替换 `hub/` 部署命令为 `git clone https://github.com/XingP14/woclaw-hub` + 链接到 npm/Docker Hub
- 更新根 `package.json` 的 `workspaces` 数组，移除 `hub`
- 更新 ROADMAP `Repo 拆分计划` 表格，woclaw-hub 状态从"待拆分"改为"✅ 已拆分 https://github.com/XingP14/woclaw-hub"
- 更新 CHANGELOG：unreleased 段加 "Repo split: woclaw-hub 拆为独立仓"
- 主仓 hub/ 文件夹保留为 deprecated stub（带 README 指向新仓），或直接删除（取决于 monorepo meta 仓策略）

## 🎯 完成判定

- [ ] `XingP14/woclaw-hub` 公开可访问
- [ ] 新仓的 `git log` 与主仓 `hub/` 历史一致
- [ ] 新仓 CI 全部通过
- [ ] 新仓可 `npm install woclaw-hub` 装到主仓
- [ ] 新仓可 `docker pull xingp14/woclaw-hub:0.5.0`
- [ ] 主仓的 docker / install 文档全部指向新仓
- [ ] ROADMAP + CHANGELOG 已更新

## ⚠️ 风险与备选

- **风险 1：git filter-repo 漏掉 dotfiles**  
  → 解决：先 `git filter-repo --subdirectory-filter hub/` 然后 `cp -r hub/.github /tmp/` 再 push，最后在新仓放回 ci workflow  
  → 或更简单：在新仓手动复制 `.github/workflows/ci.yml` + `docker.yml` + `hub-publish.yml`

- **风险 2：拆分后主仓 `npm install` 找不到 woclaw-hub**  
  → 解决：主仓 README + INSTALL 引导用户 `npm install woclaw-hub`（从 npm registry），不再走 workspace

- **风险 3：split 后 monorepo 失去 hub 单元测试**  
  → 解决：主仓 `integration-test/` 目录只做端到端测试，hub 单元测试已在新仓

## 📌 与 ROADMAP 的关系

本文档完成后，ROADMAP 应当新增：

```
#### Story RS-1: woclaw-hub 仓拆分
- [x] **Step 1 (10min): woclaw-hub 拆分方案设计** ✅ 2026-06-04
  - 输出：docs/RS-1-REPO-SPLIT-HUB-PLAN.md
  - 确认 hub/ 已自包含（独立 package.json / Dockerfile / README / test / CI）
  - 设计 3 步执行计划：建新仓 → filter-repo → 主仓调整引用
- [ ] Step 2 (10min): 在 GitHub 创建 XingP14/woclaw-hub 仓 + 配置 Secrets
- [ ] Step 3 (10min): git filter-repo 提取 hub/ 历史 + 推送
- [ ] Step 4 (10min): 主仓删 hub/ 工作流 + 文档改写
```

并把 `Repo 拆分计划` 表中 woclaw-hub 行的状态从"待拆分"改为"🚧 Step 1 done (方案设计)"。

---

_Last updated: 2026-06-04 (Step 1 of Story RS-1)_
