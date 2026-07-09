import { rectSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import { ContinueReadingSection } from './ContinueReadingSection.jsx';
import { SortableShelfItem } from './SortableShelfItem.jsx';

export function LibraryHome({
  dragIntent,
  error,
  fileInputRef,
  hasLoadedShelf,
  isLoading,
  isSavingOrder,
  isUploading,
  onFileChange,
  onOpenBook,
  onOpenFolder,
  recentReadingItems,
  shelfItems,
  uploadProgress,
}) {
  return (
    <section className="library-home">
      <div className="library-header">
        <div>
          <p className="eyebrow">Library</p>
          <h1>我的书架</h1>
        </div>

        <button
          className="upload-button"
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          aria-label="上传 EPUB"
        >
          <span className="upload-button-icon" aria-hidden="true" />
        </button>
        <input
          ref={fileInputRef}
          className="file-input"
          type="file"
          accept=".epub,application/epub+zip"
          multiple
          onChange={onFileChange}
        />
      </div>

      {error ? (
        <p className="status-message error-message" role="alert">
          {error}
        </p>
      ) : null}

      {isUploading || isSavingOrder || (isLoading && hasLoadedShelf) ? (
        <p className="status-message" role="status">
          {isUploading ? uploadProgress || '正在上传' : isSavingOrder ? '正在保存顺序' : '正在更新书架'}
        </p>
      ) : null}

      {!isLoading ? (
        <ContinueReadingSection
          items={recentReadingItems}
          onOpenBook={onOpenBook}
        />
      ) : null}

      {isLoading && !hasLoadedShelf ? (
        <div className="shelf-grid" aria-label="书架加载中">
          {Array.from({ length: 6 }).map((_, index) => (
            <div className="book-shell" key={index}>
              <div className="book-cover skeleton-cover" />
              <div className="shelf-item-label skeleton-label" />
            </div>
          ))}
        </div>
      ) : shelfItems.length ? (
        <SortableContext items={shelfItems.map((item) => item.key)} strategy={rectSortingStrategy}>
          <div className="shelf-grid" aria-label="书架列表">
            {shelfItems.map((item) => (
              <SortableShelfItem
                disabled={isSavingOrder}
                dragIntent={dragIntent}
                item={item}
                key={item.key}
                onOpenBook={onOpenBook}
                onOpenFolder={onOpenFolder}
              />
            ))}
          </div>
        </SortableContext>
      ) : (
        <div className="empty-state" role="status">
          <div className="empty-cover" aria-hidden="true" />
          <p>书架是空的</p>
        </div>
      )}
    </section>
  );
}
