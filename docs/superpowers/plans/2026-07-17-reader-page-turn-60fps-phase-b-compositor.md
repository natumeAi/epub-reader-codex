# Reader Page Turn 60 FPS Phase B Compositor Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `epubPageTurnAdapter` 内实现可强制测试的 compositor backend：拖动和 settle 只移动已显示 `.epub-view` 与页缝，成功落页时仅提交一次 scroller，并在任何异常/取消后完整恢复且让后续操作安全降级。

**Architecture:** 保留 controller 的状态机、取消代次和 `begin/dragBy/animateTo/end/cancel/recover` 方法名。adapter 在每次 `begin()` 内选择 backend，保存 epub.js 私有状态与 inline 样式；compositor 用同一组 WAAPI 关键帧驱动 views/页缝，完成时在一个绘制周期内交换 transform 与一次 scroll，scroll backend 和 basic navigation 永久保留。

**Tech Stack:** React 19、epub.js 0.3.93 continuous manager、Web Animations API、ResizeObserver/MutationObserver（可用时）、Vitest 3、Testing Library、Playwright 1.61

---

## Plan Position

- Prerequisite: complete Phase A at `docs/superpowers/plans/2026-07-17-reader-page-turn-60fps-phase-a-baseline.md`.
- Recommended order: Phase A → **Phase B（本计划）** → Phase C.
- Phase B 可独立停止：正常用户默认仍走 scroll；compositor 只通过显式 debug force 启用，直到 Phase C 实机门槛通过。
- Design source: `docs/superpowers/specs/2026-07-17-reader-page-turn-60fps-design.md`.

## Global Constraints

### Execution and Review Guardrails

严格按照设计文档和本计划执行，不扩大范围。

不得因为发现新的优化点而增加当前计划内容。

新发现的非阻塞问题统一记录到 Backlog。

每个 Task 只允许一次实现检查。

不得在每个 Task 中调用 requesting-code-review。

不得执行开放式全面质量审查。

不得形成“审查—修复—重新审查”的循环。

修复后只能重新运行原计划指定的验证。

同一验证连续失败两次时必须停止并报告。

满足 Done Criteria 后必须立即结束当前 Task。

不以零警告、零技术债、穷尽边界或生产级完美作为完成标准。

与当前设计目标无关的问题不得阻塞计划完成。

## Code Mapping Before Tasks

### 1. Current entry points

- `ReaderView.jsx` supplies pointer/key input and the page-edge element.
- `usePageTurnController.js` decides phase, direction, gesture result and relocation/recovery policy.
- `epubPageTurnAdapter.js` owns all private epub.js access and Phase A diagnostics/backend forcing.

### 2. Current call chain and target data flow

```text
controller begin(metadata + edge)
  -> adapter common scroll capability
  -> backend selection inside adapter
     -> compositor: snapshot displayed views -> temporary will-change
        -> drag: view/edge translate only, scroller stays at origin
        -> rollback: WAAPI to 0 -> restore
        -> commit: WAAPI to +/-pageWidth
                   -> one rAF: one logical scroll write + remove transforms
                   -> relocated -> stable validation
     -> scroll: Phase A rAF scroll implementation
  -> on failure: restore stable page first; next operation selects scroll/basic
```

### 3. Core files in this phase

- `client/src/utils/pageTurnGesture.js`: pure adaptive sampling of the approved cubic curve.
- `client/src/utils/epubPageTurnAdapter.js`: capability, snapshot, backend selection, WAAPI group, atomic commit, recovery and cleanup.
- `client/src/hooks/usePageTurnController.js`: backend-agnostic recovery-to-ready policy.
- `client/scripts/verify-reader-page-turn.mjs`: forced compositor/scroll browser assertions.
- `server/test/helpers/createEpubFixture.js`: test-only fixture extension for multi-chapter and RTL EPUBs; production server behavior is untouched.
- `PROJECT.md`: approved reader boundary wording, updated only after the forced compositor path is working.

### 4. Existing test coverage consumed

- Phase A diagnostics and cleaned scroll-backend unit/browser coverage.
- Gesture thresholds/easing primitive tests.
- Adapter LTR and two supported RTL mappings, settle, cancellation and recovery tests.
- Controller phase/direction/cancellation/basic fallback tests.
- Browser normal commit, rollback, exact-page, fast swipe, geometry and reduced-motion checks.

