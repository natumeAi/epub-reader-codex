# Reader Page Turn Integration and Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Phase A 的 continuous scroller 适配能力接入 React 手势状态机和 ReaderView，使点按/键盘自动滑一页、触摸真实正文跟手、未达标回弹，并完成有限的自动化与浏览器移动视口验收；目标设备实机验收由用户在计划完成后手动执行。

**Architecture:** usePageTurnController 是唯一交互状态机，管理 idle/pending/dragging/settling/basic、pointer capture、速度采样、并发保护和 1200ms 恢复；ReaderView 只路由输入并渲染单个页缘。逐帧正文与页缘写入不触发 React setState，稳定 relocated 继续由 Phase A 的 useEpubRendition 进入原有进度链。

**Tech Stack:** React 19、epub.js 0.3.93、Pointer Events、requestAnimationFrame、CSS custom properties、Vitest、Testing Library、Playwright

---

## Execution Order and Preconditions

本计划是 Phase B，只能在 docs/superpowers/plans/2026-07-16-reader-page-turn-foundation.md 全部完成后执行。

开始 Task 1 前运行：

~~~powershell
Test-Path client/src/utils/pageTurnGesture.js
Test-Path client/src/utils/epubPageTurnAdapter.js
npm test --prefix client -- pageTurnGesture.test.js epubPageTurnAdapter.test.js useEpubRendition.test.jsx
~~~

Expected: 两个 Test-Path 均为 True，测试命令 exit code 0。否则属于执行 Blocker，停止并完成 Phase A；不要在 Phase B 修补半成品基础层。

## Code Mapping

1. 当前功能主要入口

   - ReaderView 仍是全屏阅读器与唯一应用输入面。
   - Phase A 后 useEpubRendition 返回 pageTurnAdapter，ReaderView 尚未消费。

2. 当前调用链和数据流

   - 输入层：reader-gesture-layer / window keydown。
   - 目标链：ReaderView 输入 → usePageTurnController → adapter.animateTo 或一次 rendition.next/prev → 稳定 relocated → useEpubRendition 进度链。
   - 视觉链：controller 阶段/方向只在阶段变化时 setState；每帧由 adapter 写 scroller、controller 写页缘 CSS 变量。

3. 核心文件

   - client/src/components/reader/ReaderView.jsx
   - client/src/components/reader/ReaderView.test.jsx
   - client/src/hooks/usePageTurnController.js
   - client/src/hooks/usePageTurnController.test.jsx
   - client/src/hooks/useEpubRendition.js
   - client/src/hooks/useReaderSettings.js
   - client/src/hooks/useReducedMotion.js
   - client/src/styles/reader.css
   - client/scripts/reader-verification-environment.mjs

4. 已有测试覆盖

   - Phase A：手势纯逻辑、adapter、continuous/Snap 与稳定 relocated。
   - 前置 remediation：ReaderView 关闭/键盘组合、进度可靠性、reduced motion、移动设置面板。
   - 缺口：controller 并发与超时、真实触摸拖动/回弹、CSS sheet 移除、浏览器 scroller 连续变化和浏览器移动视口登录确认。

5. 将影响的文件

   - Create: client/src/hooks/usePageTurnController.js
   - Create: client/src/hooks/usePageTurnController.test.jsx
   - Modify: client/src/components/reader/ReaderView.jsx
   - Modify: client/src/components/reader/ReaderView.test.jsx
   - Modify: client/src/hooks/useReaderSettings.js
   - Modify: client/src/styles/reader.css
   - Create: client/scripts/verify-reader-page-turn.mjs
   - Modify: client/package.json
   - Modify: .github/workflows/quality.yml
   - Modify: PROJECT.md

6. 明确不应修改的模块

   - Phase A adapter/gesture 公共名称，除非定向测试暴露 P0/P1。
   - 阅读进度 API、outbox、数据库、服务端路由和存储。
   - 书架/文件夹交互、PWA 缓存策略、Docker/NAS 配置。
   - epub.js 包源码。

7. 兼容与回归风险

   - enhanced 对齐完成后再调用 next/prev 会重复翻页；controller 必须保证两条路径互斥。
   - pending/dragging/settling 中的重复输入、pointercancel、旋转、设置重排、后台和卸载必须释放同一批资源。
   - reduced motion 仍要识别点按/滑动/键盘，但只能走一次无视觉等待的 basic 导航。
   - reader-gesture-layer 必须继续盖在 iframe 上方，否则 Snap 自带触摸监听和应用 controller 可能同时移动。
   - 删除旧 sheet 后，四种主题的背景、页码常显、控制层 z-index 和面板输入不能回归。

## Behavior Classification

- 保留：左/中/右点按、键盘过滤、控制层/面板、目录、页码常显、主题/排版、关闭/恢复、进度持久化。
- 修改：点按和键盘从两阶段容器/sheet 动画改为真实 scroller 自动滑页；触摸 swipe 从 pointerup 阈值改为 pending/dragging/settling。
- 新增：触摸一比一跟手、距离或速度完成、回弹、边界阻尼、超时恢复、页缘、浏览器自动化与移动视口登录验收。
- 明确废弃：SWIPE_THRESHOLD、PAGE_SLIDE_OUT_MS、PAGE_SLIDE_IN_MS、animatingRef、pageTurn/pageTurnSheetRef、waitForPageTurnAnimation、reader-page-slide-*、reader-page-turn-sheet-* 及对应 keyframes/media override。

## Conflicts, Blockers, Existing Issues, and Backlog

### Conflicts

- PROJECT.md 的“真实翻页只由 next/prev”与增强路径冲突；Task 4 以设计确认的双路径规则替换这一句，不改其他项目约定。
- ReaderView 前置 reduced-motion 分支当前直接执行 next/prev；新 controller 接管该分支，但必须保留一次导航和立即关闭/无装饰动画行为。

### Blockers

- Phase A 未通过时本计划不得开始。
- Task 5 无法在浏览器移动视口完成登录并进入应用页面时，最终验收不能宣布完成。

### Existing Issues

- 不运行开放式基线审查；若定向命令出现与本功能无关的历史失败，记录命令和失败名称后停止该命令，不加入当前 Task。
- 预先存在的 .superpowers/ 与 client/reader-settings-narrow.png 继续保持未跟踪且不提交。

### Backlog

- 鼠标跟手、触控板横滑、多指、惯性多页、用户动画开关。
- rtlScrollType=reverse 增强支持和未知低端设备分档。
- 正式性能 telemetry、GPU trace 和自动化视觉差异系统。
- iPhone 14 Pro Max 与联想小新 Pro GT 的实机翻页验收由用户在本计划完成后手动执行，不阻塞本计划完成。

## Global Constraints

Execution and Review Guardrails

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

### Task 1：实现自动翻页、基础降级与超时恢复状态机

Estimated effort: 60–90 minutes

#### Goal

新增 hook，使点按/键盘请求在 idle/basic 时只执行一次；增强路径动画到相邻一页而不调用 next/prev，能力失败时 basic 只调用一次 next/prev，1200ms 无稳定 relocated 时恢复稳定 CFI 并锁定本会话 basic。

#### Existing Behavior

ReaderView.turnPage 自己维护 animatingRef、等待旧 CSS 动画和 relocated；reduced motion 是 ReaderView 内的旁路。Phase A adapter 尚无 React 并发状态。

#### Required Change

建立 idle/settling/basic 的第一阶段 controller；立即锁住输入，先检查 atStart/atEnd；enhanced 与 basic 互斥；视觉进度直接写 edgeRef CSS 变量；超时只恢复，不重放同一次导航。

#### Files

- Create: client/src/hooks/usePageTurnController.js
- Create: client/src/hooks/usePageTurnController.test.jsx
- Reference: client/src/utils/pageTurnGesture.js
- Reference: client/src/utils/epubPageTurnAdapter.js
- Reference: client/src/hooks/useReducedMotion.js

#### Interfaces

- Consumes:
  - adapter：Phase A adapter 或 null。
  - renditionRef、currentCfiRef、edgeRef。
  - reducedMotion:boolean。
- Produces:
  - phase: idle | settling | basic（Task 2 扩充 pending/dragging）。
  - direction: prev | next | null。
  - turnPage(direction): Promise<completed | blocked | failed | ignored>。
  - cancelPageTurn(reason): void。
- 后续 ReaderView 只调用 turnPage，不自行调用 rendition.next/prev。

#### Implementation Steps

