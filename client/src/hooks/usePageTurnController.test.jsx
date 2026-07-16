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
