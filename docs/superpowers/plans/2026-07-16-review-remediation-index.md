# Review Remediation Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按依赖顺序执行全部 7 条 Important 修复和已批准的前 5 条 Minor 修复，并在每一阶段保持可测试、可提交、可回退。

**Architecture:** 工作拆成五个可独立验证的子项目，测试基建先行，之后依次处理阅读进度、EPUB 入库安全、书库/API 正确性和前端并发/无障碍。每份子计划内采用 TDD 与小提交，本索引只负责顺序、Review 覆盖映射和跨计划质量门禁。

**Tech Stack:** Node.js 22、Express、SQLite、React、epub.js/epub2、node:test、Vitest、Testing Library、Playwright、GitHub Actions

---

## Plan order and dependencies

1. `docs/superpowers/plans/2026-07-16-quality-foundation.md`
   - 无前置实现依赖。
   - 建立后续所有计划使用的 server/client/browser 测试入口。
2. `docs/superpowers/plans/2026-07-16-reader-progress-reliability.md`
   - 依赖计划 1 的 Vitest、Testing Library 和隔离 Playwright 环境。
3. `docs/superpowers/plans/2026-07-16-epub-ingestion-security.md`
   - 依赖计划 1 的临时 data root 与 EPUB fixture。
   - 保持 `epubjs@0.3.93`，通过 override 固定 `@xmldom/xmldom@0.8.13`。
4. `docs/superpowers/plans/2026-07-16-library-sync-api-correctness.md`
   - 依赖计划 3 的严格 `inspectEpubFile`/`InvalidEpubError` 路径。
5. `docs/superpowers/plans/2026-07-16-frontend-concurrency-accessibility.md`
   - 依赖计划 1 的客户端测试环境；可使用计划 2 的 ReaderView 最终接口。

## Review finding coverage

| Review finding | Priority | Owning plan/task |
|---|---:|---|
| locations 未生成时把 2.27% 重置为 0% | Important | Reader progress Tasks 1, 4, 6 |
| 仅凭 `.epub` 扩展名接受无效文件 | Important | EPUB security Tasks 1, 3, 4 |
| `@xmldom/xmldom` 生产漏洞 | Important | EPUB security Task 5 |
| watcher 启动执行两次全量同步 | Important | Library/API Task 3 |
| 后台/断网/乱序时最后进度不可靠 | Important | Reader progress Tasks 2, 3, 5 |
| EPUB 文件一小时缓存可返回旧内容 | Important | Library/API Task 4 |
| 项目缺少自动化测试和 CI 门禁 | Important | Quality foundation Tasks 1–5 |
| 文件夹 A 的旧响应覆盖后来打开的 B | Minor 1 | Frontend Task 1 |
| 不存在 bookId 的进度 PUT 返回 500 | Minor 2 | Library/API Task 4 |
| 文件夹名称仅前端限制 80 字 | Minor 3 | Library/API Task 5 |
| 文件夹预览产生 N+1 查询 | Minor 4 | Library/API Task 5 |
| modal 缺少一致焦点/Escape/reduced-motion | Minor 5 | Frontend Tasks 2–6 |

### Task 1: Establish the execution baseline

**Files:**
- Verify: `docs/superpowers/specs/2026-07-16-*.md`
- Verify: `docs/superpowers/plans/2026-07-16-*.md`
- Preserve: `client/reader-settings-narrow.png`

- [ ] **Step 1: Confirm branch and protected untracked file**

Run:

```powershell
git status --short --branch
```

Expected: branch is `main`, the design commit is ahead of origin, and the existing untracked `client/reader-settings-narrow.png` is present. Do not stage, overwrite or delete that file.

- [ ] **Step 2: Read plans in execution order**

Run:

```powershell
Get-Content -Raw docs/superpowers/plans/2026-07-16-quality-foundation.md
Get-Content -Raw docs/superpowers/plans/2026-07-16-reader-progress-reliability.md
Get-Content -Raw docs/superpowers/plans/2026-07-16-epub-ingestion-security.md
Get-Content -Raw docs/superpowers/plans/2026-07-16-library-sync-api-correctness.md
Get-Content -Raw docs/superpowers/plans/2026-07-16-frontend-concurrency-accessibility.md
```

Expected: all five files exist and each starts with the required agentic-workers header.

### Task 2: Execute each sub-plan with a checkpoint

