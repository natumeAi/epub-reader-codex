# Backlog Remediation Suite Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按安全依赖波次完成四个修复批次、合并到 `dev0718`、对账 backlog，并验证组合结果。

**Architecture:** Wave 1 使用三个独立 subagent/worktree 并行实现 loader ownership、reader progress sequencing 和 bookshelf acceptance；主执行方逐个合并。Wave 2 从合并后的 `dev0718` 实现 error semantics，最后由主执行方更新 backlog 并运行一次组合验证。

**Tech Stack:** Git worktrees、React 19、Vitest 3、Vite 7、Playwright 1.61

---

## Plan Set

- `docs/superpowers/plans/2026-07-19-shelf-loader-request-ownership.md`
- `docs/superpowers/plans/2026-07-19-reader-close-progress-refresh.md`
- `docs/superpowers/plans/2026-07-19-bookshelf-acceptance-reliability.md`
- `docs/superpowers/plans/2026-07-19-library-error-semantics.md`

Each implementation agent must follow only its assigned plan, use TDD, commit its batch, and report changed files plus exact verification output. Agents must not edit `backlog.md` or merge their own branches.

### Task 1: Execute and integrate Wave 1

**Files:**

- No direct root implementation edits.
- Merge branches: `codex/shelf-loader-request-ownership`, `codex/reader-close-progress-refresh`, `codex/bookshelf-acceptance-reliability`.

- [ ] **Step 1: Dispatch three independent agents**

  Dispatch one agent per plan. Each agent creates the exact worktree/branch named in its plan from the same current `dev0718` base. Do not give two agents the same worktree or allow them to edit outside it.

- [ ] **Step 2: Require per-agent completion evidence**

  Accept a branch only when its agent reports the planned RED failure, GREEN targeted test, build, any plan-specific browser command, and a clean committed worktree. If a planned verification fails twice consecutively, stop that branch and report the blocker without merging it.

- [ ] **Step 3: Merge loader ownership**

  From the main checkout on `dev0718`:

  ```powershell
  git merge --no-edit codex/shelf-loader-request-ownership
  ```

  Expected: merge succeeds without touching reader or bookshelf verification files.

- [ ] **Step 4: Merge reader progress sequencing**

  ```powershell
  git merge --no-edit codex/reader-close-progress-refresh
  ```

  Expected: merge succeeds; only `App.jsx` and reader files overlap the main history, not the loader batch files.

- [ ] **Step 5: Merge bookshelf acceptance reliability**

  ```powershell
  git merge --no-edit codex/bookshelf-acceptance-reliability
  ```

  Expected: merge succeeds and introduces the CSS plus verification-script changes.

- [ ] **Step 6: Remove the three merged worktrees and branches**

  From the main checkout, remove only worktrees created for these branches, run `git worktree prune`, then delete each merged branch with `git branch -d`. Do not remove harness-owned worktrees or the main checkout.

### Task 2: Execute and integrate Wave 2

**Files:**

- Follow: `docs/superpowers/plans/2026-07-19-library-error-semantics.md`
- Merge branch: `codex/library-error-semantics`

- [ ] **Step 1: Create Wave 2 from the integrated base**

  Only after Task 1 merges all three branches, create a new worktree and `codex/library-error-semantics` from the current `dev0718` HEAD.

- [ ] **Step 2: Execute the error semantics plan**

  Assign a fresh or now-idle subagent. Require the plan's RED/GREEN tests, build, commit, changed-file report, and clean worktree. Do not allow the agent to modify request versions, reader settle behavior, verifier fields, or backlog.

- [ ] **Step 3: Merge Wave 2**

  ```powershell
  git merge --no-edit codex/library-error-semantics
  ```

  Expected: merge succeeds on top of all Wave 1 files, preserving their changes in `useShelfData.js`, `App.jsx`, and `bookshelf.css`.

- [ ] **Step 4: Remove the merged Wave 2 worktree and branch**

  Remove only the worktree created for `codex/library-error-semantics`, prune registrations, then delete the merged branch with `git branch -d`.

### Task 3: Reconcile backlog documentation

**Files:**

- Modify: `backlog.md`

- [ ] **Step 1: Mark the six implemented entries handled**

  In these exact entries, replace `状态：未处理` with `状态：已处理（2026-07-19）`:

  - 并发 loader 存在旧请求覆盖新请求的竞态
  - 关闭阅读器时刷新可能早于阅读进度持久化
  - 操作失败被误呈现为书架加载错误
  - 搜索输入框缺少可见键盘焦点
  - 浏览器规格检查可能漏报延迟请求或非 ARIA 拖动注册
  - 430px 首屏断言没有要求完整三列书架

- [ ] **Step 2: Correct the toolbar backlog contract**

  Keep the item open but replace its heading and scenario with:

  ```markdown
  ### P2：工具栏 catalog 故障契约缺少组件级隔离测试

  - 位置：`client/src/components/bookshelf/LibraryViewToolbar.test.jsx:22`
  - 状态：未处理
  - 场景：P1 修复已通过 `LibraryHome.test.jsx` 集成覆盖 catalog 不可用时“全部”保持可用、其他目录视图与排序禁用，但 `LibraryViewToolbar` 自身仍没有 `controlsDisabled=true` 的隔离测试，组件级契约在重构时缺少直接保护。
  - 后续建议：在 toolbar 定向测试中断言“全部”enabled、“最近添加”“文件夹”和排序 select disabled。
  ```

- [ ] **Step 3: Commit backlog reconciliation**

  ```powershell
  git add backlog.md
  git commit -m "docs: reconcile remediated library backlog"
  ```

### Task 4: Verify the integrated result once

**Files:**

- Test only; no new implementation edits unless a listed acceptance criterion fails.

- [ ] **Step 1: Run the combined targeted test set**

  ```powershell
  npm --prefix client test -- useShelfData.test.jsx ReaderView.test.jsx LibraryHome.test.jsx bookshelf-verification-assertions.test.js
  ```

  Expected: all listed test files pass with zero failures.

- [ ] **Step 2: Build the integrated client**

  ```powershell
  npm --prefix client run build
  ```

  Expected: Vite exits with code 0.

- [ ] **Step 3: Run one integrated browser specification**

  ```powershell
  npm --prefix client run verify:bookshelf-home
  ```

  Expected: JSON includes `typedRequestCount: 0`, `focusIndicatorVisible: true`, `readOnlyDragActivated: false`; 430px first row has at least three entries; no specification error is thrown.

- [ ] **Step 4: Stop at the agreed scope**

  Do not run a full repository test suite, lint sweep, repeated code review, or fix unrelated backlog items. Record any newly observed non-blocking P2/P3 in `backlog.md`; if the same planned verification fails twice consecutively, stop and report the blocker.

## Suite Done Criteria

- All four implementation commits and the backlog reconciliation commit are reachable from `dev0718`.
- No temporary implementation worktree or merged feature branch remains.
- Six selected backlog entries are marked handled; the toolbar entry reflects the current P1 contract.
- Combined targeted tests, client build, and one browser specification pass on the integrated HEAD.
