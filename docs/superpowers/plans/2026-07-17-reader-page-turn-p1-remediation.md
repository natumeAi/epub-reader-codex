# Reader Page Turn P1 Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复翻页异步取消竞态、完整一页拖动超时和恢复异常冒泡，并为三类行为建立自动回归覆盖。

**Architecture:** `usePageTurnController` 使用取消代次阻止已取消异步操作继续导航或覆盖阶段，并通过统一恢复函数确定地进入 basic。`epubPageTurnAdapter` 在动画起点已经等于非零目标页时主动请求 epub.js 报告当前位置，同时把恢复失败封装为布尔结果。Playwright 使用真实 scroller 页宽覆盖完整一页拖动。

**Tech Stack:** React 19、epub.js 0.3.93、Vitest 3、Testing Library、Playwright 1.61、jsdom 26

---

## Preconditions and Scope

- Design: `docs/superpowers/specs/2026-07-17-reader-page-turn-p1-remediation-design.md`
- Base behavior tests: `client/src/hooks/usePageTurnController.test.jsx` and `client/src/utils/epubPageTurnAdapter.test.js`
- Only modify:
  - `client/src/hooks/usePageTurnController.js`
  - `client/src/hooks/usePageTurnController.test.jsx`
  - `client/src/utils/epubPageTurnAdapter.js`
  - `client/src/utils/epubPageTurnAdapter.test.js`
  - `client/scripts/verify-reader-page-turn.mjs`
- Preserve unrelated untracked files and the two existing untracked page-turn plan documents.
- Every production change follows a witnessed RED test run, then a GREEN run.

## File Responsibility Map

- `epubPageTurnAdapter.js`: owns epub.js scroller integration, explicit stable-location reporting, and non-throwing stable-CFI recovery.
- `epubPageTurnAdapter.test.js`: proves exact-target reporting, unavailable reporting, and failed display recovery.
- `usePageTurnController.js`: owns cancellation generation, async continuation guards, and recovery-to-basic policy.
- `usePageTurnController.test.jsx`: proves cancellation stops every continuation and recovery errors do not reject.
- `verify-reader-page-turn.mjs`: proves the exact one-page hold/release path against a real continuous rendition.

### Task 1: Make adapter exact-target reporting and recovery deterministic

**Files:**
- Modify: `client/src/utils/epubPageTurnAdapter.test.js`
- Modify: `client/src/utils/epubPageTurnAdapter.js`
- Modify: `client/scripts/verify-reader-page-turn.mjs`

- [ ] **Step 1: Extend the rendition fixture with location reporting**

In `createRendition`, replace the rendition object with:

```js
return {
  rendition: {
    manager,
    display: vi.fn().mockResolvedValue(undefined),
    reportLocation: vi.fn(),
  },
  manager,
  scroller,
  ...overrides,
};
```

- [ ] **Step 2: Add failing exact-target and recovery tests**

Append to `client/src/utils/epubPageTurnAdapter.test.js`:

```js
it('reports the stable location when animation starts at the target page', async () => {
  const fixture = createRendition();
  const frames = createFrameDriver();
  const adapter = createEpubPageTurnAdapter(fixture.rendition, frames.environment);
  adapter.begin('stable-cfi');
  fixture.scroller.scrollLeft = 200;

  const settling = adapter.animateTo(1, { duration: 120 });
  frames.step(0);
  frames.step(120);

  await expect(settling).resolves.toEqual({ status: 'completed' });
  expect(fixture.rendition.reportLocation).toHaveBeenCalledTimes(1);
});

it.each([
  ['missing', (rendition) => { rendition.reportLocation = undefined; }],
  ['failing', (rendition) => {
    rendition.reportLocation.mockRejectedValue(new Error('report failed'));
  }],
])('returns unavailable when exact-target reporting is %s', async (_name, mutate) => {
  const fixture = createRendition();
  mutate(fixture.rendition);
  const frames = createFrameDriver();
  const adapter = createEpubPageTurnAdapter(fixture.rendition, frames.environment);
  adapter.begin('stable-cfi');
  fixture.scroller.scrollLeft = 200;

  const settling = adapter.animateTo(1, { duration: 120 });
  frames.step(0);
  frames.step(120);

  await expect(settling).resolves.toEqual({ status: 'unavailable' });
});

it('returns false when stable CFI recovery display fails', async () => {
  const fixture = createRendition();
  fixture.rendition.display.mockRejectedValue(new Error('display failed'));
  const adapter = createEpubPageTurnAdapter(fixture.rendition);
  adapter.begin('stable-cfi');

  await expect(adapter.recover()).resolves.toBe(false);
});
```

