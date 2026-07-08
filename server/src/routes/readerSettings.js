import { Router } from 'express';

const router = Router();

const FONT_SIZE_MIN = 80;
const FONT_SIZE_MAX = 140;
const HORIZONTAL_MARGIN_MIN = 12;
const HORIZONTAL_MARGIN_MAX = 48;
const VERTICAL_MARGIN_MIN = 12;
const VERTICAL_MARGIN_MAX = 48;
const LINE_HEIGHT_MIN = 1.3;
const LINE_HEIGHT_MAX = 2;
const LETTER_SPACING_MIN = 0;
const LETTER_SPACING_MAX = 0.12;
const FONT_FAMILY_IDS = new Set(['system', 'sans', 'serif', 'kai']);
const THEME_IDS = new Set(['light', 'warm', 'green', 'dark']);

function requireDatabase(req) {
  const db = req.app.locals.db;

  if (!db) {
    const error = new Error('Database is not configured');
    error.status = 503;
    throw error;
  }

  return db;
}

function formatReaderSettings(row) {
  if (!row) return null;

  return {
    fontSize: row.font_size,
    fontFamilyId: row.font_family_id,
    horizontalMargin: row.horizontal_margin,
    verticalMargin: row.vertical_margin,
    lineHeight: row.line_height,
    letterSpacing: row.letter_spacing,
    themeId: row.theme_id,
    updatedAt: row.updated_at,
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function sanitizeReaderSettings(input = {}) {
  const fontFamilyId = FONT_FAMILY_IDS.has(input.fontFamilyId) ? input.fontFamilyId : 'system';
  const themeId = THEME_IDS.has(input.themeId) ? input.themeId : 'light';

  return {
    fontSize: Math.round(clampNumber(input.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX, 100)),
    fontFamilyId,
    horizontalMargin: Math.round(
      clampNumber(input.horizontalMargin, HORIZONTAL_MARGIN_MIN, HORIZONTAL_MARGIN_MAX, 24),
    ),
    verticalMargin: Math.round(
      clampNumber(input.verticalMargin, VERTICAL_MARGIN_MIN, VERTICAL_MARGIN_MAX, 20),
    ),
    lineHeight: Number(
      clampNumber(input.lineHeight, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX, 1.6).toFixed(1),
    ),
    letterSpacing: Number(
      clampNumber(input.letterSpacing, LETTER_SPACING_MIN, LETTER_SPACING_MAX, 0).toFixed(2),
    ),
    themeId,
  };
}

function getReaderSettings(db) {
  return db.prepare('SELECT * FROM reader_settings WHERE id = 1').get() ?? null;
}

router.get('/', (req, res, next) => {
  try {
    const db = requireDatabase(req);
    res.json({ settings: formatReaderSettings(getReaderSettings(db)) });
  } catch (err) {
    next(err);
  }
});

router.put('/', (req, res, next) => {
  try {
    const db = requireDatabase(req);
    const settings = sanitizeReaderSettings(req.body);

    db.prepare(`
      INSERT INTO reader_settings (
        id,
        font_size,
        font_family_id,
        horizontal_margin,
        vertical_margin,
        line_height,
        letter_spacing,
        theme_id,
        updated_at
      )
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        font_size = excluded.font_size,
        font_family_id = excluded.font_family_id,
        horizontal_margin = excluded.horizontal_margin,
        vertical_margin = excluded.vertical_margin,
        line_height = excluded.line_height,
        letter_spacing = excluded.letter_spacing,
        theme_id = excluded.theme_id,
        updated_at = excluded.updated_at
    `).run(
      settings.fontSize,
      settings.fontFamilyId,
      settings.horizontalMargin,
      settings.verticalMargin,
      settings.lineHeight,
      settings.letterSpacing,
      settings.themeId,
    );

    res.json({ settings: formatReaderSettings(getReaderSettings(db)) });
  } catch (err) {
    next(err);
  }
});

export default router;
