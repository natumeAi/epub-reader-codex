# Reader Page Turn 60 FPS Phase A Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变默认 scroll 翻页行为的前提下，加入显式启用的性能诊断与后端强制开关，记录两台目标设备的 scroll 基线，并完成设计指定的低风险帧内写入清理。

**Architecture:** 性能采样作为独立纯工具存在，只有 `sessionStorage` 调试配置显式启用时才创建记录和调试 rAF；adapter 负责写入 backend、帧时间和动画边界，controller 只传入动作与输入时间。Phase A 始终保持 scroll backend 为默认，并把页缝的逐帧 CSS 自定义属性更新改为直接 transform 写入。两台移动设备的真实操作与采样由用户执行，agent 只执行自动化 Tasks，并且只能处理用户实际提供的设备证据。

**Tech Stack:** React 19、epub.js 0.3.93、Web Performance API、Vitest 3、Testing Library、Playwright 1.61、Vite 7

---

## Plan Position

- Recommended order: **Phase A（本计划）→ Phase B compositor backend → Phase C device rollout**。
- Baseline commit: `7298ca5 fix: preserve reader page geometry during turns` on local branch `dev20260716`.
- Phase A 可独立停止：结束时默认后端仍为 scroll，现有翻页功能必须可继续使用。
- Design source: `docs/superpowers/specs/2026-07-17-reader-page-turn-60fps-design.md`.
- Execution-ownership source: `docs/superpowers/specs/2026-07-17-reader-page-turn-manual-device-test-ownership-design.md`.

## Execution Ownership and Order

- Agent-executable order is **Task 1 → Task 2 → Task 5 → Task 6**. Agentic workers must select the first unfinished item only from this sequence.
- Manual Checkpoints A–B are user-owned real-device work. They are excluded from agent Task selection even while their checkboxes remain incomplete.
- The user runs the manual checkpoints against immutable build `4e75942bee03edd272a72384e7a3db815f1309ba` unless an explicitly identified replacement baseline is supplied.
- An agent may validate, summarize, format and commit only records and metadata actually supplied by the user. It must not operate a substitute desktop/emulated device or invent missing evidence.
- Pending manual checkpoints do not block Task 5, Task 6 or Phase B because the normal backend remains scroll. They remain required evidence before any Phase C default-backend promotion.

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

- `client/src/components/reader/ReaderView.jsx`: keyboard and pointer input enter `usePageTurnController`; owns `.reader-page-edge` and `.reader-gesture-layer`.
- `client/src/hooks/usePageTurnController.js`: phase, direction, pointer lock, rAF coalescing, settle/recovery and basic fallback state machine.
- `client/src/utils/epubPageTurnAdapter.js`: the only production boundary that reads epub.js manager, scroller, layout, Snap and RTL private state.

### 2. Current call chain and data flow

```text
ReaderView input
  -> usePageTurnController.begin/drag/settle
  -> epubPageTurnAdapter.begin()
  -> dragBy(): per-frame scrollLeft + boundary transform
  -> animateTo(): rAF + easeOutCubic + per-frame scrollLeft
  -> relocated waiter + isStableAt(delta)
  -> useEpubRendition accepts aligned relocation
  -> CFI/page label/progress persistence update once
```

The basic path remains `ReaderView -> controller -> rendition.next()/prev()` exactly once and never writes the internal scroller.

### 3. Core files in this phase

- `client/src/utils/pageTurnDiagnostics.js`: new debug configuration, bounded samples and summary calculations.
- `client/src/utils/epubPageTurnAdapter.js`: emits diagnostic events and directly positions the page seam.
- `client/src/hooks/usePageTurnController.js`: supplies input metadata and stops writing unused progress CSS variables.
- `client/src/components/reader/ReaderView.jsx`: passes keyboard timestamps only; no visual redesign.
- `client/src/styles/reader.css`: removes unused page-turn progress variables and retains the current 14px seam appearance.
- `client/scripts/verify-reader-page-turn.mjs`: proves the scroll path and debug lifecycle in real Chromium.

### 4. Existing test coverage

- `pageTurnGesture.test.js`: thresholds, velocity, damping, durations and tap zones.
- `epubPageTurnAdapter.test.js`: LTR/RTL coordinate mapping, capability failures, scroll drag/settle, cancel/recover and page-gap integration.
- `usePageTurnController.test.jsx`: enhanced/basic navigation, pointer coalescing, cancellation generation, rollback and edge hiding.
- `ReaderView.test.jsx`: keyboard/pointer routing.
- `verify-reader-page-turn.mjs`: normal drag, rollback, exact-page drag, fast swipe, page geometry and reduced motion.
- Fresh planning baseline: 46 directed tests, client build and Chromium page-turn verification passed before `7298ca5` was committed.

