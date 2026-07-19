import { useCallback, useEffect, useState } from 'react';
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

  const loadRecentReading = useCallback(async () => {
    try {
      const data = await listRecentReading();
      const items = data.items || [];
      setRecentReadingItems(items);
      return { items };
    } catch {
      setRecentReadingItems([]);
      return { items: [] };
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    setIsCatalogLoading(true);
    setCatalogError('');

    try {
      const data = await listBookCatalog();
      setCatalogBooks(data.books || []);
      return data;
    } catch (err) {
      setCatalogError(err.message || '搜索目录加载失败');
      return null;
    } finally {
      setHasLoadedCatalog(true);
      setIsCatalogLoading(false);
    }
  }, []);

  const loadShelf = useCallback(async () => {
    setIsLoading(true);
    setError('');
    const recentPromise = loadRecentReading();
    void loadCatalog();

    try {
      const shelfData = await listShelfItems();
      setShelfItems((shelfData.items || []).map(normalizeShelfItem));
      void recentPromise
        .then((recentData) => restoreReaderBook?.(shelfData, recentData))
        .catch((err) => setError(err.message || '无法加载书架'));
    } catch (err) {
      setError(err.message || '无法加载书架');
    } finally {
      setHasLoadedShelf(true);
      setIsLoading(false);
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
