# Frontend Concurrency and Accessibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 阻止旧文件夹请求覆盖当前界面，并为阅读器、文件夹和删除确认框统一实现焦点进入/锁定/恢复、Escape 关闭及减少动画行为。

**Architecture:** 文件夹请求由 `AbortController` 和递增 requestId 双重保护，只有当前 folderId/requestId 可写状态。三个 modal 复用 `useModalDialog`，动画偏好由 `useReducedMotion` 提供给 React 时序，同时 CSS media query 消除装饰动画但保留进度 spinner。

**Tech Stack:** React 19 hooks、Fetch AbortSignal、matchMedia、ARIA dialog、Vitest、Testing Library、Playwright

---

## File map

- Modify: `client/src/api/foldersApi.js` — `listFolderBooks` 接受 AbortSignal。
- Create: `client/src/api/foldersApi.test.js` — 验证 signal 传递。
- Modify: `client/src/hooks/useFolderState.js` — 请求代次、abort、卸载清理及 reduced-motion 关闭。
- Create: `client/src/hooks/useFolderState.test.jsx` — A/B 乱序、关闭后返回、AbortError 和立即关闭测试。
- Create: `client/src/hooks/useModalDialog.js` — 初始焦点、焦点锁、Escape 与恢复。
- Create: `client/src/hooks/useModalDialog.test.jsx` — 键盘与恢复行为测试。
- Create: `client/src/hooks/useReducedMotion.js` — matchMedia 状态 hook。
- Create: `client/src/hooks/useReducedMotion.test.jsx` — 初值、change 和兼容回退测试。
- Modify: `client/src/components/reader/ReaderView.jsx` — reader dialog hook 与 reduced-motion 翻页/开关时序。
- Create: `client/src/components/reader/ReaderView.test.jsx` — reduced-motion 单次翻页和 Escape 测试。
- Modify: `client/src/components/folders/FolderOverlay.jsx` — 文件夹 dialog 焦点与 Escape 集成。
- Create: `client/src/components/folders/FolderOverlay.test.jsx` — 文件夹初始焦点、trap 和重命名 Escape 测试。
- Modify: `client/src/components/bookshelf/DeleteConfirmDialog.jsx` — 删除 dialog 焦点与 Escape 集成。
- Modify: `client/src/components/bookshelf/DeleteConfirmDialog.test.jsx` — 取消按钮初始焦点、trap、Escape 和恢复测试。
- Modify: `client/src/styles/pwa.css` — reduced-motion 跨组件规则，spinner 除外。
- Create: `client/scripts/verify-reader-accessibility.mjs` — 浏览器焦点恢复与 reduced-motion reader/folder 关闭验证。
- Modify: `client/package.json` — 新增浏览器无障碍验证命令。
- Modify: `.github/workflows/quality.yml` — mobile job 执行无障碍回归。

### Task 1: Abortable, latest-only folder requests

**Files:**
- Create: `client/src/api/foldersApi.test.js`
- Modify: `client/src/api/foldersApi.js`
- Create: `client/src/hooks/useFolderState.test.jsx`
- Modify: `client/src/hooks/useFolderState.js`

- [ ] **Step 1: Write a failing API signal test**

Create `client/src/api/foldersApi.test.js`:

```js
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listFolderBooks } from './foldersApi.js';

describe('listFolderBooks', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('forwards an AbortSignal to fetch', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ books: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await listFolderBooks(7, { signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledWith('/api/folders/7/books', {
      signal: controller.signal,
    });
  });
});
```

- [ ] **Step 2: Run the API test and verify signal is ignored**

Run: `npm test -- foldersApi.test.js`

Expected: exit code 1 because fetch currently receives no options object.

- [ ] **Step 3: Add the compatible options argument**

Replace `listFolderBooks` in `client/src/api/foldersApi.js` with:

```js
export async function listFolderBooks(folderId, options = {}) {
  const response = await fetch(`/api/folders/${folderId}/books`, {
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(response.status === 404 ? '文件夹不存在' : '无法加载文件夹');
  }

  return response.json();
}
```

- [ ] **Step 4: Write failing out-of-order hook tests**

Create `client/src/hooks/useFolderState.test.jsx`:

```jsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFolderState } from './useFolderState.js';

const api = vi.hoisted(() => ({
  listFolderBooks: vi.fn(),
  renameFolder: vi.fn(),
}));

vi.mock('../api/foldersApi.js', () => api);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('useFolderState request ordering', () => {
  beforeEach(() => {
    api.listFolderBooks.mockReset();
    api.renameFolder.mockReset();
  });

  it('keeps B when A resolves after B', async () => {
    const requestA = deferred();
    const requestB = deferred();
    api.listFolderBooks
      .mockReturnValueOnce(requestA.promise)
      .mockReturnValueOnce(requestB.promise);
    const { result } = renderHook(() => useFolderState());

    act(() => { void result.current.handleOpenFolder({ id: 1, name: 'A' }); });
    const firstSignal = api.listFolderBooks.mock.calls[0][1].signal;
    act(() => { void result.current.handleOpenFolder({ id: 2, name: 'B' }); });
    expect(firstSignal.aborted).toBe(true);

    await act(async () => {
      requestB.resolve({ books: [{ id: 22, title: 'Book B' }] });
      await requestB.promise;
    });
    await act(async () => {
      requestA.resolve({ books: [{ id: 11, title: 'Book A' }] });
      await requestA.promise;
    });

    expect(result.current.openFolder.id).toBe(2);
    expect(result.current.folderBooks.map((book) => book.id)).toEqual([22]);
    expect(result.current.folderError).toBe('');
  });

  it('does not restore state after close and ignores AbortError', async () => {
    vi.useFakeTimers();
    const request = deferred();
    api.listFolderBooks.mockReturnValue(request.promise);
    const { result } = renderHook(() => useFolderState());

    act(() => { void result.current.handleOpenFolder({ id: 3, name: 'C' }); });
    act(() => result.current.handleCloseFolder());
    expect(api.listFolderBooks.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { vi.advanceTimersByTime(180); });

    await act(async () => {
      request.reject(new DOMException('aborted', 'AbortError'));
      await request.promise.catch(() => {});
    });
    expect(result.current.openFolder).toBeNull();
    expect(result.current.folderBooks).toEqual([]);
    expect(result.current.folderError).toBe('');
  });

  it('shows a real error only for the current request', async () => {
    api.listFolderBooks.mockRejectedValue(new Error('当前文件夹网络错误'));
    const { result } = renderHook(() => useFolderState());

    await act(async () => {
      await result.current.handleOpenFolder({ id: 5, name: 'E' });
    });
    expect(result.current.folderError).toBe('当前文件夹网络错误');
    expect(result.current.isFolderLoading).toBe(false);
  });
});
```

- [ ] **Step 5: Run the hook tests and observe stale state**

Run: `npm test -- useFolderState.test.jsx`

Expected: exit code 1; A can overwrite B and `listFolderBooks` has no signal.

- [ ] **Step 6: Add request lifecycle helpers to `useFolderState`**

After `folderCloseTimeoutRef`, add:

```js
  const folderRequestRef = useRef({
    controller: null,
    folderId: null,
    requestId: 0,
  });

  const invalidateFolderRequest = useCallback(() => {
    const current = folderRequestRef.current;
    current.controller?.abort();
    folderRequestRef.current = {
      controller: null,
      folderId: null,
      requestId: current.requestId + 1,
    };
  }, []);

  const beginFolderRequest = useCallback((folderId) => {
    invalidateFolderRequest();
    const controller = new AbortController();
    const request = {
      controller,
      folderId,
      requestId: folderRequestRef.current.requestId,
    };
    folderRequestRef.current = request;
    return request;
  }, [invalidateFolderRequest]);

  const isCurrentFolderRequest = useCallback((request) => (
    folderRequestRef.current.requestId === request.requestId &&
    folderRequestRef.current.folderId === request.folderId &&
    folderRequestRef.current.controller === request.controller
  ), []);
```

- [ ] **Step 7: Replace open, close-finalization and refresh request paths**

At the start of `finishCloseFolder`, call:

```js
    invalidateFolderRequest();
```

and add `invalidateFolderRequest` to its dependency array.

Replace `handleOpenFolder` with:

```js
  const handleOpenFolder = useCallback(async (folder, options = {}) => {
    const ignoreUntil = options.ignoreUntil || 0;
    if (!folder || options.isShelfBusy || performance.now() < ignoreUntil) return;

    if (folderCloseTimeoutRef.current) {
      clearTimeout(folderCloseTimeoutRef.current);
      folderCloseTimeoutRef.current = null;
    }

    const request = beginFolderRequest(folder.id);
    setIsFolderClosing(false);
    setOpenFolder(folder);
    setFolderBooks([]);
    setFolderError('');
    setFolderNameDraft('');
    setIsRenamingFolder(false);
    setIsFolderLoading(true);

    try {
      const data = await listFolderBooks(folder.id, { signal: request.controller.signal });
      if (!isCurrentFolderRequest(request)) return;
      setFolderBooks((data.books || []).map(normalizeFolderBook));
    } catch (error) {
      if (error?.name === 'AbortError' || !isCurrentFolderRequest(request)) return;
      setFolderError(error.message || '无法加载文件夹');
    } finally {
      if (isCurrentFolderRequest(request)) setIsFolderLoading(false);
    }
  }, [beginFolderRequest, isCurrentFolderRequest]);
```

