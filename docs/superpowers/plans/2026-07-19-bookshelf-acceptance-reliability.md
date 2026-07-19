# Bookshelf Acceptance Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加搜索焦点可见性，并让书架规格检查拒绝不完整首行、延迟 API 请求和真实可拖的只读结果。

**Architecture:** 纯断言模块新增三列和真实 drag snapshot 约束；Playwright 脚本延长请求观察窗口、采集 focus ring，并执行一次 pointer drag probe。生产代码只增加搜索容器 focus ring，不改变布局或交互状态。

**Tech Stack:** CSS、Vitest 3、Playwright 1.61、Vite 7

---

## Execution Boundary

- Base: `dev0718` at or after design commit `294b62b`.
- Branch/worktree: `codex/bookshelf-acceptance-reliability` in a new isolated worktree.
- This is Wave 1 and may run in parallel with loader ownership and reader progress.
- Do not edit React hooks/components, `App.jsx`, reader files, error markup, or `backlog.md`.

## File and Interface Map

- Modify/Test: `client/scripts/bookshelf-verification-assertions.test.js` — pure RED/GREEN cases.
- Modify: `client/scripts/bookshelf-verification-assertions.mjs` — enforces three-item row, focus, and real drag result.
- Modify: `client/scripts/verify-bookshelf-home.mjs` — captures focus, observes delayed requests, and probes pointer drag.
- Modify: `client/src/styles/bookshelf.css` — visible focus ring without layout shift.

### Task 1: Tighten the pure acceptance contract

**Files:**

- Modify: `client/scripts/bookshelf-verification-assertions.test.js`
- Modify: `client/scripts/bookshelf-verification-assertions.mjs`
- Test: `client/scripts/bookshelf-verification-assertions.test.js`

- [ ] **Step 1: Update the passing search snapshot**

  In the existing local-search test replace `dragHandleCount: 0` with:

  ```js
  focusIndicatorVisible: true,
  readOnlyDragActivated: false,
  ```

- [ ] **Step 2: Add incomplete-row and activated-drag failures**

  ```js
  it('rejects a 430px first screen with fewer than three shelf items', () => {
    expect(inspectBookshelfLayout({
      viewport: { width: 430, height: 932 },
      app: { left: 0, right: 430, width: 430 },
      documentScrollWidth: 430,
      search: { top: 80, bottom: 128 },
      continueSection: { top: 144, bottom: 292 },
      firstShelfRow: [{ top: 470, bottom: 679 }],
      continueViewport: { left: 18, right: 412 },
      continueCards: [
        { left: 18, right: 310 },
        { left: 322, right: 614 },
      ],
      touchTargets: [{ width: 48, height: 48 }],
    })).toContain('430×932 首屏未完整显示搜索、继续阅读和一整排书架');
  });

  it('rejects an invisible search focus or activated read-only drag', () => {
    expect(inspectBookshelfSearch({
      durationMs: 72,
      typedRequestCount: 0,
      folderContextVisible: true,
      readOnlyItemCount: 1,
      focusIndicatorVisible: false,
      readOnlyDragActivated: true,
    })).toEqual(expect.arrayContaining([
      '搜索框缺少可见键盘焦点',
      '搜索结果仍可触发拖动',
    ]));
  });
  ```

- [ ] **Step 3: Run the pure test and verify RED**

  ```powershell
  npm --prefix client test -- bookshelf-verification-assertions.test.js
  ```

  Expected: one-item first rows still pass and the new search fields are ignored.

- [ ] **Step 4: Implement the pure assertions**

  Change the first-row condition to:

  ```js
  const firstRowFits = firstShelfRow.length >= 3 && firstShelfRow.every(
    (item) => item.top >= 0 && item.bottom <= viewport.height + LAYOUT_EPSILON,
  );
  ```

  Replace the drag-handle check in `inspectBookshelfSearch` and add focus:

  ```js
  if (!snapshot.focusIndicatorVisible) {
    errors.push('搜索框缺少可见键盘焦点');
  }
  if (snapshot.readOnlyDragActivated) {
    errors.push('搜索结果仍可触发拖动');
  }
  ```

- [ ] **Step 5: Re-run the same pure test and verify GREEN**

  ```powershell
  npm --prefix client test -- bookshelf-verification-assertions.test.js
  ```

  Expected: all pure assertion tests pass.

### Task 2: Add the focus ring and browser evidence

**Files:**

