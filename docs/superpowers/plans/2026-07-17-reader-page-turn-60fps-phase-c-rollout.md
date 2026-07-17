# Reader Page Turn 60 FPS Phase C Device Rollout Implementation Plan

## Status

**Closed as not required by user decision on 2026-07-18.**

- The user manually evaluated the current mobile page-turn experience from the immutable `ac26ae6` build over the LAN HTTP service and confirmed that it meets the requested result.
- Phase C Manual Checkpoints A–D and Tasks 5–6 will not be executed. Their unchecked implementation steps below are retained only as historical plan detail and are not outstanding work.
- No real-device diagnostic JSON or numeric PWA gate evidence was collected, so this closure does not claim that the planned FPS, p95, stall or input-latency gates passed.
- `DEFAULT_PAGE_TURN_BACKEND` remains `scroll`; the completed Phase B compositor implementation and permanent scroll/basic fallbacks remain unchanged.
- The 60 FPS page-turn implementation effort is accepted as complete for the user's current product requirements, and no Phase C evidence document is required.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 iPhone 14 Pro Max 和 Lenovo Xiaoxin Pro GT 的移动 Chrome 与安装 PWA 中完成 compositor/scroll A/B 功能和性能矩阵，并且只有两台设备的 PWA compositor 均通过门槛后才将 compositor 设为正常默认后端。

**Architecture:** Phase C 不再改变手势或动画实现；前四个用户手动检查点只收集固定矩阵证据。发布开关仍是 adapter 内的单一默认常量，运行时 capability 和 compositor→scroll→basic 降级始终保留；任何门槛失败或缺失都保持 scroll 默认并停止，不通过缩短时长或削减视觉伪造结果。

**Tech Stack:** Phase B compositor/scroll adapter、移动 Chrome、安装 PWA、远程 DevTools、read-only page-turn diagnostics、Vitest、Playwright、Vite

---

## Plan Position

- Prerequisite: complete Phase A agent Tasks and Phase B in order; user-supplied Phase A device evidence is required before the Phase C release decision.
- Recommended order: Phase A → Phase B → **Phase C（本计划）**.
- Phase C is the only plan allowed to change `DEFAULT_PAGE_TURN_BACKEND` from scroll to compositor.
- Design source: `docs/superpowers/specs/2026-07-17-reader-page-turn-60fps-design.md`.
- Execution-ownership source: `docs/superpowers/specs/2026-07-17-reader-page-turn-manual-device-test-ownership-design.md`.

## Execution Ownership and Order

- Manual Checkpoints A–D are user-owned real-device work and are excluded from the agentic “first unfinished Task” order.
- The user performs device setup, interaction, lifecycle checks and record export. An agent may validate, summarize, format and commit only evidence actually supplied by the user.
- The only agent-executable sequence is **Task 5 → Task 6**.
- Task 5 must stop at Step 1 unless user-supplied evidence contains PASS verdicts for both installed-PWA gates. Missing evidence and FAIL are equally blocking; scroll remains the default.
- Desktop Chromium, emulation and headless measurements must never be substituted for a manual checkpoint.

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

- Device input still enters through `ReaderView` and `usePageTurnController`.
- Backend selection and the only release default live in `client/src/utils/epubPageTurnAdapter.js`.
- Measurements are read from `window.__EPUB_READER_PAGE_TURN_DIAGNOSTICS__` only after explicit session debug configuration.

### 2. Current call chain and rollout flow

```text
force scroll/compositor session config
  -> same ReaderView/controller input
  -> adapter backend selection
  -> isolated action records + functional result
  -> Chrome preflight on both devices
  -> installed-PWA final matrix on both devices
  -> all PWA gates pass?
       yes -> flip one default constant -> capability fallback remains
       no  -> keep scroll default -> record blocker/backlog -> stop
```

### 3. Core files in this phase

- `docs/superpowers/verification/2026-07-17-reader-page-turn-60fps.md`: all device evidence and release decision.
- `client/src/utils/epubPageTurnAdapter.js`: conditional default switch only.
- `client/src/utils/epubPageTurnAdapter.test.js`: release-selection/fallback regression.
- `client/scripts/verify-reader-page-turn.mjs`: default-mode acceptance after the switch.
- `PROJECT.md`: final implementation/default status only after the gate passes.

