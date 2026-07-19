import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LibrarySearchBar } from './LibrarySearchBar.jsx';

const baseProps = {
  bookCount: 326,
  catalogError: '',
  isCatalogLoading: false,
  onCancel: vi.fn(),
  onClear: vi.fn(),
  onFocus: vi.fn(),
  onQueryChange: vi.fn(),
  onRetry: vi.fn(),
  query: '',
  searchMode: false,
};

describe('LibrarySearchBar', () => {
  it('submits controlled search intents', () => {
    const onQueryChange = vi.fn();
    const onFocus = vi.fn();
    render(<LibrarySearchBar {...baseProps} onFocus={onFocus} onQueryChange={onQueryChange} />);
    const input = screen.getByRole('searchbox', { name: '搜索书名、作者或文件夹' });
    expect(input).toHaveAttribute('placeholder', '搜索 326 本书');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '万历' } });
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onQueryChange).toHaveBeenCalledWith('万历');
  });

  it('shows clear and cancel only for the matching state', () => {
    const onClear = vi.fn();
    const onCancel = vi.fn();
    render(
      <LibrarySearchBar
        {...baseProps}
        query="万历"
        searchMode
        onClear={onClear}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '清空搜索' }));
    fireEvent.click(screen.getByRole('button', { name: '取消搜索' }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables search while loading and exposes catalog retry', () => {
    const { rerender } = render(<LibrarySearchBar {...baseProps} isCatalogLoading />);
    expect(screen.getByRole('searchbox')).toBeDisabled();
    expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', '正在加载搜索目录');

    const onRetry = vi.fn();
    rerender(
      <LibrarySearchBar {...baseProps} catalogError="搜索目录加载失败" onRetry={onRetry} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('搜索目录加载失败');
    fireEvent.click(screen.getByRole('button', { name: '重试加载搜索目录' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
