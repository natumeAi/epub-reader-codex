import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ContinueReadingSection,
  formatRecentReadingTime,
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

  it('collapses while searching or when there are no items', () => {
    const { rerender } = render(
      <ContinueReadingSection items={[item]} onOpenBook={vi.fn()} searchMode />,
    );
    expect(screen.queryByRole('heading', { name: '继续阅读' })).not.toBeInTheDocument();
    rerender(<ContinueReadingSection items={[]} onOpenBook={vi.fn()} searchMode={false} />);
    expect(screen.queryByRole('heading', { name: '继续阅读' })).not.toBeInTheDocument();
  });
});
