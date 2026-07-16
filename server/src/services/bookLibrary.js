import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
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
import { InvalidEpubError, validateEpubArchive } from './epubValidation.js';

const booksStoragePrefix = 'data/books/';
const coversStoragePrefix = 'data/covers/';

function nextShelfSortOrder(db) {
  return db
    .prepare(
      `SELECT COALESCE(MAX(sort_order), 0) + 1000 AS value
       FROM (
         SELECT sort_order FROM books WHERE folder_id IS NULL
         UNION ALL
         SELECT sort_order FROM folders
       )`,
    )
    .get().value;
}

function storagePathToUrl(storedPath, storagePrefix, urlPrefix) {
  if (!storedPath || !storedPath.startsWith(storagePrefix)) {
    return null;
  }

  return `${urlPrefix}/${storedPath.slice(storagePrefix.length).split('/').map(encodeURIComponent).join('/')}`;
}

function managedBookFilePath(storedPath) {
  const bookFilePath = path.resolve(toAbsoluteStoragePath(storedPath));
  const bookRoot = path.resolve(booksDir);
  const relativePath = path.relative(bookRoot, bookFilePath);

  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath) || !isEpubFileName(bookFilePath)) {
    const error = new Error('Stored book file is not managed by the library');
    error.status = 500;
    throw error;
  }

  return bookFilePath;
}

export function formatBook(row) {
  return {
    id: row.id,
    folderId: row.folder_id,
    title: row.title,
    author: row.author,
    description: row.description,
    publisher: row.publisher,
    language: row.language,
    identifier: row.identifier,
    fileName: row.file_name,
    fileSize: row.file_size,
    coverPath: row.cover_path,
    coverUrl: storagePathToUrl(row.cover_path, coversStoragePrefix, '/covers'),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listBooks(db, options = {}) {
  const hasFolderId = Object.hasOwn(options, 'folderId');

  const rows = hasFolderId
    ? db
        .prepare(
          `SELECT *
           FROM books
           WHERE folder_id = ?
           ORDER BY sort_order ASC, id ASC`,
        )
        .all(options.folderId)
    : db
        .prepare(
          `SELECT *
           FROM books
           WHERE folder_id IS NULL
           ORDER BY sort_order ASC, id ASC`,
        )
        .all();

  return rows.map(formatBook);
}

export function updateShelfBookOrder(db, bookIds) {
  const currentBookIds = db
    .prepare(
      `SELECT id
       FROM books
       WHERE folder_id IS NULL
       ORDER BY sort_order ASC, id ASC`,
    )
    .all()
    .map((book) => book.id);

  const requestedBookIds = new Set(bookIds);
  const hasCurrentShelf =
    currentBookIds.length === requestedBookIds.size &&
    currentBookIds.every((bookId) => requestedBookIds.has(bookId));

  if (!hasCurrentShelf) {
    const error = new Error('Book order is out of date');
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

  db.transaction(() => {
    bookIds.forEach((bookId, index) => {
      updateBookOrder.run((index + 1) * 1000, bookId);
    });
  })();

  return listBooks(db);
}

export async function inspectEpubFile(filePath, options = {}) {
  if (!options.archiveValidated) validateEpubArchive(filePath, options.validationLimits);
  if (options.epubDetails) return options.epubDetails;

  try {
    return await (options.parseDetails || parseEpubDetails)(filePath);
  } catch (error) {
    throw new InvalidEpubError('EPUB_PARSE', { cause: error });
  }
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
  const existing = db.prepare('SELECT * FROM books WHERE file_path = ?').get(storedPath);
  const epubDetails = await inspectEpubFile(filePath, options);
  const metadata = epubDetails.metadata;
  const coverImage = epubDetails.coverImage;
  const title = metadata.title || options.title || existing?.title || fallbackTitle;
  const author = metadata.author;
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
        author: metadata.author,
        description: metadata.description,
        publisher: metadata.publisher,
        language: metadata.language,
        identifier: metadata.identifier,
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
  const book = db.prepare('SELECT folder_id, cover_path FROM books WHERE file_path = ?').get(storedPath);
  const changes = db.prepare('DELETE FROM books WHERE file_path = ?').run(storedPath).changes;

  if (changes) {
    deleteStoredCover(book?.cover_path);

    if (book?.folder_id) {
      db.prepare(
        `DELETE FROM folders
         WHERE id = ?
           AND NOT EXISTS (
             SELECT 1
             FROM books
             WHERE folder_id = folders.id
           )`,
      ).run(book.folder_id);
    }
  }

  return changes;
}

export function getBookById(db, id) {
  const row = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
  return row ? formatBook(row) : null;
}

export function getBookFilePath(db, id) {
  const row = db.prepare('SELECT file_path FROM books WHERE id = ?').get(id);
  if (!row) return null;
  return managedBookFilePath(row.file_path);
}

export function deleteBookById(db, id) {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);

  if (!book) {
    return null;
  }

  const bookFilePath = managedBookFilePath(book.file_path);

  if (existsSync(bookFilePath)) {
    unlinkSync(bookFilePath);
  }

  removeBookFileFromLibrary(db, bookFilePath);

  return formatBook(book);
}

function listEpubFilesRecursive(dir) {
  const files = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...listEpubFilesRecursive(filePath));
      continue;
    }

    if (entry.isFile() && isEpubFileName(entry.name)) {
      files.push(filePath);
    }
  }

  return files;
}

export async function syncBookDirectory(db, options = {}) {
  ensureBookDirectory();

  const currentBookPaths = new Set();
  const filePaths = listEpubFilesRecursive(booksDir);

  for (const filePath of filePaths) {
    try {
      const book = await addBookFileToLibrary(db, filePath, {
        parseDetails: options.parseDetails,
      });
      if (book) currentBookPaths.add(toStoredPath(filePath));
    } catch (error) {
      if (!(error instanceof InvalidEpubError)) throw error;
      console.warn(`Skipped invalid EPUB file ${path.resolve(filePath)} [${error.code}]`);
      removeBookFileFromLibrary(db, filePath);
    }
  }

  const trackedBooks = db
    .prepare('SELECT id, file_path, cover_path FROM books WHERE file_path LIKE ?')
    .all(`${booksStoragePrefix}%`);

  for (const book of trackedBooks) {
    const absolutePath = toAbsoluteStoragePath(book.file_path);

    if (!currentBookPaths.has(book.file_path) && !existsSync(absolutePath)) {
      removeBookFileFromLibrary(db, absolutePath);
    }
  }
}
