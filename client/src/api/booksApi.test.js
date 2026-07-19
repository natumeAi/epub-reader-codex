import { afterEach, describe, expect, it, vi } from 'vitest';
import { listBookCatalog, uploadBook } from './booksApi.js';

describe('listBookCatalog', () => {
  it('reads the complete read-only catalog', async () => {
    const payload = {
      books: [{
        id: 7,
        folderId: 3,
        folderName: '历史',
        title: '万历十五年',
        author: '黄仁宇',
        createdAt: '2026-07-18T00:00:00.000Z',
        readingProgress: 0.42,
        readingUpdatedAt: '2026-07-18T01:00:00.000Z',
      }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    }));

    await expect(listBookCatalog()).resolves.toEqual(payload);
    expect(fetch).toHaveBeenCalledWith('/api/books/catalog');
  });

  it('uses a catalog-specific error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(listBookCatalog()).rejects.toThrow('搜索目录加载失败');
  });
});

describe('uploadBook', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the server error message for an invalid EPUB', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'EPUB 文件无效或已损坏', code: 'INVALID_EPUB' }),
    }));

    await expect(uploadBook(new File(['bad'], 'bad.epub')))
      .rejects.toThrow('EPUB 文件无效或已损坏');
  });
});
