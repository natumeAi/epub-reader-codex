import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listFolderBooks,
  renameFolder,
} from '../api/foldersApi.js';
import { normalizeFolderBook } from '../utils/libraryItems.js';

const FOLDER_CLOSE_ANIM_MS = 180;

export function useFolderState({ onFolderRenamed } = {}) {
  const folderCloseTimeoutRef = useRef(null);
  const [openFolder, setOpenFolder] = useState(null);
  const [isFolderClosing, setIsFolderClosing] = useState(false);
  const [folderBooks, setFolderBooks] = useState([]);
  const [isFolderLoading, setIsFolderLoading] = useState(false);
  const [isRenamingFolder, setIsRenamingFolder] = useState(false);
  const [isSavingFolderName, setIsSavingFolderName] = useState(false);
  const [isSavingFolderOrder, setIsSavingFolderOrder] = useState(false);
  const [folderNameDraft, setFolderNameDraft] = useState('');
  const [folderError, setFolderError] = useState('');
  const [folderCloseVersion, setFolderCloseVersion] = useState(0);

  const finishCloseFolder = useCallback(() => {
    setOpenFolder(null);
    setIsFolderClosing(false);
    setFolderBooks([]);
    setFolderError('');
    setIsFolderLoading(false);
    setIsRenamingFolder(false);
    setIsSavingFolderName(false);
    setIsSavingFolderOrder(false);
    setFolderNameDraft('');
    setFolderCloseVersion((version) => version + 1);
  }, []);

  const handleOpenFolder = useCallback(async (folder, options = {}) => {
    const ignoreUntil = options.ignoreUntil || 0;

    if (!folder || options.isShelfBusy || performance.now() < ignoreUntil) {
      return;
    }

    if (folderCloseTimeoutRef.current) {
      clearTimeout(folderCloseTimeoutRef.current);
      folderCloseTimeoutRef.current = null;
    }

    setIsFolderClosing(false);
    setOpenFolder(folder);
    setFolderBooks([]);
    setFolderError('');
    setFolderNameDraft('');
    setIsRenamingFolder(false);
    setIsFolderLoading(true);

    try {
      const data = await listFolderBooks(folder.id);
      setFolderBooks((data.books || []).map(normalizeFolderBook));
    } catch (err) {
      setFolderError(err.message || '无法加载文件夹');
    } finally {
      setIsFolderLoading(false);
    }
  }, []);

  const handleCloseFolder = useCallback(() => {
    if (isSavingFolderName || isFolderClosing) {
      return;
    }

    setIsFolderClosing(true);
    folderCloseTimeoutRef.current = setTimeout(() => {
      folderCloseTimeoutRef.current = null;
      finishCloseFolder();
    }, FOLDER_CLOSE_ANIM_MS);
  }, [finishCloseFolder, isFolderClosing, isSavingFolderName]);

  const handleStartFolderRename = useCallback(() => {
    if (!openFolder || isSavingFolderName) {
      return;
    }

    setFolderNameDraft(openFolder.name || '文件夹');
    setFolderError('');
    setIsRenamingFolder(true);
  }, [isSavingFolderName, openFolder]);

  const handleCancelFolderRename = useCallback(() => {
    if (isSavingFolderName) {
      return;
    }

    setIsRenamingFolder(false);
    setFolderNameDraft('');
  }, [isSavingFolderName]);

  const handleSubmitFolderRename = useCallback(
    async (event) => {
      event.preventDefault();

      if (!openFolder || isSavingFolderName) {
        return;
      }

      setIsSavingFolderName(true);
      setFolderError('');

      try {
        const data = await renameFolder(openFolder.id, folderNameDraft.trim());
        const renamedFolder = data.folder;

        setOpenFolder(renamedFolder);
        onFolderRenamed?.(renamedFolder);
        setIsRenamingFolder(false);
        setFolderNameDraft('');
      } catch (err) {
        setFolderError(err.message || '无法重命名文件夹');
      } finally {
        setIsSavingFolderName(false);
      }
    },
    [folderNameDraft, isSavingFolderName, onFolderRenamed, openFolder],
  );

  const refreshOpenFolderBooksOrClose = useCallback(async () => {
    if (!openFolder) {
      return;
    }

    try {
      const data = await listFolderBooks(openFolder.id);
      const nextFolderBooks = (data.books || []).map(normalizeFolderBook);

      if (nextFolderBooks.length) {
        setFolderBooks(nextFolderBooks);
      } else {
        finishCloseFolder();
      }
    } catch {
      finishCloseFolder();
    }
  }, [finishCloseFolder, openFolder]);

  useEffect(
    () => () => {
      if (folderCloseTimeoutRef.current) {
        clearTimeout(folderCloseTimeoutRef.current);
      }
    },
    [],
  );

  return {
    finishCloseFolder,
    folderBooks,
    folderCloseVersion,
    folderError,
    folderNameDraft,
    handleCancelFolderRename,
    handleCloseFolder,
    handleOpenFolder,
    handleStartFolderRename,
    handleSubmitFolderRename,
    isFolderClosing,
    isFolderLoading,
    isRenamingFolder,
    isSavingFolderName,
    isSavingFolderOrder,
    openFolder,
    refreshOpenFolderBooksOrClose,
    setFolderBooks,
    setFolderError,
    setFolderNameDraft,
    setIsFolderLoading,
    setIsRenamingFolder,
    setIsSavingFolderOrder,
    setOpenFolder,
  };
}
