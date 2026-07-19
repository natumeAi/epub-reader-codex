export const LIBRARY_VIEW = Object.freeze({
  ALL: 'all',
  RECENT_ADDED: 'recent-added',
  FOLDERS: 'folders',
});

export const LIBRARY_SORT = Object.freeze({
  MANUAL: 'manual',
  RECENT_READING: 'recent-reading',
  RECENT_ADDED: 'recent-added',
  TITLE: 'title',
  AUTHOR: 'author',
});

export function normalizeLibrarySearchText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('zh-CN');
}

export function catalogBookToLibraryItem(book) {
  return {
    type: 'book',
    id: book.id,
    key: `book:${book.id}`,
    book,
    folderName: book.folderName ?? null,
  };
}

export function buildLibraryDataset({
  shelfItems = [],
  catalogBooks = [],
  query = '',
  view = LIBRARY_VIEW.ALL,
}) {
  const normalizedQuery = normalizeLibrarySearchText(query);

  if (normalizedQuery) {
    const matchingBooks = catalogBooks
      .filter((book) => [book.title, book.author].some((value) =>
        normalizeLibrarySearchText(value).includes(normalizedQuery),
      ))
      .map(catalogBookToLibraryItem);
    const matchingFolders = shelfItems.filter((item) =>
      item.type === 'folder' &&
      normalizeLibrarySearchText(item.folder?.name).includes(normalizedQuery),
    );
    return [...matchingBooks, ...matchingFolders];
  }

  if (view === LIBRARY_VIEW.RECENT_ADDED) {
    return catalogBooks.map(catalogBookToLibraryItem);
  }
  if (view === LIBRARY_VIEW.FOLDERS) {
    return shelfItems.filter((item) => item.type === 'folder');
  }
  return shelfItems;
}