**Files:**
- Modify: only files listed in the active sub-plan's File map

- [ ] **Step 1: Complete Quality Foundation**

Execute every checkbox in `2026-07-16-quality-foundation.md`, then run:

```powershell
npm test --prefix server
npm test --prefix client
npm run build --prefix client
npm run verify:reader-mobile --prefix client
```

Expected: all commands exit 0 before starting plan 2.

- [ ] **Step 2: Complete Reader Progress Reliability**

Execute every checkbox in `2026-07-16-reader-progress-reliability.md`, then run:

```powershell
npm test --prefix client
npm run verify:reader-progress --prefix client
```

Expected: tests exit 0 and the browser JSON reports a non-zero reopened progress.

- [ ] **Step 3: Complete EPUB Ingestion Security**

Execute every checkbox in `2026-07-16-epub-ingestion-security.md`, then run:

```powershell
npm test --prefix server
npm audit --omit=dev --prefix client
npm ls epubjs @xmldom/xmldom --prefix client
```

Expected: tests/audit exit 0; dependency output contains `epubjs@0.3.93` and `@xmldom/xmldom@0.8.13`.

- [ ] **Step 4: Complete Library Sync and API Correctness**

Execute every checkbox in `2026-07-16-library-sync-api-correctness.md`, then run:

```powershell
npm test --prefix server
npm run verify:reader-progress --prefix client
```

Expected: all tests exit 0, including watcher, mtime, cache, 404, folder length and two-query coverage.

- [ ] **Step 5: Complete Frontend Concurrency and Accessibility**

Execute every checkbox in `2026-07-16-frontend-concurrency-accessibility.md`, then run:

```powershell
npm test --prefix client
npm run build --prefix client
npm run verify:reader-accessibility --prefix client
```

Expected: all commands exit 0 and browser output reports focus restoration plus reduced motion.

### Task 3: Run the final non-Docker quality gate

**Files:**
- Verify: application and test files from all five plans
- Exclude: `Dockerfile`
- Exclude: `docker-compose.yml`
- Exclude: deployed NAS environment

- [ ] **Step 1: Run server gates**

Run:

```powershell
npm ci --prefix server
npm test --prefix server
npm audit --omit=dev --prefix server
```

Expected: all three commands exit 0.

- [ ] **Step 2: Run client unit/build/audit gates**

Run:

```powershell
npm ci --prefix client
npm test --prefix client
npm audit --omit=dev --prefix client
npm run build --prefix client
```

Expected: all four commands exit 0.

- [ ] **Step 3: Run all isolated browser gates**

Run:

```powershell
npm run verify:reader-mobile --prefix client
npm run verify:reader-progress --prefix client
npm run verify:reader-accessibility --prefix client
```

Expected: all three commands exit 0 without requiring `APP_URL`, Docker, Docker Hub secrets or the NAS deployment.

- [ ] **Step 4: Confirm protected paths and working tree**

Run:

```powershell
git status --short
git diff --check
```

Expected: `git diff --check` prints nothing; no generated data or screenshots are staged; the pre-existing untracked `client/reader-settings-narrow.png` is unchanged.

### Task 4: Finish the development branch

**Files:**
- Verify: Git history and working tree

- [ ] **Step 1: Review the implementation commits**

Run:

```powershell
git log --oneline --decorate -25
```

Expected: small commits correspond to the commit checkpoints in the five plans, with no Docker/NAS-only commit.

- [ ] **Step 2: Use the finishing workflow**

Invoke `superpowers:finishing-a-development-branch` only after every final gate above passes. Choose merge/PR/cleanup based on the user's instruction at that time; do not push or create external resources without explicit authorization.

## Self-review checklist

- [ ] Every one of the 7 Important and first 5 Minor findings has exactly one owning plan, with cross-plan tests listed where needed.
- [ ] Execution order respects dependencies: tests → progress → ingestion security → sync/API → frontend concurrency/accessibility.
- [ ] Docker build, Compose runtime and NAS verification are absent from all required gates, per user instruction.
- [ ] Scan all six plan files for every prohibited placeholder phrase named by the writing-plans skill; expected result is zero matches.
- [ ] Verify cross-plan names are stable: `EPUB_DATA_DIR`, `createEpubFixture`, `InvalidEpubError`, `inspectEpubFile`, `forceRefresh`, `enqueueProgress`, `useModalDialog`, and `useReducedMotion`.
