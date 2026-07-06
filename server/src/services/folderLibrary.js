import { formatBook, listBooks } from './bookLibrary.js';

const defaultFolderName = '\u65b0\u5efa\u6587\u4ef6\u5939';

function normalizeFolderName(name) {
  if (typeof name !== 'string') {
    return defaultFolderName;
  }

  const trimmedName = name.trim();
  return trimmedName || defaultFolderName;
}

function folderPreviewBooks(db, folderId) {
  return db
    .prepare(
      `SELECT *
       FROM books
       WHERE folder_id = ?
       ORDER BY sort_order ASC, id ASC
       LIMIT 4`,
    )
    .all(folderId)
    .map(formatBook);
}

export function formatFolder(row, previewBooks = []) {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    bookCount: row.book_count ?? 0,
    previewBooks,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getFolder(db, folderId) {
  const row = db
    .prepare(
      `SELECT f.*,
              COUNT(b.id) AS book_count
       FROM folders f
       LEFT JOIN books b ON b.folder_id = f.id
       WHERE f.id = ?
       GROUP BY f.id`,
    )
    .get(folderId);

  return row ? formatFolder(row, folderPreviewBooks(db, row.id)) : null;
}

export function listFolders(db) {
  return db
    .prepare(
      `SELECT f.*,
              COUNT(b.id) AS book_count
       FROM folders f
       LEFT JOIN books b ON b.folder_id = f.id
       GROUP BY f.id
       ORDER BY f.sort_order ASC, f.id ASC`,
    )
    .all()
    .map((row) => formatFolder(row, folderPreviewBooks(db, row.id)));
}

export function listShelfItems(db) {
  const bookItems = listBooks(db).map((book) => ({
    type: 'book',
    id: book.id,
    sortOrder: book.sortOrder,
    book,
  }));

  const folderItems = listFolders(db).map((folder) => ({
    type: 'folder',
    id: folder.id,
    sortOrder: folder.sortOrder,
    folder,
  }));

  return [...bookItems, ...folderItems].sort((firstItem, secondItem) => {
    if (firstItem.sortOrder !== secondItem.sortOrder) {
      return firstItem.sortOrder - secondItem.sortOrder;
    }

    if (firstItem.type !== secondItem.type) {
      return firstItem.type.localeCompare(secondItem.type);
    }

    return firstItem.id - secondItem.id;
  });
}

export function createFolderFromBooks(db, options) {
  const sourceBookId = options.sourceBookId;
  const targetBookId = options.targetBookId;

  if (sourceBookId === targetBookId) {
    const error = new Error('sourceBookId and targetBookId must be different');
    error.status = 400;
    throw error;
  }

  return db.transaction(() => {
    const sourceBook = db.prepare('SELECT * FROM books WHERE id = ?').get(sourceBookId);
    const targetBook = db.prepare('SELECT * FROM books WHERE id = ?').get(targetBookId);

    if (!sourceBook || !targetBook) {
      const error = new Error('Book not found');
      error.status = 404;
      throw error;
    }

    if (sourceBook.folder_id !== null || targetBook.folder_id !== null) {
      const error = new Error('Folder creation requires two root shelf books');
      error.status = 409;
      throw error;
    }

    const folderResult = db
      .prepare(
        `INSERT INTO folders (name, sort_order)
         VALUES (?, ?)`,
      )
      .run(normalizeFolderName(options.name), targetBook.sort_order);

    const folderId = folderResult.lastInsertRowid;
    const moveBookIntoFolder = db.prepare(
      `UPDATE books
       SET folder_id = ?,
           sort_order = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    );

    moveBookIntoFolder.run(folderId, 1000, sourceBookId);
    moveBookIntoFolder.run(folderId, 2000, targetBookId);

    return {
      folder: getFolder(db, folderId),
      books: listBooks(db, { folderId }),
      shelfItems: listShelfItems(db),
    };
  })();
}

export function renameFolder(db, folderId, name) {
  const normalizedName = normalizeFolderName(name);
  const result = db
    .prepare(
      `UPDATE folders
       SET name = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .run(normalizedName, folderId);

  return result.changes ? getFolder(db, folderId) : null;
}

export function updateFolderBookOrder(db, folderId, bookIds) {
  const folder = getFolder(db, folderId);

  if (!folder) {
    const error = new Error('Folder not found');
    error.status = 404;
    throw error;
  }

  const currentBookIds = db
    .prepare(
      `SELECT id
       FROM books
       WHERE folder_id = ?
       ORDER BY sort_order ASC, id ASC`,
    )
    .all(folderId)
    .map((book) => book.id);

  const requestedBookIds = new Set(bookIds);
  const hasCurrentFolderBooks =
    currentBookIds.length === requestedBookIds.size &&
    currentBookIds.every((bookId) => requestedBookIds.has(bookId));

  if (!hasCurrentFolderBooks) {
    const error = new Error('Folder book order is out of date');
    error.status = 409;
    throw error;
  }

  const updateBookOrder = db.prepare(
    `UPDATE books
     SET sort_order = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND folder_id = ?`,
  );

  db.transaction(() => {
    bookIds.forEach((bookId, index) => {
      updateBookOrder.run((index + 1) * 1000, bookId, folderId);
    });
  })();

  return listBooks(db, { folderId });
}

export function updateShelfItemOrder(db, items) {
  const currentItemKeys = listShelfItems(db).map((item) => `${item.type}:${item.id}`);
  const requestedItemKeys = new Set(items.map((item) => `${item.type}:${item.id}`));
  const hasCurrentShelf =
    currentItemKeys.length === requestedItemKeys.size &&
    currentItemKeys.every((itemKey) => requestedItemKeys.has(itemKey));

  if (!hasCurrentShelf) {
    const error = new Error('Shelf order is out of date');
    error.status = 409;
    throw error;
  }

  const updateBookOrder = db.prepare(
    `UPDATE books
     SET sort_order = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND folder_id IS NULL`,
  );
  const updateFolderOrder = db.prepare(
    `UPDATE folders
     SET sort_order = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  );

  db.transaction(() => {
    items.forEach((item, index) => {
      const sortOrder = (index + 1) * 1000;

      if (item.type === 'book') {
        updateBookOrder.run(sortOrder, item.id);
        return;
      }

      updateFolderOrder.run(sortOrder, item.id);
    });
  })();

  return listShelfItems(db);
}