### 5. Files affected by the Phase A design

- Create: `client/src/utils/pageTurnDiagnostics.js`
- Create: `client/src/utils/pageTurnDiagnostics.test.js`
- Create: `docs/superpowers/verification/2026-07-17-reader-page-turn-60fps.md`
- Modify: `client/src/utils/epubPageTurnAdapter.js`
- Modify: `client/src/utils/epubPageTurnAdapter.test.js`
- Modify: `client/src/hooks/usePageTurnController.js`
- Modify: `client/src/hooks/usePageTurnController.test.jsx`
- Modify: `client/src/components/reader/ReaderView.jsx`
- Modify: `client/src/components/reader/ReaderView.test.jsx`
- Modify: `client/src/styles/reader.css`
- Modify: `client/scripts/verify-reader-page-turn.mjs`

### 6. Modules that must not change in Phase A

- `server/**`, database migrations and reading-progress API.
- `client/src/hooks/useEpubRendition.js` and `client/src/hooks/useReaderSettings.js`; the committed page-gap behavior is the baseline, not part of this optimization phase.
- Shelf, folder, upload, PWA cache policy and service-worker behavior.
- epub.js package source or dependency versions.

### 7. Compatibility and regression risks

- Diagnostics must be inert by default: no continuous rAF, retained samples, console output or global mutable configuration.
- Browser event timestamps and `performance.now()` share a monotonic time origin in supported Chrome; tests must inject `now` to avoid wall-clock coupling.
- Removing CSS variables must not change seam geometry, theme colors, 14px width or the current “hide at visual target” behavior.
- The debug force switch is developer-only session state; it is not a user setting, public API or persisted data migration.

## Behavior Classification

- **Preserve:** gesture thresholds, 180ms tap, 120–220ms settle, `easeOutCubic`, page margins/gap/seam, CFI/progress, RTL mappings, reduced-motion and basic navigation.
- **Modify:** diagnostic metadata is threaded through existing calls; page seam position is written directly rather than through `--reader-page-turn-*` variables; unchanged boundary transforms are deduplicated.
- **Add:** bounded frame samples, read-only diagnostic access, explicit scroll/compositor force configuration, and two-device scroll baseline evidence.
- **Deprecate/remove:** unused `--reader-page-turn-progress` and per-frame `--reader-page-turn-edge-offset` writes. The scroll backend itself is retained permanently.

## Conflicts, Blockers, Existing Issues, Backlog

- **Resolved design precedence:** the approved 60 FPS design supersedes the scroller-only sentence in `PROJECT.md`. Phase A does not yet activate compositor; Phase B Task 5 will update `PROJECT.md` when that path is executable.
- **Blockers:** none for the agent-executable Phase A Tasks. Manual Checkpoints A–B require user device access; missing evidence does not block Tasks 5–6 or Phase B, but it does block any later default-backend promotion. Failure to meet 58 FPS is baseline evidence rather than a Phase A implementation failure.
- **Existing Issues:** no directly related failure was observed in the fresh directed verification. The full repository suite was intentionally not run during planning.
- **Backlog:** reverse RTL scroll type, 120 FPS guarantees, unknown low-end devices, a three-page renderer, and any performance work outside the reader remain outside this plan.

### Task 1: Add opt-in frame diagnostics and deterministic summaries

**Estimated effort:** 60 minutes.

#### Goal

An explicitly enabled diagnostic session can record page-turn timing data and return deterministic FPS/jank summaries; with debugging disabled, it schedules no frame and publishes no samples.

#### Existing Behavior

The adapter has an injectable clock and rAF for animation tests, but there is no debug configuration, frame record, bounded history or device-readable summary. Production currently retains no telemetry, which must remain the default.

#### Required Change

Create a pure diagnostics module with safe `sessionStorage` parsing, bounded per-action records, summary calculation and a frozen read-only `window.__EPUB_READER_PAGE_TURN_DIAGNOSTICS__` facade installed only while debugging is enabled.

#### Files

- Create: `client/src/utils/pageTurnDiagnostics.js`
- Test: `client/src/utils/pageTurnDiagnostics.test.js`
- Reference: `client/src/test/setup.js`
- Reference: `docs/superpowers/specs/2026-07-17-reader-page-turn-60fps-design.md`

#### Interfaces

