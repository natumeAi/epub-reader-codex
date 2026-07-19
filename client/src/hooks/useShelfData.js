import { useCallback, useEffect, useRef, useState } from 'react';
import { listBookCatalog } from '../api/booksApi.js';
import {
  listShelfItems,
} from '../api/foldersApi.js';
import { listRecentReading } from '../api/readingApi.js';
import { normalizeShelfItem } from '../utils/libraryItems.js';
import { useUploadBooks } from './useUploadBooks.js';

export function useShelfData({ restoreReaderBook } = {}) {
  const [shelfItems, setShelfItems] = useState([]);
  const [recentReadingItems, setRecentReadingItems] = useState([]);
  const [hasLoadedShelf, setHasLoadedShelf] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [error, setError] = useState('');
  const [catalogBooks, setCatalogBooks] = useState([]);
  const [catalogError, setCatalogError] = useState('');
  const [hasLoadedCatalog, setHasLoadedCatalog] = useState(false);
  const [isCatalogLoading, setIsCatalogLoading] = useState(true);
  const shelfRequestVersionRef = useRef(0);
  const catalogRequestVersionRef = useRef(0);
  const recentRequestVersionRef = useRef(0);

  const loadRecentReading = useCallback(async () => {
    const requestVersion = ++recentRequestVersionRef.current;
    try {
      const data = await listRecentReading();
      const items = data.items || [];
      if (recentRequestVersionRef.current === requestVersion) {
        setRecentReadingItems(items);
      }
      return { items };
    } catch {
      if (recentRequestVersionRef.current === requestVersion) {
        setRecentReadingItems([]);
      }
      return { items: [] };
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    const requestVersion = ++catalogRequestVersionRef.current;
    setIsCatalogLoading(true);
    setCatalogError('');

    try {
      const data = await listBookCatalog();
      if (catalogRequestVersionRef.current === requestVersion) {
        setCatalogBooks(data.books || []);
      }
      return data;
    } catch (err) {
      if (catalogRequestVersionRef.current === requestVersion) {
        setCatalogError(err.message || '搜索目录加载失败');
      }
      return null;
    } finally {
      if (catalogRequestVersionRef.current === requestVersion) {
        setHasLoadedCatalog(true);
        setIsCatalogLoading(false);
      }
    }
  }, []);

  const loadShelf = useCallback(async () => {
    const requestVersion = ++shelfRequestVersionRef.current;
    setIsLoading(true);
    setError('');
    const recentPromise = loadRecentReading();
    void loadCatalog();

    try {
      const shelfData = await listShelfItems();
      if (shelfRequestVersionRef.current === requestVersion) {
        setShelfItems((shelfData.items || []).map(normalizeShelfItem));
      }
      void recentPromise
        .then((recentData) => {
          if (shelfRequestVersionRef.current === requestVersion) {
            restoreReaderBook?.(shelfData, recentData);
          }
        })
        .catch((err) => {
          if (shelfRequestVersionRef.current === requestVersion) {
            setError(err.message || '无法加载书架');
          }
        });
    } catch (err) {
      if (shelfRequestVersionRef.current === requestVersion) {
        setError(err.message || '无法加载书架');
      }
    } finally {
      if (shelfRequestVersionRef.current === requestVersion) {
        setHasLoadedShelf(true);
        setIsLoading(false);
      }
    }
  }, [loadCatalog, loadRecentReading, restoreReaderBook]);

  const {
    handleFileChange,
    isUploading,
    uploadProgress,
  } = useUploadBooks({ loadShelf, setError });

  useEffect(() => {
    loadShelf();
  }, [loadShelf]);

  const replaceShelfFolder = useCallback((renamedFolder) => {
    setShelfItems((items) =>
      items.map((item) =>
        item.type === 'folder' && item.id === renamedFolder.id
          ? normalizeShelfItem({ ...item, folder: renamedFolder })
          : item,
      ),
    );
  }, []);

  return {
    catalogBooks,
    catalogError,
    error,
    handleFileChange,
    hasLoadedCatalog,
    hasLoadedShelf,
    isCatalogLoading,
    isLoading,
    isSavingOrder,
    isUploading,
    loadCatalog,
    loadRecentReading,
    loadShelf,
    recentReadingItems,
    replaceShelfFolder,
    setError,
    setIsSavingOrder,
    setShelfItems,
    shelfItems,
    uploadProgress,
  };
}
