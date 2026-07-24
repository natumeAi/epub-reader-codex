function cleanLabel(label) {
  return typeof label === 'string' ? label.trim() : '';
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function hrefDocument(href) {
  if (typeof href !== 'string') return '';
  return safeDecode(href.split('#')[0].split('?')[0]);
}

function hrefFragment(href) {
  if (typeof href !== 'string') return '';
  const fragmentIndex = href.indexOf('#');
  return fragmentIndex >= 0 ? href.slice(fragmentIndex + 1) : '';
}

function hrefSuffix(href) {
  if (typeof href !== 'string') return '';
  const queryIndex = href.indexOf('?');
  const fragmentIndex = href.indexOf('#');
  const suffixIndex = [queryIndex, fragmentIndex]
    .filter((index) => index >= 0)
    .reduce((earliest, index) => Math.min(earliest, index), href.length);
  return href.slice(suffixIndex);
}

function normalizeDocumentPath(value) {
  const segments = safeDecode(value || '')
    .replaceAll('\\', '/')
    .split('/');
  const normalized = [];

  segments.forEach((segment) => {
    if (!segment || segment === '.') return;
    if (segment === '..') {
      normalized.pop();
      return;
    }
    normalized.push(segment);
  });

  return normalized.join('/');
}

function resolveFromNavigationPath(href, navigationPath) {
  const documentHref = hrefDocument(href);
  const navigationDocument = hrefDocument(navigationPath);
  if (!documentHref || !navigationDocument) return documentHref;
  if (/^[a-z][a-z\d+.-]*:/i.test(documentHref) || documentHref.startsWith('/')) {
    return documentHref;
  }

  const navigationSegments = normalizeDocumentPath(navigationDocument).split('/');
  navigationSegments.pop();
  return normalizeDocumentPath([...navigationSegments, documentHref].join('/'));
}

function findSpineSection(book, href, navigationPath = '') {
  const documentHref = hrefDocument(href);
  if (!documentHref) return null;

  const relativeDocument = resolveFromNavigationPath(href, navigationPath);
  const candidates = [...new Set([
    documentHref,
    normalizeDocumentPath(documentHref),
    relativeDocument,
    normalizeDocumentPath(relativeDocument),
  ].filter(Boolean))];

  for (const candidate of candidates) {
    const section = book?.spine?.get?.(candidate);
    if (section) return section;
  }

  const candidateDocuments = candidates.map(normalizeDocumentPath);
  const matchingSections = (book?.spine?.spineItems || []).filter((section) => {
    const sectionDocument = normalizeDocumentPath(section?.href);
    return sectionDocument && candidateDocuments.some((candidate) => (
      sectionDocument === candidate ||
      sectionDocument.endsWith(`/${candidate}`) ||
      candidate.endsWith(`/${sectionDocument}`)
    ));
  });

  return matchingSections.length === 1 ? matchingSections[0] : null;
}

function canonicalTocHref(href, book, navigationPath) {
  const section = findSpineSection(book, href, navigationPath);
  return section?.href ? `${section.href}${hrefSuffix(href)}` : href;
}

export function prepareTocItems(items, parentPath = '', options = {}) {
  if (!Array.isArray(items)) return [];

  const { book, navigationPath = '' } = options;

  return items.map((item, index) => {
    const chapterId = parentPath ? `${parentPath}.${index}` : `${index}`;

    return {
      ...item,
      chapterId,
      href: canonicalTocHref(item?.href || '', book, navigationPath),
      label: cleanLabel(item?.label),
      startCfi: null,
      startProgress: null,
      subitems: prepareTocItems(item?.subitems, chapterId, options),
    };
  });
}

export function flattenTocItems(items) {
  if (!Array.isArray(items)) return [];

  return items.flatMap((item) => [
    item,
    ...flattenTocItems(item.subitems),
  ]);
}

function compareCfis(book, first, second) {
  try {
    const result = book?.locations?.epubcfi?.compare(first, second);
    return Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

export function findCurrentTocItem(items, { book, cfi, href } = {}) {
  const flatItems = flattenTocItems(items);
  let bestMatch = null;

  if (cfi) {
    flatItems.forEach((item) => {
      if (!item.startCfi) return;

      const position = compareCfis(book, item.startCfi, cfi);
      if (position === null || position > 0) return;

      if (!bestMatch) {
        bestMatch = item;
        return;
      }

      const bestPosition = compareCfis(book, item.startCfi, bestMatch.startCfi);
      // Prefer the later item when two nested entries point at the same place.
      if (bestPosition !== null && bestPosition >= 0) bestMatch = item;
    });
  }

  if (bestMatch) return bestMatch;

  const currentDocument = hrefDocument(href);
  if (!currentDocument) return null;

  return flatItems.find((item) => hrefDocument(item.href) === currentDocument) || null;
}

function readLocationCfis(book) {
  try {
    const savedLocations = book?.locations?.save?.();
    const locations = typeof savedLocations === 'string'
      ? JSON.parse(savedLocations)
      : savedLocations;
    return Array.isArray(locations) ? locations : [];
  } catch {
    return [];
  }
}

function locationBoundaries(book) {
  const boundaries = [];
  const firstCfiBySection = new Map();

  readLocationCfis(book).forEach((cfi, locationIndex) => {
    const section = book?.spine?.get?.(cfi);
    if (!section || !Number.isFinite(section.index)) return;

    const boundary = {
      cfi,
      locationIndex,
      sectionIndex: section.index,
    };
    boundaries.push(boundary);
    if (!firstCfiBySection.has(section.index)) {
      firstCfiBySection.set(section.index, cfi);
    }
  });

  return { boundaries, firstCfiBySection };
}

function fallbackSectionCfi(section, boundaries, firstCfiBySection) {
  const directMatch = firstCfiBySection.get(section.index);
  if (directMatch) return directMatch;

  const nextBoundary = boundaries.find((entry) => entry.sectionIndex >= section.index);
  return nextBoundary?.cfi || boundaries[boundaries.length - 1]?.cfi || null;
}

function findFragmentElement(document, fragment) {
  if (!document || !fragment) return null;

  const candidates = new Set([fragment, safeDecode(fragment)]);
  for (const candidate of candidates) {
    const element = document.getElementById?.(candidate);
    if (element) return element;
  }

  return [...(document.querySelectorAll?.('[id], [name]') || [])].find((element) => (
    candidates.has(element.getAttribute('id')) || candidates.has(element.getAttribute('name'))
  )) || null;
}

function progressFromCfi(book, cfi) {
  if (!cfi) return null;

  try {
    const progress = book?.locations?.percentageFromCfi?.(cfi);
    return Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : null;
  } catch {
    return null;
  }
}

function applyTocMetadata(items, metadata) {
  return items.map((item) => ({
    ...item,
    ...(metadata.get(item.chapterId) || {}),
    subitems: applyTocMetadata(item.subitems || [], metadata),
  }));
}

function fillMissingMetadata(flatItems, metadata) {
  flatItems.forEach((item, index) => {
    if (metadata.has(item.chapterId)) return;

    const nextItem = flatItems.slice(index + 1).find((candidate) => (
      metadata.has(candidate.chapterId)
    ));
    const previousItem = flatItems.slice(0, index).reverse().find((candidate) => (
      metadata.has(candidate.chapterId)
    ));
    const nearbyMetadata = metadata.get(nextItem?.chapterId)
      || metadata.get(previousItem?.chapterId);

    if (nearbyMetadata) metadata.set(item.chapterId, nearbyMetadata);
  });
}

export async function addTocProgress(items, book, { shouldStop = () => false } = {}) {
  const flatItems = flattenTocItems(items);
  const metadata = new Map();
  const fragmentItemsBySection = new Map();
  const { boundaries, firstCfiBySection } = locationBoundaries(book);

  flatItems.forEach((item) => {
    const section = book?.spine?.get?.(item.href || '');
    if (!section) return;

    const startCfi = fallbackSectionCfi(section, boundaries, firstCfiBySection);
    metadata.set(item.chapterId, {
      startCfi,
      startProgress: progressFromCfi(book, startCfi),
    });

    const fragment = hrefFragment(item.href);
    if (!fragment) return;

    const sectionItems = fragmentItemsBySection.get(section) || [];
    sectionItems.push({ fragment, item });
    fragmentItemsBySection.set(section, sectionItems);
  });

  for (const [section, sectionItems] of fragmentItemsBySection) {
    if (shouldStop()) return items;

    const wasLoaded = Boolean(section.contents);
    try {
      const contents = await section.load(book.load.bind(book));
      const document = contents?.ownerDocument || section.document;

      sectionItems.forEach(({ fragment, item }) => {
        const element = findFragmentElement(document, fragment);
        if (!element) return;

        const startCfi = section.cfiFromElement(element);
        metadata.set(item.chapterId, {
          startCfi,
          startProgress: progressFromCfi(book, startCfi),
        });
      });
    } catch {
      // The section-level location remains a useful fallback for malformed anchors.
    } finally {
      if (!wasLoaded) section.unload?.();
    }
  }

  fillMissingMetadata(flatItems, metadata);

  return shouldStop() ? items : applyTocMetadata(items, metadata);
}
