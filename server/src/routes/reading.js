import { Router } from 'express';

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

function parseBookId(value) {
  const bookId = Number(value);

  if (!Number.isInteger(bookId) || bookId <= 0) {
    const error = new Error('book id must be a positive integer');
    error.status = 400;
    throw error;
  }

  return bookId;
}

function getProgress(db, bookId) {
  return db
    .prepare('SELECT * FROM reading_progress WHERE book_id = ?')
    .get(bookId) ?? null;
}

function formatProgress(row) {
  if (!row) return null;

  return {
    bookId: row.book_id,
    cfi: row.cfi,
    progress: row.progress,
    chapterHref: row.chapter_href,
    chapterLabel: row.chapter_label,
    updatedAt: row.updated_at,
  };
}

// GET /api/reading/:bookId
router.get('/:bookId', (req, res, next) => {
  try {
    const db = requireDatabase(req);
    const bookId = parseBookId(req.params.bookId);
    const row = getProgress(db, bookId);

    res.json({ progress: formatProgress(row) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/reading/:bookId
router.put('/:bookId', (req, res, next) => {
  try {
    const db = requireDatabase(req);
    const bookId = parseBookId(req.params.bookId);
    const { cfi, progress, chapterHref, chapterLabel } = req.body;

    const progressValue = Number(progress);

    if (!Number.isFinite(progressValue) || progressValue < 0 || progressValue > 1) {
      const error = new Error('progress must be a number between 0 and 1');
      error.status = 400;
      throw error;
    }

    db.prepare(`
      INSERT INTO reading_progress (book_id, cfi, progress, chapter_href, chapter_label, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(book_id) DO UPDATE SET
        cfi = excluded.cfi,
        progress = excluded.progress,
        chapter_href = excluded.chapter_href,
        chapter_label = excluded.chapter_label,
        updated_at = excluded.updated_at
    `).run(bookId, cfi ?? null, progressValue, chapterHref ?? null, chapterLabel ?? null);

    const row = getProgress(db, bookId);

    res.json({ progress: formatProgress(row) });
  } catch (err) {
    next(err);
  }
});

export default router;