### 5. Files affected by Phase B

- Modify: `client/src/utils/pageTurnGesture.js`
- Modify: `client/src/utils/pageTurnGesture.test.js`
- Modify: `client/src/utils/epubPageTurnAdapter.js`
- Modify: `client/src/utils/epubPageTurnAdapter.test.js`
- Modify: `client/src/hooks/usePageTurnController.js`
- Modify: `client/src/hooks/usePageTurnController.test.jsx`
- Modify: `client/scripts/verify-reader-page-turn.mjs`
- Modify: `client/scripts/reader-verification-environment.mjs`
- Modify: `server/test/helpers/createEpubFixture.js` (test fixture only)
- Modify: `PROJECT.md`
- Reference: `client/src/hooks/useEpubRendition.js`
- Reference: `client/src/styles/reader.css`

### 6. Modules that must not change

- Production `server/src/**`, database/API/persistence and EPUB ingestion behavior.
- `client/package.json`, lockfiles and epub.js package source/version.
- Reader controls, settings UI, shelf/folder/PWA cache policy.
- Gesture thresholds, durations, easing semantics and page-margin/theme visuals.

### 7. Compatibility and regression risks

- `.epub-view` is a private epub.js 0.3.93 object (`manager.views.displayed()[n].element`); every access remains guarded in the adapter.
- The final scroll and transform removal must occur before the same paint to avoid double movement/white flash.
- A relocation emitted during commit must not be discarded by `useEpubRendition.isStableAligned()` or duplicated by basic navigation.
- Forced compositor must expose capability/runtime failure; normal selection must fall back to scroll without mixing the two inside a visually displaced session.
- Temporary `will-change`, transforms, observers, animations and diagnostic loops must all be released on every terminal path.

## Behavior Classification

- **Preserve:** controller phases/direction/cancellation generation, gesture decision rules, timing, easing, edge visual, page result, CFI/progress, chapter boundary, supported RTL, reduced motion and basic fallback.
- **Modify:** enhanced visual displacement can be compositor transform instead of per-frame scroll; recovery can return to enhanced-ready when scroll remains available.
- **Add:** adaptive WAAPI keyframes, displayed-view capability checks/snapshots, group animation, atomic commit, runtime compositor disable reason and forced browser acceptance.
- **Deprecate/remove:** no existing public feature is removed. Scroll remains a permanent backend and basic remains the final fallback.

## Conflicts, Blockers, Existing Issues, Backlog

- **Resolved design precedence:** the approved 60 FPS design replaces the scroller-only wording. Task 5 updates `PROJECT.md` to the two-backend adapter boundary; no broader architecture redesign is needed.
- **Conflict 2:** the current shared EPUB fixture generates only one LTR chapter. Task 6 adds backward-compatible test-only options for chapter count and page progression direction; no production server file is modified.
- **Blockers:** none for implementing/forcing compositor. Making it the default is explicitly blocked until Phase C PWA metrics pass on both devices.
- **Existing Issues:** jsdom does not provide production WAAPI behavior; adapter tests must use deterministic fake Animation objects, while Playwright supplies real browser coverage.
- **Backlog:** if wide-iframe compositing itself misses the device gate, collect the reason and open a separate three-page-buffer design. Do not implement that renderer here.

### Task 1: Generate bounded-error easeOutCubic WAAPI samples

**Estimated effort:** 45–60 minutes.

#### Goal

The approved cubic curve can be represented as monotonic linear WAAPI keyframe samples whose maximum normalized position error is at most 0.0025 (0.25% of page width).

#### Existing Behavior

`easeOutCubic(progress)` is evaluated on every main-thread rAF. There is no reusable sampled representation or error guarantee.

#### Required Change

Add an adaptive pure sampler that recursively subdivides a segment until the real curve and its linear interpolation stay within the normalized error threshold, then test endpoints, ordering, monotonicity and a dense-grid maximum error.

#### Files

- Modify: `client/src/utils/pageTurnGesture.js`
- Test: `client/src/utils/pageTurnGesture.test.js`
- Reference: `docs/superpowers/specs/2026-07-17-reader-page-turn-60fps-design.md`

#### Interfaces

- Consumes: existing `easeOutCubic(progress)`.
- Produces: `sampleEaseOutCubicKeyframes(maxErrorRatio = 0.0025): Array<{ offset: number, value: number }>`.
- Affects later Tasks: Task 3 converts each sample to view/edge transforms; Task 4 uses the same samples for commits.

