import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeFolderBook, normalizeShelfItem } from '../utils/libraryItems.js';
import { useLibraryDrag } from './useLibraryDrag.js';

const api = vi.hoisted(() => ({
  createFolderFromBooks: vi.fn(),
  moveFolderBookToShelf: vi.fn(),
  moveShelfBookToFolder: vi.fn(),
  updateFolderBookOrder: vi.fn(),
  updateShelfItemOrder: vi.fn(),
}));

vi.mock('../api/foldersApi.js', () => api);

function createHookProps({ folderBooks = [], openFolder = null, shelfItems }) {
  return {
    folderBooks,
    folderCloseVersion: 0,
    isSavingFolderOrder: false,
    isSavingOrder: false,
    loadShelf: vi.fn().mockResolvedValue(undefined),
    onDropOnDelete: vi.fn(),
    openFolder,
    setError: vi.fn(),
    setFolderBooks: vi.fn(),
    setFolderError: vi.fn(),
    setIsFolderLoading: vi.fn(),
    setIsRenamingFolder: vi.fn(),
    setIsSavingFolderOrder: vi.fn(),
    setIsSavingOrder: vi.fn(),
    setOpenFolder: vi.fn(),
    setShelfItems: vi.fn(),
    shelfItems,
  };
}

function publishMembershipIntent(result, activeItem, targetItem) {
  const active = {
    id: activeItem.key,
    data: { current: { item: activeItem, type: 'book' } },
  };
  const rect = {
    bottom: 100,
    height: 100,
    left: 0,
    right: 100,
    top: 0,
    width: 100,
  };
  const droppableContainers = [
    { data: { current: { type: 'book' } }, id: activeItem.key },
    { data: { current: { type: targetItem.type } }, id: targetItem.key },
  ];

  act(() => {
    result.current.appCollisionDetection({
      active,
      collisionRect: rect,
      droppableContainers,
      droppableRects: new Map([
        [activeItem.key, rect],
        [targetItem.key, rect],
      ]),
    });
  });

  return active;
}

describe('useLibraryDrag membership refreshes', () => {
  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset());
    api.createFolderFromBooks.mockResolvedValue({ shelfItems: [] });
    api.moveFolderBookToShelf.mockResolvedValue({ shelfItems: [] });
    api.moveShelfBookToFolder.mockResolvedValue({ shelfItems: [] });
  });

  it('refreshes all library resources after creating a folder', async () => {
    const firstBook = normalizeShelfItem({ type: 'book', id: 1, book: { id: 1 } });
    const secondBook = normalizeShelfItem({ type: 'book', id: 2, book: { id: 2 } });
    const props = createHookProps({ shelfItems: [firstBook, secondBook] });
    const { result } = renderHook(() => useLibraryDrag(props));
    const active = publishMembershipIntent(result, firstBook, secondBook);

    await act(async () => {
      await result.current.handleDragEnd({ active, over: { id: active.id } });
    });

    expect(api.createFolderFromBooks).toHaveBeenCalledWith(1, 2);
    expect(props.loadShelf).toHaveBeenCalledTimes(1);
  });

  it('refreshes all library resources after moving a shelf book into a folder', async () => {
    const book = normalizeShelfItem({ type: 'book', id: 1, book: { id: 1 } });
    const folder = normalizeShelfItem({ type: 'folder', id: 3, folder: { id: 3 } });
    const props = createHookProps({ shelfItems: [book, folder] });
    const { result } = renderHook(() => useLibraryDrag(props));
    const active = publishMembershipIntent(result, book, folder);

    await act(async () => {
      await result.current.handleDragEnd({ active, over: { id: active.id } });
    });

    expect(api.moveShelfBookToFolder).toHaveBeenCalledWith(3, 1);
    expect(props.loadShelf).toHaveBeenCalledTimes(1);
  });

  it('refreshes all library resources after moving a folder book to the shelf', async () => {
    const rootBook = normalizeShelfItem({ type: 'book', id: 1, book: { id: 1 } });
    const folder = normalizeShelfItem({ type: 'folder', id: 3, folder: { id: 3 } });
    const folderBook = normalizeFolderBook({ id: 4, sortOrder: 1000, title: '文件夹书' });
    const props = createHookProps({
      folderBooks: [folderBook],
      openFolder: folder.folder,
      shelfItems: [rootBook, folder],
    });
    const { rerender, result } = renderHook(
      ({ hookProps }) => useLibraryDrag(hookProps),
      { initialProps: { hookProps: props } },
    );
    const panel = document.createElement('div');
    panel.className = 'folder-panel';
    panel.getBoundingClientRect = () => ({
      bottom: 100,
      height: 100,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
    });
    document.body.append(panel);
    const active = {
      data: { current: { book: folderBook, type: 'folder-book' } },
      id: folderBook.key,
      rect: {
        current: {
          initial: { height: 20, left: 10, top: 10, width: 20 },
        },
      },
    };

    act(() => {
      result.current.handleDragMove({ active, delta: { x: 200, y: 0 } });
    });
    const nextShelfItems = props.setShelfItems.mock.calls.at(-1)[0];
    rerender({
      hookProps: {
        ...props,
        folderBooks: [],
        openFolder: null,
        shelfItems: nextShelfItems,
      },
    });

    await act(async () => {
      await result.current.handleDragEnd({ active, over: { id: rootBook.key } });
    });
    panel.remove();

    expect(api.moveFolderBookToShelf).toHaveBeenCalled();
    expect(props.loadShelf).toHaveBeenCalledTimes(1);
  });
});
