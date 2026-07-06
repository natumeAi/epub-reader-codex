import { unlinkSync } from 'node:fs';
import multer from 'multer';
import { Router } from 'express';
import {
  createEpubUploadStorage,
  isEpubUpload,
  titleFromUpload,
} from '../services/fileStorage.js';
import { addBookFileToLibrary } from '../services/bookLibrary.js';

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

router.post('/', handleUpload, (req, res, next) => {
  const uploadedPath = req.file?.path;

  try {
    const db = requireDatabase(req);

    if (!req.file) {
      const error = new Error('EPUB file is required');
      error.status = 400;
      throw error;
    }

    const book = addBookFileToLibrary(db, req.file.path, {
      fileName: req.file.originalname,
      title: titleFromUpload(req.file),
    });

    res.status(201).json({ book });
  } catch (err) {
    if (uploadedPath) {
      try {
        unlinkSync(uploadedPath);
      } catch {
        // Keep the original upload error response.
      }
    }

    next(err);
  }
});

export default router;
