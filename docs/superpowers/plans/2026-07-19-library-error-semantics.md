# Library Error Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 分离 shelf-load error 与 operation error，使错误恢复动作与失败来源一致。

**Architecture:** `useShelfData` 暴露 `shelfError`、`operationError` 和 `setOperationError`；加载路径只写 shelf state，上传/删除/拖动继续通过通用 setter 接口写 operation state。`LibraryHome` 为 shelf error 保留 retry，为 operation error 渲染无错误 retry 的独立 alert。

**Tech Stack:** React 19 hooks/components、Vitest 3、Testing Library

---

## Execution Boundary and Dependency

- Start only after all three Wave 1 branches (`codex/shelf-loader-request-ownership`, `codex/reader-close-progress-refresh`, and `codex/bookshelf-acceptance-reliability`) are merged into `dev0718`.
- Branch/worktree: `codex/library-error-semantics` from that updated `dev0718`.
- This is Wave 2 because it modifies `useShelfData.js` and its test.
- Do not edit reader files, browser verification scripts, request-version behavior, or `backlog.md`.

## File and Interface Map

- Modify: `client/src/hooks/useShelfData.js` — owns separate shelf and operation error states.
- Modify/Test: `client/src/hooks/useShelfData.test.jsx` — proves independent writes and clears.
- Modify: `client/src/App.jsx` — wires operation setter to delete/drag and both errors to home.
- Modify: `client/src/components/bookshelf/LibraryHome.jsx` — renders source-appropriate alerts.
- Modify/Test: `client/src/components/bookshelf/LibraryHome.test.jsx` — verifies retry ownership.
- Modify: `client/src/styles/bookshelf.css` — applies existing error layout to operation alerts.

### Task 1: Specify independent error state

**Files:**

- Modify: `client/src/hooks/useShelfData.test.jsx`
- Test: `client/src/hooks/useShelfData.test.jsx`

- [ ] **Step 1: Add the hook regression**

  Add inside the existing describe:

  ```jsx
  it('keeps shelf-load and operation errors independent', async () => {
    api.listShelfItems.mockRejectedValueOnce(new Error('无法加载书架'));
    const { result } = renderHook(() => useShelfData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.shelfError).toBe('无法加载书架');
    expect(result.current.operationError).toBe('');

    act(() => result.current.setOperationError('上传失败'));
    expect(result.current.shelfError).toBe('无法加载书架');
    expect(result.current.operationError).toBe('上传失败');

    api.listShelfItems.mockResolvedValueOnce({ items: [] });
    await act(async () => { await result.current.loadShelf(); });
    expect(result.current.shelfError).toBe('');
    expect(result.current.operationError).toBe('上传失败');
  });
  ```

- [ ] **Step 2: Run the hook test and verify RED**

  ```powershell
  npm --prefix client test -- useShelfData.test.jsx
  ```

  Expected: the new assertions fail because the hook still returns generic `error/setError`.

### Task 2: Split hook state and App wiring

**Files:**

- Modify: `client/src/hooks/useShelfData.js`
- Modify: `client/src/App.jsx`
- Test: `client/src/hooks/useShelfData.test.jsx`

- [ ] **Step 1: Replace the generic hook state**

  Replace:

  ```js
  const [error, setError] = useState('');
  ```

  with:

  ```js
  const [shelfError, setShelfError] = useState('');
  const [operationError, setOperationError] = useState('');
  ```

  In `loadShelf`, replace only its `setError` calls with `setShelfError`. Keep all request-version guards from the dependency plan intact. Inject the operation setter into upload:

  ```js
  } = useUploadBooks({ loadShelf, setError: setOperationError });
  ```

  Return these exact members:

  ```js
  operationError,
  setOperationError,
  shelfError,
  ```

  Remove generic `error` and `setError` from the return object.

- [ ] **Step 2: Update App destructuring and operation consumers**

  In the `useShelfData` result, destructure `operationError`, `setOperationError`, and `shelfError`. In both the `useBookDeletion` and `useLibraryDrag` option objects, replace the exact member `setError,` with:

  ```js
  setError: setOperationError,
  ```

  In the existing `LibraryHome` call, add these exact props next to `catalogError`:

  ```jsx
  operationError={operationError}
  shelfError={shelfError}
  ```

  Do not introduce an object spread into production code.

- [ ] **Step 3: Re-run the hook test and verify GREEN**

  ```powershell
  npm --prefix client test -- useShelfData.test.jsx
  ```

  Expected: all hook tests pass, including request-ownership regressions from Wave 1.

### Task 3: Render source-appropriate homepage errors

**Files:**

- Modify: `client/src/components/bookshelf/LibraryHome.test.jsx`
- Modify: `client/src/components/bookshelf/LibraryHome.jsx`
- Modify: `client/src/styles/bookshelf.css`
- Test: `client/src/components/bookshelf/LibraryHome.test.jsx`

- [ ] **Step 1: Update the shared test props**

  In `createHomeProps`, replace `error: ''` with:

  ```js
  operationError: '',
  shelfError: '',
  ```

  Update the existing shelf retry test override from `error: '无法加载书架'` to `shelfError: '无法加载书架'`.

- [ ] **Step 2: Add the operation error regression**

  ```jsx
  it('shows operation errors without a shelf retry action', () => {
    renderHome({ operationError: '上传失败' });
    expect(screen.getByRole('alert')).toHaveTextContent('上传失败');
    expect(screen.queryByRole('button', { name: '重试加载书架' }))
      .not.toBeInTheDocument();
    expect(screen.getByLabelText('可编辑书架列表')).toBeInTheDocument();
  });
  ```

- [ ] **Step 3: Run the homepage test and verify RED**

  ```powershell
  npm --prefix client test -- LibraryHome.test.jsx
  ```

  Expected: the new operation alert is absent because `LibraryHome` still accepts only generic `error`.

- [ ] **Step 4: Split the LibraryHome props and markup**

  Replace the `error` prop with `operationError` and `shelfError`. Replace the existing condition with:

  ```jsx
  {shelfError ? (
    <div className="library-shelf-error" role="alert">
      <span>{shelfError}</span>
      <button
        className="library-error-action"
        type="button"
        onClick={onRetryShelf}
      >
        重试加载书架
      </button>
    </div>
  ) : null}

  {operationError ? (
    <div className="library-operation-error" role="alert">
      <span>{operationError}</span>
    </div>
  ) : null}
  ```

- [ ] **Step 5: Reuse the existing error layout**

  Extend only the container selector:

  ```css
  .library-catalog-error,
  .library-shelf-error,
  .library-operation-error {
  ```

  Do not add `.library-operation-error` to the button selector because it has no action.

- [ ] **Step 6: Re-run the same homepage test and verify GREEN**

  ```powershell
  npm --prefix client test -- LibraryHome.test.jsx
  ```

  Expected: all homepage tests pass; only shelf errors expose the retry button.

- [ ] **Step 7: Build the client**

  ```powershell
  npm --prefix client run build
  ```

  Expected: Vite exits with code 0.

- [ ] **Step 8: Commit this batch**

  ```powershell
  git add client/src/App.jsx client/src/hooks/useShelfData.js client/src/hooks/useShelfData.test.jsx client/src/components/bookshelf/LibraryHome.jsx client/src/components/bookshelf/LibraryHome.test.jsx client/src/styles/bookshelf.css
  git commit -m "fix: separate library operation errors"
  ```

## Done Criteria

- Shelf and operation errors have independent state and clearing semantics.
- Delete, drag, and upload paths receive the operation setter.
- Only shelf-load failures expose shelf retry.
- Catalog and folder errors are unchanged.