### 4. Existing coverage consumed

- User-supplied Phase A scroll baseline for both devices/run modes.
- Phase B pure easing, capability, view lifecycle, drag/rollback/commit, cancellation and controller tests.
- Phase B forced compositor/scroll real-Chromium single/multi-chapter, RTL and fallback acceptance.

### 5. Files affected by Phase C

- Modify from user-supplied Manual Checkpoints A–D evidence: `docs/superpowers/verification/2026-07-17-reader-page-turn-60fps.md`
- Conditionally modify in Task 5: `client/src/utils/epubPageTurnAdapter.js`
- Test in Task 5: `client/src/utils/epubPageTurnAdapter.test.js`
- Modify in Task 5: `client/scripts/verify-reader-page-turn.mjs`
- Modify in Task 5: `PROJECT.md`
- Reference only: controller, ReaderView, CSS, settings, progress and PWA manifest.

### 6. Modules that must not change

- Gesture constants, animation durations/easing and reader visual CSS.
- Server, database, progress API, EPUB ingestion and persistence.
- PWA manifest/cache policy/service-worker behavior.
- Dependency versions and epub.js package source.
- Shelf, folder and settings UI.

### 7. Compatibility and regression risks

- Device debug sampling adds a debug-only rAF; compare backends with identical instrumentation and never generalize headless numbers to devices.
- iPhone Chrome/PWA and Lenovo Chrome/PWA are separate environments; do not merge their samples.
- A compositor pass on Chrome does not authorize default activation; both installed-PWA matrices are mandatory.
- Switching the default must not remove capability checks, forced scroll, runtime compositor disable or basic navigation.
- A settings/layout/rotation/background action must cancel and restore, not leave a stale session that contaminates later samples.

## Behavior Classification

- **Preserve:** all reader interaction, visual, progress, chapter, RTL, reduced-motion and fallback behavior from Phases A/B.
- **Modify:** only the normal backend preference, and only after both PWA gates pass.
- **Add:** durable Chrome/PWA device evidence and an explicit release verdict.
- **Deprecate/remove:** nothing. Scroll and basic remain permanent fallbacks after compositor becomes preferred.

## Conflicts, Blockers, Existing Issues, Backlog

- **Resolved documentation precedence:** the approved 60 FPS design supersedes the old scroller-only sentence in `PROJECT.md`; Phase B updates the architecture wording, and Task 5 records whether compositor became the default.
- **Blocker Gate G1:** do not proceed from Chrome preflight to final release if a P0/P1 functional defect appears (wrong page, CFI/progress corruption, stuck transform, unusable fallback).
- **Blocker Gate G2:** do not execute the default switch unless compositor in both installed PWAs meets every numeric gate for every core action group and passes the finite functional matrix.
- **Existing Issues:** external notifications/app switching can create invalid samples; mark and exclude them rather than changing implementation.
- **Backlog:** any P2/P3 visual nuance, device outside the target matrix, 120 FPS work, power usage, long-term telemetry and a possible three-page renderer.

## Shared Device Protocol

The user uses the same immutable build for all four manual checkpoints. For each backend/run-mode combination:

1. Enable debug with `forceBackend: 'compositor'` or `'scroll'`, reload, and confirm the first record reports that backend.
2. Clear records before every action group.
3. Execute 20 slow drag commits, 20 slow drag rollbacks, 20 fast short commits, 20 tap-next and 20 tap-prev actions.
4. For compositor, every group must satisfy: average FPS ≥ 58, p95 interval ≤ 20ms, max consecutive frames >33.4ms ≤ 1, and input-to-first-visual ≤ 33.4ms.
5. Inspect after settle: no active Animation, temporary transform or will-change; record history must stop growing.
6. Run one finite functional pass covering chapter boundary, long chapter, image-containing EPUB, four themes, each layout setting category, rotation, background/foreground, close/reopen and reduced motion. During the bounded long-chapter group, record the available layer/GPU-process memory counter before and after the group and require no monotonic retained-layer or memory growth; if a platform exposes no GPU counter, record that limitation and use layer/style/Animation cleanup evidence without inventing a value.
7. Mark external interruptions separately and repeat only the affected repetition.