- [ ] Step 1: Write failing navigation, exclusivity, reduced-motion, and timeout tests

Create client/src/hooks/usePageTurnController.test.jsx:

~~~jsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePageTurnController } from './usePageTurnController.js';

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

function createHarness(options = {}) {
  const handlers = {};
  let stableAtTarget = false;
  const rendition = {
    currentLocation: vi.fn(() => ({ atEnd: false, atStart: false })),
    next: vi.fn(() => {
      queueMicrotask(() => handlers.relocated?.({ start: { cfi: 'next-cfi' } }));
    }),
    prev: vi.fn(() => {
      queueMicrotask(() => handlers.relocated?.({ start: { cfi: 'prev-cfi' } }));
    }),
    on: vi.fn((name, handler) => { handlers[name] = handler; }),
    off: vi.fn((name, handler) => {
      if (handlers[name] === handler) delete handlers[name];
    }),
  };
  const adapter = {
    animateTo: vi.fn(async () => {
      stableAtTarget = true;
      queueMicrotask(() => handlers.relocated?.({ start: { cfi: 'enhanced-cfi' } }));
      return { status: 'completed' };
    }),
    begin: vi.fn(() => ({
      available: true,
      canNext: true,
      canPrevious: true,
      origin: 100,
      pageWidth: 100,
    })),
    cancel: vi.fn(),
    end: vi.fn(),
    inspect: vi.fn(() => ({ available: true })),
    isStableAt: vi.fn(() => stableAtTarget),
    recover: vi.fn().mockResolvedValue(true),
  };

  return {
    adapter,
    currentCfiRef: { current: 'stable-cfi' },
    edgeRef: { current: document.createElement('div') },
    rendition,
    renditionRef: { current: rendition },
    ...options,
  };
}

describe('usePageTurnController navigation', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('settles the enhanced scroller once without calling next or prev', async () => {
    const harness = createHarness();
    const { result } = renderHook(() => usePageTurnController(harness));
    await waitFor(() => expect(result.current.phase).toBe('idle'));

    await act(async () => {
      await result.current.turnPage('next');
    });

    expect(harness.adapter.animateTo).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ duration: 180 }),
    );
    expect(harness.rendition.next).not.toHaveBeenCalled();
    expect(harness.rendition.prev).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('idle');
  });

  it('uses one basic navigation for reduced motion or missing capability', async () => {
    const reduced = createHarness({ reducedMotion: true });
    const first = renderHook(() => usePageTurnController(reduced));
    await waitFor(() => expect(first.result.current.phase).toBe('basic'));
    await act(async () => { await first.result.current.turnPage('next'); });
    expect(reduced.rendition.next).toHaveBeenCalledTimes(1);
    expect(reduced.adapter.animateTo).not.toHaveBeenCalled();

    const unavailable = createHarness();
    unavailable.adapter.inspect.mockReturnValue({ available: false, reason: 'alignment' });
    const second = renderHook(() => usePageTurnController(unavailable));
    await waitFor(() => expect(second.result.current.phase).toBe('basic'));
    await act(async () => { await second.result.current.turnPage('prev'); });
    expect(unavailable.rendition.prev).toHaveBeenCalledTimes(1);
  });

  it('ignores a repeated request while settling', async () => {
    const harness = createHarness();
    const animation = deferred();
    harness.adapter.animateTo.mockReturnValue(animation.promise);
    const { result } = renderHook(() => usePageTurnController(harness));
    await waitFor(() => expect(result.current.phase).toBe('idle'));

    let first;
    await act(async () => {
      first = result.current.turnPage('next');
      const second = await result.current.turnPage('next');
      expect(second).toBe('ignored');
      animation.resolve({ status: 'cancelled' });
      await first;
    });
    expect(harness.adapter.animateTo).toHaveBeenCalledTimes(1);
  });

  it('recovers the stable CFI and enters basic after 1200ms without relocation', async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    harness.adapter.animateTo.mockResolvedValue({ status: 'completed' });
    const { result } = renderHook(() => usePageTurnController(harness));
    await act(async () => { await Promise.resolve(); });

    let navigation;
    await act(async () => {
      navigation = result.current.turnPage('next');
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1200);
      await navigation;
    });

    expect(harness.adapter.recover).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('basic');
    expect(harness.rendition.next).not.toHaveBeenCalled();
  });
});
~~~

- [ ] Step 2: Run the directed test and confirm the hook is missing

Run: npm test --prefix client -- usePageTurnController.test.jsx

Expected: exit code 1 with a failed import for usePageTurnController.js.

- [ ] Step 3: Implement the navigation-only controller

Create client/src/hooks/usePageTurnController.js:

~~~js
import { useCallback, useEffect, useRef, useState } from 'react';
import { PAGE_TURN_RULES } from '../utils/pageTurnGesture.js';

function pageDelta(direction) {
  return direction === 'next' ? 1 : -1;
}

async function readCurrentLocation(rendition) {
  const location = rendition?.currentLocation?.();
  return location && typeof location.then === 'function' ? location : Promise.resolve(location);
}

function isBoundary(location, direction) {
  return direction === 'next' ? Boolean(location?.atEnd) : Boolean(location?.atStart);
}

function createRelocationWait(rendition, predicate, timeoutMs) {
  let settled = false;
  let timer;
  let resolvePromise;

  const cleanup = () => {
    rendition?.off?.('relocated', handleRelocated);
    clearTimeout(timer);
  };
  const finish = (value) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolvePromise(value);
  };
  const handleRelocated = (location) => {
    if (predicate(location)) finish(location);
  };
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
    rendition?.on?.('relocated', handleRelocated);
    timer = setTimeout(() => finish(null), timeoutMs);
  });
  return {
    cancel: () => finish(null),
    promise,
  };
}

export function usePageTurnController({
  adapter,
  currentCfiRef,
  edgeRef,
  reducedMotion = false,
  renditionRef,
}) {
  const [phase, setPhaseState] = useState('basic');
  const [direction, setDirection] = useState(null);
  const phaseRef = useRef('basic');
  const basicRef = useRef(true);
  const relocationWaitRef = useRef(null);

  const setPhase = useCallback((nextPhase) => {
    phaseRef.current = nextPhase;
    setPhaseState(nextPhase);
  }, []);

  const clearEdge = useCallback(() => {
    edgeRef.current?.style.setProperty('--reader-page-turn-progress', '0');
    edgeRef.current?.style.setProperty('--reader-page-turn-edge-offset', '0px');
    setDirection(null);
  }, [edgeRef]);

  const writeEdgeProgress = useCallback((nextDirection, progress, pageWidth) => {
    const edge = edgeRef.current;
    if (!edge) return;
    const clamped = Math.min(1, Math.max(0, progress));
    const offset = nextDirection === 'next'
      ? (1 - clamped) * pageWidth
      : clamped * pageWidth;
    edge.style.setProperty('--reader-page-turn-progress', String(clamped));
    edge.style.setProperty('--reader-page-turn-edge-offset', offset + 'px');
  }, [edgeRef]);

  const restoreReadyPhase = useCallback(() => {
    clearEdge();
    setPhase(basicRef.current ? 'basic' : 'idle');
  }, [clearEdge, setPhase]);

  const enterBasic = useCallback(() => {
    basicRef.current = true;
    clearEdge();
    setPhase('basic');
  }, [clearEdge, setPhase]);

  const cancelPageTurn = useCallback(() => {
    relocationWaitRef.current?.cancel();
    relocationWaitRef.current = null;
    adapter?.cancel({ restoreOrigin: true });
    restoreReadyPhase();
  }, [adapter, restoreReadyPhase]);

  useEffect(() => {
    adapter?.cancel({ restoreOrigin: true });
    const capability = adapter?.inspect?.();
    basicRef.current = reducedMotion || !capability?.available;
    setPhase(basicRef.current ? 'basic' : 'idle');
    return () => {
      relocationWaitRef.current?.cancel();
      adapter?.cancel({ restoreOrigin: true });
    };
  }, [adapter, reducedMotion, setPhase]);

  const runBasicNavigation = useCallback(async (nextDirection) => {
    const rendition = renditionRef.current;
    const waiter = createRelocationWait(
      rendition,
      () => true,
      PAGE_TURN_RULES.relocatedTimeoutMs,
    );
    relocationWaitRef.current = waiter;
    try {
      const navigate = nextDirection === 'next' ? rendition?.next : rendition?.prev;
      await Promise.resolve(navigate?.call(rendition));
      return (await waiter.promise) ? 'completed' : 'failed';
    } catch {
      waiter.cancel();
      return 'failed';
    } finally {
      if (relocationWaitRef.current === waiter) relocationWaitRef.current = null;
    }
  }, [renditionRef]);

  const runEnhancedNavigation = useCallback(async (nextDirection, session) => {
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

    if (animation.status !== 'completed') {
      waiter.cancel();
      return animation.status === 'unavailable' ? 'failed' : 'ignored';
    }

    const location = await waiter.promise;
    if (!location || !adapter.isStableAt(delta)) {
      await adapter.recover();
      enterBasic();
      return 'failed';
    }

    adapter.end();
    return 'completed';
  }, [adapter, enterBasic, renditionRef, writeEdgeProgress]);

  const turnPage = useCallback(async (nextDirection) => {
    if (!['idle', 'basic'].includes(phaseRef.current)) return 'ignored';
    const rendition = renditionRef.current;
    if (!rendition || !['prev', 'next'].includes(nextDirection)) return 'ignored';

    setPhase('settling');
    try {
      const location = await readCurrentLocation(rendition).catch(() => null);
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
      return await runEnhancedNavigation(nextDirection, session);
    } finally {
      restoreReadyPhase();
    }
  }, [
    adapter,
    currentCfiRef,
    enterBasic,
    renditionRef,
    restoreReadyPhase,
    runBasicNavigation,
    runEnhancedNavigation,
    setPhase,
    writeEdgeProgress,
  ]);

  return {
    cancelPageTurn,
    direction,
    phase,
    turnPage,
  };
}
~~~

