import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEpubRendition } from './useEpubRendition.js';

const mocks = vi.hoisted(() => ({
  adapter: {
    cancel: vi.fn(),
    destroy: vi.fn(),
    isStableAligned: vi.fn(() => true),
  },
  createEpubPageTurnAdapter: vi.fn(),
  epubBook: null,
  getReadingProgress: vi.fn(),
}));

vi.mock('epubjs', () => ({ default: vi.fn(() => mocks.epubBook) }));
vi.mock('../utils/epubPageTurnAdapter.js', () => ({
  createEpubPageTurnAdapter: mocks.createEpubPageTurnAdapter,
}));
vi.mock('../api/readingApi.js', () => ({
  getReadingProgress: mocks.getReadingProgress,
}));

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function createRenditionFixture({
  savedProgress = {
    cfi: 'epubcfi(/6/2!/4/2)',
    progress: 0.0227,
  },
} = {}) {
  const generated = deferred();
  const handlers = {};
  const location = {
    start: {
      cfi: savedProgress.cfi,
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
  const epubBook = {
    destroy: vi.fn(),
    loaded: { navigation: Promise.resolve({ toc: [] }) },
    locations,
    renderTo: vi.fn(() => rendition),
  };
  mocks.epubBook = epubBook;
  mocks.getReadingProgress.mockResolvedValue({ progress: savedProgress });

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
  return {
    args,
    enqueueProgress,
    epubBook,
    generated,
    handlers,
    location,
    rendition,
  };
}

describe('useEpubRendition progress', () => {
  beforeEach(() => {
    mocks.adapter.cancel.mockClear();
    mocks.adapter.destroy.mockClear();
    mocks.adapter.isStableAligned.mockReset().mockReturnValue(true);
    mocks.createEpubPageTurnAdapter.mockReset().mockReturnValue(mocks.adapter);
    mocks.getReadingProgress.mockReset();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
  });

  it('keeps saved progress before locations and recomputes after generation', async () => {
    const fixture = createRenditionFixture();
    const { result } = renderHook(() => useEpubRendition(fixture.args));
    await waitFor(() => expect(fixture.rendition.display).toHaveBeenCalled());

    act(() => fixture.handlers.relocated(fixture.location));
    expect(result.current.progress).toBe(0.0227);
    expect(fixture.enqueueProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ progress: 0.0227 }),
    );

    await act(async () => {
      fixture.generated.resolve();
      await fixture.generated.promise;
    });
    await waitFor(() => expect(result.current.progress).toBe(0.43));
    expect(fixture.enqueueProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ progress: 0.43 }),
    );
  });

  it('uses continuous Snap and ignores relocated events until aligned', async () => {
    const fixture = createRenditionFixture({
      savedProgress: { cfi: 'stable-cfi', progress: 0.2 },
    });
    const { result, unmount } = renderHook(() => useEpubRendition(fixture.args));
    await waitFor(() => expect(fixture.epubBook.renderTo).toHaveBeenCalled());
    await waitFor(() => expect(result.current.pageTurnAdapter).toBe(mocks.adapter));

    expect(fixture.epubBook.renderTo).toHaveBeenCalledWith(
      fixture.args.containerRef.current,
      expect.objectContaining({
        flow: 'paginated',
        gap: 144,
        manager: 'continuous',
        snap: true,
        spread: 'none',
      }),
    );

    mocks.adapter.isStableAligned.mockReturnValue(false);
    act(() => fixture.handlers.relocated(fixture.location));
    expect(fixture.args.enqueueProgress).not.toHaveBeenCalled();

    mocks.adapter.isStableAligned.mockReturnValue(true);
    act(() => fixture.handlers.relocated(fixture.location));
    expect(fixture.args.enqueueProgress).toHaveBeenCalledTimes(1);
    expect(fixture.args.currentCfiRef.current).toBe(fixture.location.start.cfi);

    unmount();
    expect(mocks.adapter.destroy).toHaveBeenCalledTimes(1);
  });
});
