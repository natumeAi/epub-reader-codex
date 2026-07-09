import { useCallback, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
} from '@dnd-kit/core';
import {
  deleteBook,
} from './api/books.js';
import { DeleteConfirmDialog } from './components/bookshelf/DeleteConfirmDialog.jsx';
import { DeleteDropZone } from './components/bookshelf/DeleteDropZone.jsx';
import { DragPreview } from './components/bookshelf/DragPreview.jsx';
import { FixedDragPreview } from './components/bookshelf/FixedDragPreview.jsx';
import { LibraryHome } from './components/bookshelf/LibraryHome.jsx';
import { FolderOverlay } from './components/folders/FolderOverlay.jsx';
import { ReaderView } from './components/reader/ReaderView.jsx';
import { useFolderState } from './hooks/useFolderState.js';
import { useLibraryDrag } from './hooks/useLibraryDrag.js';
import { useReaderSession } from './hooks/useReaderSession.js';
import { useShelfData } from './hooks/useShelfData.js';

function App() {
  const fileInputRef = useRef(null);
  const [deleteCandidateBook, setDeleteCandidateBook] = useState(null);
  const [isDeletingBook, setIsDeletingBook] = useState(false);
  const {
    clearReaderBookIfDeleted,
    closeReader,
    openBook,
    readingBook,
    readingBookOrigin,
    restoreReaderBook,
  } = useReaderSession();
  const {
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
  } = useShelfData({ restoreReaderBook });
  const {
    folderBooks,
    folderCloseVersion,
    folderError,
    folderNameDraft,
    handleCancelFolderRename,
    handleCloseFolder,
    handleOpenFolder: openFolderFromShelf,
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
  } = useFolderState({
    onFolderRenamed: replaceShelfFolder,
  });
  const handleDropBookOnDelete = useCallback(
    (book) => {
      setError('');
      setFolderError('');
      setDeleteCandidateBook(book);
    },
    [setError, setFolderError],
  );
  const {
    activeDragModifier,
    activeDragPreview,
    appCollisionDetection,
    dragIntent,
    fixedDragPreviewPoint,
    getFolderOpenIgnoreUntil,
    handleDragCancel,
    handleDragEnd,
    handleDragMove,
    handleDragStart,
    sensors,
  } = useLibraryDrag({
    folderBooks,
    folderCloseVersion,
    isSavingFolderOrder,
    isSavingOrder,
    loadShelf,
    onDropOnDelete: handleDropBookOnDelete,
    openFolder,
    setError,
    setFolderBooks,
    setFolderError,
    setIsFolderLoading,
    setIsRenamingFolder,
    setIsSavingFolderOrder,
    setIsSavingOrder,
    setOpenFolder,
    setShelfItems,
    shelfItems,
  });
  function handleOpenBook(book, originRect) {
    openBook(book, originRect, { disabled: isSavingOrder });
  }

  function handleCloseReader() {
    closeReader();
    loadRecentReading();
  }

  function handleOpenFolder(folder) {
    openFolderFromShelf(folder, {
      ignoreUntil: getFolderOpenIgnoreUntil(),
      isShelfBusy: isSavingOrder,
    });
  }

  function handleCancelDeleteBook() {
    if (isDeletingBook) {
      return;
    }

    setDeleteCandidateBook(null);
  }

  async function handleConfirmDeleteBook() {
    const book = deleteCandidateBook;

    if (!book || isDeletingBook) {
      return;
    }

    setIsDeletingBook(true);
    setError('');
    setFolderError('');

    try {
      await deleteBook(book.id);

      clearReaderBookIfDeleted(book.id);

      setDeleteCandidateBook(null);

      if (openFolder) {
        await refreshOpenFolderBooksOrClose();
      }

      await loadShelf();
    } catch (err) {
      const message = err.message || '无法删除书籍';

      if (openFolder) {
        setFolderError(message);
      } else {
        setError(message);
      }
    } finally {
      setIsDeletingBook(false);
    }
  }

  return (
    <DndContext
      modifiers={[activeDragModifier]}
      sensors={sensors}
      collisionDetection={appCollisionDetection}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
      onDragMove={handleDragMove}
      onDragStart={handleDragStart}
    >
      <main className="app-shell" aria-label="EPUB Reader">
        <LibraryHome
          dragIntent={dragIntent}
          error={error}
          fileInputRef={fileInputRef}
          hasLoadedShelf={hasLoadedShelf}
          isLoading={isLoading}
          isSavingOrder={isSavingOrder}
          isUploading={isUploading}
          onFileChange={handleFileChange}
          onOpenBook={handleOpenBook}
          onOpenFolder={handleOpenFolder}
          recentReadingItems={recentReadingItems}
          shelfItems={shelfItems}
          uploadProgress={uploadProgress}
        />
        <FolderOverlay
          books={folderBooks}
          error={folderError}
          folder={openFolder}
          isClosing={isFolderClosing}
          isLoading={isFolderLoading}
          isRenaming={isRenamingFolder}
          isRenameSaving={isSavingFolderName}
          isSavingOrder={isSavingFolderOrder}
          onClose={handleCloseFolder}
          onOpenBook={handleOpenBook}
          onRenameCancel={handleCancelFolderRename}
          onRenameDraftChange={setFolderNameDraft}
          onRenameStart={handleStartFolderRename}
          onRenameSubmit={handleSubmitFolderRename}
          renameDraft={folderNameDraft}
        />
        {readingBook && (
          <ReaderView
            book={readingBook}
            originRect={readingBookOrigin}
            onClose={handleCloseReader}
          />
        )}
        <DeleteDropZone
          visible={activeDragPreview?.type === 'book' || activeDragPreview?.type === 'folder-book'}
        />
        <DeleteConfirmDialog
          book={deleteCandidateBook}
          isDeleting={isDeletingBook}
          onCancel={handleCancelDeleteBook}
          onConfirm={handleConfirmDeleteBook}
        />
      </main>
      <DragOverlay dropAnimation={null}>
        <DragPreview item={fixedDragPreviewPoint ? null : activeDragPreview} />
      </DragOverlay>
      <FixedDragPreview item={activeDragPreview} point={fixedDragPreviewPoint} />
    </DndContext>
  );
}

export default App;
