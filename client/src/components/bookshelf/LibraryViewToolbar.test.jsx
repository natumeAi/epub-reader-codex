import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LIBRARY_SORT, LIBRARY_VIEW } from '../../utils/libraryView.js';
import { LibraryViewToolbar } from './LibraryViewToolbar.jsx';

const baseProps = {
  controlsDisabled: false,
  editable: true,
  modeLabel: '全部，12 项',
  onSortChange: vi.fn(),
  onViewChange: vi.fn(),
  resultCount: 12,
  sort: LIBRARY_SORT.MANUAL,
  sortOptions: [
    { value: LIBRARY_SORT.MANUAL, label: '手动顺序' },
    { value: LIBRARY_SORT.TITLE, label: '书名' },
  ],
  view: LIBRARY_VIEW.ALL,
};

describe('LibraryViewToolbar', () => {
  it('announces count and submits view/sort changes', () => {
    const onViewChange = vi.fn();
    const onSortChange = vi.fn();
    render(
      <LibraryViewToolbar
        {...baseProps}
        onViewChange={onViewChange}
        onSortChange={onSortChange}
      />,
    );
    expect(screen.getByText('12 项')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '最近添加' }));
    fireEvent.change(screen.getByRole('combobox', { name: '排序方式' }), {
      target: { value: LIBRARY_SORT.TITLE },
    });
    expect(onViewChange).toHaveBeenCalledWith(LIBRARY_VIEW.RECENT_ADDED);
    expect(onSortChange).toHaveBeenCalledWith(LIBRARY_SORT.TITLE);
  });

  it('hides sorting for folders and shows a non-color read-only hint', () => {
    render(
      <LibraryViewToolbar
        {...baseProps}
        editable={false}
        modeLabel="文件夹，2 项，只读视图"
        sortOptions={[]}
        view={LIBRARY_VIEW.FOLDERS}
      />,
    );
    expect(screen.queryByRole('combobox', { name: '排序方式' })).not.toBeInTheDocument();
    expect(screen.getByText('只读视图，不会改变手动书架顺序')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('文件夹，2 项，只读视图');
  });
});
