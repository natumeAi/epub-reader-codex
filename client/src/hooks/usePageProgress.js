import { useCallback, useMemo, useState } from 'react';

function getPageProgressFromLocation(location) {
  const displayed = location?.start?.displayed;
  const current = Number(displayed?.page);
  const total = Number(displayed?.total);

  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
    return null;
  }

  return {
    current: Math.min(total, Math.max(1, Math.round(current))),
    total: Math.max(1, Math.round(total)),
  };
}

async function getCurrentRenditionLocation(rendition) {
  const location = rendition?.currentLocation?.();
  if (!location) return null;

  return typeof location.then === 'function' ? location : Promise.resolve(location);
}

export function usePageProgress({ renditionRef }) {
  const [pageProgress, setPageProgress] = useState(null);

  const resetPageProgress = useCallback(() => {
    setPageProgress(null);
  }, []);

  const updatePageProgressFromLocation = useCallback((location) => {
    setPageProgress(getPageProgressFromLocation(location));
  }, []);

  const refreshCurrentPageProgress = useCallback((rendition = renditionRef.current) => (
    getCurrentRenditionLocation(rendition)
      .then((location) => {
        if (renditionRef.current !== rendition) return;
        const nextPageProgress = getPageProgressFromLocation(location);
        if (nextPageProgress) setPageProgress(nextPageProgress);
      })
      .catch(() => {})
  ), [renditionRef]);

  const pageProgressLabel = useMemo(() => (
    pageProgress ? `${pageProgress.current}/${pageProgress.total}` : '--/--'
  ), [pageProgress]);

  return {
    pageProgressLabel,
    refreshCurrentPageProgress,
    resetPageProgress,
    updatePageProgressFromLocation,
  };
}