In `handleCloseFolder`, call `invalidateFolderRequest()` immediately after its guard, and add it to the dependency array.

Replace `refreshOpenFolderBooksOrClose` with:

```js
  const refreshOpenFolderBooksOrClose = useCallback(async () => {
    if (!openFolder) return;
    const request = beginFolderRequest(openFolder.id);

    try {
      const data = await listFolderBooks(openFolder.id, { signal: request.controller.signal });
      if (!isCurrentFolderRequest(request)) return;
      const nextFolderBooks = (data.books || []).map(normalizeFolderBook);
      if (nextFolderBooks.length) setFolderBooks(nextFolderBooks);
      else finishCloseFolder();
    } catch (error) {
      if (error?.name === 'AbortError' || !isCurrentFolderRequest(request)) return;
      finishCloseFolder();
    }
  }, [beginFolderRequest, finishCloseFolder, isCurrentFolderRequest, openFolder]);
```

In the unmount cleanup effect, add:

```js
      invalidateFolderRequest();
```

and change that effect dependency array from `[]` to `[invalidateFolderRequest]`.

- [ ] **Step 8: Run API and hook concurrency tests**

Run: `npm test -- foldersApi.test.js useFolderState.test.jsx`

Expected: exit code 0 with four passing tests; A's signal is aborted, its late result does not mutate B or a closed overlay, AbortError stays silent, and the current real error is displayed.

- [ ] **Step 9: Commit request concurrency protection**

```powershell
git add client/src/api/foldersApi.js client/src/api/foldersApi.test.js client/src/hooks/useFolderState.js client/src/hooks/useFolderState.test.jsx
git commit -m "fix: ignore stale folder responses"
```

### Task 2: Shared modal focus and keyboard hook

**Files:**
- Create: `client/src/hooks/useModalDialog.test.jsx`
- Create: `client/src/hooks/useModalDialog.js`

- [ ] **Step 1: Write failing focus, trap, Escape and restore tests**

Create `client/src/hooks/useModalDialog.test.jsx`:

```jsx
import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModalDialog } from './useModalDialog.js';

function Harness({ onClose, open }) {
  const firstRef = useRef(null);
  const { dialogRef, onKeyDown } = useModalDialog({
    initialFocusRef: firstRef,
    onRequestClose: onClose,
    open,
  });

  if (!open) return null;
  return (
    <div ref={dialogRef} onKeyDown={onKeyDown} role="dialog" tabIndex={-1}>
      <button ref={firstRef} type="button">First</button>
      <button type="button">Last</button>
    </div>
  );
}

describe('useModalDialog', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback) => { callback(); return 1; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  it('focuses inside, traps Tab, handles Escape, and restores focus', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <><button type="button">Trigger</button><Harness onClose={onClose} open={false} /></>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    trigger.focus();

    rerender(<><button type="button">Trigger</button><Harness onClose={onClose} open /></>);
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    expect(first).toHaveFocus();

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();
    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.keyDown(last, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<><button type="button">Trigger</button><Harness onClose={onClose} open={false} /></>);
    expect(screen.getByRole('button', { name: 'Trigger' })).toHaveFocus();
  });
});
```

- [ ] **Step 2: Run the modal hook test and verify the module is missing**

Run: `npm test -- useModalDialog.test.jsx`

Expected: exit code 1 with a failed import for `useModalDialog.js`.

- [ ] **Step 3: Implement the modal hook**

Create `client/src/hooks/useModalDialog.js`:

```js
import { useCallback, useEffect, useRef } from 'react';

const focusableSelector = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function isVisible(element) {
  if (!element.isConnected || element.hidden || element.closest('[hidden], [aria-hidden="true"]')) return false;

  for (let current = element; current instanceof HTMLElement; current = current.parentElement) {
    const style = window.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  }
  return true;
}

function focusableElements(dialog) {
  return [...dialog.querySelectorAll(focusableSelector)].filter(isVisible);
}

export function useModalDialog({
  initialFocusRef,
  onRequestClose,
  open,
  restoreFocus = true,
}) {
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    const animationFrame = requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const initialTarget = initialFocusRef?.current;
      const target = initialTarget && isVisible(initialTarget)
        ? initialTarget
        : focusableElements(dialog)[0] || dialog;
      target.focus();
    });

    return () => {
      cancelAnimationFrame(animationFrame);
      const previousFocus = previousFocusRef.current;
      if (restoreFocus && previousFocus?.isConnected) previousFocus.focus();
      previousFocusRef.current = null;
    };
  }, [initialFocusRef, open, restoreFocus]);

  const onKeyDown = useCallback((event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onRequestClose?.();
      return;
    }
    if (event.key !== 'Tab') return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const elements = focusableElements(dialog);
    if (elements.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [onRequestClose]);

  return { dialogRef, onKeyDown };
}
```

