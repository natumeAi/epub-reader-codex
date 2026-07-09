const activeReaderBookStorageKey = 'epub-reader.activeBookId';

export function readActiveReaderBookId() {
  try {
    const value = localStorage.getItem(activeReaderBookStorageKey);
    const bookId = Number(value);

    return Number.isInteger(bookId) && bookId > 0 ? bookId : null;
  } catch {
    return null;
  }
}

export function writeActiveReaderBookId(bookId) {
  try {
    localStorage.setItem(activeReaderBookStorageKey, String(bookId));
  } catch {
    // Reading still works when storage is unavailable.
  }
}

export function clearActiveReaderBookId() {
  try {
    localStorage.removeItem(activeReaderBookStorageKey);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
