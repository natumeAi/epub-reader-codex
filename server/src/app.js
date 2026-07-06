import express from 'express';
import { checkDatabase } from './db/database.js';
import booksRouter from './routes/books.js';
import foldersRouter from './routes/folders.js';
import { coversDir, ensureCoverDirectory } from './services/fileStorage.js';

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
