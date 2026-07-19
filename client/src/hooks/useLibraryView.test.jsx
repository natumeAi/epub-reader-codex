import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LIBRARY_SORT, LIBRARY_VIEW } from '../utils/libraryView.js';
import { useLibraryView } from './useLibraryView.js';

const shelfItems = [
  { type: 'book', id: 1, key: 'book:1', book: { id: 1, title: '活着', author: '余华' } },
  { type: 'folder', id: 3, key: 'folder:3', folder: { id: 3, name: '历史' } },
];
const catalogBooks = [
  { id: 1, folderId: null, title: '活着', author: '余华' },
  { id: 7, folderId: 3, folderName: '历史', title: '万历十五年', author: '黄仁宇' },
];

describe('useLibraryView', () => {
  it('starts at the only editable state', () => {
    const { result } = renderHook(() => useLibraryView({ shelfItems, catalogBooks }));
    expect(result.current).toMatchObject({
      query: '', view: LIBRARY_VIEW.ALL, sort: LIBRARY_SORT.MANUAL,
      searchFocused: false, searchMode: false, editable: true, resultCount: 2,
      modeLabel: '全部，2 项',
    });
  });

  it('restores the pre-search view and sort on cancel', () => {
    const { result } = renderHook(() => useLibraryView({ shelfItems, catalogBooks }));
    act(() => result.current.selectSort(LIBRARY_SORT.RECENT_ADDED));
    act(() => result.current.focusSearch());
    act(() => result.current.changeQuery('万历'));
    expect(result.current.visibleItems[0]).toMatchObject({ id: 7, folderName: '历史' });
    expect(result.current).toMatchObject({
      searchMode: true,
      editable: false,
      modeLabel: '搜索“万历”，1 项结果',
    });

    act(() => result.current.cancelSearch());
    expect(result.current).toMatchObject({
      query: '', view: LIBRARY_VIEW.ALL,
      sort: LIBRARY_SORT.RECENT_ADDED, searchMode: false, editable: false,
      modeLabel: '全部，2 项，只读视图',
    });
  });

  it('keeps the first search snapshot and restores it on clear', () => {
    const { result } = renderHook(() => useLibraryView({ shelfItems, catalogBooks }));
    act(() => result.current.selectView(LIBRARY_VIEW.RECENT_ADDED));
    act(() => result.current.focusSearch());
    act(() => result.current.changeQuery('余华'));
    act(() => result.current.focusSearch());
    act(() => result.current.selectSort(LIBRARY_SORT.AUTHOR));
    act(() => result.current.clearSearch());

    expect(result.current).toMatchObject({
      query: '', view: LIBRARY_VIEW.RECENT_ADDED,
      sort: LIBRARY_SORT.RECENT_ADDED, searchFocused: false,
    });
  });

  it('clears search and applies each view default', () => {
    const { result } = renderHook(() => useLibraryView({ shelfItems, catalogBooks }));
    act(() => result.current.focusSearch());
    act(() => result.current.changeQuery('余华'));
    act(() => result.current.selectView(LIBRARY_VIEW.RECENT_ADDED));
    expect(result.current).toMatchObject({
      query: '', view: LIBRARY_VIEW.RECENT_ADDED,
      sort: LIBRARY_SORT.RECENT_ADDED, searchMode: false, editable: false,
    });
    act(() => result.current.selectView(LIBRARY_VIEW.FOLDERS));
    expect(result.current).toMatchObject({
      query: '', view: LIBRARY_VIEW.FOLDERS,
      sort: LIBRARY_SORT.MANUAL, editable: false,
    });
    expect(result.current.sortOptions).toEqual([]);
  });

  it('uses title ordering when search is focused from manual or folders', () => {
    const { result } = renderHook(() => useLibraryView({ shelfItems, catalogBooks }));

    act(() => result.current.focusSearch());
    expect(result.current.sort).toBe(LIBRARY_SORT.TITLE);

    act(() => result.current.cancelSearch());
    act(() => result.current.selectView(LIBRARY_VIEW.FOLDERS));
    act(() => result.current.focusSearch());
    expect(result.current.sort).toBe(LIBRARY_SORT.TITLE);
  });

  it('returns a non-all view to the editable manual shelf', () => {
    const { result } = renderHook(() => useLibraryView({ shelfItems, catalogBooks }));

    act(() => result.current.selectView(LIBRARY_VIEW.RECENT_ADDED));
    act(() => result.current.selectView(LIBRARY_VIEW.ALL));

    expect(result.current).toMatchObject({
      view: LIBRARY_VIEW.ALL,
      sort: LIBRARY_SORT.MANUAL,
      editable: true,
    });
  });

  it('ignores unsupported sort values', () => {
    const { result } = renderHook(() => useLibraryView({ shelfItems, catalogBooks }));
    act(() => result.current.selectSort('unsupported'));
    expect(result.current.sort).toBe(LIBRARY_SORT.MANUAL);
  });
});
