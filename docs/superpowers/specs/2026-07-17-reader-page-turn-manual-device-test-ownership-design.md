# Reader Page Turn Manual Device Test Ownership Design

## Status

Approved by the user on 2026-07-17.

## Context

The current agent environment runs on Windows and has no supported iPhone Web Inspector channel. Real-device Chrome and installed-PWA measurements therefore cannot be executed or independently observed by an agent. Desktop Chromium, emulation and invented measurements are not valid substitutes for the approved mobile-device gates.

## Decision

All physical mobile-device interaction and measurement is user-owned:

- Phase A iPhone and Lenovo scroll baselines become manual checkpoints rather than agent-executable Tasks.
- Phase C iPhone and Lenovo Chrome/PWA A/B matrices become manual checkpoints rather than agent-executable Tasks.
- Phase B remains unchanged because it contains deterministic desktop Chromium verification, not real-device FPS acceptance.

Manual checkpoints are excluded from the “first unfinished Task” order used by agentic plan execution. Their unchecked state records pending user evidence and must not block unrelated automated implementation work.

## Sequencing and Gates

- Phase A agent execution proceeds as Task 1 → Task 2 → Task 5 → Task 6.
- The current immutable Phase A scroll-baseline build is `4e75942bee03edd272a72384e7a3db815f1309ba`. Manual evidence must identify the exact tested commit if that baseline is replaced.
- Phase B may proceed while manual Phase A evidence is pending because the normal default remains scroll.
- Phase C default activation remains a hard gate. Its promotion Task cannot begin until user-supplied evidence records PASS for both target devices’ installed-PWA compositor gates.
- Missing or failed manual evidence leaves scroll as the default and stops default activation. It does not authorize threshold changes or implementation tuning inside a measurement checkpoint.

## Evidence Responsibilities

The user performs device setup, actions and record export, including device/OS/browser metadata, run mode, sample counts and external-interruption notes. An agent may validate, summarize, format and commit only records and metadata actually supplied by the user.

An agent must never:

- claim a manual checkpoint was executed without user-supplied evidence;
- replace mobile results with desktop, emulated or headless measurements;
- fabricate missing values or infer a PASS verdict;
- activate compositor by default while either required PWA gate is missing or failed.

## Plan Changes

- `docs/superpowers/plans/2026-07-17-reader-page-turn-60fps-phase-a-baseline.md` will classify its former Tasks 3–4 as user-owned manual checkpoints and distinguish automated completion from pending manual evidence.
- `docs/superpowers/plans/2026-07-17-reader-page-turn-60fps-phase-c-rollout.md` will classify its former Tasks 1–4 as user-owned manual checkpoints and preserve Tasks 5–6 as gated agent work.
- Test scenarios, sample counts, thresholds, evidence schema, out-of-scope boundaries and product behavior remain unchanged.

## Completion Conditions

The plan update is complete when agent task ordering skips manual checkpoints, manual evidence remains visibly pending, and no wording allows compositor default activation before both user-run PWA gates pass.
