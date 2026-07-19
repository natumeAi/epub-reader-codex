# Reader Close Progress Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 关闭 reader 时保持即时 UI 关闭，同时把首页 recent/catalog 刷新排在 progress flush settle 之后。

**Architecture:** `ReaderView` 将关闭分成 `onClose` 与 `onProgressSettled` 两条 callback；前者保持动画/session 时序，后者由 keepalive flush promise 的 fulfilled/rejected 两条路径触发。`App` 只在 settle callback 中刷新 recent/catalog。

**Tech Stack:** React 19、Vitest 3、Testing Library、existing progress outbox hook

---

## Execution Boundary

- Base: `dev0718` at or after design commit `294b62b`.
- Branch/worktree: `codex/reader-close-progress-refresh` in a new isolated worktree.
- This is Wave 1 and may run in parallel with loader ownership and bookshelf acceptance.
- Do not edit `useShelfData.js`, bookshelf CSS/scripts, error props, or `backlog.md`.

## File and Interface Map

- Modify: `client/src/components/reader/ReaderView.jsx` — owns flush/settle sequencing while preserving close animation.
- Modify/Test: `client/src/components/reader/ReaderView.test.jsx` — proves immediate close and delayed settle callback for resolve/reject.
- Modify: `client/src/App.jsx` — wires session close separately from homepage refresh.

### Task 1: Specify the close/settle callback contract

**Files:**

- Modify: `client/src/components/reader/ReaderView.test.jsx`
- Test: `client/src/components/reader/ReaderView.test.jsx`

- [ ] **Step 1: Add a deferred helper**

  Add above the describe block:

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

- [ ] **Step 2: Replace the existing close test with a resolved settle regression**

  ```jsx
  it('closes immediately and reports after the progress flush settles', async () => {
    const progressFlush = deferred();
    const onClose = vi.fn();
    const onProgressSettled = vi.fn();
    const onBookUnavailable = vi.fn();
    mocks.flushProgress.mockReturnValue(progressFlush.promise);
    render(
      <ReaderView
        book={{ id: 12, title: '测试书' }}
        onBookUnavailable={onBookUnavailable}
        onClose={onClose}
        onProgressSettled={onProgressSettled}
      />,
    );

    expect(mocks.useReadingProgressPersistence).toHaveBeenCalledWith({ bookId: 12 });
    expect(mocks.useEpubRendition).toHaveBeenCalledWith(expect.objectContaining({
      enqueueProgress: mocks.enqueueProgress,
      flushPendingReaderSettings: mocks.flushPendingReaderSettings,
      onBookUnavailable,
    }));

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(mocks.flushProgress).toHaveBeenCalledWith({ keepalive: true });
    expect(mocks.cancelPageTurn).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onProgressSettled).not.toHaveBeenCalled();

    await act(async () => {
      progressFlush.resolve();
      await progressFlush.promise;
    });
    expect(onProgressSettled).toHaveBeenCalledTimes(1);
  });
  ```

- [ ] **Step 3: Add the rejected settle regression**

  ```jsx
  it('reports progress settled after a failed close flush', async () => {
    const progressFlush = deferred();
    const onProgressSettled = vi.fn();
    mocks.flushProgress.mockReturnValue(progressFlush.promise);
    render(
      <ReaderView
        book={{ id: 12, title: '测试书' }}
        onClose={vi.fn()}
        onProgressSettled={onProgressSettled}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await act(async () => {
      progressFlush.reject(new Error('offline'));
      await Promise.resolve();
    });
    expect(onProgressSettled).toHaveBeenCalledTimes(1);
  });
  ```

- [ ] **Step 4: Run the targeted test and verify RED**

  ```powershell
  npm --prefix client test -- ReaderView.test.jsx
  ```

  Expected: the new settle assertions fail because `ReaderView` does not accept or invoke `onProgressSettled`.

### Task 2: Split UI close from progress-settled refresh

**Files:**

- Modify: `client/src/components/reader/ReaderView.jsx`
- Modify: `client/src/App.jsx`
- Test: `client/src/components/reader/ReaderView.test.jsx`

- [ ] **Step 1: Add the optional ReaderView callback**

  Add a module-level no-op and extend the component signature:

  ```js
  const noop = () => {};
  ```

  ```js
  export function ReaderView({
    book,
    originRect,
    onBookUnavailable,
    onClose,
    onProgressSettled = noop,
  }) {
  ```

- [ ] **Step 2: Schedule settle notification from the close flush**

  In `handleCloseClick`, replace the fire-and-forget flush line with:

  ```js
  const progressFlush = flushProgress({ keepalive: true });
  void Promise.resolve(progressFlush).then(
    () => onProgressSettled(),
    () => onProgressSettled(),
  );
  ```

  Add `onProgressSettled` to the callback dependency array. Do not move the existing reduced-motion branch or animation timers, and do not await `progressFlush` before calling `onClose`.

- [ ] **Step 3: Wire App refresh to the settle callback**

  Replace `handleCloseReader` with:

  ```js
  function handleReaderProgressSettled() {
    void Promise.all([loadRecentReading(), loadCatalog()]);
  }
  ```

  Update the ReaderView props:

  ```jsx
  <ReaderView
    book={readingBook}
    originRect={readingBookOrigin}
    onBookUnavailable={handleBookUnavailable}
    onClose={closeReader}
    onProgressSettled={handleReaderProgressSettled}
  />
  ```

- [ ] **Step 4: Re-run the same targeted test and verify GREEN**

  ```powershell
  npm --prefix client test -- ReaderView.test.jsx
  ```

  Expected: all ReaderView tests pass; rejection is handled and produces no unhandled rejection output.

- [ ] **Step 5: Build the client**

  ```powershell
  npm --prefix client run build
  ```

  Expected: Vite exits with code 0 and validates the App/ReaderView prop wiring.

- [ ] **Step 6: Commit this batch**

  ```powershell
  git add client/src/App.jsx client/src/components/reader/ReaderView.jsx client/src/components/reader/ReaderView.test.jsx
  git commit -m "fix: refresh library after progress settles"
  ```

## Done Criteria

- Reader UI close timing and animation paths remain unchanged.
- `onProgressSettled` fires once for fulfilled or rejected close flushes.
- App refreshes recent/catalog only from that callback.
- Only the three listed files change.
