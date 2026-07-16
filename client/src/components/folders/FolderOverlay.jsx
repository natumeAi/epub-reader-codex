import { useRef } from 'react';
import { rectSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import { useModalDialog } from '../../hooks/useModalDialog.js';
import { SortableFolderBook } from './SortableFolderBook.jsx';

export function FolderOverlay({
  books,
  error,
  folder,
  isClosing,
  isLoading,
  isRenaming,
  isRenameSaving,
  isSavingOrder,
  onClose,
  onOpenBook,
  onRenameCancel,
  onRenameDraftChange,
  onRenameStart,
  onRenameSubmit,
  renameDraft,
}) {
  const initialFocusRef = useRef(null);
  const { dialogRef, onKeyDown } = useModalDialog({
    initialFocusRef,
    onRequestClose: onClose,
    open: Boolean(folder),
  });

  if (!folder) {
    return null;
  }

  const folderName = folder.name || '文件夹';
  const overlayClassName = `folder-overlay${isClosing ? ' is-closing' : ''}`;

  return (
    <div
      ref={dialogRef}
      className={overlayClassName}
      role="dialog"
      aria-modal="true"
      aria-labelledby="folder-overlay-title"
      onKeyDown={onKeyDown}
      tabIndex={-1}
    >
      <div className="folder-backdrop" aria-hidden="true" onClick={onClose} />
      <section className="folder-panel">
        <header className="folder-panel-header">
          {isRenaming ? (
            <div className="folder-title-editor">
              <h2 className="visually-hidden" id="folder-overlay-title">
                {folderName}
              </h2>
              <form className="folder-rename-form" onSubmit={onRenameSubmit}>
                <input
                  ref={initialFocusRef}
                  autoFocus
                  className="folder-rename-input"
                  disabled={isRenameSaving}
                  maxLength={80}
                  onChange={(event) => onRenameDraftChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      onRenameCancel();
                    }
                  }}
                  type="text"
                  value={renameDraft}
                  aria-label="文件夹名称"
                />
                <button
                  className="folder-rename-action is-confirm"
                  disabled={isRenameSaving}
                  type="submit"
                  aria-label="保存文件夹名称"
                >
                  <span aria-hidden="true" />
                </button>
                <button
                  className="folder-rename-action is-cancel"
                  disabled={isRenameSaving}
                  onClick={onRenameCancel}
                  type="button"
                  aria-label="取消重命名"
                >
                  <span aria-hidden="true" />
                </button>
              </form>
            </div>
          ) : (
            <h2 id="folder-overlay-title">
              <button
                ref={initialFocusRef}
                className="folder-title-button"
                type="button"
                onClick={onRenameStart}
              >
                {folderName}
              </button>
            </h2>
          )}
          <button
            className="folder-close-button"
            disabled={isRenameSaving}
            type="button"
            aria-label="关闭文件夹"
            onClick={onClose}
          >
            <span aria-hidden="true" />
          </button>
        </header>

        {error ? (
          <p className="folder-status error-message" role="alert">
            {error}
          </p>
        ) : null}

        {isLoading ? (
          <div className="folder-loading-state" role="status" aria-live="polite">
            <span className="folder-loading-spinner" aria-hidden="true" />
            <p>正在打开文件夹</p>
          </div>
        ) : books.length ? (
          <SortableContext items={books.map((book) => book.key)} strategy={rectSortingStrategy}>
            <div className="folder-book-grid" aria-label="文件夹书籍">
              {books.map((book) => (
                <SortableFolderBook
                  book={book}
                  disabled={isSavingOrder}
                  key={book.key}
                  onOpenBook={onOpenBook}
                />
              ))}
            </div>
          </SortableContext>
        ) : (
          <div className="folder-empty-state" role="status">
            <div className="empty-cover" aria-hidden="true" />
            <p>这个文件夹是空的</p>
          </div>
        )}
      </section>
    </div>
  );
}
