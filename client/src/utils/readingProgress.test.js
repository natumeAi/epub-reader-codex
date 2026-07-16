import { describe, expect, it } from 'vitest';
import {
  PROGRESS_OUTBOX_KEY,
  isSameProgressSnapshot,
  readProgressOutbox,
  sanitizeProgressRecord,
  selectProgressForRelocation,
  writeProgressOutbox,
} from './readingProgress.js';

describe('reading progress utilities', () => {
  it('keeps 2.27 percent until locations are ready', () => {
    const locations = { percentageFromCfi: () => 0 };

    expect(selectProgressForRelocation({
      cfi: 'epubcfi(/6/2!/4/2)',
      lastValidProgress: 0.0227,
      locations,
      locationsReady: false,
    })).toBe(0.0227);
  });

  it('uses and clamps a finite percentage after locations are ready', () => {
    expect(selectProgressForRelocation({
      cfi: 'epubcfi(/6/2!/4/2)',
      lastValidProgress: 0.0227,
      locations: { percentageFromCfi: () => 1.4 },
      locationsReady: true,
    })).toBe(1);
  });

  it('round-trips only valid versioned outbox records', () => {
    const storage = window.localStorage;
    const valid = sanitizeProgressRecord({
      bookId: 9,
      cfi: 'epubcfi(/6/2!/4/2)',
      progress: 0.45,
      chapterHref: 'chapter.xhtml',
      chapterLabel: '第一章',
    });

    expect(writeProgressOutbox({ 9: valid }, storage)).toBe(true);
    expect(readProgressOutbox(storage)).toEqual({ 9: valid });

    storage.setItem(PROGRESS_OUTBOX_KEY, '{broken json');
    expect(readProgressOutbox(storage)).toEqual({});
  });

  it('compares every field in a sent snapshot', () => {
    const snapshot = sanitizeProgressRecord({ bookId: 3, cfi: 'a', progress: 0.1 });

    expect(isSameProgressSnapshot(snapshot, { ...snapshot })).toBe(true);
    expect(isSameProgressSnapshot(snapshot, { ...snapshot, cfi: 'b' })).toBe(false);
  });
});
