import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderView } from './ReaderView.jsx';

const mocks = vi.hoisted(() => ({
  enqueueProgress: vi.fn(),
  flushPendingReaderSettings: vi.fn(),
  flushProgress: vi.fn(),
  next: vi.fn(),
  onClose: vi.fn(),
  relocatedHandler: null,
  useEpubRendition: vi.fn(),
  useReadingProgressPersistence: vi.fn(),
  useReducedMotion: vi.fn(() => true),
}));

vi.mock('../../hooks/useReducedMotion.js', () => ({
  useReducedMotion: mocks.useReducedMotion,
}));
vi.mock('../../hooks/useEpubRendition.js', () => ({
  useEpubRendition: mocks.useEpubRendition,
}));
vi.mock('../../hooks/usePageProgress.js', () => ({
  usePageProgress: () => ({
    pageProgressLabel: '1 / 2',
    refreshCurrentPageProgress: vi.fn(),
    resetPageProgress: vi.fn(),
    updatePageProgressFromLocation: vi.fn(),
  }),
}));
vi.mock('../../hooks/useReaderSettings.js', () => ({
  useReaderSettings: () => ({
    applyReaderHorizontalMargin: vi.fn(),
    applyReaderSettings: vi.fn(),
    applyReaderSettingsToContents: vi.fn(),
    decreaseFontSize: vi.fn(),
    flushPendingReaderSettings: mocks.flushPendingReaderSettings,
    fontFamilyId: 'system',
    fontFamilyOptions: [],
    fontSize: 18,
    fontSizeMax: 40,
    fontSizeMin: 14,
    fontSizeStep: 2,
    handleFontFamilyChange: vi.fn(),
    handleFontSizeChange: vi.fn(),
    handleThemeChange: vi.fn(),
    increaseFontSize: vi.fn(),
    layoutSettings: [],
    loadReaderSettings: vi.fn(),
    markReaderSettingsLoaded: vi.fn(),
    readerFont: {},
    readerSettingsRef: { current: {} },
    readerTheme: { background: '#fff', text: '#000', muted: '#666' },
    readerThemeId: 'light',
    readerViewportStyle: {},
    resetReaderSettingsLoad: vi.fn(),
    themeOptions: [],
  }),
}));
vi.mock('../../hooks/useReadingProgressPersistence.js', () => ({
  useReadingProgressPersistence: mocks.useReadingProgressPersistence,
}));
vi.mock('./ReaderTopBar.jsx', () => ({
  ReaderTopBar: ({ onClose }) => <button type="button" onClick={onClose}>关闭</button>,
}));

describe('ReaderView behavior', () => {
  beforeEach(() => {
    mocks.enqueueProgress.mockClear();
    mocks.flushPendingReaderSettings.mockClear();
    mocks.flushProgress.mockClear();
    mocks.next.mockClear();
    mocks.onClose.mockClear();
    mocks.relocatedHandler = null;
    mocks.useEpubRendition.mockReset();
    mocks.useEpubRendition.mockReturnValue({ currentHref: null, progress: 0, toc: [] });
    mocks.useReadingProgressPersistence.mockReset();
    mocks.useReadingProgressPersistence.mockReturnValue({
      enqueueProgress: mocks.enqueueProgress,
      flushProgress: mocks.flushProgress,
    });
    mocks.useReducedMotion.mockReturnValue(true);
  });

  it('composes the outbox hook and requests keepalive when closing', () => {
    render(<ReaderView book={{ id: 12, title: '测试书' }} onClose={vi.fn()} />);

    expect(mocks.useReadingProgressPersistence).toHaveBeenCalledWith({ bookId: 12 });
    expect(mocks.useEpubRendition).toHaveBeenCalledWith(expect.objectContaining({
      enqueueProgress: mocks.enqueueProgress,
      flushPendingReaderSettings: mocks.flushPendingReaderSettings,
    }));

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(mocks.flushProgress).toHaveBeenCalledWith({ keepalive: true });
  });

  it('navigates once without animation waits and Escape closes immediately', async () => {
    vi.useFakeTimers();
    mocks.useEpubRendition.mockImplementation((args) => {
      useEffect(() => {
        args.renditionRef.current = {
          currentLocation: () => ({ atEnd: false, atStart: false }),
          next: () => {
            mocks.next();
            queueMicrotask(() => mocks.relocatedHandler?.());
          },
          off: vi.fn(),
          on: (name, handler) => {
            if (name === 'relocated') mocks.relocatedHandler = handler;
          },
        };
        args.setIsLoading(false);
      }, [args.renditionRef, args.setIsLoading]);
      return { currentHref: null, progress: 0.2, toc: [] };
    });

    render(<ReaderView book={{ id: 1, title: 'Book' }} onClose={mocks.onClose} originRect={null} />);
    await act(async () => { await Promise.resolve(); });
    const gestureLayer = document.querySelector('.reader-gesture-layer');
    expect(gestureLayer).not.toBeNull();

    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.next).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });
});