- [ ] Step 4: Re-run the same directed test

Run: npm test --prefix client -- usePageTurnController.test.jsx

Expected: exit code 0 with four controller navigation tests passing.

- [ ] Step 5: Commit the navigation state machine

~~~powershell
git add client/src/hooks/usePageTurnController.js client/src/hooks/usePageTurnController.test.jsx
git commit -m "feat: control automatic page turns"
~~~

#### Done Criteria

- enhanced 完成不调用 next/prev；basic 每次只调用一个方向方法一次。
- settling 期间重复请求返回 ignored。
- atStart/atEnd 返回 blocked。
- 1200ms 超时恢复稳定 CFI、隐藏视觉层并进入 basic，不重放本次操作。
- reduced motion 不调用 adapter.animateTo。
- 定向测试通过。

#### Verification

Run: npm test --prefix client -- usePageTurnController.test.jsx

Expected: exit code 0; four tests pass.

#### Regression Scope

- 前置进度链只接收完成后的稳定 relocated。
- 方向键/点按的一次输入最多一个页增量。
- basic 失败后仍回到可接收输入的 basic，而不是锁死 settling。

#### Out of Scope

- pointermove、速度采样、pointer capture 和 CSS sheet 删除；由 Tasks 2–3 处理。
- 更改 adapter 私有边界或进度 API。
- 自动重试失败翻页。

### Task 2：加入触摸方向锁定、跟手拖动、回弹与生命周期取消

Estimated effort: 75–90 minutes

#### Goal

controller 完整支持 touch pending/dragging/settling：横向锁定后每帧一次真实 scroller 写入，距离或速度完成，否则回弹；鼠标移动不进入跟手；pointercancel、旋转、后台和卸载都恢复并清理。

#### Existing Behavior

Task 1 只有自动导航；ReaderView 旧 pointerup 仍按 45px 判断，pointermove/pointercancel 不存在。

#### Required Change

消费 Task 1 纯逻辑；只跟踪 primary touch；10px 后按 1.2 比例锁向；在一个 rAF 中合并 pointermove；basic/reduced-motion 只识别结果不移动正文；相邻未就绪先回原点再 basic 一次；实际书籍边界只回弹；设置 disabled 时忽略输入。

#### Files

- Modify: client/src/hooks/usePageTurnController.js
- Modify: client/src/hooks/usePageTurnController.test.jsx
- Reference: client/src/utils/pageTurnGesture.js
- Reference: client/src/utils/epubPageTurnAdapter.js

#### Interfaces

- Consumes: Task 1 controller 和完整 pageTurnGesture exports。
- Produces:
  - phase 新增 pending | dragging。
  - handlePointerDown(event)、handlePointerMove(event)、handlePointerUp(event)、handlePointerCancel(event)。
  - disabled:boolean 和 onCenterTap():void 输入。
  - cancelPageTurn(reason) 同时释放 rAF、pointer capture、relocated waiter 和 adapter session。
- ReaderView Task 3 直接把四个 handlers 绑定在唯一 gesture layer。

#### Implementation Steps

- [ ] Step 1: Add failing representative gesture and cleanup tests

Append to client/src/hooks/usePageTurnController.test.jsx:

~~~jsx
function pointerEvent(overrides = {}) {
  return {
    cancelable: true,
    clientX: 300,
    clientY: 300,
    currentTarget: {
      getBoundingClientRect: () => ({ left: 0, width: 375 }),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
      setPointerCapture: vi.fn(),
    },
    isPrimary: true,
    pointerId: 1,
    pointerType: 'touch',
    preventDefault: vi.fn(),
    timeStamp: 0,
    ...overrides,
  };
}

it('locks a horizontal touch, coalesces drag writes, and ignores mouse dragging', async () => {
  const harness = createHarness();
  const { result } = renderHook(() => usePageTurnController(harness));
  await waitFor(() => expect(result.current.phase).toBe('idle'));

  act(() => result.current.handlePointerDown(pointerEvent()));
  act(() => result.current.handlePointerMove(pointerEvent({
    clientX: 295, clientY: 304, timeStamp: 10,
  })));
  expect(result.current.phase).toBe('pending');

  act(() => result.current.handlePointerMove(pointerEvent({
    clientX: 220, clientY: 305, timeStamp: 20,
  })));
  await act(async () => { await new Promise(requestAnimationFrame); });
  expect(result.current.phase).toBe('dragging');
  expect(harness.adapter.dragBy).toHaveBeenCalledTimes(1);

  act(() => result.current.handlePointerCancel(pointerEvent()));
  expect(harness.adapter.cancel).toHaveBeenCalled();

  harness.adapter.dragBy.mockClear();
  act(() => result.current.handlePointerDown(pointerEvent({ pointerType: 'mouse' })));
  act(() => result.current.handlePointerMove(pointerEvent({
    clientX: 200, pointerType: 'mouse',
  })));
  expect(harness.adapter.dragBy).not.toHaveBeenCalled();
});

