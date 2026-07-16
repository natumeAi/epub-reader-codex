import { afterEach, describe, expect, it, vi } from 'vitest';
import { listFolderBooks } from './foldersApi.js';

describe('listFolderBooks', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('forwards an AbortSignal to fetch', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ books: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await listFolderBooks(7, { signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledWith('/api/folders/7/books', {
      signal: controller.signal,
    });
  });
});
