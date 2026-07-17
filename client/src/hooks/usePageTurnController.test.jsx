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
    dragBy: vi.fn((distanceX) => ({
      boundary: false,
      direction: distanceX < 0 ? 'next' : 'prev',
      effectiveDistanceX: distanceX,
      progress: Math.min(1, Math.abs(distanceX) / 100),
    })),
    end: vi.fn(),
    inspect: vi.fn(() => ({ available: true })),
    isStableAt: vi.fn(() => stableAtTarget),
    recover: vi.fn().mockResolvedValue(true),
  };

  return {
    adapter,
    currentCfiRef: { current: 'stable-cfi' },
    edgeRef: { current: document.createElement('div') },
    handlers,
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
      await result.current.turnPage('next', {
        action: 'tap-next',
        inputTime: 75,
      });
    });

    expect(harness.adapter.begin).toHaveBeenCalledWith(
      'stable-cfi',
      expect.objectContaining({
        action: 'tap-next',
        edgeElement: harness.edgeRef.current,
        inputTime: 75,
      }),
    );
    expect(harness.adapter.animateTo).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        action: 'tap-next',
        duration: 180,
        inputTime: 75,
      }),
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

  it('recovers immediately when enhanced navigation becomes unavailable', async () => {
    const harness = createHarness();
    harness.adapter.animateTo.mockResolvedValue({ status: 'unavailable' });
    const { result } = renderHook(() => usePageTurnController(harness));
    await waitFor(() => expect(result.current.phase).toBe('idle'));

    let outcome;
    await act(async () => {
      outcome = await result.current.turnPage('next');
    });

    expect(outcome).toBe('failed');
    expect(harness.adapter.recover).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('basic');
  });
});

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

async function startEnhancedTouch(result, { endX = 180 } = {}) {
  const start = pointerEvent({ clientX: 300, timeStamp: 0 });
  const move = pointerEvent({ clientX: endX, timeStamp: 250 });
  act(() => result.current.handlePointerDown(start));
  act(() => result.current.handlePointerMove(move));
  await act(async () => { await new Promise(requestAnimationFrame); });
  act(() => result.current.handlePointerUp(move));
  return { move, start };
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
    expect.objectContaining({
      action: expectedDelta === 0 ? 'rollback' : 'commit',
      duration: expect.any(Number),
      inputTime: moveTime,
    }),
  );
  expect(harness.adapter.begin).toHaveBeenCalledWith(
    'stable-cfi',
    expect.objectContaining({
      action: 'drag',
      edgeElement: harness.edgeRef.current,
      inputTime: 0,
    }),
  );
});

it('uses the pointer-up timestamp for tap navigation', async () => {
  const harness = createHarness();
  const { result } = renderHook(() => usePageTurnController(harness));
  await waitFor(() => expect(result.current.phase).toBe('idle'));

  const down = pointerEvent({
    clientX: 350,
    pointerType: 'mouse',
    timeStamp: 40,
  });
  const up = pointerEvent({
    clientX: 350,
    pointerType: 'mouse',
    timeStamp: 75,
  });
  act(() => result.current.handlePointerDown(down));
  await act(async () => {
    result.current.handlePointerUp(up);
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(harness.adapter.begin).toHaveBeenCalledWith(
    'stable-cfi',
    expect.objectContaining({
      action: 'tap-next',
      edgeElement: harness.edgeRef.current,
      inputTime: 75,
    }),
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

it('does not continue enhanced settling after reduced motion cancels capability', async () => {
  const harness = createHarness();
  const animation = deferred();
  harness.adapter.animateTo.mockReturnValue(animation.promise);
  const { result, rerender } = renderHook(
    ({ reducedMotion }) => usePageTurnController({ ...harness, reducedMotion }),
    { initialProps: { reducedMotion: false } },
  );
  await waitFor(() => expect(result.current.phase).toBe('idle'));

  await startEnhancedTouch(result);
  await waitFor(() => expect(result.current.phase).toBe('settling'));
  rerender({ reducedMotion: true });
  await act(async () => {
    animation.resolve({ status: 'cancelled' });
    await animation.promise;
  });

  expect(harness.adapter.recover).not.toHaveBeenCalled();
  expect(result.current.phase).toBe('basic');
});

it('does not recover when enhanced touch settling is cancelled', async () => {
  const harness = createHarness();
  harness.adapter.animateTo.mockResolvedValue({ status: 'cancelled' });
  const { result } = renderHook(() => usePageTurnController(harness));
  await waitFor(() => expect(result.current.phase).toBe('idle'));

  await startEnhancedTouch(result);
  await waitFor(() => expect(result.current.phase).not.toBe('settling'));

  expect(harness.adapter.recover).not.toHaveBeenCalled();
  expect(result.current.phase).toBe('idle');
});

it('hides the page edge as soon as touch settling reaches its visual target', async () => {
  const harness = createHarness();
  const animation = deferred();
  harness.adapter.animateTo.mockReturnValue(animation.promise);
  const { result } = renderHook(() => usePageTurnController(harness));
  await waitFor(() => expect(result.current.phase).toBe('idle'));

  await startEnhancedTouch(result);
  await waitFor(() => expect(result.current.phase).toBe('settling'));
  expect(harness.edgeRef.current.style.opacity).toBe('1');

  await act(async () => {
    animation.resolve({ status: 'completed' });
    await animation.promise;
    await Promise.resolve();
  });

  expect(result.current.phase).toBe('settling');
  expect(harness.edgeRef.current.style.opacity).toBe('0');

  harness.adapter.isStableAt.mockReturnValue(true);
  act(() => harness.handlers.relocated?.({ start: { cfi: 'next-cfi' } }));
  await waitFor(() => expect(result.current.phase).toBe('idle'));
});