- Modify: `client/src/styles/bookshelf.css`
- Modify: `client/scripts/verify-bookshelf-home.mjs`

- [ ] **Step 1: Add the search focus ring**

  Immediately after `.library-search-control`, add:

  ```css
  .library-search-control:focus-within {
    box-shadow:
      inset 0 0 0 1px rgba(29, 29, 31, 0.08),
      0 0 0 3px rgba(0, 122, 255, 0.24);
  }
  ```

  This changes paint only; do not add border, margin, or padding.

- [ ] **Step 2: Add focus and real-drag helpers to the browser script**

  Add below `setSearchAndMeasure`:

  ```js
  async function hasVisibleSearchFocus(page, searchbox) {
    const control = page.locator('.library-search-control');
    const before = await control.evaluate((element) => getComputedStyle(element).boxShadow);
    await searchbox.focus();
    const after = await control.evaluate((element) => getComputedStyle(element).boxShadow);
    return before !== after && after !== 'none';
  }

  async function probeReadOnlyDrag(page) {
    const item = page.locator('.read-only-shelf-item').first();
    const box = await item.boundingBox();
    if (!box) throw new Error('无法定位只读搜索结果');
    await item.evaluate((element) => {
      element.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      }, { capture: true, once: true });
    });

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 48, startY, { steps: 4 });
    await page.waitForTimeout(150);
    const activated = await page.evaluate(() => Boolean(
      document.querySelector('.read-only-shelf-item.is-dragging') ||
      document.querySelector('.drag-preview') ||
      document.querySelector('.delete-drop-zone'),
    ));
    await page.mouse.up();
    return activated;
  }
  ```

- [ ] **Step 3: Capture focus before entry regressions**

  Immediately after obtaining `searchbox`, add:

  ```js
  const focusIndicatorVisible = await hasVisibleSearchFocus(page, searchbox);
  ```

- [ ] **Step 4: Keep request counting active through the quiet window**

  Replace the current search measurement block with:

  ```js
  countTypedRequests = true;
  const searchDurationMs = await setSearchAndMeasure(page, '作者 349');
  await page.waitForTimeout(500);
  await page.waitForLoadState('networkidle');
  countTypedRequests = false;
  const readOnlyDragActivated = await probeReadOnlyDrag(page);
  ```

- [ ] **Step 5: Update snapshot and JSON fields**

  Build `searchSnapshot` with these exact fields:

  ```js
  const searchSnapshot = await page.evaluate(({
    durationMs,
    dragActivated,
    focusVisible,
    requestCount,
  }) => ({
    durationMs,
    typedRequestCount: requestCount,
    folderContextVisible: Array.from(document.querySelectorAll('.shelf-item-context'))
      .some((element) => element.textContent?.includes('历史')),
    readOnlyItemCount: document.querySelectorAll('.read-only-shelf-item').length,
    focusIndicatorVisible: focusVisible,
    readOnlyDragActivated: dragActivated,
  }), {
    durationMs: searchDurationMs,
    dragActivated: readOnlyDragActivated,
    focusVisible: focusIndicatorVisible,
    requestCount: typedRequestCount,
  });
  ```

  In the final JSON, replace `dragHandleCount` with:

  ```js
  focusIndicatorVisible: searchSnapshot.focusIndicatorVisible,
  readOnlyDragActivated: searchSnapshot.readOnlyDragActivated,
  ```

- [ ] **Step 6: Build the client**

  ```powershell
  npm --prefix client run build
  ```

  Expected: Vite exits with code 0.

- [ ] **Step 7: Run the bookshelf browser specification once**

  ```powershell
  npm --prefix client run verify:bookshelf-home
  ```

  Expected: JSON reports `typedRequestCount: 0`, `focusIndicatorVisible: true`, `readOnlyDragActivated: false`, and a 430px row with at least three entries.

- [ ] **Step 8: Commit this batch**

  ```powershell
  git add client/src/styles/bookshelf.css client/scripts/bookshelf-verification-assertions.mjs client/scripts/bookshelf-verification-assertions.test.js client/scripts/verify-bookshelf-home.mjs
  git commit -m "test: strengthen bookshelf acceptance checks"
  ```

## Done Criteria

- Search focus changes computed visual style without layout shift.
- One-item 430px rows fail and three-item rows pass.
- Request counting remains active through a 500ms observation window and network idle.
- A real pointer movement cannot activate drag UI for read-only results.
- Pure tests, build, and the one browser specification pass.
