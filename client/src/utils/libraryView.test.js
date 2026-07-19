import { describe, expect, it } from 'vitest';
import {
  buildLibraryDataset,
  deriveVisibleLibraryItems,
  getLibrarySortOptions,
  LIBRARY_SORT,
  LIBRARY_VIEW,
  normalizeLibrarySearchText,
  sortLibraryItems,
} from './libraryView.js';

const shelfItems = [
  {
    type: 'book', id: 1, key: 'book:1',
    book: {
      id: 1,
      title: '活着',
      author: '余华',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  },
  {
    type: 'folder', id: 3, key: 'folder:3',
    folder: { id: 3, name: '历史', previewBooks: [] },
  },
];
const catalogBooks = [
  {
    id: 1, folderId: null, folderName: null, title: '活着', author: '余华',
    createdAt: '2026-01-01T00:00:00.000Z',
    readingUpdatedAt: '2026-04-02T00:00:00.000Z',
  },
  {
    id: 7, folderId: 3, folderName: '历史', title: '万历十五年', author: '黄仁宇',
    createdAt: '2026-02-01T00:00:00.000Z',
    readingUpdatedAt: '2026-02-02T00:00:00.000Z',
  },
  {
    id: 8, folderId: 3, folderName: '历史', title: '中国大历史', author: '黄仁宇',
    createdAt: '2026-03-01T00:00:00.000Z',
    readingUpdatedAt: '2026-03-02T00:00:00.000Z',
  },
];

describe('buildLibraryDataset', () => {
  it('normalizes full-width and case differences', () => {
    expect(normalizeLibrarySearchText('  ＡＢＣ  ')).toBe('abc');
  });

  it.each([
    ['万历', ['book:7']],
    ['黄仁宇', ['book:7', 'book:8']],
    ['历史', ['book:8', 'folder:3']],
  ])('searches the complete catalog for %s', (query, expectedKeys) => {
    const result = buildLibraryDataset({
      shelfItems,
      catalogBooks,
      query,
      view: LIBRARY_VIEW.FOLDERS,
    });
    expect(result.map((item) => item.key)).toEqual(expectedKeys);
  });

  it('shows folder context for a matching nested book', () => {
    const [item] = buildLibraryDataset({
      shelfItems, catalogBooks, query: '万历', view: LIBRARY_VIEW.ALL,
    });
    expect(item).toMatchObject({
      type: 'book', id: 7, key: 'book:7', folderName: '历史',
    });
  });

  it('uses the fixed dataset for each quick view', () => {
    expect(buildLibraryDataset({
      shelfItems, catalogBooks, query: '', view: LIBRARY_VIEW.ALL,
    })).toBe(shelfItems);
    expect(buildLibraryDataset({
      shelfItems, catalogBooks, query: '', view: LIBRARY_VIEW.RECENT_ADDED,
    }).map((item) => item.key)).toEqual(['book:1', 'book:7', 'book:8']);
    expect(buildLibraryDataset({
      shelfItems, catalogBooks, query: '', view: LIBRARY_VIEW.FOLDERS,
    }).map((item) => item.key)).toEqual(['folder:3']);
  });
});

describe('sortLibraryItems', () => {
  it('preserves the authoritative manual order by reference', () => {
    expect(deriveVisibleLibraryItems({
      shelfItems, catalogBooks, query: '', view: LIBRARY_VIEW.ALL,
      sort: LIBRARY_SORT.MANUAL,
    })).toBe(shelfItems);
  });

  it('uses catalog timestamps for root books and folder date sorts', () => {
    expect(deriveVisibleLibraryItems({
      shelfItems, catalogBooks, query: '', view: LIBRARY_VIEW.ALL,
      sort: LIBRARY_SORT.RECENT_ADDED,
    }).map((item) => item.key)).toEqual(['folder:3', 'book:1']);

    expect(deriveVisibleLibraryItems({
      shelfItems, catalogBooks, query: '', view: LIBRARY_VIEW.ALL,
      sort: LIBRARY_SORT.RECENT_READING,
    }).map((item) => item.key)).toEqual(['book:1', 'folder:3']);
  });

  it('groups authored books before empty authors and folders', () => {
    const emptyAuthorBook = {
      type: 'book', id: 2, key: 'book:2',
      book: { id: 2, title: '无作者', author: '' },
    };
    expect(sortLibraryItems(
      [shelfItems[1], emptyAuthorBook, shelfItems[0]],
      { sort: LIBRARY_SORT.AUTHOR, catalogBooks },
    ).map((item) => item.key)).toEqual(['book:1', 'book:2', 'folder:3']);
  });

  it('uses smaller ids when titles match and leaves the input unchanged', () => {
    const sameTitleItems = [
      { type: 'book', id: 9, key: 'book:9', book: { id: 9, title: '同名', author: '甲' } },
      { type: 'book', id: 2, key: 'book:2', book: { id: 2, title: '同名', author: '乙' } },
    ];
    const before = sameTitleItems.map((item) => item.key);

    expect(sortLibraryItems(
      sameTitleItems,
      { sort: LIBRARY_SORT.TITLE, catalogBooks },
    ).map((item) => item.key)).toEqual(['book:2', 'book:9']);
    expect(sameTitleItems.map((item) => item.key)).toEqual(before);
  });

  it('places missing dates after dated items', () => {
    const undatedBook = {
      type: 'book', id: 2, key: 'book:2',
      book: { id: 2, title: '未读', author: '作者' },
    };
    expect(sortLibraryItems(
      [undatedBook, shelfItems[0]],
      { sort: LIBRARY_SORT.RECENT_READING, catalogBooks },
    ).map((item) => item.key)).toEqual(['book:1', 'book:2']);
  });

  it('falls back from manual to title ordering while searching', () => {
    const searchCatalog = [
      { id: 2, title: 'Beta', author: 'match' },
      { id: 1, title: 'Alpha', author: 'match' },
    ];
    expect(deriveVisibleLibraryItems({
      shelfItems: [], catalogBooks: searchCatalog, query: 'match',
      view: LIBRARY_VIEW.ALL, sort: LIBRARY_SORT.MANUAL,
    }).map((item) => item.key)).toEqual(['book:1', 'book:2']);
  });
});

describe('getLibrarySortOptions', () => {
  const optionValues = (options) => options.map((option) => option.value);

  it('returns the fixed options for search and quick views', () => {
    expect(optionValues(getLibrarySortOptions({
      view: LIBRARY_VIEW.ALL,
      searchMode: true,
    }))).toEqual([
      LIBRARY_SORT.RECENT_READING,
      LIBRARY_SORT.RECENT_ADDED,
      LIBRARY_SORT.TITLE,
      LIBRARY_SORT.AUTHOR,
    ]);
    expect(optionValues(getLibrarySortOptions({
      view: LIBRARY_VIEW.ALL,
      searchMode: false,
    }))).toEqual([
      LIBRARY_SORT.MANUAL,
      LIBRARY_SORT.RECENT_READING,
      LIBRARY_SORT.RECENT_ADDED,
      LIBRARY_SORT.TITLE,
      LIBRARY_SORT.AUTHOR,
    ]);
    expect(optionValues(getLibrarySortOptions({
      view: LIBRARY_VIEW.RECENT_ADDED,
      searchMode: false,
    }))).toEqual([
      LIBRARY_SORT.RECENT_READING,
      LIBRARY_SORT.RECENT_ADDED,
      LIBRARY_SORT.TITLE,
      LIBRARY_SORT.AUTHOR,
    ]);
    expect(getLibrarySortOptions({
      view: LIBRARY_VIEW.FOLDERS,
      searchMode: false,
    })).toEqual([]);
  });
});
