import { useCallback, useEffect, useState } from 'react';
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

  const loadRecentReading = useCallback(async () => {
    try {
      const data = await listRecentReading();
      setRecentReadingItems(data.items || []);
    } catch {
      setRecentReadingItems([]);
    }
  }, []);

  const loadShelf = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const [shelfData, recentData] = await Promise.all([
        listShelfItems(),
        listRecentReading().catch(() => ({ items: [] })),
      ]);

      setShelfItems((shelfData.items || []).map(normalizeShelfItem));
      setRecentReadingItems(recentData.items || []);
      await restoreReaderBook?.(shelfData, recentData);
    } catch (err) {
      setError(err.message || '无法加载书架');
    } finally {
      setHasLoadedShelf(true);
      setIsLoading(false);
    }
  }, [restoreReaderBook]);

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
    error,
    handleFileChange,
    hasLoadedShelf,
    isLoading,
    isSavingOrder,
    isUploading,
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
