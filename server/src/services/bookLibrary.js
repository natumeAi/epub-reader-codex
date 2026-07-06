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
import { deleteStoredCover, saveBookCover } from './coverStorage.js';
import { parseEpubDetails } from './epubService.js';

const booksStoragePrefix = 'data/books/';
const emptyMetadata = {
  title: null,
  author: null,
  description: null,
  publisher: null,
  language: null,
  identifier: null,
};

function nextShelfSortOrder(db) {
  return db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) + 1000 AS value FROM books WHERE folder_id IS NULL')
    .get().value;
}

export async function addBookFileToLibrary(db, filePath, options = {}) {
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
  const fallbackTitle = options.title ?? titleFromFileName(fileName);
  let metadata = emptyMetadata;
  let coverImage = null;
  let hasParsedMetadata = false;

  try {
    const epubDetails = await parseEpubDetails(filePath);
    metadata = epubDetails.metadata;
    coverImage = epubDetails.coverImage;
    hasParsedMetadata = true;
  } catch {
    metadata = emptyMetadata;
  }

  const existing = db.prepare('SELECT * FROM books WHERE file_path = ?').get(storedPath);
  const title = existing ? metadata.title || options.title || existing.title : metadata.title || fallbackTitle;
  const author = hasParsedMetadata ? metadata.author : existing?.author;
  const coverPath = saveBookCover({
    bookFilePath: filePath,
    coverImage,
    title,
    author,
  });

  return db.transaction(() => {
    if (existing) {
      const displayFileName = options.fileName || existing.file_name;

      db.prepare(
        `UPDATE books
         SET title = @title,
             author = @author,
             description = @description,
             publisher = @publisher,
             language = @language,
             identifier = @identifier,
             file_name = @fileName,
             file_size = @fileSize,
             cover_path = @coverPath,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = @id`,
      ).run({
        id: existing.id,
        title,
        author: hasParsedMetadata ? metadata.author : existing.author,
        description: hasParsedMetadata ? metadata.description : existing.description,
        publisher: hasParsedMetadata ? metadata.publisher : existing.publisher,
        language: hasParsedMetadata ? metadata.language : existing.language,
        identifier: hasParsedMetadata ? metadata.identifier : existing.identifier,
        fileName: displayFileName,
        fileSize: fileStat.size,
        coverPath,
      });

      return db.prepare('SELECT * FROM books WHERE id = ?').get(existing.id);
    }

    const result = db
      .prepare(
        `INSERT INTO books (
           title,
           author,
           description,
           publisher,
           language,
           identifier,
           file_name,
           file_path,
           file_size,
           cover_path,
           sort_order
         )
         VALUES (
           @title,
           @author,
           @description,
           @publisher,
           @language,
           @identifier,
           @fileName,
           @filePath,
           @fileSize,
           @coverPath,
           @sortOrder
         )`,
      )
      .run({
        title,
        author: metadata.author,
        description: metadata.description,
        publisher: metadata.publisher,
        language: metadata.language,
        identifier: metadata.identifier,
        fileName,
        filePath: storedPath,
        fileSize: fileStat.size,
        coverPath,
        sortOrder: nextShelfSortOrder(db),
      });

    return db.prepare('SELECT * FROM books WHERE id = ?').get(result.lastInsertRowid);
  })();
}

export function removeBookFileFromLibrary(db, filePath) {
  const storedPath = toStoredPath(filePath);
  const book = db.prepare('SELECT cover_path FROM books WHERE file_path = ?').get(storedPath);
  const changes = db.prepare('DELETE FROM books WHERE file_path = ?').run(storedPath).changes;

  if (changes) {
    deleteStoredCover(book?.cover_path);
  }

  return changes;
}

export async function syncBookDirectory(db) {
  ensureBookDirectory();

  const currentBookPaths = new Set();
  const entries = readdirSync(booksDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !isEpubFileName(entry.name)) {
      continue;
    }

    const filePath = path.join(booksDir, entry.name);
    currentBookPaths.add(toStoredPath(filePath));
    await addBookFileToLibrary(db, filePath);
  }

  const trackedBooks = db
    .prepare('SELECT id, file_path, cover_path FROM books WHERE file_path LIKE ?')
    .all(`${booksStoragePrefix}%`);

  const removeMissingBook = db.prepare('DELETE FROM books WHERE id = ?');

  for (const book of trackedBooks) {
    const absolutePath = toAbsoluteStoragePath(book.file_path);

    if (!currentBookPaths.has(book.file_path) && !existsSync(absolutePath)) {
      removeMissingBook.run(book.id);
      deleteStoredCover(book.cover_path);
    }
  }
}
