import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDatabase } from './db/database.js';
import booksRouter from './routes/books.js';
import foldersRouter from './routes/folders.js';
import readingRouter from './routes/reading.js';
import { coversDir, ensureCoverDirectory } from './services/fileStorage.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const clientDistDir = path.resolve(currentDir, '..', 'public');
const clientIndexFile = path.join(clientDistDir, 'index.html');

export function createApp({ db } = {}) {
  const app = express();

  app.locals.db = db;

  ensureCoverDirectory();

  app.use(express.json({ limit: '1mb' }));
  app.use('/covers', express.static(coversDir));

  app.get('/api/health', (req, res) => {
    const database = req.app.locals.db ? checkDatabase(req.app.locals.db) : 'unconfigured';

    res.json({
      status: 'ok',
      service: 'epub-reader-server',
      database,
    });
  });

  app.use('/api/books', booksRouter);
  app.use('/api/folders', foldersRouter);
  app.use('/api/reading', readingRouter);

  if (existsSync(clientIndexFile)) {
    app.use(express.static(clientDistDir));
    app.get(/^\/(?!api\/|covers\/).*/, (req, res) => {
      res.sendFile(clientIndexFile);
    });
  }

  app.use((req, res) => {
    res.status(404).json({
      error: 'Not Found',
    });
  });

  app.use((err, req, res, next) => {
    const status = err.status || 500;

    res.status(status).json({
      error: status === 500 ? 'Internal Server Error' : err.message,
    });
  });

  return app;
}

export default createApp();
