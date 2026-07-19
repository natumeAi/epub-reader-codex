import { useCallback, useMemo, useRef, useState } from 'react';
import {
  deriveVisibleLibraryItems,
  getLibrarySortOptions,
  LIBRARY_SORT,
  LIBRARY_VIEW,
  normalizeLibrarySearchText,
} from '../utils/libraryView.js';

const allowedSorts = new Set(Object.values(LIBRARY_SORT));

const defaultSortByView = Object.freeze({
  [LIBRARY_VIEW.ALL]: LIBRARY_SORT.MANUAL,
  [LIBRARY_VIEW.RECENT_ADDED]: LIBRARY_SORT.RECENT_ADDED,
  [LIBRARY_VIEW.FOLDERS]: LIBRARY_SORT.MANUAL,
});

const viewLabels = Object.freeze({
  [LIBRARY_VIEW.ALL]: '全部',
  [LIBRARY_VIEW.RECENT_ADDED]: '最近添加',
  [LIBRARY_VIEW.FOLDERS]: '文件夹',
});

export function useLibraryView({ shelfItems, catalogBooks }) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState(LIBRARY_VIEW.ALL);
  const [sort, setSort] = useState(LIBRARY_SORT.MANUAL);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchSnapshotRef = useRef(null);

  const focusSearch = useCallback(() => {
    if (!searchSnapshotRef.current) {
      searchSnapshotRef.current = { view, sort };
    }
    setSearchFocused(true);
    if (sort === LIBRARY_SORT.MANUAL || view === LIBRARY_VIEW.FOLDERS) {
      setSort(LIBRARY_SORT.TITLE);
    }
  }, [sort, view]);

  const changeQuery = useCallback((value) => {
    setQuery(value);
  }, []);

  const restoreSearchSnapshot = useCallback(() => {
    const snapshot = searchSnapshotRef.current;
    setQuery('');
    setSearchFocused(false);
    if (snapshot) {
      setView(snapshot.view);
      setSort(snapshot.sort);
    }
    searchSnapshotRef.current = null;
  }, []);

  const selectView = useCallback((nextView) => {
    if (!(nextView in defaultSortByView)) return;
    setQuery('');
    setSearchFocused(false);
    searchSnapshotRef.current = null;
    setView(nextView);
    setSort(defaultSortByView[nextView]);
  }, []);

  const selectSort = useCallback((nextSort) => {
    if (allowedSorts.has(nextSort)) {
      setSort(nextSort);
    }
  }, []);

  const normalizedQuery = normalizeLibrarySearchText(query);
  const searchMode = searchFocused || Boolean(normalizedQuery);
  const visibleItems = useMemo(() => deriveVisibleLibraryItems({
    shelfItems,
    catalogBooks,
    query,
    view,
    sort,
  }), [catalogBooks, query, shelfItems, sort, view]);
  const editable = !normalizedQuery &&
    view === LIBRARY_VIEW.ALL &&
    sort === LIBRARY_SORT.MANUAL;
  const resultCount = visibleItems.length;
  const modeLabel = normalizedQuery
    ? `搜索“${query.trim()}”，${resultCount} 项结果`
    : `${viewLabels[view]}，${resultCount} 项${editable ? '' : '，只读视图'}`;
  const sortOptions = useMemo(
    () => getLibrarySortOptions({ view, searchMode }),
    [searchMode, view],
  );

  return {
    query,
    view,
    sort,
    searchFocused,
    focusSearch,
    changeQuery,
    clearSearch: restoreSearchSnapshot,
    cancelSearch: restoreSearchSnapshot,
    selectView,
    selectSort,
    visibleItems,
    resultCount,
    searchMode,
    editable,
    modeLabel,
    sortOptions,
  };
}