it.each([
  ['distance', -120, -0.1, 1],
  ['velocity', -50, -0.7, 1],
  ['rollback', -50, -0.2, 0],
])('%s release settles to the expected page delta', async (_name, dx, velocity, expectedDelta) => {
  const harness = createHarness();
  harness.adapter.dragBy = vi.fn(() => ({
    boundary: false,
    direction: 'next',
    effectiveDistanceX: dx,
    progress: Math.abs(dx) / 100,
  }));
  const { result } = renderHook(() => usePageTurnController(harness));
  await waitFor(() => expect(result.current.phase).toBe('idle'));

  const start = pointerEvent({ clientX: 300, timeStamp: 0 });
  const moveTime = Math.abs(velocity) >= 0.45 ? 50 : 250;
  const move = pointerEvent({
    clientX: 300 + dx,
    timeStamp: moveTime,
  });
  act(() => result.current.handlePointerDown(start));
  act(() => result.current.handlePointerMove(move));
  await act(async () => { await new Promise(requestAnimationFrame); });
  await act(async () => {
    result.current.handlePointerUp(move);
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(harness.adapter.animateTo).toHaveBeenCalledWith(
    expectedDelta,
    expect.objectContaining({ duration: expect.any(Number) }),
  );
});

it('returns to a ready phase and releases capture on resize or pointercancel', async () => {
  const harness = createHarness();
  const event = pointerEvent();
  const { result, unmount } = renderHook(() => usePageTurnController(harness));
  await waitFor(() => expect(result.current.phase).toBe('idle'));

  act(() => result.current.handlePointerDown(event));
  act(() => window.dispatchEvent(new Event('resize')));
  expect(event.currentTarget.releasePointerCapture).toHaveBeenCalledWith(1);
  expect(harness.adapter.cancel).toHaveBeenCalled();
  expect(result.current.phase).toBe('idle');

  unmount();
  expect(harness.adapter.cancel).toHaveBeenCalled();
});
~~~

Update createHarness.adapter with:

~~~js
dragBy: vi.fn((distanceX) => ({
  boundary: false,
  direction: distanceX < 0 ? 'next' : 'prev',
  effectiveDistanceX: distanceX,
  progress: Math.min(1, Math.abs(distanceX) / 100),
})),
~~~

- [ ] Step 2: Run the directed test and confirm pointer handlers are absent

Run: npm test --prefix client -- usePageTurnController.test.jsx

Expected: exit code 1 because handlePointerDown/Move/Up/Cancel are undefined.

- [ ] Step 3: Extend imports and controller state for touch input

Replace the pageTurnGesture import with:

~~~js
import {
  PAGE_TURN_RULES,
  classifyDirection,
  decidePageDelta,
  getRecentVelocity,
  getSettleDuration,
  getTapZone,
} from '../utils/pageTurnGesture.js';
~~~

Replace the hook signature with the following exact parameter list:

~~~js
export function usePageTurnController({
  adapter,
  currentCfiRef,
  disabled = false,
  edgeRef,
  onCenterTap,
  reducedMotion = false,
  renditionRef,
}) {
~~~

Immediately after the existing relocationWaitRef declaration add:

~~~js
  const pointerRef = useRef(null);
  const dragFrameRef = useRef(null);
  const pendingDragDistanceRef = useRef(0);
~~~

- [ ] Step 4: Add the exact pointer helpers and lifecycle cleanup

Inside the hook, before runBasicNavigation, add:

~~~js
  const clearDragFrame = useCallback(() => {
    if (dragFrameRef.current !== null) {
      cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
  }, []);

  const releasePointer = useCallback((pointer = pointerRef.current) => {
    if (!pointer) return;
    try {
      if (pointer.target?.hasPointerCapture?.(pointer.pointerId)) {
        pointer.target.releasePointerCapture(pointer.pointerId);
      }
    } catch {
      // Pointer capture can already be gone after browser cancellation.
    }
  }, []);

  const writeDragFrame = useCallback((distanceX) => {
    const result = adapter?.dragBy(distanceX);
    if (result && pointerRef.current) {
      writeEdgeProgress(
        result.direction,
        result.progress,
        pointerRef.current.session.pageWidth,
      );
    }
    return result;
  }, [adapter, writeEdgeProgress]);

  const queueDragFrame = useCallback((distanceX) => {
    pendingDragDistanceRef.current = distanceX;
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = requestAnimationFrame(() => {
      dragFrameRef.current = null;
      writeDragFrame(pendingDragDistanceRef.current);
    });
  }, [writeDragFrame]);

  const finishPointer = useCallback(() => {
    clearDragFrame();
    releasePointer();
    pointerRef.current = null;
  }, [clearDragFrame, releasePointer]);
~~~

Replace cancelPageTurn with:

~~~js
  const cancelPageTurn = useCallback(() => {
    relocationWaitRef.current?.cancel();
    relocationWaitRef.current = null;
    finishPointer();
    adapter?.cancel({ restoreOrigin: true });
    restoreReadyPhase();
  }, [adapter, finishPointer, restoreReadyPhase]);
~~~

Add this lifecycle effect after the adapter/reducedMotion effect:

~~~js
  useEffect(() => {
    const cancelForLifecycle = () => cancelPageTurn('viewport');
    const cancelWhenHidden = () => {
      if (document.visibilityState === 'hidden') cancelPageTurn('hidden');
    };
    window.addEventListener('resize', cancelForLifecycle);
    window.addEventListener('orientationchange', cancelForLifecycle);
    document.addEventListener('visibilitychange', cancelWhenHidden);
    return () => {
      window.removeEventListener('resize', cancelForLifecycle);
      window.removeEventListener('orientationchange', cancelForLifecycle);
      document.removeEventListener('visibilitychange', cancelWhenHidden);
      cancelPageTurn('unmount');
    };
  }, [cancelPageTurn]);
~~~

- [ ] Step 5: Add pointer handlers and return them from the hook

Add these callbacks after turnPage:

~~~js
  const handlePointerDown = useCallback((event) => {
    if (
      disabled ||
      !['idle', 'basic'].includes(phaseRef.current) ||
      (event.pointerType === 'touch' && event.isPrimary === false)
    ) {
      return;
    }

    const touch = event.pointerType === 'touch';
    let session = null;
    let mode = touch ? 'basic' : 'tap';
    if (touch && !basicRef.current) {
      session = adapter?.begin(currentCfiRef.current);
      if (session) mode = 'enhanced';
      else enterBasic();
    }

    pointerRef.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      target: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      locked: null,
      captured: false,
      mode,
      session,
      samples: [{ x: event.clientX, time: event.timeStamp }],
    };
    setPhase('pending');
  }, [adapter, currentCfiRef, disabled, enterBasic, setPhase]);

  const handlePointerMove = useCallback((event) => {
    const pointer = pointerRef.current;
    if (!pointer || event.pointerId !== pointer.pointerId || pointer.pointerType !== 'touch') return;
    const dx = event.clientX - pointer.startX;
    const dy = event.clientY - pointer.startY;
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
    pointer.samples.push({ x: event.clientX, time: event.timeStamp });
    if (pointer.samples.length > 12) pointer.samples.shift();

    if (!pointer.locked) {
      const lock = classifyDirection(dx, dy);
      if (lock === 'pending') return;
      if (lock === 'vertical') {
        adapter?.cancel({ restoreOrigin: true });
        finishPointer();
        restoreReadyPhase();
        return;
      }
      pointer.locked = 'horizontal';
      if (pointer.mode === 'enhanced') {
        const nextDirection = dx < 0 ? 'next' : 'prev';
        setDirection(nextDirection);
        setPhase('dragging');
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
          pointer.captured = true;
        } catch {
          pointer.captured = false;
        }
      }
    }

    if (pointer.locked === 'horizontal') {
      if (event.cancelable) event.preventDefault();
      if (pointer.mode === 'enhanced') queueDragFrame(dx);
    }
  }, [adapter, finishPointer, queueDragFrame, restoreReadyPhase, setPhase]);

  const handlePointerUp = useCallback((event) => {
    const pointer = pointerRef.current;
    if (!pointer || event.pointerId !== pointer.pointerId) return;
    const dx = event.clientX - pointer.startX;
    const dy = event.clientY - pointer.startY;
    pointer.samples.push({ x: event.clientX, time: event.timeStamp });

    const settle = async () => {
      if (pointer.pointerType !== 'touch' || !pointer.locked) {
        adapter?.cancel({ restoreOrigin: true });
        finishPointer();
        restoreReadyPhase();
        if (Math.max(Math.abs(dx), Math.abs(dy)) >= PAGE_TURN_RULES.directionLockPx) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const zone = getTapZone(event.clientX, rect.left, rect.width);
        if (zone === 'center') onCenterTap?.();
        else await turnPage(zone);
        return;
      }

      if (pointer.locked !== 'horizontal') {
        cancelPageTurn('vertical');
        return;
      }

      clearDragFrame();
      const dragResult = pointer.mode === 'enhanced'
        ? writeDragFrame(dx)
        : {
            effectiveDistanceX: dx,
            progress: pointer.session ? Math.abs(dx) / pointer.session.pageWidth : 0,
          };
      const velocityX = getRecentVelocity(pointer.samples);
      const width = pointer.session?.pageWidth ||
        adapter?.inspect?.().pageWidth ||
        event.currentTarget.getBoundingClientRect().width;
      const delta = decidePageDelta({
        distanceX: dx,
        velocityX,
        pageWidth: width,
      });
      const nextDirection = delta === 1
        ? 'next'
        : delta === -1
          ? 'prev'
          : dx < 0
            ? 'next'
            : 'prev';
      finishPointer();

      if (pointer.mode !== 'enhanced') {
        restoreReadyPhase();
        if (delta) await turnPage(nextDirection);
        return;
      }

      setPhase('settling');
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
        adapter.end();
        restoreReadyPhase();
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
        adapter.end();
        const location = await readCurrentLocation(renditionRef.current).catch(() => null);
        if (!isBoundary(location, nextDirection)) {
          await runBasicNavigation(nextDirection);
        }
        restoreReadyPhase();
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
      const location = animation.status === 'completed' ? await waiter.promise : null;
      if (!location || !adapter.isStableAt(delta)) {
        waiter.cancel();
        await adapter.recover();
        enterBasic();
      } else {
        adapter.end();
      }
      relocationWaitRef.current = null;
      restoreReadyPhase();
    };

    void settle();
  }, [
    adapter,
    cancelPageTurn,
    clearDragFrame,
    enterBasic,
    finishPointer,
    onCenterTap,
    renditionRef,
    restoreReadyPhase,
    runBasicNavigation,
    setPhase,
    turnPage,
    writeDragFrame,
    writeEdgeProgress,
  ]);

  const handlePointerCancel = useCallback((event) => {
    if (pointerRef.current?.pointerId !== event.pointerId) return;
    cancelPageTurn('pointercancel');
  }, [cancelPageTurn]);
~~~

Return the complete interface:

~~~js
  return {
    cancelPageTurn,
    direction,
    handlePointerCancel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    phase,
    turnPage,
  };
~~~

- [ ] Step 6: Re-run the same directed test and commit

Run: npm test --prefix client -- usePageTurnController.test.jsx

Expected: exit code 0; navigation tests plus horizontal lock, distance, velocity, rollback and cleanup cases pass.

Commit:

~~~powershell
git add client/src/hooks/usePageTurnController.js client/src/hooks/usePageTurnController.test.jsx
git commit -m "feat: add touch-following page turns"
~~~

#### Done Criteria

- touch 在 10px 前 pending，横向比例不达 1.2 时退出并交还纵向滚动。
- dragging 每个 animation frame 最多调用一次 adapter.dragBy；React 不在 pointermove 每帧 setState。
- 距离、速度和回弹三种代表场景准确；结果仍限 -1/0/1。
- 鼠标拖动不跟手；primary touch 以外输入不启动。
- settling 忽略新输入；pointercancel/resize/orientationchange/hidden/unmount 清理 rAF、capture、waiter 和 adapter session。
- 相邻未就绪先回原点，再在非书籍边界 basic 一次。

#### Verification

Run: npm test --prefix client -- usePageTurnController.test.jsx

Expected: exit code 0; controller navigation and gesture tests pass.

#### Regression Scope

- 轻点仍按三区处理，拖动不会误触 center chrome。
- reduced motion/basic 不在 move 中写 scroller。
- 首尾页只回弹，不重复调用 next/prev。
- 生命周期取消后下一次输入可用。

#### Out of Scope

- CSS 视觉细节和 ReaderView wiring；Task 3 处理。
- 多指缩放、鼠标/触控板跟手和惯性。
- 重新设计阈值。

### Task 3：接入 ReaderView、设置重排与柔和页缘

Estimated effort: 75–90 minutes

#### Goal

ReaderView 不再维护旧 out/in/sheet 时序，只把点按/pointer/键盘交给 controller；真实正文由 scroller 移动，单个窄页缘在 dragging/settling 显示，设置、目录、关闭和面板行为保持。

#### Existing Behavior

ReaderView 包含 SWIPE_THRESHOLD、两个 80ms 时长、animatingRef、pointerRef、pageTurn/pageTurnSheetRef 和动画等待函数。触摸媒体查询固定不移动 iframe，只移动全屏主题色 sheet。

#### Required Change

删除旧状态和 CSS；消费 pageTurnAdapter；绑定四个 pointer handlers；键盘调用 turnPage；关闭/目录跳转/设置重排先 cancel；始终渲染一个 aria-hidden 页缘；只在 dragging/settling 添加 will-change；reduced motion 隐藏页缘且 controller basic。

#### Files

- Modify: client/src/components/reader/ReaderView.jsx
- Modify: client/src/components/reader/ReaderView.test.jsx
- Modify: client/src/hooks/useReaderSettings.js
- Modify: client/src/styles/reader.css
- Reference: client/src/hooks/usePageTurnController.js
- Reference: client/src/hooks/useEpubRendition.js

#### Interfaces

- Consumes: useEpubRendition.pageTurnAdapter；usePageTurnController 完整接口。
- Produces:
  - ReaderView gesture layer 绑定 onPointerDown/Move/Up/Cancel。
  - overlay classes reader-page-turn-pending/dragging/settling/basic。
  - CSS variables --reader-page-turn-progress 和 --reader-page-turn-edge-offset。
  - useReaderSettings 新可选 beforeRenditionMutation():void。
- 后续浏览器脚本依赖 .reader-page-edge、阶段 classes、旧 .reader-page-turn-sheet 不存在。

#### Implementation Steps

- [ ] Step 1: Update ReaderView tests to assert controller wiring and preserved close/keyboard behavior

In client/src/components/reader/ReaderView.test.jsx add the hoisted controller mocks:

~~~jsx
cancelPageTurn: vi.fn(),
handlePointerCancel: vi.fn(),
handlePointerDown: vi.fn(),
handlePointerMove: vi.fn(),
handlePointerUp: vi.fn(),
turnPage: vi.fn(),
usePageTurnController: vi.fn(),
~~~

Add the module mock:

~~~jsx
vi.mock('../../hooks/usePageTurnController.js', () => ({
  usePageTurnController: mocks.usePageTurnController,
}));
~~~

In beforeEach:

~~~js
mocks.cancelPageTurn.mockClear();
mocks.handlePointerCancel.mockClear();
mocks.handlePointerDown.mockClear();
mocks.handlePointerMove.mockClear();
mocks.handlePointerUp.mockClear();
mocks.turnPage.mockClear();
mocks.usePageTurnController.mockReset().mockReturnValue({
  cancelPageTurn: mocks.cancelPageTurn,
  direction: 'next',
  handlePointerCancel: mocks.handlePointerCancel,
  handlePointerDown: mocks.handlePointerDown,
  handlePointerMove: mocks.handlePointerMove,
  handlePointerUp: mocks.handlePointerUp,
  phase: 'idle',
  turnPage: mocks.turnPage,
});
mocks.useEpubRendition.mockReturnValue({
  currentHref: null,
  pageTurnAdapter: { name: 'adapter' },
  progress: 0,
  toc: [],
});
~~~

Replace the obsolete direct-rendition navigation test with:

~~~jsx
it('routes keyboard and pointer input through the page-turn controller', async () => {
  render(<ReaderView book={{ id: 1, title: 'Book' }} onClose={mocks.onClose} />);
  const gestureLayer = document.querySelector('.reader-gesture-layer');
  expect(gestureLayer).not.toBeNull();

  fireEvent.pointerDown(gestureLayer, {
    clientX: 300, clientY: 300, pointerId: 1, pointerType: 'touch',
  });
  fireEvent.pointerMove(gestureLayer, {
    clientX: 200, clientY: 300, pointerId: 1, pointerType: 'touch',
  });
  fireEvent.pointerUp(gestureLayer, {
    clientX: 180, clientY: 300, pointerId: 1, pointerType: 'touch',
  });
  fireEvent.pointerCancel(gestureLayer, {
    pointerId: 1, pointerType: 'touch',
  });
  fireEvent.keyDown(window, { key: 'ArrowRight' });

  expect(mocks.handlePointerDown).toHaveBeenCalledTimes(1);
  expect(mocks.handlePointerMove).toHaveBeenCalledTimes(1);
  expect(mocks.handlePointerUp).toHaveBeenCalledTimes(1);
  expect(mocks.handlePointerCancel).toHaveBeenCalledTimes(1);
  expect(mocks.turnPage).toHaveBeenCalledWith('next');
  expect(document.querySelector('.reader-page-turn-sheet')).toBeNull();
  expect(document.querySelectorAll('.reader-page-edge')).toHaveLength(1);
});
~~~

Keep the existing outbox/close test and add:

~~~jsx
expect(mocks.cancelPageTurn).toHaveBeenCalled();
~~~

after clicking the close button.

- [ ] Step 2: Run the directed component test and confirm old wiring fails

Run: npm test --prefix client -- ReaderView.test.jsx

Expected: exit code 1 because the controller is not called, pointermove/cancel are unbound, and the old sheet can still render.

- [ ] Step 3: Replace ReaderView's old page-turn ownership with controller composition

Add the import:

~~~js
import { usePageTurnController } from '../../hooks/usePageTurnController.js';
~~~

Delete SWIPE_THRESHOLD, PAGE_SLIDE_OUT_MS, PAGE_SLIDE_IN_MS, waitForNextPaint, waitForPageTurnAnimation, waitForRelocated, getCurrentLocation, isAtPageBoundary, schedulePageTurnFollowUp, pointerRef, animatingRef, pageTurnSheetRef and pageTurn state. Keep PAGE_NAV_TIMEOUT_MS deleted because the controller owns 1200ms.

Add refs and a stable pre-mutation callback beside existing refs:

~~~js
const pageEdgeRef = useRef(null);
const cancelPageTurnRef = useRef(null);
const cancelBeforeRenditionMutation = useCallback(() => {
  cancelPageTurnRef.current?.('settings');
}, []);
~~~

Pass this option to useReaderSettings:

~~~js
beforeRenditionMutation: cancelBeforeRenditionMutation,
~~~

Destructure pageTurnAdapter from useEpubRendition:

~~~js
const {
  currentHref,
  pageTurnAdapter,
  progress,
  toc,
} = useEpubRendition({
  applyReaderHorizontalMargin,
  applyReaderSettings,
  applyReaderSettingsToContents,
  book,
  bookRef,
  containerRef,
  currentCfiRef,
  enqueueProgress,
  error,
  flushPendingReaderSettings,
  isClosingRef,
  isLoading,
  loadReaderSettings,
  markReaderSettingsLoaded,
  readerSettingsRef,
  renditionRef,
  resetPageProgress,
  resetReaderSettingsLoad,
  setError,
  setIsLoading,
  updatePageProgressFromLocation,
});
~~~

Add a stable center callback and controller composition immediately after useEpubRendition:

~~~js
const handleCenterTap = useCallback(() => {
  setChromeVisible((visible) => {
    if (visible) setActivePanel(null);
    return !visible;
  });
}, []);

const {
  cancelPageTurn,
  direction: pageTurnDirection,
  handlePointerCancel,
  handlePointerDown,
  handlePointerMove,
  handlePointerUp,
  phase: pageTurnPhase,
  turnPage,
} = usePageTurnController({
  adapter: pageTurnAdapter,
  currentCfiRef,
  disabled: Boolean(activePanel) || isLoading || Boolean(error),
  edgeRef: pageEdgeRef,
  onCenterTap: handleCenterTap,
  reducedMotion,
  renditionRef,
});

useEffect(() => {
  cancelPageTurnRef.current = cancelPageTurn;
  return () => {
    if (cancelPageTurnRef.current === cancelPageTurn) {
      cancelPageTurnRef.current = null;
    }
  };
}, [cancelPageTurn]);
~~~

At the first line of handleCloseClick add:

~~~js
cancelPageTurnRef.current?.('close');
~~~

Replace goPrev/goNext and keep the current keyboard filtering:

~~~js
const goPrev = useCallback(() => turnPage('prev'), [turnPage]);
const goNext = useCallback(() => turnPage('next'), [turnPage]);
~~~

At the start of goToHref add:

~~~js
cancelPageTurnRef.current?.('toc');
~~~

Delete the local handlePointerDown/handlePointerUp implementations.

Build overlay classes with:

~~~js
pageTurnPhase ? 'reader-page-turn-' + pageTurnPhase : '',
pageTurnDirection ? 'reader-page-turn-direction-' + pageTurnDirection : '',
~~~

Render the EPUB container without reader-page-slide classes, remove the conditional sheet, and render one page edge:

~~~jsx
<div
  ref={containerRef}
  className="reader-epub-container"
  style={readerViewportStyle}
/>
<div
  ref={pageEdgeRef}
  className={[
    'reader-page-edge',
    pageTurnDirection ? 'reader-page-edge-' + pageTurnDirection : '',
  ].filter(Boolean).join(' ')}
  aria-hidden="true"
/>
~~~

Bind the gesture layer:

~~~jsx
<div
  className="reader-gesture-layer"
  onPointerCancel={handlePointerCancel}
  onPointerDown={handlePointerDown}
  onPointerMove={handlePointerMove}
  onPointerUp={handlePointerUp}
  aria-hidden="true"
/>
~~~

- [ ] Step 4: Cancel active motion before settings mutate rendition

Add beforeRenditionMutation to the useReaderSettings parameter list. In both effects that begin with if (!isReaderReady), call it immediately before applyReaderSettings or applyReaderHorizontalMargin:

~~~js
beforeRenditionMutation?.();
~~~

Add beforeRenditionMutation to those effect dependency arrays. Do not call it from storage-only save effects.

- [ ] Step 5: Replace the old slide/sheet CSS with the single edge

In client/src/styles/reader.css add the page-edge variables to .reader-overlay and lower contrast in dark theme:

~~~css
--reader-page-edge-line: rgba(0, 0, 0, 0.12);
--reader-page-edge-shadow: rgba(0, 0, 0, 0.16);
--reader-page-turn-progress: 0;
--reader-page-turn-edge-offset: 0px;
~~~

~~~css
.reader-theme-dark {
  --reader-page-edge-line: rgba(255, 255, 255, 0.06);
  --reader-page-edge-shadow: rgba(0, 0, 0, 0.24);
}
~~~

Replace the block from .reader-epub-container through the old touch media query with:

~~~css
.reader-epub-container {
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow: hidden;
  background: var(--reader-bg);
  contain: layout paint;
}

.reader-epub-container iframe {
  display: block;
  width: 100% !important;
  height: 100% !important;
  border: 0;
}

.reader-page-edge {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 2;
  width: 14px;
  opacity: 0;
  pointer-events: none;
  transform: translate3d(var(--reader-page-turn-edge-offset), 0, 0);
}

.reader-page-edge::before {
  content: "";
  position: absolute;
  inset: 0;
  border-left: 1px solid var(--reader-page-edge-line);
  background: linear-gradient(
    to right,
    var(--reader-page-edge-shadow),
    transparent 75%
  );
}

.reader-page-edge-prev::before {
  border-left: 0;
  border-right: 1px solid var(--reader-page-edge-line);
  background: linear-gradient(
    to left,
    var(--reader-page-edge-shadow),
    transparent 75%
  );
}

.reader-page-turn-dragging .reader-page-edge,
.reader-page-turn-settling .reader-page-edge {
  opacity: 1;
  will-change: transform;
}

@media (prefers-reduced-motion: reduce) {
  .reader-page-edge {
    display: none;
  }
}
~~~

Keep .reader-gesture-layer at z-index 2 and touch-action: pan-y. Delete every reader-page-slide-*, reader-page-turn-sheet-* and reader-page-sheet/page-slide keyframe selector.

- [ ] Step 6: Re-run the same component test and build

Run:

~~~powershell
npm test --prefix client -- ReaderView.test.jsx
npm run build --prefix client
~~~

Expected: both exit 0; ReaderView test confirms controller routing, one edge, no sheet, close cancellation and preserved outbox composition.

- [ ] Step 7: Commit ReaderView and visual integration

~~~powershell
git add client/src/components/reader/ReaderView.jsx client/src/components/reader/ReaderView.test.jsx client/src/hooks/useReaderSettings.js client/src/styles/reader.css
git commit -m "feat: integrate hybrid reader page turns"
~~~

#### Done Criteria

- ReaderView 不再拥有旧翻页时序或读取 epub.js 内部对象。
- gesture layer 是唯一应用输入面，四个 pointer 事件和键盘都进入 controller。
- 旧纯色 sheet、容器 out/in keyframes 和触摸 override 全部删除。
- 页缘只有一个，窄渐变/小阴影，不改变正文 opacity，不用 3D/filter/backdrop-filter。
- will-change 只在 dragging/settling；reduced motion 页缘不显示。
- 设置、目录和关闭先取消活动手势；组件测试和 build 通过。

#### Verification

Run:

~~~powershell
npm test --prefix client -- ReaderView.test.jsx
npm run build --prefix client
~~~

Expected: both exit 0.

#### Regression Scope

- 中间点按显隐 chrome，隐藏时关闭面板。
- 编辑控件/面板打开时方向键和 gesture 不翻页。
- 页码常显，top/bottom bar 和 panel z-index 不被页缘覆盖。
- 四种主题与当前/相邻 iframe 的排版重套保持。
- reduced motion 关闭/阅读器 modal 的前置 accessibility 行为保持。

#### Out of Scope

- 重构 ReaderView 其余 FLIP、panel 或进度组合代码。
- 新增设置项、主题或视觉系统。
- 修改书架/文件夹 CSS。

### Task 4：增加隔离 Playwright 验证并更新项目双路径约定

Estimated effort: 60–90 minutes

#### Goal

用现有隔离环境验证真实 scroller 在触摸中连续变化、达标一页、未达标回弹、快速轻扫和 reduced motion；CI 提供单一命令；PROJECT.md 不再保留冲突约定。

#### Existing Behavior

verify-reader-mobile 只验证设置面板；package.json/quality.yml 没有 page-turn 命令。PROJECT.md 仍写 next/prev 是唯一真实翻页方式。

#### Required Change

新增 verify:reader-page-turn，不创建第二个环境管理器；使用 CDP touch events 产生真实 touch pointer；只选择四个代表场景；更新 CI mobile job；以增强/basic 互斥规则替换旧项目文字。

#### Files

- Create: client/scripts/verify-reader-page-turn.mjs
- Modify: client/package.json
- Modify: .github/workflows/quality.yml
- Modify: PROJECT.md
- Reference: client/scripts/reader-verification-environment.mjs
- Reference: client/scripts/verify-reader-progress.mjs

#### Interfaces

- Consumes: prepareReaderVerification()；Playwright chromium；.reader-gesture-layer/.reader-page-edge/阶段 classes。
- Produces:
  - npm run verify:reader-page-turn。
  - JSON 输出 normalPage、rollbackPage、fastSwipePage、reducedMotionPage、sheetRemoved。
  - CI mobile job 新增一个明确步骤。
  - PROJECT.md 双导航路径规范。

#### Implementation Steps

- [ ] Step 1: Create the browser verification script before adding its package command

Create client/scripts/verify-reader-page-turn.mjs:

~~~js
import { chromium } from 'playwright';
import { prepareReaderVerification } from './reader-verification-environment.mjs';

const environment = await prepareReaderVerification();
let browser;

function parsePageLabel(label) {
  const match = String(label).trim().match(/^(\d+)\/(\d+)$/);
  if (!match) throw new Error('Invalid page label: ' + label);
  return { current: Number(match[1]), total: Number(match[2]) };
}

async function openReader(context) {
  const page = await context.newPage();
  await page.goto(environment.appUrl, { waitUntil: 'networkidle', timeout: 30000 });
  const book = page.locator(
    '.continue-book-button[data-book-id], button.book-shell[data-book-id]',
  ).first();
  await book.waitFor({ timeout: 10000 });
  await book.tap();
  await page.waitForSelector('.reader-gesture-layer', { timeout: 15000 });
  await page.waitForFunction(() => {
    const label = document.querySelector('.reader-page-progress')?.textContent?.trim();
    const container = document.querySelector('.reader-epub-container');
    return Boolean(label && label !== '--/--' && container?.querySelector('iframe'));
  });
  return page;
}

async function label(page) {
  return parsePageLabel(await page.locator('.reader-page-progress').textContent());
}

async function readScroll(page) {
  return page.evaluate(() => {
    const container = document.querySelector('.reader-epub-container');
    const candidates = [...container.querySelectorAll('*')];
    const scroller = candidates.find((element) => {
      const overflowX = getComputedStyle(element).overflowX;
      return element.scrollWidth > element.clientWidth + 1 &&
        (overflowX === 'auto' || overflowX === 'scroll');
    });
    if (!scroller) throw new Error('epub.js horizontal scroller not found');
    return {
      left: scroller.scrollLeft,
      sheetRemoved: !document.querySelector('.reader-page-turn-sheet'),
      edgeOpacity: Number(getComputedStyle(
        document.querySelector('.reader-page-edge'),
      ).opacity),
    };
  });
}

async function waitSettled(page) {
  await page.waitForFunction(() => {
    const overlay = document.querySelector('.reader-overlay');
    return overlay &&
      !overlay.classList.contains('reader-page-turn-pending') &&
      !overlay.classList.contains('reader-page-turn-dragging') &&
      !overlay.classList.contains('reader-page-turn-settling');
  }, undefined, { timeout: 5000 });
}

async function touch(session, type, x, y) {
  await session.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{
      id: 1,
      x,
      y,
      radiusX: 2,
      radiusY: 2,
      force: 1,
    }],
  });
}

