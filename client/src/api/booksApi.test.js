import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadBook } from './booksApi.js';

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