- Consumes: monotonic timestamps, optional `sessionStorage`, optional injected rAF/cancel functions.
- Produces:
  - `PAGE_TURN_DEBUG_STORAGE_KEY: 'epub-reader:page-turn-debug'`
  - `readPageTurnDebugConfig(storage): { enabled: boolean, forceBackend: null | 'scroll' | 'compositor' }`
  - `summarizePageTurnFrames(record): PageTurnSummary`
  - `createPageTurnDiagnostics(options): { begin, markVisualUpdate, markAnimationStart, frame, finish, cancel, getRecords, clear, destroy }`
  - read-only records with `action`, `backend`, `inputTime`, `firstVisualTime`, `animationStartTime`, `endTime`, `frameTimestamps`, `cancelReason` and summary fields.
- Affects later Tasks: Task 2 wires these methods into the scroll adapter; Phase B reuses the same API for compositor A/B samples.

#### Implementation Steps

- [ ] **Step 1: Write failing diagnostics tests**

Cover disabled/invalid configuration, accepted force values, bounded copies and exact summary math. Use this representative assertion set:

```js
expect(readPageTurnDebugConfig(storage)).toEqual({
  enabled: true,
  forceBackend: 'scroll',
});

expect(summarizePageTurnFrames({
  inputTime: 5,
  firstVisualTime: 21,
  frameTimestamps: [0, 16, 32, 53, 90, 130],
})).toMatchObject({
  averageFps: 38.46,
  inputLatencyMs: 16,
  p95FrameIntervalMs: 40,
  framesOver20Ms: 3,
  maxConsecutiveFramesOver33_4Ms: 2,
});
```

Also assert that `createPageTurnDiagnostics({ enabled: false })` never calls the injected `requestAnimationFrame` and returns `[]` from `getRecords()`.

- [ ] **Step 2: Run the new test and witness RED**

Run the Task verification command. Expected: Vitest fails because `pageTurnDiagnostics.js` and its exports do not exist.

- [ ] **Step 3: Implement safe configuration and summary calculations**

Use one JSON session value, accept only the two backend names, calculate intervals from adjacent timestamps, use nearest-rank p95, round public millisecond/FPS values to two decimals, and never throw on unavailable storage:

```js
export const PAGE_TURN_DEBUG_STORAGE_KEY = 'epub-reader:page-turn-debug';

export function readPageTurnDebugConfig(storage = globalThis.sessionStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(PAGE_TURN_DEBUG_STORAGE_KEY) || 'null');
    const forceBackend = ['scroll', 'compositor'].includes(parsed?.forceBackend)
      ? parsed.forceBackend
      : null;
    return { enabled: parsed?.enabled === true, forceBackend };
  } catch {
    return { enabled: false, forceBackend: null };
  }
}
```

- [ ] **Step 4: Implement a bounded recorder and frozen diagnostic facade**

Keep at most 200 completed records, deep-copy arrays on reads, cancel the debug-only sampler in `finish`, `cancel` and `destroy`, and install the global with a non-writable property only when enabled:

```js
Object.defineProperty(target, '__EPUB_READER_PAGE_TURN_DIAGNOSTICS__', {
  configurable: true,
  value: Object.freeze({ getRecords, clear }),
  writable: false,
});
```

`finish()` must calculate and store the summary once; `destroy()` must remove this exact facade and leave no scheduled rAF.

- [ ] **Step 5: Re-run the same test and witness GREEN**

Expected: all diagnostics tests pass; disabled mode reports zero scheduled rAF calls.

- [ ] **Step 6: Commit Task 1**

```powershell
git add client/src/utils/pageTurnDiagnostics.js client/src/utils/pageTurnDiagnostics.test.js
git commit -m "feat: add page turn frame diagnostics"
```

#### Done Criteria

- The required action/timing/backend fields and four performance thresholds can be derived from a record.
- Invalid or absent debug storage is equivalent to disabled mode.
- History is bounded and returned by copy.
- Disabled mode schedules no diagnostic rAF and publishes no retained record.
- The directed test passes.

#### Verification

Run once after the implementation (repeat only once after a fix):

```powershell
npm test --prefix client -- pageTurnDiagnostics.test.js
```

Expected: one test file passes with zero failures.

#### Regression Scope

- Default production startup remains free of frame sampling.
- Malformed session data cannot prevent opening the reader.
- Clearing/destroying diagnostics releases records and scheduled callbacks.

#### Out of Scope

- Uploading telemetry, analytics UI, persistent user settings, remote logging, GPU memory profiling, 120 FPS classification and non-reader performance metrics.

### Task 2: Thread input metadata and scroll-backend samples through existing interfaces

**Estimated effort:** 75–90 minutes.

#### Goal

Drag, commit, rollback and tap/key actions produce diagnostic records with the real input timestamp and `backend: 'scroll'` when debug mode is enabled, while all existing navigation results remain unchanged.

#### Existing Behavior

