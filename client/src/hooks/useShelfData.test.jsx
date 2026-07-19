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
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
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

  it('keeps the shelf and last catalog when a later catalog refresh fails', async () => {
    const { result } = renderHook(() => useShelfData());
    await waitFor(() => expect(result.current.catalogBooks).toHaveLength(1));
    api.listBookCatalog.mockRejectedValueOnce(new Error('搜索目录加载失败'));

    await act(async () => { await result.current.loadCatalog(); });

    expect(result.current.shelfItems).toHaveLength(1);
    expect(result.current.error).toBe('');
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
});
