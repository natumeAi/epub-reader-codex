import { Router } from 'express';
import { listBooks } from '../services/bookLibrary.js';
import {
  createFolderFromBooks,
  getFolder,
  listFolders,
  listShelfItems,
  renameFolder,
  updateFolderBookOrder,
  updateShelfItemOrder,
} from '../services/folderLibrary.js';

const router = Router();

function requireDatabase(req) {
  const db = req.app.locals.db;

  if (!db) {
    const error = new Error('Database is not configured');
    error.status = 503;
    throw error;
  }

  return db;
}

function parsePositiveInteger(value, label) {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    const error = new Error(`${label} must be a positive integer`);
    error.status = 400;
    throw error;
  }

  return parsedValue;
}

function parseBookIds(value) {
  if (!Array.isArray(value)) {
    const error = new Error('bookIds must be an array');
    error.status = 400;
    throw error;
  }

  const bookIds = value.map((bookId) => parsePositiveInteger(bookId, 'book id'));

  if (new Set(bookIds).size !== bookIds.length) {
    const error = new Error('bookIds must be unique');
    error.status = 400;
    throw error;
  }

  return bookIds;
}

function parseShelfItems(value) {
  if (!Array.isArray(value)) {
    const error = new Error('items must be an array');
    error.status = 400;
    throw error;
  }

  const items = value.map((item) => {
    if (!item || (item.type !== 'book' && item.type !== 'folder')) {
      const error = new Error('items must contain book or folder entries');
      error.status = 400;
      throw error;
    }

    return {
      type: item.type,
      id: parsePositiveInteger(item.id, `${item.type} id`),
    };
  });

  const itemKeys = items.map((item) => `${item.type}:${item.id}`);

  if (new Set(itemKeys).size !== itemKeys.length) {
    const error = new Error('items must be unique');
    error.status = 400;
    throw error;
  }

  return items;
}

router.get('/shelf', (req, res, next) => {
  try {
    const db = requireDatabase(req);

    res.json({ items: listShelfItems(db) });
  } catch (err) {
    next(err);
  }
});

router.patch('/shelf/order', (req, res, next) => {
  try {
    const db = requireDatabase(req);
    const items = parseShelfItems(req.body.items);

    res.json({ items: updateShelfItemOrder(db, items) });
  } catch (err) {
    next(err);
  }
});

router.get('/', (req, res, next) => {
  try {
    const db = requireDatabase(req);

    res.json({ folders: listFolders(db) });
  } catch (err) {
    next(err);
  }
});

router.post('/', (req, res, next) => {
  try {
    const db = requireDatabase(req);
    const result = createFolderFromBooks(db, {
      sourceBookId: parsePositiveInteger(req.body.sourceBookId, 'sourceBookId'),
      targetBookId: parsePositiveInteger(req.body.targetBookId, 'targetBookId'),
      name: req.body.name,
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const db = requireDatabase(req);
    const folderId = parsePositiveInteger(req.params.id, 'folder id');
    const folder = getFolder(db, folderId);

    if (!folder) {
      const error = new Error('Folder not found');
      error.status = 404;
      throw error;
    }

    res.json({ folder });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', (req, res, next) => {
  try {
    const db = requireDatabase(req);
    const folderId = parsePositiveInteger(req.params.id, 'folder id');
    const folder = renameFolder(db, folderId, req.body.name);

    if (!folder) {
      const error = new Error('Folder not found');
      error.status = 404;
      throw error;
    }

    res.json({ folder });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/books', (req, res, next) => {
  try {
    const db = requireDatabase(req);
    const folderId = parsePositiveInteger(req.params.id, 'folder id');

    if (!getFolder(db, folderId)) {
      const error = new Error('Folder not found');
      error.status = 404;
      throw error;
    }

    res.json({ books: listBooks(db, { folderId }) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/books/order', (req, res, next) => {
  try {
    const db = requireDatabase(req);
    const folderId = parsePositiveInteger(req.params.id, 'folder id');
    const bookIds = parseBookIds(req.body.bookIds);

    res.json({ books: updateFolderBookOrder(db, folderId, bookIds) });
  } catch (err) {
    next(err);
  }
});

export default router;