async function drag(page, { fromX, toX, holdMs = 0, y = 330, inspectMid = false }) {
  const session = await page.context().newCDPSession(page);
  await touch(session, 'touchStart', fromX, y);
  await touch(session, 'touchMove', toX, y);
  if (holdMs) await page.waitForTimeout(holdMs);
  const mid = inspectMid ? await readScroll(page) : null;
  await touch(session, 'touchEnd', toX, y);
  await session.detach();
  await waitSettled(page);
  return mid;
}

try {
  browser = await chromium.launch(environment.browserOptions);
  const context = await browser.newContext({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await openReader(context);
  const initialPage = await label(page);
  const initialScroll = await readScroll(page);

  const normalMid = await drag(page, {
    fromX: 330,
    toX: 190,
    inspectMid: true,
  });
  const normalPage = await label(page);
  if (
    normalMid.left === initialScroll.left ||
    normalMid.edgeOpacity === 0 ||
    normalPage.current !== initialPage.current + 1 ||
    !normalMid.sheetRemoved
  ) {
    throw new Error('Normal drag failed: ' + JSON.stringify({
      initialPage, initialScroll, normalMid, normalPage,
    }));
  }

  const rollbackStart = await label(page);
  const rollbackScroll = await readScroll(page);
  const rollbackMid = await drag(page, {
    fromX: 300,
    toX: 265,
    holdMs: 180,
    inspectMid: true,
  });
  const rollbackPage = await label(page);
  const rollbackEnd = await readScroll(page);
  if (
    rollbackMid.left === rollbackScroll.left ||
    rollbackPage.current !== rollbackStart.current ||
    Math.abs(rollbackEnd.left - rollbackScroll.left) > 1
  ) {
    throw new Error('Rollback failed: ' + JSON.stringify({
      rollbackStart, rollbackScroll, rollbackMid, rollbackPage, rollbackEnd,
    }));
  }

  const fastStart = await label(page);
  await drag(page, { fromX: 300, toX: 250, holdMs: 20 });
  const fastSwipePage = await label(page);
  if (fastSwipePage.current !== fastStart.current + 1) {
    throw new Error('Fast swipe failed: ' + JSON.stringify({
      fastStart, fastSwipePage,
    }));
  }
  await context.close();

  const reducedContext = await browser.newContext({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  const reducedPage = await openReader(reducedContext);
  const reducedStart = await label(reducedPage);
  const reducedScroll = await readScroll(reducedPage);
  const reducedMid = await drag(reducedPage, {
    fromX: 330,
    toX: 190,
    inspectMid: true,
  });
  const reducedMotionPage = await label(reducedPage);
  if (
    reducedMid.left !== reducedScroll.left ||
    reducedMid.edgeOpacity !== 0 ||
    reducedMotionPage.current !== reducedStart.current + 1
  ) {
    throw new Error('Reduced motion failed: ' + JSON.stringify({
      reducedStart, reducedScroll, reducedMid, reducedMotionPage,
    }));
  }
  await reducedContext.close();

  console.log(JSON.stringify({
    normalPage,
    rollbackPage,
    fastSwipePage,
    reducedMotionPage,
    sheetRemoved: normalMid.sheetRemoved,
  }, null, 2));
} finally {
  try {
    await browser?.close();
  } finally {
    await environment.cleanup();
  }
}
~~~

- [ ] Step 2: Add the package command

Add to client/package.json scripts:

~~~json
"verify:reader-page-turn": "node scripts/verify-reader-page-turn.mjs"
~~~

Do not run it yet; Steps 3–4 only register the already written acceptance test and update the confirmed project convention. Step 5 is this Task's single verification run.

- [ ] Step 3: Add the existing command to the mobile CI job

After verify:reader-mobile in .github/workflows/quality.yml add:

~~~yaml
      - run: npm run verify:reader-page-turn
        working-directory: client
~~~

Do not add a new workflow, browser install, server process manager or artifact upload.

- [ ] Step 4: Replace the stale project convention with the confirmed dual-path rule

In PROJECT.md under 阅读器控制层约定 replace the old page-turn bullet with:

~~~markdown
- 阅读器固定使用混合平移翻页且不提供用户切换：左右点按和桌面方向键自动滑动一页，触摸横向拖动显示真实正文并跟手。
- 增强路径只由 continuous manager 的 scroller 对齐到相邻一个页宽完成，落页后不得再调用 next/prev；基础降级路径不直接移动内部 scroller，只调用一次 rendition.next/prev。同一次操作不能混用两条路径。
- epub.js manager、scroller、layout、RTL scroll type 和 Snap 私有对象只允许由 client/src/utils/epubPageTurnAdapter.js 读取；能力失败时保持基础翻页可用。
~~~

After the existing reader interaction checklist item add:

~~~markdown
- [x] 优化阅读器混合翻页：点按/键盘真实正文自动滑页，触摸拖动跟手、阈值落页或回弹，异常时降级为单次基础翻页
~~~

- [ ] Step 5: Run the one browser verification

Run: npm run verify:reader-page-turn --prefix client

Expected: exit code 0；JSON 中 sheetRemoved=true，normal/fast 各只前进一页，rollback 页不变，reduced motion 中间 scroller 不动但最终前进一页。

- [ ] Step 6: Commit browser coverage and project convention

~~~powershell
git add client/scripts/verify-reader-page-turn.mjs client/package.json .github/workflows/quality.yml PROJECT.md
git commit -m "test: verify hybrid reader page turns"
~~~

#### Done Criteria

- 隔离脚本无需 APP_URL 即可启动临时服务；提供 APP_URL 时仍可复用外部环境。
- 浏览器代表性覆盖真实跟手、一次完成、回弹、快扫和 reduced motion。
- CI 只增加一个已有环境内的命令。
- PROJECT.md 准确描述 enhanced/basic 互斥与单一私有边界。
- browser verification 通过。

#### Verification

Run: npm run verify:reader-page-turn --prefix client

Expected: exit code 0 and the described JSON fields.

#### Regression Scope

- Fixture、临时 data root、子进程和清理继续复用 reader-verification-environment。
- 不覆盖现有 reader settings/progress/accessibility 脚本。
- 页面 label 每个完成手势只改变一页，回弹不变。

#### Out of Scope

- 在 CI 模拟章节边界、所有主题或 50 页性能。
- 截图金丝雀、GPU tracing 和跨浏览器矩阵。
- 修改 README 部署说明。

### Task 5：使用浏览器移动视口完成登录确认

Estimated effort: 15–30 minutes

#### Goal

在浏览器中启用手机移动视口，打开可访问的应用页面并完成一次登录，确认登录后页面能够在移动布局中正常显示。真实设备翻页验收由用户在本计划完成后手动执行。

#### Existing Behavior

Task 4 已覆盖真实 scroller、触摸输入、回弹、快速轻扫和 reduced motion，但尚未单独确认移动视口下的登录和登录后页面可达性。

#### Required Change

不改实现；只在浏览器移动视口中完成一次登录并确认进入登录后的应用页面。不执行实机翻页清单，不创建实机通过记录，也不把目标设备可用性作为完成条件。

#### Files

- Reference: docs/superpowers/specs/2026-07-16-reader-page-turn-interaction-design.md
- Reference: client/scripts/verify-reader-page-turn.mjs
- No files are created or modified by this Task.

#### Interfaces

- Consumes: 可访问的应用 URL；浏览器移动视口；已有授权会话或用户提供的登录方式。
- Produces: 当前 Task 报告中的一次移动视口登录结果。
- 不产生公共 API、配置、迁移、运行时行为或验收记录文件变化。

#### Implementation Steps

- [ ] Step 1: Open the application in a mobile browser viewport

在浏览器中启用手机移动视口和触摸模拟，使用一个代表性手机尺寸打开应用登录页面。不得修改前端代码、浏览器存储或服务端数据来绕过登录。

- [ ] Step 2: Complete one authorized login

使用已有授权会话或用户提供的登录方式完成一次登录。不得读取、导出或记录密码、cookie、token 或其他认证秘密。

- [ ] Step 3: Confirm the post-login mobile page

确认登录后进入预期应用页面，页面主内容在移动视口中可见且没有被登录遮罩或错误页阻断。本 Step 不执行翻页性能、长时间 iframe、PWA 生命周期或真实设备视觉验收。

- [ ] Step 4: Report the result and stop

报告所用移动视口、登录是否成功和登录后的可见页面；不创建验收 Markdown，不提交代码，并立即结束当前 Task。

#### Done Criteria

- 浏览器已启用代表性手机移动视口和触摸模拟。
- 已完成一次授权登录并进入预期登录后页面。
- 没有修改代码、配置、认证数据或创建实机验收记录。

#### Verification

Manual browser procedure: 在手机移动视口打开应用，完成一次授权登录，并确认登录后的应用主页面可见。

Expected: 登录成功；登录遮罩或登录页消失；预期应用页面在移动视口中可见。

#### Regression Scope

- 仅覆盖移动视口下的登录入口、登录完成和登录后页面可达性。
- 不从本次浏览器确认推断真实设备翻页、GPU 合成、PWA 生命周期或 iframe trim 已通过。

#### Out of Scope

- iPhone 14 Pro Max 与联想小新 Pro GT 的真实设备验收；由用户在本计划完成后手动执行。
- 连续翻页 50 页、半页跟手、慢拖回弹、快速轻扫、章节/首尾边界、四主题、全部排版设置、后台/旋转/目录/重开和 iframe trim 的实机确认。
- 未知低端设备、正式 FPS 数值门槛、功耗、内存 profiler 和网络性能。

## Post-plan Manual Device Acceptance

以下验收由用户在本计划完成后手动执行，不属于 Task 5 Done Criteria，也不阻塞 Phase B 完成：

- iPhone 14 Pro Max：在 Safari/PWA 中检查连续 50 页、半页跟手、慢拖回弹、快速轻扫、章节/首尾边界、四主题、全部排版设置、后台/旋转/目录/重开和 iframe trim。
- 联想小新 Pro GT（骁龙 8 Gen 3、8GB）：在 Chrome/PWA 中执行同一清单。
- 若发现 P0/P1，回到拥有该行为的原 Task；P2/P3 记入后续 Backlog。

## Phase B and Feature Final Verification

全部五个 Task 完成后只执行一次有限计划级验证：

1. Build once

   Run: npm run build --prefix client

   Expected: exit code 0。

2. Run the directly related test set once

   Run:

   ~~~powershell
   npm test --prefix client -- pageTurnGesture.test.js epubPageTurnAdapter.test.js usePageTurnController.test.jsx useEpubRendition.test.jsx ReaderView.test.jsx
   ~~~

   Expected: exit code 0；只包含翻页规则、适配、controller、rendition 和 ReaderView。

3. Run the page-turn browser acceptance once

   Run: npm run verify:reader-page-turn --prefix client

   Expected: exit code 0；normal/fast 一页、rollback 不变、reduced motion 无中间移动、sheetRemoved=true。

4. Specification compliance check once

   逐条核对设计验收：真实正文跟手；点按/键盘/拖动最多一页；回弹/取消/首尾稳定；CFI/页码/章节/百分比/重开正确；相邻 view 主题排版一致；能力失败 basic；reduced motion basic；浏览器移动视口登录成功并进入预期页面。

5. Preserved behavior check once

   只检查：中间点按、编辑控件/面板键盘过滤、目录、Aa 设置、页码常显、关闭/重开、PWA 前后台和 outbox 测试没有明显回归。

6. Severity and stop rule

   - 只处理 P0：无法编译、无法启动、数据损坏风险。
   - 只处理 P1：明确违反设计或验收标准。
   - P2/P3 全部进入 Backlog。
   - 修复 P0/P1 后只重新运行上述原命令或 Task 5 的原移动视口登录步骤。
   - 不启动第二轮开放式质量审查。
   - build、相关 tests、page-turn browser、规格和移动视口登录验收满足后立即宣布计划完成；用户后续实机验收不阻塞本计划完成。

## Plan Text Self-Check

- [x] 设计中的自动滑页、触摸跟手、阈值/速度、回弹、边界、超时、生命周期、页缘、reduced motion、Playwright 和移动视口登录均有 owning Task；两台实机验收已明确为用户后续手动执行。
- [x] 没有重新讨论产品方案，也没有加入服务端、依赖升级、设置项或无关重构。
- [x] 前四个实现 Task 均为 60–90 分钟；Task 5 为 15–30 分钟的浏览器移动视口登录确认，并能在 Task 边界停止。
- [x] 每个 Task 均包含用户要求的十个结构段落和有限验证。
- [x] enhanced/basic 互斥、旧 PROJECT 冲突、前置 remediation/Phase A 和移动视口登录 Blocker 已明确；实机验收不阻塞本计划完成。
- [x] 鼠标/触控板、reverse RTL、低端设备与正式 telemetry 已放入 Out of Scope/Backlog。
