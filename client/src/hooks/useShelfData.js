import { useCallback, useEffect, useState } from 'react';
import {
  listRecentReading,
  listShelfItems,
  uploadBook,
} from '../api/books.js';
import { normalizeShelfItem } from '../utils/libraryItems.js';

export function useShelfData({ restoreReaderBook } = {}) {
  const [shelfItems, setShelfItems] = useState([]);
  const [recentReadingItems, setRecentReadingItems] = useState([]);
  const [hasLoadedShelf, setHasLoadedShelf] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
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

  useEffect(() => {
    loadShelf();
  }, [loadShelf]);

  const handleFileChange = useCallback(
    async (event) => {
      if (isUploading) {
        event.target.value = '';
        return;
      }

      const files = Array.from(event.target.files || []);

      if (!files.length) {
        return;
      }

      setIsUploading(true);
      setUploadProgress(`正在上传 1/${files.length}`);
      setError('');

      try {
        const failedFiles = [];

        for (let index = 0; index < files.length; index += 1) {
          const file = files[index];

          setUploadProgress(`正在上传 ${index + 1}/${files.length}`);

          try {
            await uploadBook(file);
          } catch {
            failedFiles.push(file.name || '未命名文件');
          }
        }

        setUploadProgress('正在更新书架');
        await loadShelf();

        if (failedFiles.length) {
          const successCount = files.length - failedFiles.length;
          setError(`${successCount} 本上传完成，${failedFiles.length} 本失败：${failedFiles.join('、')}`);
        }
      } catch (err) {
        setError(err.message || '上传失败');
      } finally {
        setIsUploading(false);
        setUploadProgress('');
        event.target.value = '';
      }
    },
    [isUploading, loadShelf],
  );

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