### Manual Checkpoint A (User-owned): Complete iPhone Chrome compositor/scroll preflight

**Ownership:** The user performs all device operations and exports. Agentic workers must skip this checkpoint when selecting the first unfinished Task; they may only process user-supplied evidence.

**Status:** Not required — closed by user acceptance on 2026-07-18.

**Estimated effort:** 75–90 minutes.

#### Goal

iPhone 14 Pro Max mobile Chrome has complete forced compositor and forced scroll results, with a clear functional/performance preflight verdict.

#### Existing Behavior

Phase A records only scroll baseline. Phase B proves compositor function in desktop Chromium, not iPhone Chrome performance.

#### Required Change

Run the Shared Device Protocol in iPhone Chrome, append actual records and finite regression results, and stop on P0/P1 without modifying code inside this Task.

#### Files

- Modify: `docs/superpowers/verification/2026-07-17-reader-page-turn-60fps.md`
- Reference: `client/src/utils/pageTurnDiagnostics.js`
- Reference: `client/scripts/verify-reader-page-turn.mjs`

#### Interfaces

- Consumes: Phase A iPhone scroll baseline; Phase B force switch/diagnostics.
- Produces: iPhone Chrome tables for both backends and a `PASS`/`FAIL` preflight verdict with explicit failed criteria.
- Affects later work: a P0/P1 failure stops before Manual Checkpoint C; performance evidence informs, but only PWA evidence authorizes Task 5.

#### Implementation Steps

- [ ] **Step 1: Record the immutable build and environment**

Record commit, iOS version, Chrome version, portrait viewport and remote-debug method in the evidence document.

- [ ] **Step 2: Run the forced compositor core groups**

Use:

```js
sessionStorage.setItem('epub-reader:page-turn-debug', JSON.stringify({
  enabled: true,
  forceBackend: 'compositor',
}));
location.reload();
```

Run all five 20-action groups and copy the actual diagnostic aggregates.

- [ ] **Step 3: Run the forced scroll comparison groups**

Change only `forceBackend` to `scroll`, reload and repeat the same groups in the same order.

- [ ] **Step 4: Run the finite Chrome functional matrix**

Exercise the listed content/theme/settings/lifecycle cases once per backend where meaningful. Confirm page result, CFI/progress, seam, cancellation and cleanup; reduced motion must use basic.

- [ ] **Step 5: Write the preflight verdict and clear debug state**

List each numeric criterion separately. If any P0/P1 function fails, stop Phase C and report Gate G1. A numeric miss is recorded exactly; do not tune animation semantics in this Task.

- [ ] **Step 6: Commit the supplied iPhone Chrome evidence**

```powershell
git add docs/superpowers/verification/2026-07-17-reader-page-turn-60fps.md
git commit -m "docs: record iPhone Chrome page turn preflight"
```

#### Done Criteria

- Both backends have five isolated 20-sample groups.
- Every compositor criterion and finite functional case has an objective result.
- External interruptions are excluded and listed.
- No implementation file changed.

#### Verification

```js
window.__EPUB_READER_PAGE_TURN_DIAGNOSTICS__.getRecords()
```

Expected: the current group has 20 completed records for the forced backend and no active/growing record after settle.

#### Regression Scope

- Correct page/CFI/progress result.
- No persistent view/edge transform or will-change.
- Scroll and basic fallbacks remain usable.

#### Out of Scope

- PWA release verdict, other iPhones, implementation tuning, GPU deep profiling and unrelated UI defects.

### Manual Checkpoint B (User-owned): Complete Lenovo Chrome compositor/scroll preflight

**Ownership:** The user performs all device operations and exports. Agentic workers must skip this checkpoint when selecting the first unfinished Task; they may only process user-supplied evidence.

**Status:** Not required — closed by user acceptance on 2026-07-18.

**Estimated effort:** 75–90 minutes.

#### Goal