#### Implementation Steps

- [ ] **Step 1: Add failing sampler tests**

Interpolate the returned samples at 1,001 evenly spaced points and assert:

```js
expect(samples[0]).toEqual({ offset: 0, value: 0 });
expect(samples.at(-1)).toEqual({ offset: 1, value: 1 });
expect(samples.every((point, index) => (
  index === 0 || (
    point.offset > samples[index - 1].offset &&
    point.value >= samples[index - 1].value
  )
))).toBe(true);
expect(maxInterpolationError(samples, easeOutCubic)).toBeLessThanOrEqual(0.0025);
```

- [ ] **Step 2: Run the gesture test and witness RED**

Expected: import/export failure for the sampler.

- [ ] **Step 3: Implement adaptive subdivision**

For each segment, compare the curve with linear interpolation at 25%, 50% and 75%; split at the midpoint while any error exceeds the threshold. Cap recursion at 12 levels to guarantee termination, then return sorted unique offsets:

```js
export function sampleEaseOutCubicKeyframes(maxErrorRatio = 0.0025) {
  const tolerance = Number.isFinite(maxErrorRatio) && maxErrorRatio > 0
    ? maxErrorRatio
    : 0.0025;
  const points = [{ offset: 0, value: easeOutCubic(0) }];
  const appendSegment = (left, right, depth) => {
    const leftValue = easeOutCubic(left);
    const rightValue = easeOutCubic(right);
    const exceedsTolerance = [0.25, 0.5, 0.75].some((ratio) => {
      const offset = left + (right - left) * ratio;
      const linearValue = leftValue + (rightValue - leftValue) * ratio;
      return Math.abs(easeOutCubic(offset) - linearValue) > tolerance;
    });

    if (exceedsTolerance && depth < 12) {
      const midpoint = (left + right) / 2;
      appendSegment(left, midpoint, depth + 1);
      appendSegment(midpoint, right, depth + 1);
      return;
    }

    points.push({ offset: right, value: rightValue });
  };

  appendSegment(0, 1, 0);
  return points;
}
```

The implementation must use the existing cubic function; it must not substitute CSS `ease-out` or browser smooth scroll.

- [ ] **Step 4: Re-run the test and witness GREEN**

- [ ] **Step 5: Commit Task 1**

```powershell
git add client/src/utils/pageTurnGesture.js client/src/utils/pageTurnGesture.test.js
git commit -m "feat: sample page turn easing keyframes"
```

#### Done Criteria

- Endpoints are exact, offsets strictly increase and values are monotonic.
- Dense-grid normalized error is at most 0.0025.
- Existing gesture tests remain unchanged and pass.

#### Verification

```powershell
npm test --prefix client -- pageTurnGesture.test.js
```

Expected: the gesture test file passes.

#### Regression Scope

- Existing clamping of `easeOutCubic` outside `[0, 1]`.
- Gesture constants and duration calculations.

#### Out of Scope

- Changing easing, duration, keyframe timing based on device refresh rate, spring physics and 120 FPS tuning.

### Task 2: Add compositor capability checks and reversible session snapshots

**Estimated effort:** 75–90 minutes.

#### Goal

Forced compositor `begin()` succeeds only for a safe, aligned set of connected displayed views and restores every captured inline style when ended/cancelled; normal default remains scroll.

#### Existing Behavior

`inspect()` validates the continuous horizontal scroller but never reads `manager.views.displayed()`, WAAPI support or view transforms/animations. Sessions snapshot only scroller transform.

#### Required Change

Add private compositor inspection, backend selection and a rich session snapshot. Prepare only displayed views and the edge with temporary `will-change`, but do not change their visual transform during `begin()`.

#### Files

- Modify: `client/src/utils/epubPageTurnAdapter.js`
- Test: `client/src/utils/epubPageTurnAdapter.test.js`
- Reference: `client/node_modules/epubjs/src/managers/helpers/views.js`
- Reference: `client/node_modules/epubjs/src/managers/views/iframe.js`

#### Interfaces

