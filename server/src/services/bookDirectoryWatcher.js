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

export function startBookDirectoryWatcher(db) {
  ensureBookDirectory();
  syncBookDirectory(db).catch((err) => {
    console.error('Failed to sync EPUB directory on startup:', err);
  });

  const watcher = chokidar.watch(booksDir, {
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100,
    },
    ignoreInitial: true,
  });

  watcher.on('add', async (filePath) => {
    if (isEpubFileName(filePath)) {
      try {
        await addBookFileToLibrary(db, filePath);
      } catch (error) {
        if (error instanceof InvalidEpubError) removeBookFileFromLibrary(db, filePath);
        logSyncError('add or update', filePath, error);
      }
    }
  });

  watcher.on('change', async (filePath) => {
    if (isEpubFileName(filePath)) {
      try {
        await addBookFileToLibrary(db, filePath);
      } catch (error) {
        if (error instanceof InvalidEpubError) removeBookFileFromLibrary(db, filePath);
        logSyncError('add or update', filePath, error);
      }
    }
  });

  watcher.on('unlink', (filePath) => {
    if (isEpubFileName(filePath)) {
      try {
        removeBookFileFromLibrary(db, filePath);
      } catch (err) {
        logSyncError('remove', filePath, err);
      }
    }
  });

  watcher.on('ready', async () => {
    try {
      await syncBookDirectory(db);
    } catch (err) {
      console.error('Failed to sync EPUB directory on watcher ready:', err);
    }
  });

  watcher.on('error', (err) => {
    console.error('Book directory watcher error:', err);
  });

  return watcher;
}
