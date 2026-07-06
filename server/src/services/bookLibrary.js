import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  booksDir,
  ensureBookDirectory,
  isEpubFileName,
  titleFromFileName,
  toAbsoluteStoragePath,
  toStoredPath,
} from './fileStorage.js';

const booksStoragePrefix = 'data/books/';

function nextShelfSortOrder(db) {
  return db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) + 1000 AS value FROM books WHERE folder_id IS NULL')
    .get().value;
}

export function addBookFileToLibrary(db, filePath, options = {}) {
  if (!isEpubFileName(filePath)) {
    return null;
  }

  let fileStat;

  try {
    fileStat = statSync(filePath);
  } catch {
    return null;
  }

  if (!fileStat.isFile()) {
    return null;
  }

  const fileName = options.fileName || path.basename(filePath);
  const storedPath = toStoredPath(filePath);
  const title = options.title ?? titleFromFileName(fileName);

  return db.transaction(() => {
    const existing = db.prepare('SELECT * FROM books WHERE file_path = ?').get(storedPath);

    if (existing) {
      if (options.title === undefined) {
        db.prepare(
          `UPDATE books
           SET file_name = ?, file_size = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        ).run(fileName, fileStat.size, existing.id);
      } else {
        db.prepare(
          `UPDATE books
           SET title = ?, file_name = ?, file_size = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        ).run(title, fileName, fileStat.size, existing.id);
      }

      return db.prepare('SELECT * FROM books WHERE id = ?').get(existing.id);
    }

    const result = db
      .prepare(
        `INSERT INTO books (title, file_name, file_path, file_size, sort_order)
         VALUES (@title, @fileName, @filePath, @fileSize, @sortOrder)`,
      )
      .run({
        title,
        fileName,
        filePath: storedPath,
        fileSize: fileStat.size,
        sortOrder: nextShelfSortOrder(db),
      });

    return db.prepare('SELECT * FROM books WHERE id = ?').get(result.lastInsertRowid);
  })();
}

export function removeBookFileFromLibrary(db, filePath) {
  const storedPath = toStoredPath(filePath);
  return db.prepare('DELETE FROM books WHERE file_path = ?').run(storedPath).changes;
}

export function syncBookDirectory(db) {
  ensureBookDirectory();

  const currentBookPaths = new Set();
  const entries = readdirSync(booksDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !isEpubFileName(entry.name)) {
      continue;
    }

    const filePath = path.join(booksDir, entry.name);
    currentBookPaths.add(toStoredPath(filePath));
    addBookFileToLibrary(db, filePath);
  }

  const trackedBooks = db
    .prepare('SELECT id, file_path FROM books WHERE file_path LIKE ?')
    .all(`${booksStoragePrefix}%`);

  const removeMissingBook = db.prepare('DELETE FROM books WHERE id = ?');

  for (const book of trackedBooks) {
    const absolutePath = toAbsoluteStoragePath(book.file_path);

    if (!currentBookPaths.has(book.file_path) && !existsSync(absolutePath)) {
      removeMissingBook.run(book.id);
    }
  }
}