- Consumes: Phase A `debugConfig.forceBackend`, common scroll capability and `begin(..., { edgeElement })`.
- Produces:
  - adapter-private `inspectCompositor(capability, edgeElement)` with deterministic reasons `views`, `view-disconnected`, `view-transform`, `view-animation`, `waapi` and `geometry`;
  - `begin()` result adds `backend: 'scroll' | 'compositor'`;
  - compositor session holds stable CFI, origin/physical scroll/page width/max/direction, displayed view identities, initial rects, original `transform`/`willChange`, edge snapshot, visual offset, animations and generation.
- Affects later Tasks: Tasks 3–5 operate only through this snapshot.

#### Implementation Steps

- [ ] **Step 1: Extend the adapter fixture with displayed views and fake WAAPI**

Create connected `.epub-view` elements and an Animation fake with `finished`, `cancel()` and writable `startTime`. Keep existing tests on scroll by default.

- [ ] **Step 2: Add failing capability/style restoration cases**

Cover zero views, disconnected/replaced view, non-empty inline transform, active `getAnimations()`, missing `animate`, invalid geometry and two safe views. Assert safe forced begin sets only temporary will-change and cancel restores exact original inline values.

- [ ] **Step 3: Run the adapter test and witness RED**

- [ ] **Step 4: Add explicit backend selection without changing release default**

Use a release constant that Phase C alone may flip:

```js
const DEFAULT_PAGE_TURN_BACKEND = 'scroll';

function selectBackend({ compositor, forceBackend }) {
  if (forceBackend === 'scroll') return 'scroll';
  if (forceBackend === 'compositor') return compositor.available ? 'compositor' : null;
  return DEFAULT_PAGE_TURN_BACKEND === 'compositor' && compositor.available
    ? 'compositor'
    : 'scroll';
}
```

Forced compositor returning `null` must make `begin()` fail with a diagnostic reason; it must not claim a scroll sample as compositor.

- [ ] **Step 5: Capture and release the session snapshot**

Read all layout/geometry once in `begin()`, store exact inline values, and set `willChange = 'transform'` only on selected views/edge. `end`, `cancel`, `recover`, `destroy` and a failed begin restore those values and clear session arrays.

- [ ] **Step 6: Re-run the adapter test and witness GREEN**

- [ ] **Step 7: Commit Task 2**

```powershell
git add client/src/utils/epubPageTurnAdapter.js client/src/utils/epubPageTurnAdapter.test.js
git commit -m "feat: prepare compositor page turn sessions"
```

#### Done Criteria

- Every design capability precondition has a deterministic pass/fail path.
- Only current displayed `.epub-view` elements are prepared.
- Business transforms/animations are never overwritten.
- Original view/edge styles are restored on every tested terminal path.
- Default backend remains scroll.

#### Verification

```powershell
npm test --prefix client -- epubPageTurnAdapter.test.js
```

Expected: all adapter tests pass.

#### Regression Scope

- Existing continuous/Snap/alignment/RTL capability checks.
- Scroll backend begin/cancel behavior.
- No permanent `will-change` after a session.

#### Out of Scope

- Drag displacement, WAAPI settle, final scroll commit, default activation and epub.js source patches.

### Task 3: Implement compositor drag and rollback

**Estimated effort:** 75–90 minutes.

#### Goal

In a forced compositor session, touch drag moves every displayed view and the seam together while `scrollLeft` stays at origin; rollback animates to zero and restores styles without relocation.

#### Existing Behavior

The scroll backend changes `scrollLeft` during drag and rAF settle. Task 2 only prepares view layers; it does not create visible compositor motion.

#### Required Change

Route compositor `dragBy()` to direct `translate3d` writes, preserve current clamp/damping rules, and implement a synchronized WAAPI group for `animateTo(0)` using Task 1 samples.

#### Files

- Modify: `client/src/utils/epubPageTurnAdapter.js`
- Test: `client/src/utils/epubPageTurnAdapter.test.js`
- Reference: `client/src/utils/pageTurnGesture.js`
- Reference: `client/src/hooks/usePageTurnController.js`

#### Interfaces

- Consumes: Task 1 samples, Task 2 compositor session and existing `dragBy(distanceX)` / `animateTo(0, options)`.
- Produces:
  - adapter-private `writeCompositorOffset(offset)`;
  - adapter-private `createTransformKeyframes(from, to, pageWidth)`;
  - adapter-private `runAnimationGroup({ from, to, duration, direction })` with one shared start time;
  - unchanged drag result `{ boundary, direction, effectiveDistanceX, progress }`.
- Affects later Tasks: Task 4 extends the same group to nonzero commits.

