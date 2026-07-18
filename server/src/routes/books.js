import { existsSync, unlinkSync } from 'node:fs';
import multer from 'multer';
import { Router } from 'express';
import { deleteBookCoverFiles } from '../services/coverStorage.js';
import {
  createEpubUploadStorage,
  fileNameFromUpload,
  isEpubUpload,
  moveValidatedUploadToBooks,
  titleFromUpload,
} from '../services/fileStorage.js';
import {
  addBookFileToLibrary,
  deleteBookById,
  getBookById,
  getBookFilePath,
  inspectEpubFile,
  listBooks,
  listCatalogBooks,
  updateShelfBookOrder,
} from '../services/bookLibrary.js';

const configuredMaxUploadSizeMb = Number(process.env.EPUB_UPLOAD_MAX_MB || 100);
const maxUploadSizeMb =
  Number.isFinite(configuredMaxUploadSizeMb) && configuredMaxUploadSizeMb > 0
    ? configuredMaxUploadSizeMb
    : 100;

const upload = multer({
  storage: createEpubUploadStorage(),
  limits: {
    fileSize: maxUploadSizeMb * 1024 * 1024,
  },
  fileFilter(req, file, callback) {
    if (!isEpubUpload(file)) {
      const error = new Error('Only EPUB files are supported');
      error.status = 400;
      callback(error);
      return;
    }

    callback(null, true);
  },
});

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

function handleUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      err.status = 400;
    }

    next(err);
  });
}

function parseFolderId(value) {
  if (value === undefined) {
    return undefined;
  }

  const folderId = Number(value);

  if (!Number.isInteger(folderId) || folderId <= 0) {
    const error = new Error('folderId must be a positive integer');
    error.status = 400;
    throw error;
  }

  return folderId;
}

function parseBookId(value) {
  const bookId = Number(value);

  if (!Number.isInteger(bookId) || bookId <= 0) {
    const error = new Error('book id must be a positive integer');
    error.status = 400;
    throw error;
  }

  return bookId;
}

function parseBookIds(value) {
  if (!Array.isArray(value)) {
    const error = new Error('bookIds must be an array');
    error.status = 400;
    throw error;
  }

  const bookIds = value.map(parseBookId);

  if (new Set(bookIds).size !== bookIds.length) {
    const error = new Error('bookIds must be unique');
    error.status = 400;
    throw error;
  }

  return bookIds;
}

router.get('/', (req, res, next) => {
  try {
    const db = requireDatabase(req);
    const folderId = parseFolderId(req.query.folderId);
    const books = folderId === undefined ? listBooks(db) : listBooks(db, { folderId });

    res.json({ books });
  } catch (err) {
    next(err);
  }
});

router.get('/catalog', (req, res, next) => {
  try {
    const db = requireDatabase(req);
    res.json({ books: listCatalogBooks(db) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const db = requireDatabase(req);
    const bookId = parseBookId(req.params.id);
    const book = getBookById(db, bookId);

    if (!book) {
      const error = new Error('Book not found');
      error.status = 404;
      throw error;
    }

    res.json({ book });
  } catch (err) {
    next(err);
  }
});

router.patch('/order', (req, res, next) => {
  try {
    const db = requireDatabase(req);
    const bookIds = parseBookIds(req.body.bookIds);
    const books = updateShelfBookOrder(db, bookIds);

    res.json({ books });
  } catch (err) {
    next(err);
  }
});

router.post('/', handleUpload, async (req, res, next) => {
  const stagedPath = req.file?.path;
  let finalPath = null;
  let committed = false;

  try {
    const db = requireDatabase(req);

    if (!req.file) {
      const error = new Error('EPUB file is required');
      error.status = 400;
      throw error;
    }

    const displayFileName = fileNameFromUpload(req.file);
    const epubDetails = await inspectEpubFile(stagedPath);
    finalPath = moveValidatedUploadToBooks(stagedPath, displayFileName);
    const book = await addBookFileToLibrary(db, finalPath, {
      archiveValidated: true,
      epubDetails,
      fileName: displayFileName,
      title: titleFromUpload(req.file),
    });
    committed = true;
    res.status(201).json({ book });
  } catch (error) {
    if (!committed) {
      for (const filePath of [stagedPath, finalPath]) {
        if (!filePath || !existsSync(filePath)) continue;
        try {
          unlinkSync(filePath);
        } catch {
          // Preserve the primary error.
        }
      }
      if (finalPath) {
        try {
          deleteBookCoverFiles(finalPath);
        } catch {
          // Preserve the primary error.
        }
      }
    }
    next(error);
  }
});

router.get('/:id/file', (req, res, next) => {
  try {
    const db = requireDatabase(req);
    const bookId = parseBookId(req.params.id);
    const filePath = getBookFilePath(db, bookId);

    if (!filePath) {
      const error = new Error('Book not found');
      error.status = 404;
      throw error;
    }

    res.setHeader('Content-Type', 'application/epub+zip');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    const db = requireDatabase(req);
    const bookId = parseBookId(req.params.id);
    const book = deleteBookById(db, bookId);

    if (!book) {
      const error = new Error('Book not found');
      error.status = 404;
      throw error;
    }

    res.json({ book });
  } catch (err) {
    next(err);
  }
});

export default router;
