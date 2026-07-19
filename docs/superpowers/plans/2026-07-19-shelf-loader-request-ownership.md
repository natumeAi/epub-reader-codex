# Shelf Loader Request Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 shelf、catalog 与 recent 的重叠请求只能由最新调用提交 React 状态。

**Architecture:** `useShelfData` 为三类资源各持有独立递增 version ref；loader 捕获版本并在每个 state commit 前检查所有权。请求本身不取消，返回值契约和三类资源独立完成语义保持不变。

**Tech Stack:** React 19 hooks、Vitest 3、Testing Library `renderHook`

---

## Execution Boundary

- Base: `dev0718` at or after design commit `294b62b`.
- Branch/worktree: `codex/shelf-loader-request-ownership` in a new isolated worktree.
- This is Wave 1 and may run in parallel with reader progress and bookshelf acceptance plans.
- Do not edit `App.jsx`, reader files, CSS, browser scripts, `backlog.md`, or error prop names.

## File and Interface Map

- Modify: `client/src/hooks/useShelfData.js` — owns the three resource request versions and gates state commits.
- Modify/Test: `client/src/hooks/useShelfData.test.jsx` — reproduces out-of-order completion with deferred promises.

### Task 1: Reproduce stale catalog, shelf, and recent commits

**Files:**

- Modify: `client/src/hooks/useShelfData.test.jsx`
- Test: `client/src/hooks/useShelfData.test.jsx`

- [ ] **Step 1: Extend the deferred helper**

  Replace the existing helper with:

  ```js
  function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, reject, resolve };
  }
  ```

- [ ] **Step 2: Add the stale catalog regression**

  Add inside `useShelfData independent resources`:

  ```jsx
  it('lets only the latest catalog request commit data and loading state', async () => {
    const { result } = renderHook(() => useShelfData());
    await waitFor(() => expect(result.current.catalogBooks).toHaveLength(1));
    const older = deferred();
    const newer = deferred();
    api.listBookCatalog
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    let olderLoad;
    let newerLoad;
    act(() => { olderLoad = result.current.loadCatalog(); });
    act(() => { newerLoad = result.current.loadCatalog(); });

    await act(async () => {
      older.resolve({ books: [{ id: 2, title: '旧目录' }] });
      await olderLoad;
    });
    expect(result.current.isCatalogLoading).toBe(true);
    expect(result.current.catalogBooks[0].title).toBe('根层书');

    await act(async () => {
      newer.resolve({ books: [{ id: 3, title: '新目录' }] });
      await newerLoad;
    });
    expect(result.current.isCatalogLoading).toBe(false);
    expect(result.current.catalogBooks[0].title).toBe('新目录');
  });
  ```

- [ ] **Step 3: Add the stale shelf/restore regression**

  ```jsx
  it('ignores an older shelf result and restores only the latest shelf', async () => {
    const restoreReaderBook = vi.fn();
    const { result } = renderHook(() => useShelfData({ restoreReaderBook }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(restoreReaderBook).toHaveBeenCalledTimes(1));
    restoreReaderBook.mockClear();
    const older = deferred();
    const newer = deferred();
    api.listShelfItems
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    let olderLoad;
    let newerLoad;
    act(() => { olderLoad = result.current.loadShelf(); });
    act(() => { newerLoad = result.current.loadShelf(); });

    await act(async () => {
      newer.resolve({ items: [{ type: 'book', id: 3, book: { id: 3, title: '新书架' } }] });
      await newerLoad;
    });
    await act(async () => {
      older.resolve({ items: [{ type: 'book', id: 2, book: { id: 2, title: '旧书架' } }] });
      await olderLoad;
    });

    expect(result.current.shelfItems[0].book.title).toBe('新书架');
    expect(result.current.error).toBe('');
    expect(restoreReaderBook).toHaveBeenCalledTimes(1);
    expect(restoreReaderBook.mock.calls[0][0].items[0].book.title).toBe('新书架');
  });
  ```

