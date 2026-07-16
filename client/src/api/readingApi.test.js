import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveReadingProgress } from './readingApi.js';

describe('saveReadingProgress', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes signal and keepalive to fetch', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ progress: { bookId: 4 } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await saveReadingProgress(4, { cfi: 'cfi', progress: 0.2 }, {
      keepalive: true,
      signal: controller.signal,
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/reading/4', expect.objectContaining({
      keepalive: true,
      signal: controller.signal,
    }));
  });

  it('attaches the HTTP status to a failed save', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(saveReadingProgress(99, { progress: 0.2 })).rejects.toMatchObject({
      message: '无法保存阅读进度',
      status: 404,
    });
  });
});
