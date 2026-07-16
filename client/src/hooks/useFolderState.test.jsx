import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFolderState } from './useFolderState.js';

const api = vi.hoisted(() => ({
  listFolderBooks: vi.fn(),
  renameFolder: vi.fn(),
}));

vi.mock('../api/foldersApi.js', () => api);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('useFolderState request ordering', () => {
  beforeEach(() => {
    api.listFolderBooks.mockReset();
    api.renameFolder.mockReset();
  });

  it('keeps B when A resolves after B', async () => {
    const requestA = deferred();
    const requestB = deferred();
    api.listFolderBooks
      .mockReturnValueOnce(requestA.promise)
      .mockReturnValueOnce(requestB.promise);
    const { result } = renderHook(() => useFolderState());

    act(() => { void result.current.handleOpenFolder({ id: 1, name: 'A' }); });
    const firstSignal = api.listFolderBooks.mock.calls[0][1].signal;
    act(() => { void result.current.handleOpenFolder({ id: 2, name: 'B' }); });
    expect(firstSignal.aborted).toBe(true);

    await act(async () => {
      requestB.resolve({ books: [{ id: 22, title: 'Book B' }] });
      await requestB.promise;
    });
    await act(async () => {
      requestA.resolve({ books: [{ id: 11, title: 'Book A' }] });
      await requestA.promise;
    });

    expect(result.current.openFolder.id).toBe(2);
    expect(result.current.folderBooks.map((book) => book.id)).toEqual([22]);
    expect(result.current.folderError).toBe('');
  });

  it('does not restore state after close and ignores AbortError', async () => {
    vi.useFakeTimers();
    const request = deferred();
    api.listFolderBooks.mockReturnValue(request.promise);
    const { result } = renderHook(() => useFolderState());

    act(() => { void result.current.handleOpenFolder({ id: 3, name: 'C' }); });
    act(() => result.current.handleCloseFolder());
    expect(api.listFolderBooks.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { vi.advanceTimersByTime(180); });

    await act(async () => {
      request.reject(new DOMException('aborted', 'AbortError'));
      await request.promise.catch(() => {});
    });
    expect(result.current.openFolder).toBeNull();
    expect(result.current.folderBooks).toEqual([]);
    expect(result.current.folderError).toBe('');
  });

  it('shows a real error only for the current request', async () => {
    api.listFolderBooks.mockRejectedValue(new Error('当前文件夹网络错误'));
    const { result } = renderHook(() => useFolderState());

    await act(async () => {
      await result.current.handleOpenFolder({ id: 5, name: 'E' });
    });
    expect(result.current.folderError).toBe('当前文件夹网络错误');
    expect(result.current.isFolderLoading).toBe(false);
  });

  it('finishes close synchronously when reduced motion is requested', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    api.listFolderBooks.mockResolvedValue({ books: [] });
    const { result } = renderHook(() => useFolderState());

    await act(async () => {
      await result.current.handleOpenFolder({ id: 4, name: 'D' });
    });
    act(() => result.current.handleCloseFolder());
    expect(result.current.openFolder).toBeNull();
    expect(result.current.isFolderClosing).toBe(false);
  });
});
