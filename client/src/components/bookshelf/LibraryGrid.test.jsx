import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LIBRARY_VIEW } from '../../utils/libraryView.js';
import { LibraryGrid } from './LibraryGrid.jsx';

vi.mock('@dnd-kit/sortable', () => ({
  rectSortingStrategy: {},
  SortableContext: ({ children }) => <div data-testid="sortable-context">{children}</div>,
}));
vi.mock('./SortableShelfItem.jsx', () => ({
  SortableShelfItem: ({ item }) => <div data-testid={`sortable-${item.key}`} />,
}));

const bookItem = {
  type: 'book', id: 7, key: 'book:7', folderName: '历史',
  book: { id: 7, title: '万历十五年', coverUrl: '/covers/7.jpg' },
};
const folderItem = {
  type: 'folder', id: 3, key: 'folder:3',
  folder: { id: 3, name: '历史', previewBooks: [] },
};

describe('LibraryGrid', () => {
  it('mounts sortable items only for editable mode', () => {
    const { rerender } = render(
      <LibraryGrid editable items={[bookItem]} hasLoadedShelf isLoading={false} />,
    );
    expect(screen.getByTestId('sortable-context')).toBeInTheDocument();
    rerender(
      <LibraryGrid editable={false} items={[bookItem]} hasLoadedShelf isLoading={false} />,
    );
    expect(screen.queryByTestId('sortable-context')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '万历十五年，位于“历史”' })).toBeInTheDocument();
  });

  it('opens read-only books and folders without drag props', () => {
    const onOpenBook = vi.fn();
    const onOpenFolder = vi.fn();
    render(
      <LibraryGrid
        editable={false}
        items={[bookItem, folderItem]}
        hasLoadedShelf
        isLoading={false}
        onOpenBook={onOpenBook}
        onOpenFolder={onOpenFolder}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '万历十五年，位于“历史”' }));
    fireEvent.click(screen.getByRole('button', { name: '历史' }));
    expect(onOpenBook).toHaveBeenCalledWith(bookItem.book, expect.anything());
    expect(onOpenFolder).toHaveBeenCalledWith(folderItem.folder);
    expect(screen.getByRole('img', { name: '万历十五年' })).toHaveAttribute('decoding', 'async');
  });

  it('renders the finite empty state for the active mode', () => {
    const onClearSearch = vi.fn();
    const { rerender } = render(
      <LibraryGrid
        editable={false}
        items={[]}
        query="不存在"
        view={LIBRARY_VIEW.ALL}
        hasLoadedShelf
        isLoading={false}
        onClearSearch={onClearSearch}
      />,
    );
    expect(screen.getByText('没有找到“不存在”')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清空搜索结果' }));
    expect(onClearSearch).toHaveBeenCalledTimes(1);
    rerender(
      <LibraryGrid
        editable={false}
        items={[]}
        query=""
        view={LIBRARY_VIEW.FOLDERS}
        hasLoadedShelf
        isLoading={false}
      />,
    );
    expect(screen.getByText(/拖动两本根层书籍/)).toBeInTheDocument();
  });
});
