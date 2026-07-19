import { createRef } from 'react';
import { DndContext } from '@dnd-kit/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LibraryHome } from './LibraryHome.jsx';

const shelfItems = [
  { type: 'book', id: 1, key: 'book:1', book: { id: 1, title: '活着', author: '余华' } },
  { type: 'folder', id: 3, key: 'folder:3', folder: { id: 3, name: '历史' } },
];
const catalogBooks = [
  { id: 1, folderId: null, title: '活着', author: '余华' },
  { id: 7, folderId: 3, folderName: '历史', title: '万历十五年', author: '黄仁宇' },
];
const recentReadingItems = [{
  book: { id: 1, title: '活着' },
  progress: { progress: 0.4, updatedAt: '2026-07-18T00:00:00.000Z' },
}];

function createHomeProps(overrides = {}) {
  return {
    catalogBooks,
    catalogError: '',
    dragIntent: null,
    fileInputRef: createRef(),
    hasLoadedCatalog: true,
    hasLoadedShelf: true,
    isCatalogLoading: false,
    isLoading: false,
    isSavingOrder: false,
    isUploading: false,
    onFileChange: vi.fn(),
    onOpenBook: vi.fn(),
    onOpenFolder: vi.fn(),
    onRetryCatalog: vi.fn(),
    onRetryShelf: vi.fn(),
    operationError: '',
    recentReadingItems,
    shelfError: '',
    shelfItems,
    uploadProgress: '',
    ...overrides,
  };
}

function renderHome(overrides = {}) {
  const props = createHomeProps(overrides);
  return render(<DndContext><LibraryHome {...props} /></DndContext>);
}

describe('LibraryHome composition', () => {
  it('hides continue reading in search and restores scroll on cancel', async () => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 280 });
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    renderHome();
    expect(screen.getByRole('heading', { name: '继续阅读' })).toBeInTheDocument();

    const search = screen.getByRole('searchbox', { name: '搜索书名、作者或文件夹' });
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: '万历' } });
    expect(screen.queryByRole('heading', { name: '继续阅读' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '万历十五年，位于“历史”' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '取消搜索' }));
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 280, behavior: 'auto' }));
    expect(screen.getByRole('heading', { name: '继续阅读' })).toBeInTheDocument();
    expect(screen.getByLabelText('可编辑书架列表')).toBeInTheDocument();
  });

  it('keeps the manual shelf usable when catalog fails', () => {
    const onRetryCatalog = vi.fn();
    renderHome({
      catalogError: '搜索目录加载失败',
      hasLoadedCatalog: true,
      onRetryCatalog,
    });
    expect(screen.getByRole('alert')).toHaveTextContent('搜索目录加载失败');
    expect(screen.getByLabelText('可编辑书架列表')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '继续阅读' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试加载搜索目录' }));
    expect(onRetryCatalog).toHaveBeenCalledTimes(1);
  });

  it('keeps All available as an escape when catalog refresh is unavailable', () => {
    const props = createHomeProps();
    const { rerender } = render(
      <DndContext><LibraryHome {...props} /></DndContext>,
    );

    fireEvent.click(screen.getByRole('button', { name: '最近添加' }));
    expect(screen.getByRole('button', { name: '最近添加' }))
      .toHaveAttribute('aria-pressed', 'true');

    rerender(
      <DndContext><LibraryHome {...props} isCatalogLoading /></DndContext>,
    );
    expect(screen.getByRole('button', { name: '全部' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '最近添加' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '文件夹' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: '排序方式' })).toBeDisabled();

    rerender(
      <DndContext>
        <LibraryHome {...props} catalogError="搜索目录加载失败" />
      </DndContext>,
    );
    expect(screen.getByRole('button', { name: '全部' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '最近添加' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '文件夹' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: '排序方式' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    expect(screen.getByRole('button', { name: '全部' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: '排序方式' }))
      .toHaveValue('manual');
    expect(screen.getByLabelText('可编辑书架列表')).toBeInTheDocument();
  });

  it('shows a shelf-specific retry without replacing search', () => {
    const onRetryShelf = vi.fn();
    renderHome({ shelfError: '无法加载书架', onRetryShelf, shelfItems: [] });
    fireEvent.click(screen.getByRole('button', { name: '重试加载书架' }));
    expect(onRetryShelf).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('shows operation errors without a shelf retry action', () => {
    renderHome({ operationError: '上传失败' });
    expect(screen.getByRole('alert')).toHaveTextContent('上传失败');
    expect(screen.queryByRole('button', { name: '重试加载书架' }))
      .not.toBeInTheDocument();
    expect(screen.getByLabelText('可编辑书架列表')).toBeInTheDocument();
  });

  it('keeps one operation live region mounted while its status changes', () => {
    const props = createHomeProps();
    const { container, rerender } = render(
      <DndContext><LibraryHome {...props} /></DndContext>,
    );
    const liveRegion = container.querySelector('.library-operation-status');
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(liveRegion).toBeEmptyDOMElement();

    rerender(
      <DndContext><LibraryHome {...props} isCatalogLoading /></DndContext>,
    );
    expect(container.querySelector('.library-operation-status')).toBe(liveRegion);
    expect(liveRegion).toHaveTextContent('正在加载搜索目录');

    rerender(
      <DndContext>
        <LibraryHome {...props} isUploading uploadProgress="已上传 1 本" />
      </DndContext>,
    );
    expect(container.querySelector('.library-operation-status')).toBe(liveRegion);
    expect(liveRegion).toHaveTextContent('已上传 1 本');
  });
});