#### Implementation Steps

- [ ] **Step 1: Add failing drag/multi-view/boundary/rollback tests**

Assert two views receive identical transforms, seam uses the Phase A geometry mapping, scroller remains origin through drag, a missing neighbor uses 28px damping, and rollback produces no `scrollLeft` setter or `reportLocation` call.

```js
adapter.begin('stable-cfi', { edgeElement });
adapter.dragBy(-40);
expect(viewElements.map((element) => element.style.transform)).toEqual([
  'translate3d(-40px, 0, 0)',
  'translate3d(-40px, 0, 0)',
]);
expect(scroller.scrollLeft).toBe(100);
```

- [ ] **Step 2: Run the adapter test and witness RED**

- [ ] **Step 3: Implement direct compositor drag writes**

Use existing `clampDragDistance()`/`dampBoundaryDistance()` and store `session.visualOffset`. Write the same transform to every captured view and the derived edge offset; do not read layout or call React state from this path.

- [ ] **Step 4: Build normalized linear WAAPI keyframes**

Map each sampled value to `from + (to - from) * value`, use `easing: 'linear'`, `fill: 'forwards'`, one duration and a shared `document.timeline.currentTime`/injected timeline time for all view and edge animations.

- [ ] **Step 5: Complete rollback without scroll**

Wait for every `Animation.finished`; if all complete for the current generation, cancel the fill animations, restore transforms/will-change, leave scroller at origin and resolve `{ status: 'completed', backend: 'compositor' }`.

- [ ] **Step 6: Re-run the adapter test and witness GREEN**

- [ ] **Step 7: Commit Task 3**

```powershell
git add client/src/utils/epubPageTurnAdapter.js client/src/utils/epubPageTurnAdapter.test.js
git commit -m "feat: animate compositor page turn rollback"
```

#### Done Criteria

- Drag never changes scroller origin or triggers relocation.
- All captured views and the seam use the same visual offset.
- Boundary damping and direction semantics match scroll.
- Rollback reaches zero, commits no scroll and restores all temporary styles.
- Forced compositor diagnostics record drag/rollback as compositor.

#### Verification

```powershell
npm test --prefix client -- epubPageTurnAdapter.test.js
```

Expected: adapter tests pass, including forced compositor drag/rollback.

#### Regression Scope

- Multiple displayed views remain visually synchronized.
- Edge damping maximum stays 28px.
- Scroll backend tests remain green and unchanged.

#### Out of Scope

- Nonzero page commit, relocation/progress, runtime failure downgrade and default selection.

### Task 4: Commit a compositor page turn with one atomic scroll

**Estimated effort:** 75–90 minutes.

#### Goal

Forced compositor tap/commit animates to a full page, writes the target logical scroll exactly once, removes final transforms in the same pre-paint callback and then completes through the existing relocated/stability flow.

#### Existing Behavior

Task 3 can only roll back. The scroll backend changes scroller position every frame and contains an exact-target `reportLocation()` workaround.

#### Required Change

Extend group animation to `pageDelta` ±1, keep final fill until an rAF commit callback, write logical target once, cancel/remove transform before paint, and resolve only after style cleanup. Retain exact-target reporting only for the scroll backend.

#### Files

- Modify: `client/src/utils/epubPageTurnAdapter.js`
- Test: `client/src/utils/epubPageTurnAdapter.test.js`
- Reference: `client/node_modules/epubjs/src/managers/continuous/index.js`
- Reference: `client/node_modules/epubjs/src/rendition.js`

#### Interfaces

- Consumes: Task 3 animation group, existing `toPhysicalScroll`, `isStableAt(delta)` and controller relocated waiter.
- Produces: compositor `animateTo(-1 | 1, { duration, action, inputTime }) -> Promise<{ status: 'completed' | 'cancelled' | 'unavailable', backend: 'compositor', reason?: string }>`.
- Affects later Tasks: Task 5 guards failures/cancellation; Task 6 verifies browser geometry.

#### Implementation Steps

- [ ] **Step 1: Add failing one-scroll and atomic-style tests**

Instrument the scroller setter and fake animations. During animation, expect zero scroll writes and final view transforms; after the injected commit rAF, expect one target write, empty restored transforms and `isStableAt(delta) === true`. Cover LTR, RTL default and RTL negative physical writes.

- [ ] **Step 2: Run the adapter test and witness RED**

