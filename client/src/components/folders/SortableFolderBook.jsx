import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { BookCover } from '../bookshelf/BookCover.jsx';

const shelfSortTransition = {
  duration: 460,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
};

export function SortableFolderBook({ book, disabled, onOpenBook }) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: book.key,
    data: {
      book,
      type: 'folder-book',
    },
    disabled,
    transition: shelfSortTransition,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const className = ['folder-book-shell', isDragging ? 'is-dragging' : '']
    .filter(Boolean)
    .join(' ');
  const label = book.title || '未命名书籍';

  return (
    <div
      ref={setNodeRef}
      className={className}
      style={style}
    >
      <button
        ref={setActivatorNodeRef}
        className="folder-book-cover-button"
        disabled={disabled}
        type="button"
        aria-label={label}
        onClick={(event) => {
          const rect = event.currentTarget.querySelector('.book-cover')?.getBoundingClientRect();
          onOpenBook(book, rect || null);
        }}
        {...attributes}
        {...listeners}
      >
        <span className="book-cover">
          <BookCover book={book} />
        </span>
        <span className="shelf-item-label">{label}</span>
      </button>
    </div>
  );
}
