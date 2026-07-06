import chokidar from 'chokidar';
import { booksDir, ensureBookDirectory, isEpubFileName } from './fileStorage.js';
import {
  addBookFileToLibrary,
  removeBookFileFromLibrary,
  syncBookDirectory,
} from './bookLibrary.js';

function logSyncError(action, filePath, err) {
  console.error(`Failed to ${action} EPUB file ${filePath}:`, err);
}

export function startBookDirectoryWatcher(db) {
  ensureBookDirectory();
  syncBookDirectory(db);

  const watcher = chokidar.watch(booksDir, {
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100,
    },
    depth: 0,
    ignoreInitial: true,
  });

  watcher.on('add', (filePath) => {
    if (isEpubFileName(filePath)) {
      try {
        addBookFileToLibrary(db, filePath);
      } catch (err) {
        logSyncError('add', filePath, err);
      }
    }
  });

  watcher.on('change', (filePath) => {
    if (isEpubFileName(filePath)) {
      try {
        addBookFileToLibrary(db, filePath);
      } catch (err) {
        logSyncError('update', filePath, err);
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

  watcher.on('ready', () => {
    try {
      syncBookDirectory(db);
    } catch (err) {
      console.error('Failed to sync EPUB directory on watcher ready:', err);
    }
  });

  watcher.on('error', (err) => {
    console.error('Book directory watcher error:', err);
  });

  return watcher;
}
