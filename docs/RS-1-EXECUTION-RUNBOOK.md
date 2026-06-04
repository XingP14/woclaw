# RS-1 Execution Runbook (Parent Action)

> **目的**：把 RS-1 Step 2/3/4 折叠成可复制粘贴的命令，让父端在 5-10 分钟内完成 `XingP14/woclaw-hub` 拆仓。
>
> **何时执行**：父端有 10 分钟空闲 + `gh` CLI 已 `auth login` 时。
>
> **前置**：方案设计见 [`RS-1-REPO-SPLIT-HUB-PLAN.md`](./RS-1-REPO-SPLIT-HUB-PLAN.md)；本文件只列执行命令，不重复设计。

---

## ⏱ 预估耗时

| Step | 内容 | 耗时 | 谁能跑 |
|------|------|------|--------|
| 0 | 环境准备 | 2 min | 父端 |
| 1 | 在 GitHub 创建 `XingP14/woclaw-hub` | 1 min | 父端（gh CLI） |
| 2 | 配置 Secrets + branch protection | 2 min | 父端（gh CLI） |
| 3 | `git filter-repo` 提取 `hub/` 历史 | 3 min | 父端（脚本） |
| 4 | 主仓调整引用 + ROADMAP/CHANGELOG | 5 min | cron 下一轮自动做 |
| **合计** | | **~13 min** | |

---

## Step 0 — 环境准备（2 min）

```bash
# 0.1 确认 gh CLI 已登录 XingP14 账号
gh auth status
# 期望: "Logged in to github.com as <XingP14 用户名>"

# 0.2 准备 secrets（从密码管理器 / 1Password 取出）
export NPM_TOKEN="npm_xxxxxxxxxxxxxxxxxxxx"
export DOCKERHUB_USERNAME="xingp14"
export DOCKERHUB_TOKEN="dckr_pat_xxxxxxxxxxxxxxxxxxxx"

# 0.3 确认 git-filter-repo 已安装
pipx install git-filter-repo  # 或 brew install git-filter-repo
git filter-repo --version
```

---

## Step 1 — 创建 GitHub 仓（1 min）

```bash
# 1.1 创建空仓（README/LICENSE 由 filter-repo 注入，所以 --add-readme=false）
gh repo create XingP14/woclaw-hub \
  --public \
  --description "WoClaw Hub — Shared Memory + Messaging for AI Agents (extracted from woclaw monorepo)" \
  --homepage "https://github.com/XingP14/woclaw" \
  --add-readme=false \
  --license=MIT

# 1.2 验证
gh repo view XingP14/woclaw-hub --json name,isPrivate,defaultBranchRef
# 期望: name="woclaw-hub", isPrivate=false, defaultBranchRef.name="master"
```

---

## Step 2 — 配置 Secrets + Branch Protection（2 min）

```bash
# 2.1 添加 Secrets
gh secret set NPM_TOKEN --repo XingP14/woclaw-hub --body "$NPM_TOKEN"
gh secret set DOCKERHUB_USERNAME --repo XingP14/woclaw-hub --body "$DOCKERHUB_USERNAME"
gh secret set DOCKERHUB_TOKEN --repo XingP14/woclaw-hub --body "$DOCKERHUB_TOKEN"

# 2.2 配置 branch protection（master）
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  /repos/XingP14/woclaw-hub/branches/master/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["hub (lint + build + test)"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

# 2.3 验证
gh secret list --repo XingP14/woclaw-hub
# 期望: NPM_TOKEN, DOCKERHUB_USERNAME, DOCKERHUB_TOKEN
```

---

## Step 3 — `git filter-repo` 提取 `hub/` 历史（3 min）

```bash
# 3.1 准备临时目录
WORK=/tmp/woclaw-hub-extract
rm -rf "$WORK" && mkdir -p "$WORK" && cd "$WORK"

# 3.2 浅克隆主仓
git clone --no-hardlinks https://github.com/XingP14/woclaw.git .

# 3.3 提取 hub/ 子目录（含完整历史）
git filter-repo --subdirectory-filter hub/ --force

# 3.4 补充 .github/workflows/（filter-repo 会漏掉主仓根目录的 dotfiles）
cd "$WORK"
mkdir -p .github/workflows
# 从主仓拷过来（提前 clone 到 ~/woclaw-main）
cp ~/woclaw-main/.github/workflows/ci.yml .github/workflows/ci.yml
cp ~/woclaw-main/.github/workflows/docker.yml .github/workflows/docker.yml
cp ~/woclaw-main/.github/workflows/docker-publish.yml .github/workflows/docker-publish.yml
cp ~/woclaw-main/.github/workflows/hub-publish.yml .github/workflows/hub-publish.yml
git add .github/workflows/
git -c user.email="ci@woclaw.local" -c user.name="WoClaw Bot" \
    commit -m "chore(workflows): import ci/docker/hub-publish from monorepo root"

# 3.5 推送到新仓
git remote add origin https://github.com/XingP14/woclaw-hub.git
git push -u origin master

# 3.6 验证
gh repo view XingP14/woclaw-hub --json url
# 期望: "https://github.com/XingP14/woclaw-hub"
```

---

## Step 4 — 通知 cron（1 min）

Step 4 涉及删主仓 workflow / 改 docs/ / 更新 ROADMAP + CHANGELOG — 这些都是低风险纯文档/配置改动，**由 cron 下一轮自动执行**。

父端只需在 dingtalk 给一句话：

> "woclaw-hub 已拆好，go"

下一轮 cron 读到后会自动跑 Step 4（5-10 min 一次性脚本）。

---

## ✅ 验收清单

执行完后在 [XingP14/woclaw-hub](https://github.com/XingP14/woclaw-hub) 检查：

- [ ] 仓可见，`master` 分支存在
- [ ] `git log --oneline | head -5` 显示主仓 `hub/` 历史（包含 `/ready` endpoint commit `4ba380e`）
- [ ] 仓根目录只有 `hub/` 的内容（src/、test/、Dockerfile、package.json、`woclaw-hub.service`）
- [ ] `.github/workflows/` 含 `ci.yml` / `docker.yml` / `docker-publish.yml` / `hub-publish.yml`
- [ ] Secrets 列表含 `NPM_TOKEN` / `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN`
- [ ] `npm install woclaw-hub@0.5.0` 在干净环境能装（验证：从 npm registry 可拉取）
- [ ] `docker pull xingp14/woclaw-hub:0.5.0` 能拉到镜像

---

## 🔄 回滚

如果 Step 3 推送后发现历史不对：

```bash
# 删掉新仓的 master 重来
gh repo delete XingP14/woclaw-hub --confirm

# 或在 GitHub 网页端 Settings → Danger Zone → Delete this repository
```

主仓 `hub/` 目录在 filter-repo 是在 `/tmp` 里操作的，**主仓完全不受影响**。

---

## 📌 父端决策点

| 决策 | 默认 | 备选 |
|------|------|------|
| 仓可见性 | `public` | `private`（开发阶段用，发版前再 public） |
| Branch protection | 严格（1 approval + status checks） | 宽松（无 required review，仅 required status checks） |
| Linear history | `true` | `false`（允许 merge commit） |
| 拆仓后主仓 `hub/` 目录 | 保留为 deprecated stub（README 指向新仓） | 直接删除 |

---

_Last updated: 2026-06-04 (RS-1 Step 1 done, runbook ready for parent action)_
