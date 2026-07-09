export function FolderCover({ folder }) {
  const previewBooks = (folder.previewBooks || []).slice(0, 4);

  return (
    <span className="folder-cover">
      <span className="folder-preview-grid" aria-hidden="true">
        {previewBooks.map((previewBook, index) => (
          <span className="folder-preview-slot" key={previewBook.id ?? index}>
            {previewBook.coverUrl ? (
              <img className="folder-preview-image" src={previewBook.coverUrl} alt="" loading="lazy" />
            ) : (
              <span className="folder-preview-image folder-preview-image-empty" />
            )}
          </span>
        ))}
      </span>
    </span>
  );
}
