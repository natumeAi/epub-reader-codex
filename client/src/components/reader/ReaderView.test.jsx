import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderView } from './ReaderView.jsx';

const mocks = vi.hoisted(() => ({
  cancelPageTurn: vi.fn(),
  enqueueProgress: vi.fn(),
  flushPendingReaderSettings: vi.fn(),
  flushProgress: vi.fn(),
  handlePointerCancel: vi.fn(),
  handlePointerDown: vi.fn(),
  handlePointerMove: vi.fn(),
  handlePointerUp: vi.fn(),
  next: vi.fn(),
  onClose: vi.fn(),
  relocatedHandler: null,
  turnPage: vi.fn(),
  useEpubRendition: vi.fn(),
  usePageTurnController: vi.fn(),
  useReadingProgressPersistence: vi.fn(),
  useReducedMotion: vi.fn(() => true),
}));

vi.mock('../../hooks/useReducedMotion.js', () => ({
  useReducedMotion: mocks.useReducedMotion,
}));
vi.mock('../../hooks/useEpubRendition.js', () => ({
  useEpubRendition: mocks.useEpubRendition,
}));
vi.mock('../../hooks/usePageTurnController.js', () => ({
  usePageTurnController: mocks.usePageTurnController,
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
    mocks.cancelPageTurn.mockClear();
    mocks.enqueueProgress.mockClear();
    mocks.flushPendingReaderSettings.mockClear();
    mocks.flushProgress.mockClear();
    mocks.handlePointerCancel.mockClear();
    mocks.handlePointerDown.mockClear();
    mocks.handlePointerMove.mockClear();
    mocks.handlePointerUp.mockClear();
    mocks.next.mockClear();
    mocks.onClose.mockClear();
    mocks.relocatedHandler = null;
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
    mocks.useEpubRendition.mockReset();
    mocks.useEpubRendition.mockReturnValue({
      currentHref: null,
      pageTurnAdapter: { name: 'adapter' },
      progress: 0,
      toc: [],
    });
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
    expect(mocks.cancelPageTurn).toHaveBeenCalled();
  });

  it('routes keyboard and pointer input through the page-turn controller', async () => {
    mocks.useEpubRendition.mockImplementation((args) => {
      useEffect(() => {
        args.setIsLoading(false);
      }, [args.setIsLoading]);
      return {
        currentHref: null,
        pageTurnAdapter: { name: 'adapter' },
        progress: 0.2,
        toc: [],
      };
    });

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
});