Lenovo Xiaoxin Pro GT mobile Chrome has the same complete A/B preflight evidence and verdict as the iPhone.

#### Existing Behavior

Phase A records Lenovo scroll baseline; there is no real-device compositor result.

#### Required Change

Run the Shared Device Protocol in Lenovo Chrome with the same build/order/schema, append actual results and stop on P0/P1.

#### Files

- Modify: `docs/superpowers/verification/2026-07-17-reader-page-turn-60fps.md`
- Reference: `client/src/utils/pageTurnDiagnostics.js`

#### Interfaces

- Consumes: Phase A Lenovo baseline and Manual Checkpoint A evidence schema.
- Produces: Lenovo Chrome compositor/scroll metrics, functional matrix and preflight verdict.
- Affects later work: Manual Checkpoint D uses the same device for the final PWA gate.

#### Implementation Steps

- [ ] **Step 1: Record environment/build identity**

Record Android/Chrome versions, device refresh setting, portrait viewport and exact commit; do not change refresh settings between backends.

- [ ] **Step 2: Capture forced compositor groups**

Run the five 20-action groups and export actual records after each group.

- [ ] **Step 3: Capture forced scroll groups**

Reload with forced scroll and repeat the identical groups/order.

- [ ] **Step 4: Run the finite Chrome functional matrix**

Cover chapter/content/theme/settings/rotation/background/reopen/reduced-motion cases and inspect temporary style cleanup.

- [ ] **Step 5: Record verdict and clear debug state**

Apply the exact same numeric gates as Manual Checkpoint A. Stop for P0/P1; record numeric misses without redesign.

- [ ] **Step 6: Commit the supplied Lenovo Chrome evidence**

```powershell
git add docs/superpowers/verification/2026-07-17-reader-page-turn-60fps.md
git commit -m "docs: record Lenovo Chrome page turn preflight"
```

#### Done Criteria

- Both backends have complete, action-separated data.
- Functional and cleanup cases have explicit results.
- Schema/gates match Manual Checkpoint A.
- No implementation file changed.

#### Verification

```js
window.__EPUB_READER_PAGE_TURN_DIAGNOSTICS__.getRecords()
```

Expected: 20 completed records for the current forced backend/action group and no active record after settle.

#### Regression Scope

- Correct page/CFI/progress and chapter boundary.
- Rotation/background/settings cancellation.
- No persistent animation/style state.

#### Out of Scope

- Installed-PWA verdict, other Android devices, interaction tuning and architecture changes.

### Manual Checkpoint C (User-owned): Complete the iPhone installed-PWA final gate

**Ownership:** The user performs all device operations and exports. Agentic workers must skip this checkpoint when selecting the first unfinished Task; they may only process user-supplied evidence.

**Status:** Not required — closed by user acceptance on 2026-07-18.

**Estimated effort:** 75–90 minutes.

#### Goal

iPhone installed PWA produces the final compositor/scroll A/B evidence, and compositor either passes every release criterion or explicitly blocks default activation.

#### Existing Behavior

Chrome preflight is not the product’s final run mode. Phase A has only the PWA scroll baseline.

#### Required Change

Run the Shared Device Protocol in standalone PWA with the immutable Phase B build, including close/reopen and background/foreground cases, and record the release-gate verdict.

#### Files

- Modify: `docs/superpowers/verification/2026-07-17-reader-page-turn-60fps.md`
- Reference: `client/public/manifest.webmanifest`
- Reference: `client/src/utils/pageTurnDiagnostics.js`

#### Interfaces

- Consumes: Manual Checkpoint A iPhone Chrome preflight and Phase A PWA scroll baseline.
- Produces: iPhone PWA compositor/scroll metric tables, functional matrix and one release-gate verdict.
- Affects later Tasks: Task 5 requires this verdict to be PASS.

#### Implementation Steps

- [ ] **Step 1: Confirm standalone mode and immutable build**

Launch from the desktop icon, record app/version metadata, and verify it targets the same server/commit used by Chrome preflight.

- [ ] **Step 2: Run forced compositor core groups**

Enable session debug through remote inspection, reload within the PWA, and capture all five 20-action groups.

