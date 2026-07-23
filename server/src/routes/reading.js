import { Router } from 'express';
import { formatBook } from '../services/bookLibrary.js';

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

function normalizeBookIdentityValue(value) {
  return String(value ?? '').normalize('NFC').trim().toLocaleLowerCase('en-US');
}

function bookContentKey(book) {
  const fileSize = Number(book?.file_size);
  const identifier = normalizeBookIdentityValue(book?.identifier);
  const hasUsefulIdentifier = identifier && !['none', 'unknown', 'n/a'].includes(identifier);

  if (hasUsefulIdentifier) {
    return `identifier:${identifier}:${fileSize}`;
  }

  return `file:${normalizeBookIdentityValue(book?.file_name)}:${fileSize}`;
}

function getExactProgress(db, bookId) {
  return db
    .prepare('SELECT * FROM reading_progress WHERE book_id = ?')
    .get(bookId) ?? null;
}

function getLatestEquivalentProgress(db, bookId) {
  const targetBook = db
    .prepare('SELECT id, identifier, file_name, file_size FROM books WHERE id = ?')
    .get(bookId);
  if (!targetBook) return null;

  const targetContentKey = bookContentKey(targetBook);
  const candidates = db
    .prepare(
      `SELECT rp.*, b.identifier, b.file_name, b.file_size
       FROM reading_progress rp
       INNER JOIN books b ON b.id = rp.book_id
       WHERE b.file_size = ?
       ORDER BY rp.updated_at DESC, rp.book_id DESC`,
    )
    .all(targetBook.file_size);

  return candidates.find((row) => bookContentKey(row) === targetContentKey) ?? null;
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

// GET /api/reading/recent
router.get('/recent', (req, res, next) => {
  try {
    const db = requireDatabase(req);
    const rows = db
      .prepare(
        `SELECT b.*,
                rp.book_id AS progress_book_id,
                rp.cfi AS progress_cfi,
                rp.progress AS progress_value,
                rp.chapter_href AS progress_chapter_href,
                rp.chapter_label AS progress_chapter_label,
                rp.updated_at AS progress_updated_at
         FROM reading_progress rp
         INNER JOIN books b ON b.id = rp.book_id
         ORDER BY rp.updated_at DESC, rp.book_id DESC`,
      )
      .all();
    const seenContentKeys = new Set();
    const recentRows = [];

    for (const row of rows) {
      const contentKey = bookContentKey(row);
      if (seenContentKeys.has(contentKey)) continue;
      seenContentKeys.add(contentKey);
      recentRows.push(row);
      if (recentRows.length === 10) break;
    }

    res.json({
      items: recentRows.map((row) => ({
        book: formatBook(row),
        progress: formatProgress({
          book_id: row.progress_book_id,
          cfi: row.progress_cfi,
          progress: row.progress_value,
          chapter_href: row.progress_chapter_href,
          chapter_label: row.progress_chapter_label,
          updated_at: row.progress_updated_at,
        }),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/reading/:bookId
router.get('/:bookId', (req, res, next) => {
  try {
    const db = requireDatabase(req);
    const bookId = parseBookId(req.params.bookId);
    const row = getLatestEquivalentProgress(db, bookId);
    const progress = formatProgress(row);

    res.json({
      progress: progress ? { ...progress, bookId } : null,
    });
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

    const bookExists = db.prepare('SELECT 1 FROM books WHERE id = ?').get(bookId);
    if (!bookExists) {
      const error = new Error('Book not found');
      error.status = 404;
      error.code = 'BOOK_NOT_FOUND';
      throw error;
    }

    db.prepare(`
      INSERT INTO reading_progress (book_id, cfi, progress, chapter_href, chapter_label, updated_at)
      VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))
      ON CONFLICT(book_id) DO UPDATE SET
        cfi = excluded.cfi,
        progress = excluded.progress,
        chapter_href = excluded.chapter_href,
        chapter_label = excluded.chapter_label,
        updated_at = excluded.updated_at
    `).run(bookId, cfi ?? null, progressValue, chapterHref ?? null, chapterLabel ?? null);

    const row = getExactProgress(db, bookId);

    res.json({ progress: formatProgress(row) });
  } catch (err) {
    next(err);
  }
});

export default router;