- [ ] **Step 3: Run the adapter tests and verify RED**

Run:

```powershell
npm test --prefix client -- epubPageTurnAdapter.test.js
```

Expected: the exact-target test reports zero `reportLocation` calls, the unavailable cases resolve `completed`, and failed display recovery rejects instead of resolving false.

- [ ] **Step 4: Add the real-browser exact-page regression before production changes**

In `readScroll`, add:

```js
width: scroller.clientWidth,
```

After the rollback scenario and before the fast swipe, add:

```js
const exactStart = await label(page);
const exactScroll = await readScroll(page);
const exactFromX = Math.min(350, exactScroll.width + 20);
const exactToX = exactFromX - exactScroll.width;
await drag(page, {
  fromX: exactFromX,
  toX: exactToX,
  holdMs: 250,
});
const exactPage = await label(page);
if (exactPage.current !== exactStart.current + 1) {
  throw new Error('Exact-page drag failed: ' + JSON.stringify({
    exactStart, exactScroll, exactPage,
  }));
}
```

Add `exactPage` to the final JSON output.

- [ ] **Step 5: Run the browser regression and verify RED**

Run:

```powershell
npm run verify:reader-page-turn --prefix client
```

Expected: exit 1 after approximately 1200ms with `Exact-page drag failed`; the exact-page gesture returns to its starting page.

- [ ] **Step 6: Implement exact-target reporting**

In `animateTo`, immediately after calculating `destination`, add:

```js
const startsAtDestination = pageDelta !== 0 &&
  Math.abs(startLogical - destination) <= ALIGNMENT_EPSILON_PX;
```

Replace the completion block after `if (linearProgress < 1)` with:

```js
if (startsAtDestination) {
  const reportLocation = rendition?.reportLocation;
  if (typeof reportLocation !== 'function') {
    animation = null;
    resolve({ status: 'unavailable' });
    return;
  }

  const activeAnimation = animation;
  Promise.resolve()
    .then(() => reportLocation.call(rendition))
    .then(
      () => {
        if (animation !== activeAnimation) return;
        animation = null;
        resolve({ status: 'completed' });
      },
      () => {
        if (animation !== activeAnimation) return;
        animation = null;
        resolve({ status: 'unavailable' });
      },
    );
  return;
}

animation = null;
resolve({ status: 'completed' });
```

This identity check prevents an old report Promise from resolving a cancelled or replaced animation.

- [ ] **Step 7: Make recovery non-throwing**

Replace `recover` with:

```js
async function recover() {
  const stableCfi = session?.stableCfi;
  cancel({ restoreOrigin: true });
  if (!stableCfi || typeof rendition?.display !== 'function') return false;
  try {
    await rendition.display(stableCfi);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 8: Run adapter and browser checks and verify GREEN**

Run:

```powershell
npm test --prefix client -- epubPageTurnAdapter.test.js
npm run verify:reader-page-turn --prefix client
```

Expected: all adapter tests pass with no unhandled rejection; browser output includes `exactPage`, and normal, exact-page, and fast gestures each advance one page.

- [ ] **Step 9: Commit adapter remediation and browser coverage**

```powershell
git add client/src/utils/epubPageTurnAdapter.js client/src/utils/epubPageTurnAdapter.test.js client/scripts/verify-reader-page-turn.mjs
git commit -m "fix: report stable page turn targets"
```

### Task 2: Stop cancelled controller operations from continuing

**Files:**
- Modify: `client/src/hooks/usePageTurnController.test.jsx`
- Modify: `client/src/hooks/usePageTurnController.js`

- [ ] **Step 1: Add a reusable enhanced touch starter to the test**

After `pointerEvent`, add:

```js
async function startEnhancedTouch(result, { endX = 180 } = {}) {
  const start = pointerEvent({ clientX: 300, timeStamp: 0 });
  const move = pointerEvent({ clientX: endX, timeStamp: 250 });
  act(() => result.current.handlePointerDown(start));
  act(() => result.current.handlePointerMove(move));
  await act(async () => { await new Promise(requestAnimationFrame); });
  act(() => result.current.handlePointerUp(move));
  return { move, start };
}
```

- [ ] **Step 2: Add failing cancellation tests**

Append:

```js
it('does not recover or enter basic after resize cancels enhanced settling', async () => {
  const harness = createHarness();
  const animation = deferred();
  harness.adapter.animateTo.mockReturnValue(animation.promise);
  const { result } = renderHook(() => usePageTurnController(harness));
  await waitFor(() => expect(result.current.phase).toBe('idle'));

  await startEnhancedTouch(result);
  await waitFor(() => expect(result.current.phase).toBe('settling'));
  act(() => window.dispatchEvent(new Event('resize')));
  await act(async () => {
    animation.resolve({ status: 'cancelled' });
    await animation.promise;
  });

  expect(harness.adapter.recover).not.toHaveBeenCalled();
  expect(result.current.phase).toBe('idle');
});