- [ ] **Step 3: Run forced scroll comparison groups**

Repeat the same groups with forced scroll.

- [ ] **Step 4: Run the full finite PWA functional matrix**

Include chapter first/last transitions, long/image books, four themes, font/size/horizontal margin/line height/letter spacing, rotation, background/foreground, close/reopen and reduced motion. Check no persistent style/Animation after every lifecycle cancellation.

- [ ] **Step 5: Apply Gate G2 for this device**

Mark PASS only if every compositor core group meets all four numeric thresholds and every functional case passes. Otherwise mark FAIL with exact groups/criteria; keep scroll default and do not adjust visual/interaction semantics.

- [ ] **Step 6: Commit the supplied iPhone PWA evidence**

```powershell
git add docs/superpowers/verification/2026-07-17-reader-page-turn-60fps.md
git commit -m "docs: record iPhone PWA page turn gate"
```

#### Done Criteria

- Both backends have complete PWA records.
- All compositor numeric/functional criteria have explicit outcomes.
- Background/reopen cleanup is verified.
- Release verdict is unambiguous and implementation remains unchanged.

#### Verification

```js
window.__EPUB_READER_PAGE_TURN_DIAGNOSTICS__.getRecords()
```

Expected: 20 records for the selected group/backend, all terminal, with no persistent temporary styles or active Animation.

#### Regression Scope

- Standalone PWA launch and foreground recovery.
- Progress/CFI after close/reopen.
- No service-worker/offline behavior is introduced.

#### Out of Scope

- Other iOS devices, offline reading, power profiling, threshold relaxation and code fixes inside the measurement Task.

### Manual Checkpoint D (User-owned): Complete the Lenovo installed-PWA final gate

**Ownership:** The user performs all device operations and exports. Agentic workers must skip this checkpoint when selecting the first unfinished Task; they may only process user-supplied evidence.

**Status:** Not required — closed by user acceptance on 2026-07-18.

**Estimated effort:** 75–90 minutes.

#### Goal

Lenovo installed PWA supplies the second mandatory release verdict, completing the evidence needed for or against default compositor activation.

#### Existing Behavior

Manual Checkpoint B covers Chrome only; Phase A PWA evidence covers scroll only.

#### Required Change

Run the identical PWA A/B and functional matrix on Lenovo, append results, and produce the second Gate G2 verdict.

#### Files

- Modify: `docs/superpowers/verification/2026-07-17-reader-page-turn-60fps.md`
- Reference: `client/public/manifest.webmanifest`
- Reference: `client/src/utils/pageTurnDiagnostics.js`

#### Interfaces

- Consumes: Manual Checkpoint B Lenovo preflight and Manual Checkpoint C PWA schema/gate.
- Produces: Lenovo PWA compositor/scroll evidence and release-gate verdict.
- Affects later Tasks: Task 5 runs only when user-supplied Manual Checkpoints C and D both say PASS.

#### Implementation Steps

- [ ] **Step 1: Confirm standalone/build identity**

Record Android/Chrome/PWA metadata and confirm the same commit/server as the previous manual checkpoints.

- [ ] **Step 2: Capture forced compositor core groups**

Run the five 20-action groups and export actual records separately.

- [ ] **Step 3: Capture forced scroll comparison groups**

Repeat the exact groups/order with forced scroll.

- [ ] **Step 4: Run the finite PWA functional matrix**

Exercise all required content/theme/settings/lifecycle/reduced-motion cases and inspect cleanup after each cancellation.

- [ ] **Step 5: Apply and record Gate G2**

PASS requires every compositor metric and functional case to pass. On FAIL, identify exact criteria, leave scroll default and stop before Task 5.

- [ ] **Step 6: Commit the supplied Lenovo PWA evidence**

```powershell
git add docs/superpowers/verification/2026-07-17-reader-page-turn-60fps.md
git commit -m "docs: record Lenovo PWA page turn gate"
```

#### Done Criteria

- Complete compositor/scroll PWA data exists for Lenovo.
- Release verdict uses the same thresholds as iPhone.
- External interruptions are separated.
- No implementation file changed.

