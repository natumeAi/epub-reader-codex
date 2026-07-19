import { describe, expect, it } from 'vitest';
import {
  buildLibraryDataset,
  LIBRARY_VIEW,
  normalizeLibrarySearchText,
} from './libraryView.js';

const shelfItems = [
  { type: 'book', id: 1, key: 'book:1', book: { id: 1, title: '活着', author: '余华' } },
  {
    type: 'folder', id: 3, key: 'folder:3',
    folder: { id: 3, name: '历史', previewBooks: [] },
  },
];
const catalogBooks = [
  { id: 1, folderId: null, folderName: null, title: '活着', author: '余华' },
  { id: 7, folderId: 3, folderName: '历史', title: '万历十五年', author: '黄仁宇' },
  { id: 8, folderId: 3, folderName: '历史', title: '中国大历史', author: '黄仁宇' },
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