- [ ] **Step 4: Run the modal hook test**

Run: `npm test -- useModalDialog.test.jsx`

Expected: exit code 0; focus cycles at both ends, Escape calls once, and close restores the trigger.

- [ ] **Step 5: Commit the shared modal hook**

```powershell
git add client/src/hooks/useModalDialog.js client/src/hooks/useModalDialog.test.jsx
git commit -m "feat: add shared modal focus management"
```

### Task 3: Integrate all three dialogs

**Files:**
- Modify: `client/src/components/bookshelf/DeleteConfirmDialog.jsx`
- Modify: `client/src/components/bookshelf/DeleteConfirmDialog.test.jsx`
- Modify: `client/src/components/folders/FolderOverlay.jsx`
- Create: `client/src/components/folders/FolderOverlay.test.jsx`
- Modify: `client/src/components/reader/ReaderView.jsx`

- [ ] **Step 1: Extend the delete dialog test for keyboard behavior**

Append this test to `DeleteConfirmDialog.test.jsx`:

```jsx
  it('focuses cancel, closes on Escape, and restores the trigger', async () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <>
        <button type="button">Delete trigger</button>
        <DeleteConfirmDialog book={null} isDeleting={false} onCancel={onCancel} onConfirm={vi.fn()} />
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'Delete trigger' });
    trigger.focus();
    rerender(
      <>
        <button type="button">Delete trigger</button>
        <DeleteConfirmDialog book={{ id: 1, title: 'Book' }} isDeleting={false} onCancel={onCancel} onConfirm={vi.fn()} />
      </>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: '取消' })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    rerender(
      <>
        <button type="button">Delete trigger</button>
        <DeleteConfirmDialog book={null} isDeleting={false} onCancel={onCancel} onConfirm={vi.fn()} />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Delete trigger' })).toHaveFocus();
  });
```

Also change that file's Testing Library import to:

```js
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
```

- [ ] **Step 2: Integrate the delete dialog hook**

Replace `client/src/components/bookshelf/DeleteConfirmDialog.jsx` with:

```jsx
import { useRef } from 'react';
import { useModalDialog } from '../../hooks/useModalDialog.js';

export function DeleteConfirmDialog({ book, isDeleting, onCancel, onConfirm }) {
  const cancelButtonRef = useRef(null);
  const { dialogRef, onKeyDown } = useModalDialog({
    initialFocusRef: cancelButtonRef,
    onRequestClose: onCancel,
    open: Boolean(book),
  });

  if (!book) return null;
  const title = book.title || '这本书';

  return (
    <div
      ref={dialogRef}
      className="delete-confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-confirm-title"
      onKeyDown={onKeyDown}
      tabIndex={-1}
    >
      <div className="delete-confirm-backdrop" />
      <section className="delete-confirm-panel">
        <h2 id="delete-confirm-title">删除《{title}》？</h2>
        <p>这会从书架和服务器中移除 EPUB 文件。</p>
        <div className="delete-confirm-actions">
          <button ref={cancelButtonRef} type="button" onClick={onCancel} disabled={isDeleting}>
            取消
          </button>
          <button className="is-danger" type="button" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? '正在删除' : '删除'}
          </button>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Write the folder focus and nested-Escape tests**

Create `client/src/components/folders/FolderOverlay.test.jsx`:

```jsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FolderOverlay } from './FolderOverlay.jsx';

const baseProps = {
  books: [],
  error: '',
  folder: { id: 1, name: 'Folder' },
  isClosing: false,
  isLoading: false,
  isRenaming: false,
  isRenameSaving: false,
  isSavingOrder: false,
  onClose: vi.fn(),
  onOpenBook: vi.fn(),
  onRenameCancel: vi.fn(),
  onRenameDraftChange: vi.fn(),
  onRenameStart: vi.fn(),
  onRenameSubmit: vi.fn(),
  renameDraft: 'Folder',
};