`ReaderView` discards keyboard event timestamps, the controller calls `begin()`/`animateTo()` without action metadata, and the adapter rAF has no diagnostic hooks. `turnPage(direction)` and adapter method names are stable and must remain callable without new arguments.

#### Required Change

Add optional metadata objects to existing methods, create one diagnostics instance per adapter, record scroll animation frames without adding a second rAF, and use a debug-only rAF only for intervals where an animation backend supplies no frame callback. The default and forced backend in this phase are both scroll; forcing compositor must fail visibly rather than silently claiming compositor coverage.

#### Files

- Modify: `client/src/utils/epubPageTurnAdapter.js`
- Test: `client/src/utils/epubPageTurnAdapter.test.js`
- Modify: `client/src/hooks/usePageTurnController.js`
- Test: `client/src/hooks/usePageTurnController.test.jsx`
- Modify: `client/src/components/reader/ReaderView.jsx`
- Test: `client/src/components/reader/ReaderView.test.jsx`
- Reference: `client/src/utils/pageTurnDiagnostics.js`

#### Interfaces

- Consumes: Task 1 diagnostics API; existing `currentCfiRef`, `edgeRef`, adapter environment injection and controller cancellation generation.
- Produces:
  - `begin(stableCfi = null, { action = 'drag', edgeElement = null, inputTime = now() } = {})`
  - `animateTo(pageDelta, { action, duration, inputTime } = {}): Promise<{ status: string, backend: 'scroll' }>`
  - `turnPage(direction, { action, inputTime } = {}): Promise<'completed' | 'failed' | 'blocked' | 'ignored'>`
  - Session summaries add `backend: 'scroll'` but controller behavior never branches on that property.
- Affects later Tasks: Task 5 uses `edgeElement`; Phase B preserves these signatures while selecting compositor internally.

#### Implementation Steps

- [ ] **Step 1: Add failing adapter/controller/component tests**

Assert that an injected diagnostics spy receives `begin({ action, backend: 'scroll', inputTime })`, drag rAF timestamps and one terminal status. Assert the controller passes `event.timeStamp` on pointer input and ReaderView passes keyboard timestamps:

```js
expect(harness.adapter.begin).toHaveBeenCalledWith('stable-cfi', expect.objectContaining({
  action: 'drag',
  edgeElement: harness.edgeRef.current,
  inputTime: 40,
}));

expect(mocks.turnPage).toHaveBeenCalledWith('next', {
  action: 'tap-next',
  inputTime: 75,
});
```

Include a disabled-debug test proving the adapter does not request an extra frame.

- [ ] **Step 2: Run the directed tests and witness RED**

Run the Task verification command. Expected: metadata assertions fail and no diagnostic events are emitted.

- [ ] **Step 3: Initialize diagnostics inside the adapter without changing default behavior**

Resolve injected values before globals so unit tests remain deterministic:

```js
const debugConfig = environment.debugConfig || readPageTurnDebugConfig();
const diagnostics = environment.diagnostics || createPageTurnDiagnostics({
  enabled: debugConfig.enabled,
  cancelAnimationFrame: cancelFrame,
  now,
  requestAnimationFrame: requestFrame,
});
```

Store diagnostic record ids on the active session/animation, record the existing scroll animation tick timestamp, and finish/cancel the matching record exactly once from `animateTo`, `cancel`, `end` or `destroy`.

- [ ] **Step 4: Pass action and input times through controller paths**

Use pointerdown for `drag`, pointerup for `commit`/`rollback`, and the initiating tap or key event for tap actions. Preserve no-argument callers:

