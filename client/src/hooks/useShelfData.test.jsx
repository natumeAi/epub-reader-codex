import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useShelfData } from './useShelfData.js';

const api = vi.hoisted(() => ({
  listBookCatalog: vi.fn(),
  listRecentReading: vi.fn(),
  listShelfItems: vi.fn(),
}));

vi.mock('../api/booksApi.js', () => ({ listBookCatalog: api.listBookCatalog }));
vi.mock('../api/foldersApi.js', () => ({ listShelfItems: api.listShelfItems }));
vi.mock('../api/readingApi.js', () => ({ listRecentReading: api.listRecentReading }));
vi.mock('./useUploadBooks.js', () => ({
  useUploadBooks: () => ({
    handleFileChange: vi.fn(),
    isUploading: false,
    uploadProgress: '',
  }),
}));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('useShelfData independent resources', () => {
  beforeEach(() => {
    api.listShelfItems.mockResolvedValue({
      items: [{ type: 'book', id: 1, book: { id: 1, title: '根层书' } }],
    });
    api.listRecentReading.mockResolvedValue({ items: [] });
    api.listBookCatalog.mockResolvedValue({
      books: [{ id: 1, folderId: null, title: '根层书' }],
    });
  });

  it('loads shelf, recent and catalog without sharing errors', async () => {
    const { result } = renderHook(() => useShelfData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.shelfItems).toHaveLength(1);
    expect(result.current.catalogBooks).toHaveLength(1);
    expect(result.current.catalogError).toBe('');
    expect(result.current.hasLoadedCatalog).toBe(true);
    expect(result.current.isCatalogLoading).toBe(false);
  });

  it('keeps shelf-load and operation errors independent', async () => {
    api.listShelfItems.mockRejectedValueOnce(new Error('无法加载书架'));
    const { result } = renderHook(() => useShelfData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.shelfError).toBe('无法加载书架');
    expect(result.current.operationError).toBe('');

    act(() => result.current.setOperationError('上传失败'));
    expect(result.current.shelfError).toBe('无法加载书架');
    expect(result.current.operationError).toBe('上传失败');

    api.listShelfItems.mockResolvedValueOnce({ items: [] });
    await act(async () => { await result.current.loadShelf(); });
    expect(result.current.shelfError).toBe('');
    expect(result.current.operationError).toBe('上传失败');
  });

  it('keeps the shelf and last catalog when a later catalog refresh fails', async () => {
    const { result } = renderHook(() => useShelfData());
    await waitFor(() => expect(result.current.catalogBooks).toHaveLength(1));
    api.listBookCatalog.mockRejectedValueOnce(new Error('搜索目录加载失败'));

    await act(async () => { await result.current.loadCatalog(); });

    expect(result.current.shelfItems).toHaveLength(1);
    expect(result.current.shelfError).toBe('');
    expect(result.current.catalogBooks).toHaveLength(1);
    expect(result.current.catalogError).toBe('搜索目录加载失败');
  });

  it('finishes the primary shelf while auxiliary requests are still pending', async () => {
    const recentRequest = deferred();
    const catalogRequest = deferred();
    api.listRecentReading.mockReturnValueOnce(recentRequest.promise);
    api.listBookCatalog.mockReturnValueOnce(catalogRequest.promise);

    const { result } = renderHook(() => useShelfData());
    await waitFor(() => expect(result.current.shelfItems).toHaveLength(1));

    expect(result.current.hasLoadedShelf).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isCatalogLoading).toBe(true);
  });

  it('lets only the latest catalog request commit data and loading state', async () => {
    const { result } = renderHook(() => useShelfData());
    await waitFor(() => expect(result.current.catalogBooks).toHaveLength(1));
    const older = deferred();
    const newer = deferred();
    api.listBookCatalog
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    let olderLoad;
    let newerLoad;
    act(() => { olderLoad = result.current.loadCatalog(); });
    act(() => { newerLoad = result.current.loadCatalog(); });

    await act(async () => {
      older.resolve({ books: [{ id: 2, title: '旧目录' }] });
      await olderLoad;
    });
    expect(result.current.isCatalogLoading).toBe(true);
    expect(result.current.catalogBooks[0].title).toBe('根层书');

    await act(async () => {
      newer.resolve({ books: [{ id: 3, title: '新目录' }] });
      await newerLoad;
    });
    expect(result.current.isCatalogLoading).toBe(false);
    expect(result.current.catalogBooks[0].title).toBe('新目录');
  });

  it('ignores an older shelf result and restores only the latest shelf', async () => {
    const restoreReaderBook = vi.fn();
    const { result } = renderHook(() => useShelfData({ restoreReaderBook }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(restoreReaderBook).toHaveBeenCalledTimes(1));
    restoreReaderBook.mockClear();
    const older = deferred();
    const newer = deferred();
    api.listShelfItems
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    let olderLoad;
    let newerLoad;
    act(() => { olderLoad = result.current.loadShelf(); });
    act(() => { newerLoad = result.current.loadShelf(); });

    await act(async () => {
      newer.resolve({ items: [{ type: 'book', id: 3, book: { id: 3, title: '新书架' } }] });
      await newerLoad;
    });
    await act(async () => {
      older.resolve({ items: [{ type: 'book', id: 2, book: { id: 2, title: '旧书架' } }] });
      await olderLoad;
    });

    expect(result.current.shelfItems[0].book.title).toBe('新书架');
    expect(result.current.shelfError).toBe('');
    expect(restoreReaderBook).toHaveBeenCalledTimes(1);
    expect(restoreReaderBook.mock.calls[0][0].items[0].book.title).toBe('新书架');
  });

  it('lets only the latest recent-reading request commit items', async () => {
    const { result } = renderHook(() => useShelfData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const older = deferred();
    const newer = deferred();
    api.listRecentReading
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    let olderLoad;
    let newerLoad;
    act(() => { olderLoad = result.current.loadRecentReading(); });
    act(() => { newerLoad = result.current.loadRecentReading(); });

    await act(async () => {
      newer.resolve({ items: [{ book: { id: 3, title: '新进度' } }] });
      await newerLoad;
    });
    await act(async () => {
      older.resolve({ items: [{ book: { id: 2, title: '旧进度' } }] });
      await olderLoad;
    });

    expect(result.current.recentReadingItems[0].book.title).toBe('新进度');
  });
});