- [ ] **Step 3: Animate to the full visual target**

Use `targetOffset = -pageDelta * session.pageWidth`; preserve the current duration passed by controller. Keep every view/edge animation filled at its final keyframe until commit.

- [ ] **Step 4: Exchange transform and scroll before one paint**

After all `finished` promises resolve for the current generation, request one frame and execute in this order:

```js
writeLogical(session.origin + pageDelta * session.pageWidth, session);
cancelAnimationGroup(session.animations);
restoreCompositorStyles(session);
session.visualOffset = 0;
```

Disconnect session mutation/resize watchers immediately before the scroll write so normal continuous-manager loading after commit is not classified as a mid-animation view failure.

- [ ] **Step 5: Keep stability/progress semantics backend-neutral**

`isStableAt(delta)` checks the committed logical scroll and zero boundary offset. `isStableAligned()` returns true after the atomic exchange so the normal `useEpubRendition` relocated handler can update CFI/progress exactly once. Do not call `rendition.next()`/`prev()`.

- [ ] **Step 6: Re-run the adapter test and witness GREEN**

- [ ] **Step 7: Commit Task 4**

```powershell
git add client/src/utils/epubPageTurnAdapter.js client/src/utils/epubPageTurnAdapter.test.js
git commit -m "feat: commit compositor page turns atomically"
```

#### Done Criteria

- No compositor drag/animation frame writes scroller position.
- Successful nonzero settle performs one target scroll write.
- Final transform and the new scroll position are exchanged before paint.
- Stable relocation can update CFI/progress once.
- RTL physical coordinate behavior matches existing mapping tests.
- Tap duration and settle duration inputs are unchanged.

#### Verification

```powershell
npm test --prefix client -- epubPageTurnAdapter.test.js
```

Expected: adapter tests pass, including single-write LTR/RTL commits.

#### Regression Scope

- One page per successful operation.
- No `next/prev` on enhanced path.
- Scroll exact-target reporting remains available only to the scroll backend.
- Rollback still performs zero scroll writes.

#### Out of Scope

- Runtime failure downgrade, controller recovery changes, device performance conclusions and default activation.

### Task 5: Make compositor cancellation/failure recovery backend-safe

**Estimated effort:** 75–90 minutes.

#### Goal

Every lifecycle, view, geometry or Animation failure restores the stable page and styles; an internal compositor failure disables compositor for later operations but allows a fresh scroll session, while failed scroll recovery still enters basic.

#### Existing Behavior

The controller’s `recoverToBasic()` always makes enhanced failure permanent basic. Adapter cancellation covers rAF scroll animation but not Animation groups, view identity/geometry invalidation or backend-specific disable state.

#### Required Change

Add session generation checks, observer/async-boundary validation, grouped Animation failure handling and backend disable flags. Replace controller’s unconditional recovery-to-basic with recovery-to-ready based on a fresh `adapter.inspect()` result, without branching on backend names. Update `PROJECT.md` to the approved two-backend boundary.

#### Files

- Modify: `client/src/utils/epubPageTurnAdapter.js`
- Test: `client/src/utils/epubPageTurnAdapter.test.js`
- Modify: `client/src/hooks/usePageTurnController.js`
- Test: `client/src/hooks/usePageTurnController.test.jsx`
- Modify: `PROJECT.md`
- Reference: `client/src/hooks/useEpubRendition.js`
- Reference: `client/src/hooks/useReaderSettings.js`

#### Interfaces

- Consumes: existing controller cancellation generation, adapter `cancel/recover/inspect`, compositor snapshot and animation group.
- Produces:
  - adapter-private monotonically increasing session/animation generation;
  - backend state `compositorDisabledReason` and `enhancedDisabledReason`;
  - `recover(): Promise<boolean>` still resolves non-throwingly;
  - controller-private `recoverToReady(operationVersion)` that chooses `idle` when recovered scroll capability remains and `basic` otherwise.
- Affects later Tasks: Phase C relies on runtime compositor→scroll fallback before enabling the default.

#### Implementation Steps

- [ ] **Step 1: Add failing adapter/controller failure cases**

Cover view removal/replacement, `isConnected === false`, changed snapshot geometry, one rejected/cancelled Animation, destroy, resize/settings cancellation and stale `finished` resolution. Assert no half-transform switch to scroll. Add a controller test where compositor returns unavailable, recover succeeds, `inspect()` remains available and the next operation starts enhanced scroll; retain the existing failed-recovery→basic test.