#### Verification

```js
window.__EPUB_READER_PAGE_TURN_DIAGNOSTICS__.getRecords()
```

Expected: 20 terminal records for the current action/backend and no persistent animation/style state.

#### Regression Scope

- Standalone lifecycle, settings mutation and rotation cancellation.
- Page/CFI/progress correctness and fallbacks.

#### Out of Scope

- Other tablets, device-specific branches, threshold changes, redesign and unrelated PWA issues.

### Task 5: Promote compositor to default only after both PWA gates pass

**Status:** Not applicable — the user closed Phase C without changing the default backend.

**Estimated effort:** 45–60 minutes.

#### Goal

Normal unforced sessions prefer compositor on capable readers, while missing capability/runtime failure still selects scroll and reduced motion/basic behavior remains unchanged.

#### Existing Behavior

Phase B implements and forces compositor but keeps `DEFAULT_PAGE_TURN_BACKEND = 'scroll'`. User-supplied manual-checkpoint evidence is the only accepted release input, and normal sessions do not use compositor by default until that evidence passes both PWA gates.

#### Required Change

First verify both user-supplied PWA verdicts are PASS. Then add a failing default-selection test, flip the single release constant, update default-mode browser expectation and record the completed status in `PROJECT.md` and the evidence document. If either gate is not PASS, do not touch code and report Gate G2 as the blocker.

#### Files

- Modify: `client/src/utils/epubPageTurnAdapter.js`
- Test: `client/src/utils/epubPageTurnAdapter.test.js`
- Modify: `client/scripts/verify-reader-page-turn.mjs`
- Modify: `PROJECT.md`
- Modify: `docs/superpowers/verification/2026-07-17-reader-page-turn-60fps.md`
- Reference: user-supplied Phase C Manual Checkpoints C–D verdict sections.

#### Interfaces

- Consumes: both user-supplied PWA PASS verdicts, `selectBackend()` and runtime disable state.
- Produces: `DEFAULT_PAGE_TURN_BACKEND = 'compositor'` with unchanged force override and capability fallback.
- Affects later Tasks: Task 6 verifies the unforced release behavior.

#### Implementation Steps

- [ ] **Step 1: Enforce the release gate before editing**

Read both user-supplied PWA verdicts. If either is missing/FAIL, stop, leave scroll default, record the exact blocker and do not perform Steps 2–7.

- [ ] **Step 2: Add failing default/fallback tests**

Without `forceBackend`, assert safe views select compositor; missing WAAPI/views/business-transform safety selects scroll; compositor disabled after runtime failure selects scroll on the next operation; reduced-motion controller remains basic.

- [ ] **Step 3: Run the adapter test and witness RED**

Expected: safe unforced session currently reports scroll.

- [ ] **Step 4: Flip only the release preference**

```js
const DEFAULT_PAGE_TURN_BACKEND = 'compositor';
```

Do not remove or weaken `inspectCompositor`, forced scroll, runtime disable, scroll backend or basic navigation.

- [ ] **Step 5: Update unforced browser and project status**

Make the default browser context expect compositor while retaining explicit forced-scroll and degraded contexts. In `PROJECT.md`, mark the 60 FPS compositor rollout complete and state that default compositor is gated by capability with permanent scroll/basic fallback.

- [ ] **Step 6: Re-run the same adapter test and witness GREEN**

- [ ] **Step 7: Record the release decision and commit**

Append the exact two PWA verdict references, activation commit and unchanged fallback policy to the evidence document.

```powershell
git add client/src/utils/epubPageTurnAdapter.js client/src/utils/epubPageTurnAdapter.test.js client/scripts/verify-reader-page-turn.mjs PROJECT.md docs/superpowers/verification/2026-07-17-reader-page-turn-60fps.md
git commit -m "perf: prefer compositor page turns"
```

#### Done Criteria

- Both user-supplied PWA verdicts were PASS before code changed.
- Safe unforced sessions select compositor.
- Capability/runtime failure selects scroll on a fresh operation.
- Reduced motion/basic path is unchanged.
- `PROJECT.md` and evidence identify the actual default and gate.
- Directed adapter test passes.

