import { EPub } from 'epub2';

const coverNamePattern = /(^|[-_/\\])(front[-_ ]?)?cover([._/-]|$)/i;

function cleanText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function cleanMetadataNode(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = cleanMetadataNode(item);

      if (text) {
        return text;
      }
    }

    return null;
  }

  if (typeof value === 'object' && value !== null) {
    return cleanText(value['#']);
  }

  return cleanText(value);
}

function rawIdentifier(metadata) {
  const rawMetadata = metadata[EPub.SYMBOL_RAW_DATA] || {};
  return cleanMetadataNode(rawMetadata.identifier) || cleanMetadataNode(rawMetadata['dc:identifier']);
}

export function normalizeEpubMetadata(metadata = {}) {
  return {
    title: cleanText(metadata.title),
    author: cleanText(metadata.creator) || cleanText(metadata.creatorFileAs),
    description: cleanText(metadata.description),
    publisher: cleanText(metadata.publisher),
    language: cleanText(metadata.language),
    identifier:
      cleanText(metadata.ISBN) ||
      cleanText(metadata.UUID) ||
      cleanText(metadata.identifier) ||
      rawIdentifier(metadata),
  };
}

function imageMimeType(manifestItem = {}) {
  return cleanText(manifestItem['media-type'] || manifestItem.mediaType);
}

function isImageManifestItem(manifestItem) {
  return imageMimeType(manifestItem)?.toLowerCase().startsWith('image/');
}

function addCandidate(candidateIds, id) {
  const cleanId = cleanText(id);

  if (cleanId && !candidateIds.includes(cleanId)) {
    candidateIds.push(cleanId);
  }
}

function coverCandidateIds(epub) {
  const candidateIds = [];
  const manifest = epub.manifest || {};

  addCandidate(candidateIds, epub.metadata?.cover);

  for (const [id, item] of Object.entries(manifest)) {
    if (!isImageManifestItem(item)) {
      continue;
    }

    const properties = cleanText(item.properties || item.property);

    if (properties?.split(/\s+/).includes('cover-image')) {
      addCandidate(candidateIds, id);
    }
  }

  for (const [id, item] of Object.entries(manifest)) {
    if (!isImageManifestItem(item)) {
      continue;
    }

    if (coverNamePattern.test(id) || coverNamePattern.test(item.href || '')) {
      addCandidate(candidateIds, id);
    }
  }

  return candidateIds;
}

function readEpubImage(epub, imageId) {
  return new Promise((resolve, reject) => {
    epub.getImage(imageId, (err, data, mimeType) => {
      if (err) {
        reject(err);
        return;
      }

      resolve({
        data,
        mimeType,
      });
    });
  });
}

export async function extractEpubCoverImage(epub) {
  for (const imageId of coverCandidateIds(epub)) {
    try {
      const coverImage = await readEpubImage(epub, imageId);

      if (coverImage.data?.length) {
        return coverImage;
      }
    } catch {
      // Try the next likely cover entry.
    }
  }

  return null;
}

export async function parseEpubDetails(filePath) {
  const epub = await EPub.createAsync(filePath);

  return {
    metadata: normalizeEpubMetadata(epub.metadata),
    coverImage: await extractEpubCoverImage(epub),
  };
}

export async function parseEpubMetadata(filePath) {
  const { metadata } = await parseEpubDetails(filePath);
  return metadata;
}
