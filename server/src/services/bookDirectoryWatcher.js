import path from 'node:path';
import chokidar from 'chokidar';
import { booksDir, ensureBookDirectory, isEpubFileName } from './fileStorage.js';
import {
  addBookFileToLibrary,
  removeBookFileFromLibrary,
  syncBookDirectory,
} from './bookLibrary.js';
import { InvalidEpubError } from './epubValidation.js';

function logSyncError(action, filePath, error) {
  console.error(`Failed to ${action} EPUB file ${path.resolve(filePath)} [${error.code || 'UNEXPECTED_ERROR'}]`);
}

export function startBookDirectoryWatcher(db, dependencies = {}) {
  const addBook = dependencies.addBookFileToLibrary || addBookFileToLibrary;
  const removeBook = dependencies.removeBookFileFromLibrary || removeBookFileFromLibrary;
  const syncBooks = dependencies.syncBookDirectory || syncBookDirectory;
  const watch = dependencies.watch || chokidar.watch;
  let readySyncStarted = false;

  ensureBookDirectory();
  const watcher = watch(booksDir, {
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100,
    },
    ignoreInitial: true,
  });

  watcher.on('add', async (filePath) => {
    if (!isEpubFileName(filePath)) return;
    try {
      await addBook(db, filePath);
    } catch (error) {
      if (error instanceof InvalidEpubError) removeBook(db, filePath);
      logSyncError('add', filePath, error);
    }
  });

  watcher.on('change', async (filePath) => {
    if (!isEpubFileName(filePath)) return;
    try {
      await addBook(db, filePath, { forceRefresh: true });
    } catch (error) {
      if (error instanceof InvalidEpubError) removeBook(db, filePath);
      logSyncError('update', filePath, error);
    }
  });

  watcher.on('unlink', (filePath) => {
    if (!isEpubFileName(filePath)) return;
    try {
      removeBook(db, filePath);
    } catch (error) {
      logSyncError('remove', filePath, error);
    }
  });

  watcher.on('ready', async () => {
    if (readySyncStarted) return;
    readySyncStarted = true;
    try {
      await syncBooks(db);
    } catch (error) {
      console.error('Failed to sync EPUB directory on watcher ready:', error);
    }
  });

  watcher.on('error', (error) => {
    console.error('Book directory watcher error:', error);
  });

  return watcher;
}