it('does not run basic navigation after resize cancels a missing-neighbor rollback', async () => {
  const harness = createHarness();
  harness.adapter.begin.mockReturnValue({
    available: true,
    canNext: false,
    canPrevious: true,
    origin: 100,
    pageWidth: 100,
  });
  const animation = deferred();
  harness.adapter.animateTo.mockReturnValue(animation.promise);
  const { result } = renderHook(() => usePageTurnController(harness));
  await waitFor(() => expect(result.current.phase).toBe('idle'));

  await startEnhancedTouch(result);
  await waitFor(() => expect(result.current.phase).toBe('settling'));
  act(() => window.dispatchEvent(new Event('resize')));
  await act(async () => {
    animation.resolve({ status: 'cancelled' });
    await animation.promise;
  });

  expect(harness.rendition.next).not.toHaveBeenCalled();
  expect(harness.rendition.prev).not.toHaveBeenCalled();
  expect(result.current.phase).toBe('idle');
});

it('does not recover after cancellation while automatic navigation waits for relocation', async () => {
  const harness = createHarness();
  harness.adapter.animateTo.mockResolvedValue({ status: 'completed' });
  const { result } = renderHook(() => usePageTurnController(harness));
  await waitFor(() => expect(result.current.phase).toBe('idle'));

  let navigation;
  await act(async () => {
    navigation = result.current.turnPage('next');
    await Promise.resolve();
  });
  act(() => window.dispatchEvent(new Event('resize')));
  await act(async () => { await navigation; });

  expect(harness.adapter.recover).not.toHaveBeenCalled();
  expect(result.current.phase).toBe('idle');
});
```

- [ ] **Step 3: Run the controller tests and verify RED**

Run:

```powershell
npm test --prefix client -- usePageTurnController.test.jsx
```

Expected: cancelled enhanced settling calls recover or ends in basic, and cancelled missing-neighbor rollback calls `rendition.next()`.

- [ ] **Step 4: Add cancellation generation helpers**

Beside the existing refs add:

```js
const cancellationVersionRef = useRef(0);
```

After `setPhase`, add:

```js
const isCurrentOperation = useCallback((version) => (
  cancellationVersionRef.current === version
), []);
```

At the first line of `cancelPageTurn`, add:

```js
cancellationVersionRef.current += 1;
```

- [ ] **Step 5: Guard automatic navigation continuations**

Replace `runEnhancedNavigation` with:

```js
const runEnhancedNavigation = useCallback(async (
  nextDirection,
  session,
  operationVersion,
) => {
  const delta = pageDelta(nextDirection);
  const rendition = renditionRef.current;
  const waiter = createRelocationWait(
    rendition,
    () => adapter.isStableAt(delta),
    PAGE_TURN_RULES.relocatedTimeoutMs,
  );
  relocationWaitRef.current = waiter;
  const animation = await adapter.animateTo(delta, {
    duration: PAGE_TURN_RULES.tapDurationMs,
    onProgress: ({ pageWidth, progress }) => {
      writeEdgeProgress(nextDirection, progress, pageWidth);
    },
  });

  if (!isCurrentOperation(operationVersion)) {
    waiter.cancel();
    return 'ignored';
  }
  if (animation.status !== 'completed') {
    waiter.cancel();
    return animation.status === 'unavailable' ? 'failed' : 'ignored';
  }

  const location = await waiter.promise;
  if (!isCurrentOperation(operationVersion)) return 'ignored';
  if (!location || !adapter.isStableAt(delta)) {
    await adapter.recover();
    if (!isCurrentOperation(operationVersion)) return 'ignored';
    enterBasic();
    return 'failed';
  }

  adapter.end();
  return 'completed';
}, [
  adapter,
  enterBasic,
  isCurrentOperation,
  renditionRef,
  writeEdgeProgress,
]);
```

Replace `turnPage` with:

```js
const turnPage = useCallback(async (nextDirection) => {
  if (!['idle', 'basic'].includes(phaseRef.current)) return 'ignored';
  const rendition = renditionRef.current;
  if (!rendition || !['prev', 'next'].includes(nextDirection)) return 'ignored';

  const operationVersion = cancellationVersionRef.current;
  setPhase('settling');
  try {
    const location = await readCurrentLocation(rendition).catch(() => null);
    if (!isCurrentOperation(operationVersion)) return 'ignored';
    if (isBoundary(location, nextDirection)) return 'blocked';

    if (basicRef.current) {
      return await runBasicNavigation(nextDirection);
    }

    const session = adapter?.begin(currentCfiRef.current);
    if (!session) {
      enterBasic();
      return await runBasicNavigation(nextDirection);
    }

    const neighborReady =
      nextDirection === 'next' ? session.canNext : session.canPrevious;
    if (!neighborReady) {
      adapter.cancel({ restoreOrigin: true });
      return await runBasicNavigation(nextDirection);
    }

    setDirection(nextDirection);
    writeEdgeProgress(nextDirection, 0, session.pageWidth);
    return await runEnhancedNavigation(nextDirection, session, operationVersion);
  } finally {
    if (isCurrentOperation(operationVersion)) restoreReadyPhase();
  }
}, [
  adapter,
  currentCfiRef,
  enterBasic,
  isCurrentOperation,
  renditionRef,
  restoreReadyPhase,
  runBasicNavigation,
  runEnhancedNavigation,
  setPhase,
  writeEdgeProgress,
]);
```

- [ ] **Step 6: Guard enhanced touch continuations**

At the beginning of `handlePointerUp`, capture:

```js
const operationVersion = cancellationVersionRef.current;
```

Replace the enhanced branch beginning at `setPhase('settling')` and ending before `void settle()` with:

```js
setPhase('settling');
try {
  if (delta === 0) {
    const duration = getSettleDuration(
      Math.abs(dragResult?.effectiveDistanceX || 0),
      pointer.session.pageWidth,
    );
    await adapter.animateTo(0, {
      duration,
      onProgress: ({ pageWidth, progress }) => {
        writeEdgeProgress(nextDirection, progress, pageWidth);
      },
    });
    if (!isCurrentOperation(operationVersion)) return;
    adapter.end();
    return;
  }

  const neighborReady =
    delta === 1 ? pointer.session.canNext : pointer.session.canPrevious;
  if (!neighborReady) {
    await adapter.animateTo(0, {
      duration: PAGE_TURN_RULES.settleDurationMinMs,
      onProgress: ({ pageWidth, progress }) => {
        writeEdgeProgress(nextDirection, progress, pageWidth);
      },
    });
    if (!isCurrentOperation(operationVersion)) return;
    adapter.end();
    const location = await readCurrentLocation(renditionRef.current).catch(() => null);
    if (!isCurrentOperation(operationVersion)) return;
    if (!isBoundary(location, nextDirection)) {
      await runBasicNavigation(nextDirection);
      if (!isCurrentOperation(operationVersion)) return;
    }
    return;
  }

  const remaining = Math.max(
    0,
    pointer.session.pageWidth - Math.abs(dragResult?.effectiveDistanceX || 0),
  );
  const waiter = createRelocationWait(
    renditionRef.current,
    () => adapter.isStableAt(delta),
    PAGE_TURN_RULES.relocatedTimeoutMs,
  );
  relocationWaitRef.current = waiter;
  const animation = await adapter.animateTo(delta, {
    duration: getSettleDuration(remaining, pointer.session.pageWidth),
    onProgress: ({ pageWidth, progress }) => {
      writeEdgeProgress(nextDirection, progress, pageWidth);
    },
  });
  if (!isCurrentOperation(operationVersion)) {
    waiter.cancel();
    return;
  }
  const location = animation.status === 'completed' ? await waiter.promise : null;
  if (!isCurrentOperation(operationVersion)) return;
  if (!location || !adapter.isStableAt(delta)) {
    waiter.cancel();
    await adapter.recover();
    if (!isCurrentOperation(operationVersion)) return;
    enterBasic();
  } else {
    adapter.end();
  }
  if (relocationWaitRef.current === waiter) relocationWaitRef.current = null;
} finally {
  if (isCurrentOperation(operationVersion)) restoreReadyPhase();
}
```

Remove the old branch-local `restoreReadyPhase()` calls and add `isCurrentOperation` to the callback dependency array.

- [ ] **Step 7: Run the controller tests and verify GREEN**

Run:

```powershell
npm test --prefix client -- usePageTurnController.test.jsx
```

Expected: all controller tests pass; cancellation leaves phase ready without recovery, basic navigation, or stale finally state changes.

- [ ] **Step 8: Commit cancellation remediation**

```powershell
git add client/src/hooks/usePageTurnController.js client/src/hooks/usePageTurnController.test.jsx
git commit -m "fix: stop cancelled page turn continuations"
```

### Task 3: Guarantee recovery failures enter basic without rejecting

**Files:**
- Modify: `client/src/hooks/usePageTurnController.test.jsx`
- Modify: `client/src/hooks/usePageTurnController.js`

- [ ] **Step 1: Add a failing recovery rejection test**

Inside `describe('usePageTurnController navigation')`, append:

```js
it('enters basic without rejecting when stable CFI recovery fails', async () => {
  vi.useFakeTimers();
  const harness = createHarness();
  harness.adapter.animateTo.mockResolvedValue({ status: 'completed' });
  harness.adapter.recover.mockRejectedValue(new Error('display failed'));
  const { result } = renderHook(() => usePageTurnController(harness));
  await act(async () => { await Promise.resolve(); });

  let outcome;
  await act(async () => {
    const navigation = result.current.turnPage('next');
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1200);
    outcome = await navigation;
  });

  expect(outcome).toBe('failed');
  expect(result.current.phase).toBe('basic');
});
```

- [ ] **Step 2: Run the directed test and verify RED**

Run:

```powershell
npm test --prefix client -- usePageTurnController.test.jsx
```

Expected: the new test rejects with `display failed` instead of returning `failed`.

- [ ] **Step 3: Add the unified recovery helper**

Before `runEnhancedNavigation`, add:

```js
const recoverToBasic = useCallback(async (operationVersion) => {
  try {
    await adapter?.recover?.();
  } catch {
    // Recovery failure still falls back to basic navigation.
  }
  if (!isCurrentOperation(operationVersion)) return false;
  enterBasic();
  return true;
}, [adapter, enterBasic, isCurrentOperation]);
```

Replace each controller sequence:

```js
await adapter.recover();
enterBasic();
```

with:

```js
await recoverToBasic(operationVersion);
```

After the call, return `ignored` or stop the touch settle if the operation became stale; otherwise return `failed` for automatic navigation. Add `recoverToBasic` to affected dependency arrays.

- [ ] **Step 4: Handle unavailable animations without waiting for relocation**

In automatic and touch target-settle paths, when `animation.status === 'unavailable'`:

```js
waiter.cancel();
await recoverToBasic(operationVersion);
return 'failed'; // automatic path; touch path returns after recovery
```

When the status is `cancelled`, cancel the waiter and return `ignored` without permanent downgrade.

- [ ] **Step 5: Run the controller and adapter tests and verify GREEN**

Run:

```powershell
npm test --prefix client -- usePageTurnController.test.jsx epubPageTurnAdapter.test.js
```

Expected: all directed tests pass and recovery rejection produces no unhandled Promise rejection.

- [ ] **Step 6: Commit recovery remediation**

```powershell
git add client/src/hooks/usePageTurnController.js client/src/hooks/usePageTurnController.test.jsx
git commit -m "fix: contain page turn recovery failures"
```

### Task 4: Run final verification

**Files:**
- Verify only; no production files are changed by this task.

- [ ] **Step 1: Re-run the page-turn browser verification**

Run:

```powershell
npm run verify:reader-page-turn --prefix client
```

Expected: exit 0; normal, exact-page, and fast gestures each advance exactly one page; rollback is unchanged; reduced motion uses basic navigation; `sheetRemoved` is true.

- [ ] **Step 2: Run the full client verification set**

Run:

```powershell
npm test --prefix client
npm run build --prefix client
npm run verify:reader-mobile --prefix client
npm run verify:reader-progress --prefix client
npm run verify:reader-accessibility --prefix client
git diff --check 5b65c4c..HEAD
```

Expected:

- all Vitest files pass;
- Vite production build exits 0;
- mobile, progress, and accessibility verification scripts exit 0;
- diff check prints no errors.

- [ ] **Step 3: Verify the private boundary and working tree**

Run:

```powershell
rg -n "\.(manager|_layout|snapper)|scrollLeft|rtlScrollType|reportLocation" client/src --glob "!**/*.test.*"
git status --short
```

Expected: page-turn private integration and `reportLocation` appear only in `client/src/utils/epubPageTurnAdapter.js`; unrelated pre-existing untracked files remain untouched.

## Final Review Checklist

- [ ] Cancellation generation is checked after every await that can resume an obsolete operation.
- [ ] Cancelled operations never call recover, `next/prev`, `adapter.end`, or stale ready-phase restoration.
- [ ] Exact-target reporting happens only for non-zero page delta when animation starts at its destination.
- [ ] Missing/failing location reporting and failed display recovery resolve to controlled statuses.
- [ ] Unit tests were observed RED before production changes and GREEN after them.
- [ ] Real Chromium exact-page drag completes without the 1200ms recovery path.
- [ ] Full tests, build, mobile/progress/accessibility scripts, private-boundary search, and diff check pass.