describe('FolderOverlay dialog behavior', () => {
  it('focuses the title and traps backward Tab', async () => {
    render(<FolderOverlay {...baseProps} />);
    const title = screen.getByRole('button', { name: 'Folder' });
    await waitFor(() => expect(title).toHaveFocus());
    fireEvent.keyDown(title, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: '关闭文件夹' })).toHaveFocus();
  });

  it('Escape in rename cancels rename without closing the folder', () => {
    const onClose = vi.fn();
    const onRenameCancel = vi.fn();
    render(<FolderOverlay {...baseProps} isRenaming onClose={onClose} onRenameCancel={onRenameCancel} />);

    fireEvent.keyDown(screen.getByRole('textbox', { name: '文件夹名称' }), { key: 'Escape' });
    expect(onRenameCancel).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Integrate the folder dialog hook**

Add imports to `FolderOverlay.jsx`:

```js
import { useRef } from 'react';
import { useModalDialog } from '../../hooks/useModalDialog.js';
```

At the beginning of the component body, before the null return, add:

```js
  const initialFocusRef = useRef(null);
  const { dialogRef, onKeyDown } = useModalDialog({
    initialFocusRef,
    onRequestClose: onClose,
    open: Boolean(folder),
  });
```

Change the root element to:

```jsx
    <div
      ref={dialogRef}
      className={overlayClassName}
      role="dialog"
      aria-modal="true"
      aria-labelledby="folder-overlay-title"
      onKeyDown={onKeyDown}
      tabIndex={-1}
    >
```

Add `ref={initialFocusRef}` to both `.folder-title-button` and `.folder-rename-input`. Replace the rename input Escape handler with:

```jsx
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      onRenameCancel();
                    }
                  }}
```

- [ ] **Step 5: Integrate the reader dialog hook**

Add to `ReaderView.jsx` imports:

```js
import { useModalDialog } from '../../hooks/useModalDialog.js';
```

Add beside the other refs:

```js
  const readerInitialFocusRef = useRef(null);
```

Immediately after `handleCloseClick` is declared, add:

```js
  const { dialogRef, onKeyDown: onDialogKeyDown } = useModalDialog({
    initialFocusRef: readerInitialFocusRef,
    onRequestClose: handleCloseClick,
    open: true,
  });
```

Add these props to the root `.reader-overlay`:

```jsx
      ref={(node) => {
        dialogRef.current = node;
        readerInitialFocusRef.current = node;
      }}
      onKeyDown={onDialogKeyDown}
      tabIndex={-1}
```

The existing `role`, `aria-modal`, and accessible label remain unchanged.

- [ ] **Step 6: Run modal component tests and build**

Run:

```powershell
npm test -- useModalDialog.test.jsx DeleteConfirmDialog.test.jsx FolderOverlay.test.jsx
npm run build
```

Expected: all tests pass and build exits 0; rename Escape calls only cancel, while root Escape follows each component's existing guarded close function.

- [ ] **Step 7: Commit dialog integration**

```powershell
git add client/src/components/bookshelf/DeleteConfirmDialog.jsx client/src/components/bookshelf/DeleteConfirmDialog.test.jsx client/src/components/folders/FolderOverlay.jsx client/src/components/folders/FolderOverlay.test.jsx client/src/components/reader/ReaderView.jsx
git commit -m "fix: manage focus across application dialogs"
```

### Task 4: Reduced-motion preference and folder close timing

**Files:**
- Create: `client/src/hooks/useReducedMotion.test.jsx`
- Create: `client/src/hooks/useReducedMotion.js`
- Modify: `client/src/hooks/useFolderState.js`
- Modify: `client/src/hooks/useFolderState.test.jsx`

- [ ] **Step 1: Write failing matchMedia tests**

Create `client/src/hooks/useReducedMotion.test.jsx`:

```jsx
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useReducedMotion } from './useReducedMotion.js';

describe('useReducedMotion', () => {
  it('reads and reacts to the reduced-motion media query', () => {
    let listener;
    const mediaQuery = {
      matches: true,
      addEventListener: vi.fn((eventName, callback) => { listener = callback; }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', vi.fn(() => mediaQuery));
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);

    act(() => listener({ matches: false }));
    expect(result.current).toBe(false);
  });

  it('defaults to false when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });
});
```

- [ ] **Step 2: Run the hook test and verify the module is missing**

Run: `npm test -- useReducedMotion.test.jsx`

Expected: exit code 1 with a failed import for `useReducedMotion.js`.

- [ ] **Step 3: Implement the media-query hook with legacy fallback**

Create `client/src/hooks/useReducedMotion.js`:

```js
import { useEffect, useState } from 'react';

const query = '(prefers-reduced-motion: reduce)';

function currentPreference() {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

export function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(currentPreference);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mediaQuery = window.matchMedia(query);
    const handleChange = (event) => setReducedMotion(event.matches);
    setReducedMotion(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  return reducedMotion;
}
```

- [ ] **Step 4: Make folder close immediate under reduced motion**

Add this import to `useFolderState.js`:

```js
import { useReducedMotion } from './useReducedMotion.js';
```

At the top of the hook body add:

```js
  const reducedMotion = useReducedMotion();
```

In `handleCloseFolder`, after setting `isFolderClosing`, replace timer creation with:

```js
    if (reducedMotion) {
      finishCloseFolder();
      return;
    }

    folderCloseTimeoutRef.current = setTimeout(() => {
      folderCloseTimeoutRef.current = null;
      finishCloseFolder();
    }, FOLDER_CLOSE_ANIM_MS);
```

Add `reducedMotion` to the callback dependency array.

- [ ] **Step 5: Add the immediate-close regression**

Append to `useFolderState.test.jsx`:

```jsx
  it('finishes close synchronously when reduced motion is requested', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    api.listFolderBooks.mockResolvedValue({ books: [] });
    const { result } = renderHook(() => useFolderState());

    await act(async () => { await result.current.handleOpenFolder({ id: 4, name: 'D' }); });
    act(() => result.current.handleCloseFolder());
    expect(result.current.openFolder).toBeNull();
    expect(result.current.isFolderClosing).toBe(false);
  });
```

- [ ] **Step 6: Run reduced-motion and folder tests**

Run: `npm test -- useReducedMotion.test.jsx useFolderState.test.jsx`

Expected: exit code 0; media changes update state and reduced-motion close needs no 180ms timer advance.

- [ ] **Step 7: Commit reduced-motion state plumbing**

```powershell
git add client/src/hooks/useReducedMotion.js client/src/hooks/useReducedMotion.test.jsx client/src/hooks/useFolderState.js client/src/hooks/useFolderState.test.jsx
git commit -m "feat: honor reduced motion in folder transitions"
```

### Task 5: Reader reduced-motion timing and CSS

**Files:**
- Create: `client/src/components/reader/ReaderView.test.jsx`
- Modify: `client/src/components/reader/ReaderView.jsx`
- Modify: `client/src/styles/pwa.css`

- [ ] **Step 1: Write a reduced-motion page-turn/close test**

Create `client/src/components/reader/ReaderView.test.jsx` with stable hook mocks:

```jsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReaderView } from './ReaderView.jsx';

const state = vi.hoisted(() => ({
  next: vi.fn(),
  onClose: vi.fn(),
  relocatedHandler: null,
}));

vi.mock('../../hooks/useReducedMotion.js', () => ({ useReducedMotion: () => true }));
vi.mock('../../hooks/useReadingProgressPersistence.js', () => ({
  useReadingProgressPersistence: () => ({ enqueueProgress: vi.fn(), flushProgress: vi.fn() }),
}));
vi.mock('../../hooks/usePageProgress.js', () => ({
  usePageProgress: () => ({
    pageProgressLabel: '1/2',
    refreshCurrentPageProgress: vi.fn(),
    resetPageProgress: vi.fn(),
    updatePageProgressFromLocation: vi.fn(),
  }),
}));
vi.mock('../../hooks/useReaderSettings.js', () => ({
  useReaderSettings: () => ({
    applyReaderHorizontalMargin: vi.fn(), applyReaderSettings: vi.fn(),
    applyReaderSettingsToContents: vi.fn(), decreaseFontSize: vi.fn(),
    flushPendingReaderSettings: vi.fn(), fontFamilyId: 'system', fontFamilyOptions: [],
    fontSize: 18, fontSizeMax: 40, fontSizeMin: 14, fontSizeStep: 2,
    handleFontFamilyChange: vi.fn(), handleFontSizeChange: vi.fn(), handleThemeChange: vi.fn(),
    increaseFontSize: vi.fn(), layoutSettings: {}, loadReaderSettings: vi.fn(),
    markReaderSettingsLoaded: vi.fn(), readerFont: {},
    readerSettingsRef: { current: {} }, readerTheme: { background: '#fff', text: '#000', muted: '#666' },
    readerThemeId: 'light', readerViewportStyle: {}, resetReaderSettingsLoad: vi.fn(), themeOptions: [],
  }),
}));
vi.mock('../../hooks/useEpubRendition.js', async () => {
  const { useEffect } = await import('react');
  return {
    useEpubRendition: (args) => {
      useEffect(() => {
        args.renditionRef.current = {
          currentLocation: () => ({ atEnd: false, atStart: false }),
          next: () => {
            state.next();
            queueMicrotask(() => state.relocatedHandler?.());
          },
          off: vi.fn(),
          on: (name, handler) => { if (name === 'relocated') state.relocatedHandler = handler; },
        };
        args.setIsLoading(false);
      }, [args.renditionRef, args.setIsLoading]);
      return { currentHref: null, progress: 0.2, toc: [] };
    },
  };
});

describe('ReaderView reduced motion', () => {
  it('navigates once without animation waits and Escape closes immediately', async () => {
    state.next.mockClear();
    state.onClose.mockClear();
    render(<ReaderView book={{ id: 1, title: 'Book' }} onClose={state.onClose} originRect={null} />);
    let gestureLayer;
    await waitFor(() => {
      gestureLayer = document.querySelector('.reader-gesture-layer');
      expect(gestureLayer).not.toBeNull();
    });
    vi.spyOn(gestureLayer, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 375 });

    fireEvent.pointerDown(gestureLayer, { clientX: 300, clientY: 300 });
    fireEvent.pointerUp(gestureLayer, { clientX: 300, clientY: 300 });
    await waitFor(() => expect(state.next).toHaveBeenCalledTimes(1));

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(state.onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the reader test and observe the animation delay**

Run: `npm test -- ReaderView.test.jsx`

Expected: exit code 1 or timeout because close/page-turn still schedules fixed animation waits instead of reduced-motion paths.

- [ ] **Step 3: Add reduced-motion state and zero-wait close/open behavior**

Add this import to `ReaderView.jsx`:

```js
import { useReducedMotion } from '../../hooks/useReducedMotion.js';
```

At the beginning of `ReaderView`, before animation-dependent state initializers, add:

```js
  const reducedMotion = useReducedMotion();
```

Change initial animation state to:

```js
  const [flipTransform, setFlipTransform] = useState(() => (
    originRect && !reducedMotion ? rectToTransformString(originRect) : null
  ));
  const [coverOpacity, setCoverOpacity] = useState(() => (
    originRect && !reducedMotion ? 1 : 0
  ));
```

At the top of the reader-open animation effect add:

```js
    if (reducedMotion) return undefined;
```

and add `reducedMotion` to that effect dependency array.

In `handleCloseClick`, immediately after `void flushProgress({ keepalive: true });`, add:

```js
    if (reducedMotion) {
      onClose();
      return;
    }
```

Add `reducedMotion` to the close callback dependency array.

- [ ] **Step 4: Add the reduced-motion single-navigation branch**

Inside `turnPage`, after the boundary check and before `setPageTurn`, add:

```js
      if (reducedMotion) {
        const relocated = waitForRelocated(rendition, PAGE_NAV_TIMEOUT_MS);
        Promise.resolve(nav()).catch(() => {});
        await relocated;
        schedulePageTurnFollowUp(() => {
          if (renditionRef.current === rendition && !isClosingRef.current) {
            applyReaderSettings(rendition, readerSettingsRef.current);
          }
        });
        return;
      }
```

Add `reducedMotion` to `turnPage` dependencies. Set the cover clone transition duration with:

```jsx
            transitionDuration: `${reducedMotion ? 0 : READER_COVER_FADE_MS}ms`,
```

- [ ] **Step 5: Add CSS reduced-motion rules while preserving progress spinners**

Append to `client/src/styles/pwa.css`:

```css
@media (prefers-reduced-motion: reduce) {
  .reader-overlay,
  .reader-overlay *:not(.reader-loading-spinner),
  .folder-overlay,
  .folder-overlay *:not(.folder-loading-spinner),
  .library-home *,
  .delete-confirm-overlay,
  .delete-confirm-overlay * {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }

  .reader-loading-spinner {
    animation: spin 0.75s linear infinite;
  }

  .folder-loading-spinner {
    animation: folder-loading-spin 0.82s linear infinite;
  }
}
```

- [ ] **Step 6: Run reader, reduced-motion, and full client tests**

Run:

```powershell
npm test -- ReaderView.test.jsx useReducedMotion.test.jsx useFolderState.test.jsx
npm test
npm run build
```

Expected: all commands exit 0; a reduced-motion gesture calls `rendition.next` once and Escape calls `onClose` synchronously.

- [ ] **Step 7: Commit reader/CSS reduced motion**

```powershell
git add client/src/components/reader/ReaderView.jsx client/src/components/reader/ReaderView.test.jsx client/src/styles/pwa.css
git commit -m "fix: remove decorative motion when requested"
```

### Task 6: Browser focus and reduced-motion acceptance

**Files:**
- Create: `client/scripts/verify-reader-accessibility.mjs`
- Modify: `client/package.json`
- Modify: `.github/workflows/quality.yml`

- [ ] **Step 1: Add the browser accessibility regression**

Create `client/scripts/verify-reader-accessibility.mjs`:

```js
import { chromium } from 'playwright';
import { prepareReaderVerification } from './reader-verification-environment.mjs';

const environment = await prepareReaderVerification();
const browser = await chromium.launch(environment.browserOptions);
const page = await browser.newPage({ viewport: { width: 375, height: 667 } });

try {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(environment.appUrl, { waitUntil: 'networkidle', timeout: 30000 });

  const firstBook = page.locator('.continue-book-button[data-book-id], button.book-shell[data-book-id]').first();
  await firstBook.focus();
  await page.keyboard.press('Enter');
  const reader = page.locator('.reader-overlay');
  await reader.waitFor({ timeout: 15000 });
  const readerHasFocus = await reader.evaluate((element) => element === document.activeElement);
  if (!readerHasFocus) throw new Error('阅读器打开后焦点未进入 dialog');

  const readerCloseStarted = Date.now();
  await page.keyboard.press('Escape');
  await reader.waitFor({ state: 'detached', timeout: 500 });
  if (Date.now() - readerCloseStarted >= 500) throw new Error('减少动画时阅读器关闭仍在等待动画');
  if (!(await firstBook.evaluate((element) => element === document.activeElement))) {
    throw new Error('阅读器关闭后焦点未恢复到书籍按钮');
  }

  const shelfResponse = await fetch(new URL('/api/folders/shelf', environment.appUrl));
  const shelf = await shelfResponse.json();
  const sourceBook = shelf.items.find((item) => item.type === 'book').book;
  const epubResponse = await fetch(new URL(`/api/books/${sourceBook.id}/file`, environment.appUrl));
  const form = new FormData();
  form.append('file', new Blob([await epubResponse.arrayBuffer()], { type: 'application/epub+zip' }), 'Second Fixture.epub');
  const uploadResponse = await fetch(new URL('/api/books', environment.appUrl), { method: 'POST', body: form });
  if (!uploadResponse.ok) throw new Error(`第二本书上传失败: ${uploadResponse.status}`);

  const updatedShelf = await (await fetch(new URL('/api/folders/shelf', environment.appUrl))).json();
  const rootBookIds = updatedShelf.items.filter((item) => item.type === 'book').map((item) => item.id);
  const folderResponse = await fetch(new URL('/api/folders', environment.appUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceBookId: rootBookIds[0], targetBookId: rootBookIds[1] }),
  });
  if (!folderResponse.ok) throw new Error(`创建文件夹失败: ${folderResponse.status}`);

  await page.reload({ waitUntil: 'networkidle' });
  const folderButton = page.locator('button.book-shell').filter({ has: page.locator('.folder-cover') }).first();
  await folderButton.focus();
  await page.keyboard.press('Enter');
  const folderDialog = page.locator('.folder-overlay');
  await folderDialog.waitFor({ timeout: 5000 });
  await page.keyboard.press('Escape');
  await folderDialog.waitFor({ state: 'detached', timeout: 500 });
  if (!(await folderButton.evaluate((element) => element === document.activeElement))) {
    throw new Error('文件夹关闭后焦点未恢复');
  }

  console.log(JSON.stringify({
    folderFocusRestored: true,
    readerFocusRestored: true,
    reducedMotion: true,
  }, null, 2));
} finally {
  await browser.close();
  await environment.cleanup();
}
```

- [ ] **Step 2: Add the npm and CI commands**

Add to `client/package.json` scripts:

```json
"verify:reader-accessibility": "node scripts/verify-reader-accessibility.mjs"
```

Append to the `mobile` job in `.github/workflows/quality.yml`:

```yaml
      - run: npm run verify:reader-accessibility
        working-directory: client
