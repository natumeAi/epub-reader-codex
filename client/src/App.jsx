import { lazy, Suspense, useCallback, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
} from '@dnd-kit/core';
import { DeleteConfirmDialog } from './components/bookshelf/DeleteConfirmDialog.jsx';
import { DeleteDropZone } from './components/bookshelf/DeleteDropZone.jsx';
import { DragPreview } from './components/bookshelf/DragPreview.jsx';
import { FixedDragPreview } from './components/bookshelf/FixedDragPreview.jsx';
import { LibraryHome } from './components/bookshelf/LibraryHome.jsx';
import { FolderOverlay } from './components/folders/FolderOverlay.jsx';
import { useBookDeletion } from './hooks/useBookDeletion.js';
import { useFolderState } from './hooks/useFolderState.js';
import { useLibraryDrag } from './hooks/useLibraryDrag.js';
import { useReaderSession } from './hooks/useReaderSession.js';
import { useShelfData } from './hooks/useShelfData.js';

const ReaderView = lazy(() => import('./components/reader/ReaderView.jsx'));

function App() {
  const fileInputRef = useRef(null);
  const {
    clearReaderBookIfDeleted,
    closeReader,
    openBook,
    readingBook,
    readingBookOrigin,
    restoreReaderBook,
  } = useReaderSession();
  const {
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
  } = useShelfData({ restoreReaderBook });
  const handleFolderRenamed = useCallback((renamedFolder) => {
    replaceShelfFolder(renamedFolder);
    void loadShelf();
  }, [loadShelf, replaceShelfFolder]);
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
  } = useFolderState({ onFolderRenamed: handleFolderRenamed });
  const {
    deleteCandidateBook,
    handleCancelDeleteBook,
    handleConfirmDeleteBook,
    handleDropBookOnDelete,
    isDeletingBook,
  } = useBookDeletion({
    clearReaderBookIfDeleted,
    loadShelf,
    openFolder,
    refreshOpenFolderBooksOrClose,
    setError,
    setFolderError,
  });
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
    void Promise.all([loadRecentReading(), loadCatalog()]);
  }

  function handleOpenFolder(folder) {
    openFolderFromShelf(folder, {
      ignoreUntil: getFolderOpenIgnoreUntil(),
      isShelfBusy: isSavingOrder,
    });
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
          catalogBooks={catalogBooks}
          catalogError={catalogError}
          dragIntent={dragIntent}
          error={error}
          fileInputRef={fileInputRef}
          hasLoadedCatalog={hasLoadedCatalog}
          hasLoadedShelf={hasLoadedShelf}
          isCatalogLoading={isCatalogLoading}
          isLoading={isLoading}
          isSavingOrder={isSavingOrder}
          isUploading={isUploading}
          onFileChange={handleFileChange}
          onOpenBook={handleOpenBook}
          onOpenFolder={handleOpenFolder}
          onRetryCatalog={loadCatalog}
          onRetryShelf={loadShelf}
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
          <Suspense fallback={null}>
            <ReaderView
              book={readingBook}
              originRect={readingBookOrigin}
              onClose={handleCloseReader}
            />
          </Suspense>
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
