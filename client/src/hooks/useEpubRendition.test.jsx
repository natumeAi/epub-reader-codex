import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEpubRendition } from './useEpubRendition.js';

const mocks = vi.hoisted(() => ({
  epubBook: null,
  getReadingProgress: vi.fn(),
}));

vi.mock('epubjs', () => ({ default: vi.fn(() => mocks.epubBook) }));
vi.mock('../api/readingApi.js', () => ({
  getReadingProgress: mocks.getReadingProgress,
}));

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe('useEpubRendition progress', () => {
  beforeEach(() => {
    mocks.getReadingProgress.mockReset();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
  });

  it('keeps saved progress before locations and recomputes after generation', async () => {
    const generated = deferred();
    const handlers = {};
    const location = {
      start: {
        cfi: 'epubcfi(/6/2!/4/2)',
        href: 'chapter.xhtml',
        displayed: { page: 2, total: 10 },
      },
    };
    const locations = {
      generate: vi.fn(() => generated.promise),
      percentageFromCfi: vi.fn(() => 0.43),
    };
    const rendition = {
      currentLocation: vi.fn(() => location),
      destroy: vi.fn(),
      display: vi.fn().mockResolvedValue(undefined),
      getContents: vi.fn(() => []),
      hooks: { content: { register: vi.fn() } },
      off: vi.fn(),
      on: vi.fn((name, handler) => { handlers[name] = handler; }),
    };
    mocks.epubBook = {
      destroy: vi.fn(),
      loaded: { navigation: Promise.resolve({ toc: [] }) },
      locations,
      renderTo: vi.fn(() => rendition),
    };
    mocks.getReadingProgress.mockResolvedValue({
      progress: { cfi: location.start.cfi, progress: 0.0227 },
    });

    const enqueueProgress = vi.fn();
    const refs = {
      bookRef: { current: null },
      containerRef: { current: document.createElement('div') },
      currentCfiRef: { current: null },
      isClosingRef: { current: false },
      readerSettingsRef: { current: { horizontalMargin: 24 } },
      renditionRef: { current: null },
    };
    const args = {
      ...refs,
      applyReaderHorizontalMargin: vi.fn().mockResolvedValue(undefined),
      applyReaderSettings: vi.fn(),
      applyReaderSettingsToContents: vi.fn(),
      book: { id: 5 },
      enqueueProgress,
      error: '',
      flushPendingReaderSettings: vi.fn(),
      isLoading: true,
      loadReaderSettings: vi.fn().mockResolvedValue({ horizontalMargin: 24 }),
      markReaderSettingsLoaded: vi.fn(),
      resetPageProgress: vi.fn(),
      resetReaderSettingsLoad: vi.fn(),
      setError: vi.fn(),
      setIsLoading: vi.fn(),
      updatePageProgressFromLocation: vi.fn(),
    };

    const { result } = renderHook(() => useEpubRendition(args));
    await waitFor(() => expect(rendition.display).toHaveBeenCalled());

    act(() => handlers.relocated(location));
    expect(result.current.progress).toBe(0.0227);
    expect(enqueueProgress).toHaveBeenLastCalledWith(expect.objectContaining({ progress: 0.0227 }));

    await act(async () => { generated.resolve(); await generated.promise; });
    await waitFor(() => expect(result.current.progress).toBe(0.43));
    expect(enqueueProgress).toHaveBeenLastCalledWith(expect.objectContaining({ progress: 0.43 }));
  });
});