```js
const turnPage = useCallback(async (nextDirection, interaction = {}) => {
  const inputTime = Number.isFinite(interaction.inputTime)
    ? interaction.inputTime
    : performance.now();
  const action = interaction.action || `tap-${nextDirection}`;
  // Existing phase, boundary, enhanced and basic flow follows unchanged.
}, [
  adapter,
  currentCfiRef,
  edgeRef,
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

Every `adapter.begin()` call passes `edgeElement: edgeRef.current`; every settle call passes one of `commit`, `rollback`, `tap-prev` or `tap-next`.

- [ ] **Step 5: Preserve timestamps at the ReaderView keyboard boundary**

Call `turnPage` directly from the key handler so `event.timeStamp` is not lost:

```js
if (event.key === 'ArrowLeft') {
  event.preventDefault();
  void turnPage('prev', { action: 'tap-prev', inputTime: event.timeStamp });
} else if (event.key === 'ArrowRight') {
  event.preventDefault();
  void turnPage('next', { action: 'tap-next', inputTime: event.timeStamp });
}
```

- [ ] **Step 6: Re-run the same directed tests and witness GREEN**

Expected: all selected tests pass; debug records identify scroll and disabled mode adds no frame.

- [ ] **Step 7: Commit Task 2**

```powershell
git add client/src/utils/epubPageTurnAdapter.js client/src/utils/epubPageTurnAdapter.test.js client/src/hooks/usePageTurnController.js client/src/hooks/usePageTurnController.test.jsx client/src/components/reader/ReaderView.jsx client/src/components/reader/ReaderView.test.jsx
git commit -m "feat: instrument scroll page turns"
```

#### Done Criteria

- All five action names can be recorded with input, first visual, animation start/end and backend.
- Debug-disabled navigation produces the same page result and no extra diagnostic rAF.
- Existing method calls without metadata continue to work.
- Forced compositor cannot be mistaken for a successful compositor session before Phase B.
- The directed tests pass.

#### Verification

```powershell
npm test --prefix client -- pageTurnDiagnostics.test.js epubPageTurnAdapter.test.js usePageTurnController.test.jsx ReaderView.test.jsx
```

Expected: all four selected test files pass.

#### Regression Scope

- Pointer direction lock and one-rAF coalescing.
- One enhanced result or one basic `next/prev`, never both.
- Keyboard editing targets remain ignored.
- Cancellation finishes the current diagnostic record without stale continuation.

#### Out of Scope

- Compositor selection, view transforms, browser UI, analytics transport, gesture-rule changes and page-turn duration changes.

### Manual Checkpoint A (User-owned): Record the iPhone scroll-backend baseline

**Ownership:** The user performs all iPhone setup, interaction and record export. Agentic workers must skip this checkpoint when selecting the first unfinished Task; they may only process user-supplied evidence.

**Status:** Pending user evidence.

**Estimated effort:** 60–90 minutes.

#### Goal

The iPhone 14 Pro Max has reproducible scroll-backend measurements for Chrome and installed PWA, recorded separately by action without treating baseline failure as an implementation defect.

#### Existing Behavior

There is no durable device baseline. Chrome/PWA observation is currently subjective and cannot distinguish drag, commit, rollback or tap samples.

#### Required Change

Run the current scroll path with diagnostics forced to scroll, execute each core action 20 consecutive times in both run modes, mark external interruptions separately, and create the shared verification evidence document from the actual exported records.

#### Files

- Create: `docs/superpowers/verification/2026-07-17-reader-page-turn-60fps.md`
- Reference: `client/src/utils/pageTurnDiagnostics.js`
- Reference: `docs/superpowers/specs/2026-07-17-reader-page-turn-60fps-design.md`

#### Interfaces

- Consumes: Task 2 debug configuration and read-only window diagnostics.
- Produces: an evidence section containing commit id, device/OS/Chrome version, run mode, action/scenario, 20-sample count, average FPS, p95, >20ms frames, max consecutive >33.4ms frames, input latency, backend and external-interruption notes.
- Affects later Tasks: Phase C compares compositor and scroll results against this baseline.

#### Implementation Steps

- [ ] **Step 1: Deploy the immutable baseline build to the iPhone test target**

Use `4e75942bee03edd272a72384e7a3db815f1309ba`, record the exact commit, OS version, Chrome version and whether the run is a normal tab or installed standalone PWA. Use the same server/build for both modes. If the baseline is deliberately replaced, record the exact replacement commit instead of silently using current `HEAD`.

- [ ] **Step 2: Enable forced scroll diagnostics for the session**

Run in the remote DevTools console, then reload the reader:

```js
sessionStorage.setItem('epub-reader:page-turn-debug', JSON.stringify({
  enabled: true,
  forceBackend: 'scroll',
}));
location.reload();
```

- [ ] **Step 3: Capture the five isolated core action groups**

For each run mode, clear records before each group and execute 20 repetitions of: slow drag followed by commit, slow drag followed by rollback, fast short commit, tap-next, and tap-prev. Do not include idle time in a group; annotate notifications/app switches instead of mixing those samples.

- [ ] **Step 4: Export and validate the records**

Run after each group:

```js
window.__EPUB_READER_PAGE_TURN_DIAGNOSTICS__.getRecords()
```

Expected: the group contains 20 terminal records for the intended scenario, every record reports `backend: 'scroll'`, and no record remains active after settle.

- [ ] **Step 5: Create the evidence document from the measured exports**

Write an “iPhone 14 Pro Max — scroll baseline” section with separate Chrome and PWA tables. Include actual aggregate values and an explicit baseline verdict; do not alter code or tune interaction rules in response to the numbers.

- [ ] **Step 6: Clear the debug session and commit the supplied evidence**

```js
sessionStorage.removeItem('epub-reader:page-turn-debug');
location.reload();
```

```powershell
git add docs/superpowers/verification/2026-07-17-reader-page-turn-60fps.md
git commit -m "docs: record iPhone scroll page turn baseline"
```

#### Done Criteria

- Chrome and installed PWA each have five isolated 20-repetition groups.
- Every retained sample identifies scroll and contains all required timing fields.
- External interruptions are excluded and documented.
- The evidence is committed without changing implementation.

#### Verification

DevTools command:

```js
window.__EPUB_READER_PAGE_TURN_DIAGNOSTICS__.getRecords()
```

Expected: exactly 20 completed scroll records for the current group, with no active animation or growing record count after the group ends.

#### Regression Scope

- The PWA still opens the current server content without service-worker caching.
- Diagnostic mode does not alter page result, thresholds, timing or visual styling.

#### Out of Scope

- Passing the 58 FPS gate, changing code based on baseline results, GPU profiling, other iPhones and background-interrupted samples.

### Manual Checkpoint B (User-owned): Record the Lenovo scroll-backend baseline

**Ownership:** The user performs all Lenovo setup, interaction and record export. Agentic workers must skip this checkpoint when selecting the first unfinished Task; they may only process user-supplied evidence.

**Status:** Pending user evidence.

**Estimated effort:** 60–90 minutes.

#### Goal

The Lenovo Xiaoxin Pro GT has the same reproducible Chrome/PWA scroll baseline schema as the iPhone, enabling later device-to-device and backend A/B comparison.

#### Existing Behavior

Manual Checkpoint A supplies only iPhone evidence; no Lenovo action-separated baseline exists.

#### Required Change

Repeat the exact five 20-repetition groups on the Lenovo device in mobile Chrome and installed PWA, append actual results to the same evidence document, and leave implementation unchanged.

#### Files

- Modify: `docs/superpowers/verification/2026-07-17-reader-page-turn-60fps.md`
- Reference: `client/src/utils/pageTurnDiagnostics.js`
- Reference: `docs/superpowers/specs/2026-07-17-reader-page-turn-60fps-design.md`

#### Interfaces

- Consumes: Manual Checkpoint A evidence schema and Task 2 diagnostic facade.
- Produces: Lenovo Chrome and PWA scroll-baseline tables with the same fields and sample counts.
- Affects later Tasks: Phase C uses the completed two-device baseline for its default-backend decision.

#### Implementation Steps

- [ ] **Step 1: Confirm the immutable build and record device metadata**

Use the same commit as Manual Checkpoint A and record OS, Chrome version, viewport/orientation and run mode.

- [ ] **Step 2: Enable forced scroll diagnostics**

Use the same `sessionStorage` JSON command from Manual Checkpoint A and reload before sampling.

- [ ] **Step 3: Run the Chrome action groups**

Clear diagnostics between groups; execute 20 slow commits, 20 rollbacks, 20 fast short commits, 20 tap-next and 20 tap-prev actions. Export actual records after every group.

- [ ] **Step 4: Run the installed-PWA action groups**

Repeat the same five isolated groups in standalone mode. Mark notification, rotation or app-switch interruptions separately and rerun only the interrupted repetition, not the entire group.

- [ ] **Step 5: Append actual Lenovo results and compare shape, not success**

Add Lenovo Chrome/PWA tables, confirm each group contains 20 scroll records and note device/run-mode differences. Baseline values do not need to pass the final compositor gate.

- [ ] **Step 6: Clear debug state and commit the supplied evidence**

```powershell
git add docs/superpowers/verification/2026-07-17-reader-page-turn-60fps.md
git commit -m "docs: record Lenovo scroll page turn baseline"
```

#### Done Criteria

- Both Lenovo run modes have five complete 20-sample groups.
- Fields and calculation method match Manual Checkpoint A.
- No implementation/configuration file changes are included.
- Debug session state is removed after collection.

#### Verification

```js
window.__EPUB_READER_PAGE_TURN_DIAGNOSTICS__.getRecords()
```

Expected: exactly 20 completed records for the selected group, all with `backend: 'scroll'` and no active record after settle.

#### Regression Scope

- Mobile Chrome and standalone PWA operate against the same build.
- Sample grouping does not mix idle time or external interruption.

#### Out of Scope

- Compositor measurements, default switching, non-target Android devices, performance tuning and device-specific code branches.

### Task 5: Remove redundant frame writes without changing scroll behavior

**Estimated effort:** 75–90 minutes.

#### Goal

The scroll backend keeps its current motion and result but stops writing an unused progress variable, stops rewriting opacity every frame, avoids unchanged boundary transforms, and moves the seam with direct `transform` writes.

#### Existing Behavior

Each drag/animation frame writes `scrollLeft`, two CSS variables and opacity. `--reader-page-turn-progress` has no CSS consumer, edge offset is reparsed through a custom property, and `setBoundaryOffset(0)` rewrites the scroller transform even when unchanged.

#### Required Change

Move edge positioning into the adapter using the `edgeElement` already passed to `begin()`, snapshot/restore its inline transform and will-change, make controller opacity writes phase-only, delete unused CSS variables, and deduplicate identical scroller/edge transform writes.

#### Files

- Modify: `client/src/utils/epubPageTurnAdapter.js`
- Test: `client/src/utils/epubPageTurnAdapter.test.js`
- Modify: `client/src/hooks/usePageTurnController.js`
- Test: `client/src/hooks/usePageTurnController.test.jsx`
- Modify: `client/src/styles/reader.css`
- Reference: `client/src/components/reader/ReaderView.jsx`

#### Interfaces

- Consumes: Task 2 `begin(..., { edgeElement })`, existing `dragBy()` result and `animateTo()` action metadata.
- Produces:
  - adapter-private `setEdgeOffset(offset)` and `setEdgeDirection(direction)` behavior;
  - unchanged public `dragBy()` return shape;
  - controller-private `showEdge(direction)` / `hideEdge()` that write opacity only at phase transitions;
  - no `onProgress` callback requirement for seam positioning.
- Affects later Tasks: Phase B animates the same edge element together with displayed views.

#### Implementation Steps

- [ ] **Step 1: Add failing write-count and cleanup tests**

Instrument `scrollLeft`, scroller `style.transform` and edge `style.transform`. Assert two identical boundary calls produce one transform write, a normal drag directly sets the expected seam transform, animation opacity is not rewritten by frame ticks, and cancel/end restore original inline styles.

```js
adapter.begin('stable-cfi', { edgeElement });
adapter.dragBy(-40);
expect(edgeElement.style.transform).toBe('translate3d(60px, 0, 0)');
expect(edgeElement.style.getPropertyValue('--reader-page-turn-progress')).toBe('');
```

- [ ] **Step 2: Run directed adapter/controller tests and witness RED**

Expected: current code still sets custom properties and repeats boundary/opacity writes.

- [ ] **Step 3: Add direct, deduplicated edge and boundary writers**

Map a next seam to `pageWidth + visualOffset` and a previous seam to `visualOffset`; cache the last physical offset:

```js
function setEdgeOffset(offset) {
  if (!session?.edgeElement || session.edgeOffset === offset) return;
  session.edgeOffset = offset;
  session.edgeElement.style.transform = `translate3d(${offset}px, 0, 0)`;
}
```

Apply the same equality guard to `setBoundaryOffset`. Snapshot `transform` and `willChange` in `begin`, set temporary `will-change: transform`, and restore both from `end`, `cancel`, `recover` and `destroy`.

- [ ] **Step 4: Remove per-frame controller custom-property and opacity writes**

Replace `writeEdgeProgress` with phase-only visibility helpers. `dragBy`/`animateTo` own seam transform; controller only sets direction and opacity at start/hide/clear. Remove `onProgress` options from every adapter call.

- [ ] **Step 5: Remove unused CSS variables while preserving appearance**

Delete `--reader-page-turn-progress` and `--reader-page-turn-edge-offset` declarations. Give `.reader-page-edge` a neutral direct-transform base and keep width, pseudo-element line/shadow, theme variables and reduced-motion display unchanged:

```css
.reader-page-edge {
  transform: translate3d(0, 0, 0);
}
```

- [ ] **Step 6: Re-run the same tests and witness GREEN**

Expected: directed tests pass with direct edge transforms, deduplicated writes and full cleanup.

- [ ] **Step 7: Commit Task 5**

```powershell
git add client/src/utils/epubPageTurnAdapter.js client/src/utils/epubPageTurnAdapter.test.js client/src/hooks/usePageTurnController.js client/src/hooks/usePageTurnController.test.jsx client/src/styles/reader.css
git commit -m "perf: reduce scroll page turn frame writes"
```

#### Done Criteria

- No production write to `--reader-page-turn-progress` remains.
- Seam movement uses direct transform and keeps current geometry.
- Opacity changes only at show/hide/cleanup boundaries.
- Unchanged boundary offset does not write style again.
- Cancel/end/destroy leave no temporary transform or will-change.
- Directed tests pass.

#### Verification

```powershell
npm test --prefix client -- epubPageTurnAdapter.test.js usePageTurnController.test.jsx
```

Expected: both selected files pass.

#### Regression Scope

- LTR and supported RTL logical/physical scroll mapping.
- 14px seam line/shadow and page-margin geometry.
- Rollback leaves scroll at origin; commit leaves it one page away.
- Reduced motion still bypasses enhanced animation.

#### Out of Scope

- Compositor view transforms, new easing, changing duration, CSS redesign, iframe containment changes and broad stylesheet cleanup.

### Task 6: Extend Chromium verification for diagnostics and frame-write cleanup

**Estimated effort:** 45–60 minutes.

#### Goal

One deterministic Chromium script proves the cleaned scroll path, direct seam movement, debug sample lifecycle and unchanged page results.

#### Existing Behavior

The script validates page geometry and results but does not force/read backend diagnostics, distinguish direct edge transform cleanup, or assert that default mode retains no samples.

#### Required Change

Run the existing scenarios in a forced-scroll debug context, inspect backend records and final inline styles, then open one default-disabled context to prove there is no retained diagnostic activity. Do not infer real-device FPS from headless Chromium.

#### Files

- Modify: `client/scripts/verify-reader-page-turn.mjs`
- Reference: `client/scripts/reader-verification-environment.mjs`
- Reference: `client/src/utils/pageTurnDiagnostics.js`
- Reference: `client/src/styles/reader.css`

#### Interfaces

- Consumes: session debug key, `window.__EPUB_READER_PAGE_TURN_DIAGNOSTICS__.getRecords()`, existing `readScroll`, `drag` and `waitSettled` helpers.
- Produces: script JSON with page results plus `backend`, `recordCount`, `temporaryStylesCleared` and `defaultDiagnosticsAbsent`.
- Affects later Tasks: Phase B reuses the context initializer to force compositor and compare state.

#### Implementation Steps

- [ ] **Step 1: Add the forced-scroll context initializer**

Before creating the debug context, install session configuration:

```js
await context.addInitScript(({ key, value }) => {
  sessionStorage.setItem(key, value);
}, {
  key: 'epub-reader:page-turn-debug',
  value: JSON.stringify({ enabled: true, forceBackend: 'scroll' }),
});
```

- [ ] **Step 2: Add assertions before changing production behavior further**

After normal drag and rollback, read diagnostic records and the scroller/edge inline style. Require the expected action records, `backend === 'scroll'`, unchanged final page semantics and empty temporary `will-change`/transform after settle.

- [ ] **Step 3: Add a default-disabled context assertion**

Open the reader without the init script, perform one tap, and assert the diagnostic facade is absent or returns no records and no extra active animation remains.

- [ ] **Step 4: Run the browser verification**

Run the Task verification command. If it fails, fix only the script or Phase A behavior and repeat this same command once.

- [ ] **Step 5: Commit Task 6**

```powershell
git add client/scripts/verify-reader-page-turn.mjs
git commit -m "test: verify scroll page turn diagnostics"
```

#### Done Criteria

- Normal drag, rollback, exact-page, fast swipe and reduced motion still produce current results.
- Debug records identify scroll and finish without growth after settle.
- Edge/scroller temporary transform and will-change are cleared.
- Default-disabled context retains no samples.
- Browser verification exits 0.

#### Verification

```powershell
npm run verify:reader-page-turn --prefix client
```

Expected: exit 0 and final JSON reports scroll backend, cleared temporary styles and absent default diagnostics.

#### Regression Scope

- Existing page-margin, column-gap and seam assertions.
- One-page result for normal/exact/fast commit and zero-page rollback.
- Basic reduced-motion path.

#### Out of Scope

- Headless FPS thresholds, chapter-boundary/RTL fixtures, compositor behavior, all themes and full PWA lifecycle.

## Phase A Plan-Level Final Verification

After all four agent-executable Tasks (Tasks 1, 2, 5 and 6), run exactly one related unit-test set and one client build:

```powershell
npm test --prefix client -- pageTurnDiagnostics.test.js pageTurnGesture.test.js epubPageTurnAdapter.test.js usePageTurnController.test.jsx ReaderView.test.jsx
npm run build --prefix client
```

Expected: both commands exit 0. Then perform one specification check against the design sections “性能采样” and “帧内写入清理”, and confirm the preserved behavior list above has no obvious regression. Only P0 (cannot build/start or data-corruption risk) and P1 (direct design/acceptance violation) may be fixed; rerun only the same failed command once. Record P2/P3 in Backlog and do not start a second review.

## Phase A Completion State

- Default backend is still scroll.
- Debugging is opt-in and bounded.
- Frame-write cleanup is complete and browser-verified.
- Phase B can begin without activating compositor for normal users, even if Manual Checkpoints A–B are still pending.
- Full Phase A evidence is complete only after the user supplies both device/run-mode scroll baselines; pending manual evidence must be reported explicitly and never inferred.
