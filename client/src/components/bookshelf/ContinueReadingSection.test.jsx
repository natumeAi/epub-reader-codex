import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ContinueReadingSection,
  formatRecentReadingTime,
  normalizeRecentReadingTimestamp,
} from './ContinueReadingSection.jsx';

const item = {
  book: { id: 1, title: '活着' },
  progress: { progress: 0.42, updatedAt: '2026-07-18T00:00:00.000Z' },
};

describe('ContinueReadingSection', () => {
  it('shows progress and recent reading time in one clickable card', () => {
    const onOpenBook = vi.fn();
    render(<ContinueReadingSection items={[item]} onOpenBook={onOpenBook} searchMode={false} />);
    const button = screen.getByRole('button', { name: '继续阅读《活着》' });
    expect(button).toHaveTextContent('42%');
    expect(button).toHaveAccessibleDescription(/42%.*(?:前|月|最近阅读)/);
    expect(button.querySelector('time')).toHaveAttribute(
      'dateTime',
      '2026-07-18T00:00:00.000Z',
    );
    fireEvent.click(button);
    expect(onOpenBook).toHaveBeenCalledWith(item.book, expect.anything());
  });

  it('formats representative relative times', () => {
    const now = Date.parse('2026-07-18T02:00:00.000Z');
    expect(formatRecentReadingTime('2026-07-18T01:30:00.000Z', now)).toBe('30 分钟前');
    expect(formatRecentReadingTime('2026-07-17T02:00:00.000Z', now)).toBe('1 天前');
  });

  it('treats SQLite timestamps as UTC and exposes ISO datetime', () => {
    const updatedAt = '2026-07-18 01:30:00';
    const normalized = '2026-07-18T01:30:00Z';
    const now = Date.parse('2026-07-18T02:00:00.000Z');
    expect(normalizeRecentReadingTimestamp(updatedAt)).toBe(normalized);
    expect(normalizeRecentReadingTimestamp(item.progress.updatedAt)).toBe(item.progress.updatedAt);
    expect(formatRecentReadingTime(updatedAt, now)).toBe('30 分钟前');

    const sqliteItem = {
      ...item,
      progress: { ...item.progress, updatedAt },
    };
    render(
      <ContinueReadingSection items={[sqliteItem]} onOpenBook={vi.fn()} searchMode={false} />,
    );
    expect(screen.getByRole('button', { name: '继续阅读《活着》' }).querySelector('time'))
      .toHaveAttribute('dateTime', normalized);
  });

  it('collapses while searching or when there are no items', () => {
    const { rerender } = render(
      <ContinueReadingSection items={[item]} onOpenBook={vi.fn()} searchMode />,
    );
    expect(screen.queryByRole('heading', { name: '继续阅读' })).not.toBeInTheDocument();
    rerender(<ContinueReadingSection items={[]} onOpenBook={vi.fn()} searchMode={false} />);
    expect(screen.queryByRole('heading', { name: '继续阅读' })).not.toBeInTheDocument();
  });
});
