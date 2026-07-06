import { useEffect, useRef, useState } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { listBooks, updateBookOrder, uploadBook } from './api/books.js';

function BookCover({ book }) {
  if (book.coverUrl) {
    return (
      <img
        className="book-cover-image"
        src={book.coverUrl}
        alt={book.title || '书籍封面'}
        loading="lazy"
      />
    );
  }

  return (
    <div className="book-cover-placeholder">
      <span className="placeholder-spine" aria-hidden="true" />
      <span className="placeholder-mark" aria-hidden="true" />
    </div>
  );
}

function SortableBook({ book, disabled }) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: book.id, disabled });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <button
      ref={setNodeRef}
      className={`book-shell${isDragging ? ' is-dragging' : ''}`}
      style={style}
      type="button"
      aria-label={book.title || '未命名书籍'}
      {...attributes}
      {...listeners}
    >
      <span className="book-cover">
        <BookCover book={book} />
      </span>
    </button>
  );
}

function App() {
  const fileInputRef = useRef(null);
  const [books, setBooks] = useState([]);
  const [hasLoadedShelf, setHasLoadedShelf] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [error, setError] = useState('');
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        delay: 500,
        tolerance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 500,
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  async function loadShelf() {
    setIsLoading(true);
    setError('');

    try {
      const data = await listBooks();
      setBooks(data.books || []);
    } catch (err) {
      setError(err.message || '无法加载书架');
    } finally {
      setHasLoadedShelf(true);
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadShelf();
  }, []);

  async function handleFileChange(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setIsUploading(true);
    setError('');

    try {
      await uploadBook(file);
      await loadShelf();
    } catch (err) {
      setError(err.message || '上传失败');
    } finally {
      setIsUploading(false);
      event.target.value = '';
    }
  }

  async function handleShelfDragEnd(event) {
    const { active, over } = event;

    if (!over || active.id === over.id || isSavingOrder) {
      return;
    }

    const oldIndex = books.findIndex((book) => book.id === active.id);
    const newIndex = books.findIndex((book) => book.id === over.id);

    if (oldIndex < 0 || newIndex < 0) {
      return;
    }

    const previousBooks = books;
    const reorderedBooks = arrayMove(books, oldIndex, newIndex);

    setBooks(reorderedBooks);
    setIsSavingOrder(true);
    setError('');

    try {
      const data = await updateBookOrder(reorderedBooks.map((book) => book.id));
      setBooks(data.books || reorderedBooks);
    } catch (err) {
      setBooks(previousBooks);
      setError(err.message || '无法保存书架顺序');
    } finally {
      setIsSavingOrder(false);
    }
  }

  return (
    <main className="app-shell" aria-label="EPUB Reader">
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
            onChange={handleFileChange}
          />
        </div>

        {error ? (
          <p className="status-message error-message" role="alert">
            {error}
          </p>
        ) : null}

        {isUploading || isSavingOrder || (isLoading && hasLoadedShelf) ? (
          <p className="status-message" role="status">
            {isUploading ? '正在上传' : isSavingOrder ? '正在保存顺序' : '正在更新书架'}
          </p>
        ) : null}

        {isLoading && !hasLoadedShelf ? (
          <div className="shelf-grid" aria-label="书架加载中">
            {Array.from({ length: 6 }).map((_, index) => (
              <div className="book-shell" key={index}>
                <div className="book-cover skeleton-cover" />
              </div>
            ))}
          </div>
        ) : books.length ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleShelfDragEnd}
          >
            <SortableContext items={books.map((book) => book.id)} strategy={rectSortingStrategy}>
              <div className="shelf-grid" aria-label="书籍列表">
                {books.map((book) => (
                  <SortableBook book={book} disabled={isSavingOrder} key={book.id} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="empty-state" role="status">
            <div className="empty-cover" aria-hidden="true" />
            <p>书架是空的</p>
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
