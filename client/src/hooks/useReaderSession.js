import { useCallback, useEffect, useRef, useState } from 'react';
import { getBook } from '../api/booksApi.js';
import {
  clearActiveReaderBookId,
  readActiveReaderBookId,
  writeActiveReaderBookId,
} from '../utils/activeReaderStorage.js';
import { findBookInLoadedLibrary } from '../utils/libraryItems.js';

export function useReaderSession() {
  const hasTriedReaderRestoreRef = useRef(false);
  const readingBookRef = useRef(null);
  const [readingBook, setReadingBook] = useState(null);
  const [readingBookOrigin, setReadingBookOrigin] = useState(null);

  useEffect(() => {
    readingBookRef.current = readingBook;
  }, [readingBook]);

  const openBook = useCallback((book, originRect, options = {}) => {
    if (!book || options.disabled) {
      return;
    }

    writeActiveReaderBookId(book.id);
    setReadingBookOrigin(originRect || null);
    setReadingBook(book);
  }, []);

  const closeReader = useCallback(() => {
    clearActiveReaderBookId();
    setReadingBook(null);
    setReadingBookOrigin(null);
  }, []);

  const clearReaderBookIfDeleted = useCallback((bookId) => {
    if (readingBookRef.current?.id === bookId || readActiveReaderBookId() === bookId) {
      clearActiveReaderBookId();
      setReadingBook(null);
      setReadingBookOrigin(null);
    }
  }, []);

  const restoreReaderBook = useCallback(async (shelfData, recentData) => {
    const activeBookId = readActiveReaderBookId();

    if (!activeBookId || readingBookRef.current || hasTriedReaderRestoreRef.current) {
      return;
    }

    hasTriedReaderRestoreRef.current = true;
    let bookToRestore = findBookInLoadedLibrary(activeBookId, shelfData, recentData);

    if (!bookToRestore) {
      try {
        const data = await getBook(activeBookId);
        bookToRestore = data.book;
      } catch {
        clearActiveReaderBookId();
      }
    }

    if (bookToRestore) {
      setReadingBookOrigin(null);
      setReadingBook(bookToRestore);
    }
  }, []);

  return {
    clearReaderBookIfDeleted,
    closeReader,
    openBook,
    readingBook,
    readingBookOrigin,
    restoreReaderBook,
  };
}
