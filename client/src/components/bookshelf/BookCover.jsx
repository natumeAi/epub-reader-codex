export function BookCover({ book }) {
  if (book.coverUrl) {
    return (
      <img
        className="book-cover-image"
        src={book.coverUrl}
        alt={book.title || '书籍封面'}
        decoding="async"
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