- [ ] **Step 2: Run directed tests and witness RED**

- [ ] **Step 3: Validate and invalidate compositor sessions deterministically**

When available, observe view/scroller size and child-list changes; otherwise recheck captured identities/rects only before animation and after `finished`, never on each drag frame. Invalidation must: increment generation, cancel the whole Animation group, cancel diagnostics, restore view/edge styles, restore origin, disconnect observers and set the compositor disable reason.

- [ ] **Step 4: Distinguish external cancellation from backend failure**

`pointercancel`, resize, hidden, settings mutation, close and destroy restore state but do not permanently disable compositor. A spontaneous Animation rejection, view replacement/disconnect or geometry invalidation disables compositor. When not forced, the next `begin()` selects scroll; when compositor is forced, the next `begin()` fails visibly.

- [ ] **Step 5: Recover the controller to the best safe ready mode**

Replace `recoverToBasic` with:

```js
const recoverToReady = useCallback(async (operationVersion) => {
  let restored = false;
  try {
    restored = Boolean(await adapter?.recover?.());
  } catch {
    restored = false;
  }
  if (!isCurrentOperation(operationVersion)) return false;
  const capability = restored ? adapter?.inspect?.() : null;
  clearEdge();
  basicRef.current = !capability?.available;
  setPhase(basicRef.current ? 'basic' : 'idle');
  return restored;
}, [adapter, clearEdge, isCurrentOperation, setPhase]);
```

Keep checks after every `await`; cancelled operations cannot recover, navigate, end a newer adapter session or overwrite phase.

- [ ] **Step 6: Update the approved project boundary**

In `PROJECT.md` “阅读器控制层约定”, replace the scroller-only enhanced statement with the actual rule: adapter may use short-lived displayed-view compositor motion or the permanent scroll fallback; a successful compositor settle commits exactly one scroller target; basic still calls exactly one `next/prev`; no operation mixes paths.

- [ ] **Step 7: Re-run directed tests and witness GREEN**

- [ ] **Step 8: Commit Task 5**

```powershell
git add client/src/utils/epubPageTurnAdapter.js client/src/utils/epubPageTurnAdapter.test.js client/src/hooks/usePageTurnController.js client/src/hooks/usePageTurnController.test.jsx PROJECT.md
git commit -m "fix: recover compositor page turns safely"
```

#### Done Criteria

- All design cancellation events release animations, observers, transforms and will-change.
- Visual displacement is restored before any later scroll/basic operation.
- Default-mode compositor failure makes the next enhanced operation scroll, not half-compositor/half-scroll.
- Forced compositor exposes its failure rather than hiding it.
- Recovery failure remains non-throwing and basic remains usable.
- `PROJECT.md` matches the approved adapter architecture.

#### Verification

```powershell
npm test --prefix client -- epubPageTurnAdapter.test.js usePageTurnController.test.jsx
```

Expected: both files pass, including cancellation generation and fallback cases.

#### Regression Scope

- Resize/orientation/hidden/settings/close/pointercancel/unmount behavior.
- Existing exact-target scroll workaround and basic fallback.
- Progress handler ignores genuinely unstable positions but accepts successful commit.

#### Out of Scope

- Automatic retry in the same visually displaced operation, changing basic navigation, device-specific blacklists and broad controller refactoring.

### Task 6: Prove forced compositor behavior in real Chromium fixtures

**Estimated effort:** 75–90 minutes.

#### Goal

The browser acceptance script proves forced compositor drag/commit/rollback cleanup, scroll fallback, chapter boundary, LTR and constructible RTL behavior without using headless timing as the FPS verdict.

#### Existing Behavior

The current fixture is one LTR chapter, and the browser script observes scroll/edge/page labels but not displayed-view transforms, CFI persistence, backend selection or multi-chapter seams.

#### Required Change

Extend the shared test-only EPUB helper with backward-compatible multi-chapter/RTL options, allow named fixture definitions in the client verification environment, and run finite forced compositor/scroll scenarios with real WAAPI.

#### Files

- Modify: `server/test/helpers/createEpubFixture.js`
- Modify: `client/scripts/reader-verification-environment.mjs`
- Modify: `client/scripts/verify-reader-page-turn.mjs`
- Reference: `client/src/utils/pageTurnDiagnostics.js`
- Reference: `client/src/api/readingApi.js`

