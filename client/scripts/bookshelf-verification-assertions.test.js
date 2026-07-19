import { describe, expect, it } from 'vitest';
import {
  inspectBookshelfLayout,
  inspectBookshelfSearch,
} from './bookshelf-verification-assertions.mjs';

describe('bookshelf home acceptance assertions', () => {
  it('accepts the 430px first-screen contract', () => {
    expect(inspectBookshelfLayout({
      viewport: { width: 430, height: 932 },
      app: { left: 0, right: 430, width: 430 },
      documentScrollWidth: 430,
      search: { top: 80, bottom: 128 },
      continueSection: { top: 144, bottom: 292 },
      firstShelfRow: [
        { top: 470, bottom: 679 },
        { top: 470, bottom: 679 },
        { top: 470, bottom: 679 },
      ],
      continueViewport: { left: 18, right: 412 },
      continueCards: [
        { left: 18, right: 310 },
        { left: 322, right: 614 },
      ],
      touchTargets: [{ width: 48, height: 48 }],
    })).toEqual([]);
  });

  it('reports only explicit layout failures', () => {
    expect(inspectBookshelfLayout({
      viewport: { width: 320, height: 700 },
      app: { left: 0, right: 340, width: 340 },
      documentScrollWidth: 340,
      search: { top: 90, bottom: 130 },
      continueSection: null,
      firstShelfRow: [],
      continueViewport: null,
      continueCards: [],
      touchTargets: [{ width: 40, height: 40 }],
    })).toEqual(expect.arrayContaining([
      '页面存在横向溢出',
      '存在小于 44px 的主要控件',
    ]));
  });

  it('accepts local search under 100ms without requests or drag handles', () => {
    expect(inspectBookshelfSearch({
      durationMs: 72,
      typedRequestCount: 0,
      folderContextVisible: true,
      readOnlyItemCount: 1,
      dragHandleCount: 0,
    })).toEqual([]);
  });
});