#### Verification

```powershell
npm test --prefix client -- epubPageTurnAdapter.test.js usePageTurnController.test.jsx
```

Expected: both selected files pass; default/fallback tests report compositor/scroll/basic as designed.

#### Regression Scope

- No half-session backend switch.
- Forced scroll remains available for diagnosis.
- Unsupported/private-object failures remain safe.
- One page/progress result per operation.

#### Out of Scope

- Threshold/easing/visual changes, device allowlists, deleting scroll/basic, dependency upgrades and fixing a failed gate inside this Task.

### Task 6: Run the single final release verification and close the plan

**Status:** Not applicable — the user accepted the existing verified Phase B build and closed Phase C.

**Estimated effort:** 30–45 minutes.

#### Goal

The promoted build compiles, passes the direct browser test set, satisfies the approved design checklist and shows no obvious regression in preserved reader behavior; the plan then stops immediately.

#### Existing Behavior

Task-level tests and user-supplied device evidence exist, but the unforced release build has not received the one plan-level final verification required after activation.

#### Required Change

Run exactly one client build and one direct page-turn browser test set, then perform one finite specification/preserved-behavior check. Fix only P0/P1 and rerun only the originally failed command once.

#### Files

- Verify only: no planned source change.
- Reference: `docs/superpowers/specs/2026-07-17-reader-page-turn-60fps-design.md`
- Reference: `docs/superpowers/verification/2026-07-17-reader-page-turn-60fps.md`
- Reference: all Phase A/B/C commits.

#### Interfaces

- Consumes: Task 5 default selection, all automated evidence and all user-supplied device evidence.
- Produces: final command evidence and one specification-conformance verdict; no new API.
- Affects later Tasks: none.

#### Implementation Steps

- [ ] **Step 1: Run the affected client build once**

Use the build command below and record exit code/output.

- [ ] **Step 2: Run the direct browser test set once**

Use the browser command below. It must cover unforced compositor, forced scroll, degraded/basic, commit/rollback, chapter, RTL and cleanup.

- [ ] **Step 3: Perform one finite specification check**

Check: all visible stages use the intended backend; numeric user-run device gates are recorded; gesture/timing/easing/visual/page result/CFI/progress/chapter/RTL/reduced/basic behavior is preserved; no persistent will-change/transform/Animation remains.

- [ ] **Step 4: Apply the P0/P1-only rule**

P0 is build/start/data-corruption risk. P1 is a direct design or acceptance violation. Put all P2/P3 in Backlog. After a P0/P1 fix, rerun only the failed original command once; do not start another review.

- [ ] **Step 5: Stop immediately when criteria pass**

Record completion in the task output; do not request another review or begin another optimization.

#### Done Criteria

- Build exits 0.
- Direct browser test set exits 0.
- Both user-supplied PWA compositor verdicts meet all numeric/functional gates.
- Approved design goals and preserved behaviors have one explicit pass verdict.
- No unresolved P0/P1 remains.

#### Verification

```powershell
npm run build --prefix client
npm run verify:reader-page-turn --prefix client
```

Expected: both commands exit 0; browser JSON identifies default compositor plus working forced-scroll/degraded/basic paths and cleared temporary styles.

#### Regression Scope

- Build/start, page result, CFI/progress, chapter/RTL, reduced motion and fallback.
- Page margins, seam and cleanup.

#### Out of Scope

- Full repository review, all device models, comprehensive security/performance audit, warning cleanup, production perfection, second review rounds and future renderer work.

## Phase C Closure State

- [x] The user completed a manual mobile experience check against build `ac26ae6` and accepted the current page-turn result on 2026-07-18.
- [x] The user explicitly decided that the Phase C device rollout and numeric evidence matrix are no longer required.
- [x] Manual Checkpoints A–D and Tasks 5–6 are closed as not applicable rather than represented as tests that were run.
- [x] The default backend remains scroll; compositor forcing, runtime capability checks and scroll/basic fallbacks remain available.
- [x] No fabricated real-device metrics or PASS verdicts were added, and the plan is closed with no remaining required work.