#### Interfaces

- Consumes: existing fixture defaults and `prepareReaderVerification(options)`.
- Produces:
  - `createEpubFixture(path, { chapterCount = 1, pageProgressionDirection = 'ltr', ...existing })` with the old single `chapter.xhtml` default preserved;
  - `prepareReaderVerification({ fixtures })`, where each fixture supplies a filename/title and helper options;
  - browser helpers to select a fixture, force backend, read displayed-view inline/computed transforms and fetch `/api/reading/:bookId` CFI.
- Affects later Tasks: Phase C runs the same script after default activation.

#### Implementation Steps

- [ ] **Step 1: Extend only the test EPUB generator**

Generate manifest/spine/item files from `chapterCount`; add `page-progression-direction="rtl"` only for RTL. Preserve all old option defaults and do not touch `server/src/**` or add a dependency.

- [ ] **Step 2: Let the verification environment create explicit fixtures**

When `options.fixtures` is supplied, create exactly those books; otherwise preserve current `fixtureCount` behavior. Define three page-turn fixtures: long single-chapter LTR, two-chapter LTR and RTL.

- [ ] **Step 3: Add forced-compositor mid/final assertions**

During drag require: at least one displayed `.epub-view`, identical nonzero transform on every displayed view, moved seam and unchanged scroller origin. After commit require: logical scroll changed one page, page/CFI advanced once, view and seam transforms/will-change cleared and diagnostic backend compositor.

- [ ] **Step 4: Add rollback and degradation assertions**

Rollback must preserve scroll, page label and persisted CFI. A context with `Element.prototype.animate` unavailable must choose scroll in normal mode; reduced motion must use basic and show no animated edge.

- [ ] **Step 5: Add finite chapter/RTL scenarios**

For the two-chapter book, advance at most 30 pages until persisted `chapterHref` changes, then verify the boundary operation still advances exactly once and cleans styles. For RTL, perform one commit and one rollback, assert the logical page result/CFI and compositor record; physical RTL variants remain covered by adapter unit tests.

- [ ] **Step 6: Run the real-browser verification**

Do not add FPS assertions. If the command fails twice with the same cause, stop and report per guardrail.

- [ ] **Step 7: Commit Task 6**

```powershell
git add server/test/helpers/createEpubFixture.js client/scripts/reader-verification-environment.mjs client/scripts/verify-reader-page-turn.mjs
git commit -m "test: verify compositor page turns in chromium"
```

#### Done Criteria

- Mid-drag compositor state has transformed views/seam and unchanged scroll.
- Commit writes one page and cleans all temporary styles.
- Rollback preserves scroll/page/CFI.
- Multi-chapter LTR, constructible RTL, scroll fallback, reduced motion and basic behavior pass.
- Existing fixture callers retain their defaults.
- Browser command exits 0 without claiming device FPS.

#### Verification

```powershell
npm run verify:reader-page-turn --prefix client
```

Expected: exit 0; output identifies successful forced compositor, forced/automatic scroll fallback, chapter boundary, RTL, rollback and cleanup scenarios.

#### Regression Scope

- Current single-chapter fixture users.
- Page margins, gap/seam geometry and themes used by the fixture.
- One progress/CFI result per successful operation.
- No temporary animation objects after settle.

#### Out of Scope

- Real-device FPS verdicts, all real EPUB content shapes, server production behavior, image-heavy fixture generation and exhaustive RTL engines.

## Phase B Plan-Level Final Verification

After all six Tasks, run one related unit-test set and one client build:

```powershell
npm test --prefix client -- pageTurnDiagnostics.test.js pageTurnGesture.test.js epubPageTurnAdapter.test.js usePageTurnController.test.jsx useEpubRendition.test.jsx ReaderView.test.jsx
npm run build --prefix client
```

Expected: both commands exit 0. Perform one specification check against capability, session snapshot, drag/rollback/commit, cancellation/recovery and test-strategy sections. Confirm normal release selection is still scroll. Fix only P0/P1, rerun only the failed command once, record P2/P3 in Backlog, and do not begin a second open-ended review.

## Phase B Completion State

- Compositor is fully functional and browser-verified under explicit force.
- Scroll and basic fallbacks remain available.
- Normal users still receive scroll until Phase C gates pass.
- `PROJECT.md` reflects the approved two-backend adapter boundary.
