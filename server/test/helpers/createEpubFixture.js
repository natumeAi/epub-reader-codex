import path from 'node:path';
import AdmZip from 'adm-zip';

const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

function contentOpf(title, author) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:fixture-book</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`;
}

function chapterXhtml(paragraphCount) {
  const paragraphs = Array.from(
    { length: paragraphCount },
    (_, index) => `<p>测试段落 ${index + 1}：用于隔离阅读器验证。</p>`,
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Fixture Chapter</title></head>
  <body><h1>Fixture Chapter</h1>${paragraphs}</body>
</html>`;
}

export function createEpubFixture(filePath, options = {}) {
  const title = options.title || 'Test Book';
  const author = options.author || 'Test Author';
  const paragraphCount = Number.isInteger(options.paragraphCount)
    ? Math.max(1, options.paragraphCount)
    : 1;
  const zip = new AdmZip();

  zip.addFile('mimetype', Buffer.from('application/epub+zip'));
  zip.getEntry('mimetype').header.method = 0;
  zip.addFile('META-INF/container.xml', Buffer.from(containerXml));
  zip.addFile('OEBPS/content.opf', Buffer.from(contentOpf(title, author)));
  zip.addFile('OEBPS/chapter.xhtml', Buffer.from(chapterXhtml(paragraphCount)));
  zip.writeZip(path.resolve(filePath));

  return path.resolve(filePath);
}