```

- [ ] **Step 3: Run full non-Docker acceptance**

Run:

```powershell
npm test
npm run build
npm run verify:reader-mobile
npm run verify:reader-progress
npm run verify:reader-accessibility
```

Expected: all commands exit 0; the final script reports all three booleans true. Docker/NAS verification remains out of scope.

- [ ] **Step 4: Commit browser accessibility coverage**

```powershell
git add client/scripts/verify-reader-accessibility.mjs client/package.json .github/workflows/quality.yml
git commit -m "test: verify modal focus and reduced motion"
```

## Self-review checklist

- [ ] Folder race maps to Task 1; focus entry/trap/Escape/restore maps to Tasks 2–3; reduced-motion JS/CSS/browser behavior maps to Tasks 4–6.
- [ ] Every state write from folder fetches checks controller, folderId and requestId; open, close, finish-close, refresh and unmount invalidate the prior request; AbortError never becomes user-visible.
- [ ] Reader starts on dialog root, Folder starts on title/rename input, Delete starts on Cancel; all roots have `tabIndex={-1}` and use existing business close guards.
- [ ] Reduced motion removes reader/folder waits and decorative CSS animation, but reader navigation still calls next/prev once and both loading spinners continue rotating.
- [ ] Scan this document for every prohibited placeholder phrase named by the writing-plans skill; expected result is zero matches.
- [ ] Verify consistent names: `folderRequestRef`, `invalidateFolderRequest`, `useModalDialog`, `onRequestClose`, `initialFocusRef`, `useReducedMotion`, and `reducedMotion`.
