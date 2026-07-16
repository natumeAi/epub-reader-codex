import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderView } from './ReaderView.jsx';

const mocks = vi.hoisted(() => ({
  enqueueProgress: vi.fn(),
  flushPendingReaderSettings: vi.fn(),
  flushProgress: vi.fn(),
  useEpubRendition: vi.fn(),
  useReadingProgressPersistence: vi.fn(),
}));

vi.mock('../../hooks/useEpubRendition.js', () => ({
  useEpubRendition: mocks.useEpubRendition,
}));
vi.mock('../../hooks/usePageProgress.js', () => ({
  usePageProgress: () => ({
    pageProgressLabel: '1 / 1',
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
    readerTheme: {},
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

describe('ReaderView progress persistence', () => {
  beforeEach(() => {
    mocks.useEpubRendition.mockReset();
    mocks.useEpubRendition.mockReturnValue({ currentHref: null, progress: 0, toc: [] });
    mocks.useReadingProgressPersistence.mockReset();
    mocks.useReadingProgressPersistence.mockReturnValue({
      enqueueProgress: mocks.enqueueProgress,
      flushProgress: mocks.flushProgress,
    });
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
});
