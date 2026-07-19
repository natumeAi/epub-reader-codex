# Bookshelf Catalog Failure Escape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在目录刷新加载或失败时保留“全部”逃生入口，使用户能从派生视图恢复“全部 + 手动顺序”的可编辑书架。

**Architecture:** 保留 `LibraryHome` 现有的目录可用性判断和 `useLibraryView` 状态转换，只在 `LibraryViewToolbar` 将禁用条件细化到单个视图按钮。“全部”复用现有 `selectView` 行为，其他目录依赖视图和排序选择框继续禁用，不增加状态、effect 或旧目录回退。

**Tech Stack:** React 19、Vite 7、Vitest 3、Testing Library

---

## Execution and Review Guardrails

- 从 `dev0718` 最新提交创建新的隔离工作树与 `codex/fix-catalog-failure-escape` 分支。
- 严格执行本计划，不重新设计需求，不增加计划外功能，不处理 Out of Scope。
- 只运行本文列出的 `LibraryHome.test.jsx` 定向测试和客户端构建命令。
- 不调用 `requesting-code-review`，不进行全面质量审查，不执行“审查—修复—重新审查”循环。
- RED 后实现最小修复；修复后只重新运行原定向测试，再运行一次计划指定的构建。
- 同一验证连续失败两次时立即停止并报告阻塞原因，不继续后续步骤。
- 新发现但不影响当前验收标准的问题追加到 `backlog.md`，本次不修复。

## File and Interface Map

- Modify: `client/src/components/bookshelf/LibraryViewToolbar.jsx` — 根据选项值决定目录不可用时是否禁用视图按钮；排序控件逻辑保持不变。
- Modify/Test: `client/src/components/bookshelf/LibraryHome.test.jsx` — 使用真实 `LibraryHome`、`useLibraryView` 和 toolbar 覆盖目录加载及错误后的用户逃生路径。
- Reference only: `client/src/hooks/useLibraryView.js` — 现有 `selectView(LIBRARY_VIEW.ALL)` 清空搜索、恢复 `LIBRARY_SORT.MANUAL`，不修改。

### Task 1: Add the catalog-failure escape regression

**Files:**

- Modify: `client/src/components/bookshelf/LibraryHome.test.jsx`
- Modify: `client/src/components/bookshelf/LibraryViewToolbar.jsx`
- Test: `client/src/components/bookshelf/LibraryHome.test.jsx`

- [ ] **Step 1: Write the failing integration test**

  在 `LibraryHome composition` describe 中增加以下测试。它先进入“最近添加”，依次模拟目录刷新加载和失败，确认只有“全部”保留可用，最后通过“全部”恢复手动顺序与可编辑书架：

  ```jsx
  it('keeps All available as an escape when catalog refresh is unavailable', () => {
    const props = createHomeProps();
    const { rerender } = render(
      <DndContext><LibraryHome {...props} /></DndContext>,
    );

    fireEvent.click(screen.getByRole('button', { name: '最近添加' }));
    expect(screen.getByRole('button', { name: '最近添加' }))
      .toHaveAttribute('aria-pressed', 'true');

    rerender(
      <DndContext><LibraryHome {...props} isCatalogLoading /></DndContext>,
    );
    expect(screen.getByRole('button', { name: '全部' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '最近添加' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '文件夹' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: '排序方式' })).toBeDisabled();

    rerender(
      <DndContext>
        <LibraryHome {...props} catalogError="搜索目录加载失败" />
      </DndContext>,
    );
    expect(screen.getByRole('button', { name: '全部' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '最近添加' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '文件夹' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: '排序方式' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    expect(screen.getByRole('button', { name: '全部' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: '排序方式' }))
      .toHaveValue('manual');
    expect(screen.getByLabelText('可编辑书架列表')).toBeInTheDocument();
  });
  ```

- [ ] **Step 2: Run the targeted test and verify RED**

  Run from the repository root:

  ```powershell
  npm --prefix client test -- LibraryHome.test.jsx
  ```

  Expected: the new test fails at the first `toBeEnabled()` assertion because the current toolbar disables “全部” whenever `controlsDisabled` is true. Existing `LibraryHome.test.jsx` tests remain passing.

- [ ] **Step 3: Implement the minimal toolbar condition**

  在 `LibraryViewToolbar.jsx` 的 `viewOptions.map` button 中只替换 `disabled` 表达式：

  ```jsx
  disabled={controlsDisabled && option.value !== LIBRARY_VIEW.ALL}
  ```

  不修改 select 的以下现有行为：

  ```jsx
  disabled={controlsDisabled}
  ```

  不修改 `LibraryHome`、`useLibraryView` 或其他组件。

- [ ] **Step 4: Re-run the same targeted test and verify GREEN**

  Run exactly the original test command:

  ```powershell
  npm --prefix client test -- LibraryHome.test.jsx
  ```

  Expected: `LibraryHome.test.jsx` 全部通过；新测试证明加载与错误状态均保留“全部”，其他目录控件仍禁用，点击后恢复 manual 和 editable。

- [ ] **Step 5: Run the affected client build once**

  ```powershell
  npm --prefix client run build
  ```

  Expected: Vite build exits with code 0. Do not run another build, full test suite, lint, browser specification check, or review command.

- [ ] **Step 6: Commit the regression and minimal fix**

  ```powershell
  git add client/src/components/bookshelf/LibraryHome.test.jsx client/src/components/bookshelf/LibraryViewToolbar.jsx
  git commit -m "fix: preserve catalog failure escape path"
  ```

## Done Criteria

- 目录刷新加载或失败时，“全部”按钮可用。
- 同一状态下，“最近添加”“文件夹”和排序选择框仍禁用。
- 用户从派生视图点击“全部”后回到手动顺序和可编辑书架。
- 没有自动切换视图、旧目录回退、新状态或其他行为改动。
- 指定定向测试和客户端构建通过，修复提交存在。

## Out of Scope

- 修改 catalog 请求、重试、缓存、错误文案或 loading UI。
- 在目录错误时自动切换视图，或允许使用旧目录操作派生视图和排序。
- 修改搜索、继续阅读、书架 DnD、FolderOverlay、reader、服务端或数据库。
- 修复整体审查中的 P2/P3、重构 toolbar API、增加端到端或全仓库测试。
- 请求代码审查、重复规格/质量审查或任何计划外验证。