- [ ] **Step 4: Add the stale recent regression**

  ```jsx
  it('lets only the latest recent-reading request commit items', async () => {
    const { result } = renderHook(() => useShelfData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const older = deferred();
    const newer = deferred();
    api.listRecentReading
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    let olderLoad;
    let newerLoad;
    act(() => { olderLoad = result.current.loadRecentReading(); });
    act(() => { newerLoad = result.current.loadRecentReading(); });

    await act(async () => {
      newer.resolve({ items: [{ book: { id: 3, title: '新进度' } }] });
      await newerLoad;
    });
    await act(async () => {
      older.resolve({ items: [{ book: { id: 2, title: '旧进度' } }] });
      await olderLoad;
    });

    expect(result.current.recentReadingItems[0].book.title).toBe('新进度');
  });
  ```

- [ ] **Step 5: Run the targeted test and verify RED**

  ```powershell
  npm --prefix client test -- useShelfData.test.jsx
  ```

  Expected: the new tests fail because older requests currently update state and clear loading unconditionally. Do not change assertions to match stale behavior.

### Task 2: Gate resource commits by request ownership

**Files:**

- Modify: `client/src/hooks/useShelfData.js`
- Test: `client/src/hooks/useShelfData.test.jsx`

- [ ] **Step 1: Add resource version refs**

  Update the React import and add the refs after state declarations:

  ```js
  import { useCallback, useEffect, useRef, useState } from 'react';
  ```

  ```js
  const shelfRequestVersionRef = useRef(0);
  const catalogRequestVersionRef = useRef(0);
  const recentRequestVersionRef = useRef(0);
  ```

- [ ] **Step 2: Gate recent-reading commits**

  Replace `loadRecentReading` with:

  ```js
  const loadRecentReading = useCallback(async () => {
    const requestVersion = ++recentRequestVersionRef.current;
    try {
      const data = await listRecentReading();
      const items = data.items || [];
      if (recentRequestVersionRef.current === requestVersion) {
        setRecentReadingItems(items);
      }
      return { items };
    } catch {
      if (recentRequestVersionRef.current === requestVersion) {
        setRecentReadingItems([]);
      }
      return { items: [] };
    }
  }, []);
  ```

- [ ] **Step 3: Gate catalog commits and finally**

  At the start of `loadCatalog`, capture:

  ```js
  const requestVersion = ++catalogRequestVersionRef.current;
  ```

  Guard every catalog setter after the request starts:

  ```js
  if (catalogRequestVersionRef.current === requestVersion) {
    setCatalogBooks(data.books || []);
  }
  ```

  ```js
  if (catalogRequestVersionRef.current === requestVersion) {
    setCatalogError(err.message || '搜索目录加载失败');
  }
  ```

  ```js
  if (catalogRequestVersionRef.current === requestVersion) {
    setHasLoadedCatalog(true);
    setIsCatalogLoading(false);
  }
  ```

  Keep `return data` and `return null` unchanged.

- [ ] **Step 4: Gate shelf data, restore, error, and finally**

  At the start of `loadShelf`, capture:

  ```js
  const requestVersion = ++shelfRequestVersionRef.current;
  ```

  Only set shelf items when current. In the existing recent promise continuation, guard both restore and its error path:

  ```js
  if (shelfRequestVersionRef.current === requestVersion) {
    setShelfItems((shelfData.items || []).map(normalizeShelfItem));
  }
  void recentPromise
    .then((recentData) => {
      if (shelfRequestVersionRef.current === requestVersion) {
        restoreReaderBook?.(shelfData, recentData);
      }
    })
    .catch((err) => {
      if (shelfRequestVersionRef.current === requestVersion) {
        setError(err.message || '无法加载书架');
      }
    });
  ```

  Guard the outer catch and finally with the same equality check. Do not await catalog or recent before ending shelf loading.

- [ ] **Step 5: Re-run the same targeted test and verify GREEN**

  ```powershell
  npm --prefix client test -- useShelfData.test.jsx
  ```

  Expected: all `useShelfData.test.jsx` tests pass with no unhandled promise rejection.

- [ ] **Step 6: Build the client**

  ```powershell
  npm --prefix client run build
  ```

  Expected: Vite exits with code 0.

- [ ] **Step 7: Commit this batch**

  ```powershell
  git add client/src/hooks/useShelfData.js client/src/hooks/useShelfData.test.jsx
  git commit -m "fix: ignore stale shelf data requests"
  ```

## Done Criteria

- Three resources use independent ownership versions.
- Old requests cannot update data, error, loaded, loading, or reader restore.
- Existing independent-resource tests plus the three reverse-completion regressions pass.
- Only the two listed files change.
