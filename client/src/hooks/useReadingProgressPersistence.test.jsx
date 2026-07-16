import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readProgressOutbox,
  sanitizeProgressRecord,
  writeProgressOutbox,
} from '../utils/readingProgress.js';
import { useReadingProgressPersistence } from './useReadingProgressPersistence.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('useReadingProgressPersistence', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  it('serializes A then sends the newer B without deleting it with A', async () => {
    const first = deferred();
    const second = deferred();
    let inFlight = 0;
    let maximumInFlight = 0;
    const saveProgress = vi.fn((bookId, payload) => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      const pending = saveProgress.mock.calls.length === 1 ? first : second;
      return pending.promise.finally(() => { inFlight -= 1; });
    });
    const { result } = renderHook(() => useReadingProgressPersistence({ bookId: 7, saveProgress }));

    act(() => {
      result.current.enqueueProgress({ cfi: 'A', progress: 0.1 });
      result.current.enqueueProgress({ cfi: 'B', progress: 0.2 });
    });
    expect(saveProgress).toHaveBeenCalledTimes(1);
    expect(saveProgress.mock.calls[0][1]).toMatchObject({ cfi: 'A' });

    await act(async () => { first.resolve({}); await first.promise; });
    await waitFor(() => expect(saveProgress).toHaveBeenCalledTimes(2));
    expect(saveProgress.mock.calls[1][1]).toMatchObject({ cfi: 'B' });

    await act(async () => { second.resolve({}); await second.promise; });
    await waitFor(() => expect(readProgressOutbox()).toEqual({}));
    expect(maximumInFlight).toBe(1);
  });

  it('keeps a network failure and retries when the page becomes visible', async () => {
    const saveProgress = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce({});
    const { result } = renderHook(() => useReadingProgressPersistence({ bookId: 8, saveProgress }));

    act(() => result.current.enqueueProgress({ cfi: 'offline-cfi', progress: 0.3 }));
    await waitFor(() => expect(saveProgress).toHaveBeenCalledTimes(1));
    expect(readProgressOutbox()[8]).toMatchObject({ cfi: 'offline-cfi' });

    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(saveProgress).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(readProgressOutbox()).toEqual({}));
  });

  it('sends a newer queued snapshot after the active request fails', async () => {
    const first = deferred();
    const second = deferred();
    const saveProgress = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { result } = renderHook(() => useReadingProgressPersistence({ bookId: 10, saveProgress }));

    act(() => {
      result.current.enqueueProgress({ cfi: 'A', progress: 0.1 });
      result.current.enqueueProgress({ cfi: 'B', progress: 0.2 });
    });
    await act(async () => {
      first.reject(new TypeError('offline'));
      await first.promise.catch(() => {});
    });

    await waitFor(() => expect(saveProgress).toHaveBeenCalledTimes(2));
    expect(saveProgress.mock.calls[1][1]).toMatchObject({ cfi: 'B', progress: 0.2 });

    await act(async () => {
      second.resolve({});
      await second.promise;
    });
    await waitFor(() => expect(readProgressOutbox()).toEqual({}));
  });

  it('retries pending progress when connectivity returns', async () => {
    const saveProgress = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce({});
    const { result } = renderHook(() => useReadingProgressPersistence({ bookId: 12, saveProgress }));

    act(() => result.current.enqueueProgress({ cfi: 'online-retry', progress: 0.4 }));
    await waitFor(() => expect(saveProgress).toHaveBeenCalledTimes(1));
    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(saveProgress).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(readProgressOutbox()).toEqual({}));
  });

  it('uses keepalive on pagehide and drops a permanent 404', async () => {
    const notFound = Object.assign(new Error('missing'), { status: 404 });
    const saveProgress = vi.fn().mockRejectedValue(notFound);
    const { result } = renderHook(() => useReadingProgressPersistence({ bookId: 11, saveProgress }));

    act(() => result.current.enqueueProgress({ cfi: 'gone', progress: 0.6 }));
    await waitFor(() => expect(saveProgress).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(readProgressOutbox()).toEqual({}));

    saveProgress.mockResolvedValue({});
    writeProgressOutbox({
      11: sanitizeProgressRecord({ bookId: 11, cfi: 'last', progress: 0.7 }),
    });
    await act(async () => { await Promise.resolve(); });
    act(() => window.dispatchEvent(new Event('pagehide')));
    await waitFor(() => expect(saveProgress).toHaveBeenLastCalledWith(
      11,
      expect.objectContaining({ cfi: 'last' }),
      expect.objectContaining({ keepalive: true }),
    ));
  });
});
