import path from 'node:path';
import AdmZip from 'adm-zip';

const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

function chapterDefinition(index, chapterCount) {
  const number = index + 1;
  return {
    href: chapterCount === 1 ? 'chapter.xhtml' : `chapter-${number}.xhtml`,
    id: chapterCount === 1 ? 'chapter' : `chapter-${number}`,
    number,
  };
}

function contentOpf(title, author, chapters, pageProgressionDirection) {
  const manifest = chapters
    .map(({ href, id }) => `    <item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`)
    .join('\n');
  const spine = chapters
    .map(({ id }) => `<itemref idref="${id}"/>`)
    .join('');
  const progression = pageProgressionDirection === 'rtl'
    ? ' page-progression-direction="rtl"'
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:fixture-book</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
${manifest}
  </manifest>
  <spine${progression}>${spine}</spine>
</package>`;
}

function chapterXhtml(paragraphCount, chapterNumber, chapterCount) {
  const chapterTitle = chapterCount === 1
    ? 'Fixture Chapter'
    : `Fixture Chapter ${chapterNumber}`;
  const paragraphs = Array.from(
    { length: paragraphCount },
    (_, index) => `<p>测试段落 ${index + 1}：用于隔离阅读器验证。</p>`,
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>${chapterTitle}</title></head>
  <body><h1>${chapterTitle}</h1>${paragraphs}</body>
</html>`;
}

export function createEpubFixture(filePath, options = {}) {
  const title = options.title || 'Test Book';
  const author = options.author || 'Test Author';
  const paragraphCount = Number.isInteger(options.paragraphCount)
    ? Math.max(1, options.paragraphCount)
    : 1;
  const chapterCount = Number.isInteger(options.chapterCount)
    ? Math.max(1, options.chapterCount)
    : 1;
  const pageProgressionDirection = options.pageProgressionDirection === 'rtl'
    ? 'rtl'
    : 'ltr';
  const chapters = Array.from(
    { length: chapterCount },
    (_, index) => chapterDefinition(index, chapterCount),
  );
  const zip = new AdmZip();

  zip.addFile('mimetype', Buffer.from('application/epub+zip'));
  zip.getEntry('mimetype').header.method = 0;
  zip.addFile('META-INF/container.xml', Buffer.from(containerXml));
  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(contentOpf(title, author, chapters, pageProgressionDirection)),
  );
  chapters.forEach(({ href, number }) => {
    zip.addFile(
      `OEBPS/${href}`,
      Buffer.from(chapterXhtml(paragraphCount, number, chapterCount)),
    );
  });
  zip.writeZip(path.resolve(filePath));

  return path.resolve(filePath);
}
