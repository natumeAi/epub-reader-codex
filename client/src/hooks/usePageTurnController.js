import { useCallback, useEffect, useRef, useState } from 'react';
import { PAGE_TURN_RULES } from '../utils/pageTurnGesture.js';

function pageDelta(direction) {
  return direction === 'next' ? 1 : -1;
}

async function readCurrentLocation(rendition) {
  const location = rendition?.currentLocation?.();
  return location && typeof location.then === 'function' ? location : Promise.resolve(location);
}

function isBoundary(location, direction) {
  return direction === 'next' ? Boolean(location?.atEnd) : Boolean(location?.atStart);
}

function createRelocationWait(rendition, predicate, timeoutMs) {
  let settled = false;
  let timer;
  let resolvePromise;

  const cleanup = () => {
    rendition?.off?.('relocated', handleRelocated);
    clearTimeout(timer);
  };
  const finish = (value) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolvePromise(value);
  };
  const handleRelocated = (location) => {
    if (predicate(location)) finish(location);
  };
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
    rendition?.on?.('relocated', handleRelocated);
    timer = setTimeout(() => finish(null), timeoutMs);
  });
  return {
    cancel: () => finish(null),
    promise,
  };
}

export function usePageTurnController({
  adapter,
  currentCfiRef,
  edgeRef,
  reducedMotion = false,
  renditionRef,
}) {
  const [phase, setPhaseState] = useState('basic');
  const [direction, setDirection] = useState(null);
  const phaseRef = useRef('basic');
  const basicRef = useRef(true);
  const relocationWaitRef = useRef(null);

  const setPhase = useCallback((nextPhase) => {
    phaseRef.current = nextPhase;
    setPhaseState(nextPhase);
  }, []);

  const clearEdge = useCallback(() => {
    edgeRef.current?.style.setProperty('--reader-page-turn-progress', '0');
    edgeRef.current?.style.setProperty('--reader-page-turn-edge-offset', '0px');
    setDirection(null);
  }, [edgeRef]);

  const writeEdgeProgress = useCallback((nextDirection, progress, pageWidth) => {
    const edge = edgeRef.current;
    if (!edge) return;
    const clamped = Math.min(1, Math.max(0, progress));
    const offset = nextDirection === 'next'
      ? (1 - clamped) * pageWidth
      : clamped * pageWidth;
    edge.style.setProperty('--reader-page-turn-progress', String(clamped));
    edge.style.setProperty('--reader-page-turn-edge-offset', offset + 'px');
  }, [edgeRef]);

  const restoreReadyPhase = useCallback(() => {
    clearEdge();
    setPhase(basicRef.current ? 'basic' : 'idle');
  }, [clearEdge, setPhase]);

  const enterBasic = useCallback(() => {
    basicRef.current = true;
    clearEdge();
    setPhase('basic');
  }, [clearEdge, setPhase]);

  const cancelPageTurn = useCallback(() => {
    relocationWaitRef.current?.cancel();
    relocationWaitRef.current = null;
    adapter?.cancel({ restoreOrigin: true });
    restoreReadyPhase();
  }, [adapter, restoreReadyPhase]);

  useEffect(() => {
    adapter?.cancel({ restoreOrigin: true });
    const capability = adapter?.inspect?.();
    basicRef.current = reducedMotion || !capability?.available;
    setPhase(basicRef.current ? 'basic' : 'idle');
    return () => {
      relocationWaitRef.current?.cancel();
      adapter?.cancel({ restoreOrigin: true });
    };
  }, [adapter, reducedMotion, setPhase]);

  const runBasicNavigation = useCallback(async (nextDirection) => {
    const rendition = renditionRef.current;
    const waiter = createRelocationWait(
      rendition,
      () => true,
      PAGE_TURN_RULES.relocatedTimeoutMs,
    );
    relocationWaitRef.current = waiter;
    try {
      const navigate = nextDirection === 'next' ? rendition?.next : rendition?.prev;
      await Promise.resolve(navigate?.call(rendition));
      return (await waiter.promise) ? 'completed' : 'failed';
    } catch {
      waiter.cancel();
      return 'failed';
    } finally {
      if (relocationWaitRef.current === waiter) relocationWaitRef.current = null;
    }
  }, [renditionRef]);

  const runEnhancedNavigation = useCallback(async (nextDirection, session) => {
    const delta = pageDelta(nextDirection);
    const rendition = renditionRef.current;
    const waiter = createRelocationWait(
      rendition,
      () => adapter.isStableAt(delta),
      PAGE_TURN_RULES.relocatedTimeoutMs,
    );
    relocationWaitRef.current = waiter;
    const animation = await adapter.animateTo(delta, {
      duration: PAGE_TURN_RULES.tapDurationMs,
      onProgress: ({ pageWidth, progress }) => {
        writeEdgeProgress(nextDirection, progress, pageWidth);
      },
    });

    if (animation.status !== 'completed') {
      waiter.cancel();
      return animation.status === 'unavailable' ? 'failed' : 'ignored';
    }

    const location = await waiter.promise;
    if (!location || !adapter.isStableAt(delta)) {
      await adapter.recover();
      enterBasic();
      return 'failed';
    }

    adapter.end();
    return 'completed';
  }, [adapter, enterBasic, renditionRef, writeEdgeProgress]);

  const turnPage = useCallback(async (nextDirection) => {
    if (!['idle', 'basic'].includes(phaseRef.current)) return 'ignored';
    const rendition = renditionRef.current;
    if (!rendition || !['prev', 'next'].includes(nextDirection)) return 'ignored';

    setPhase('settling');
    try {
      const location = await readCurrentLocation(rendition).catch(() => null);
      if (isBoundary(location, nextDirection)) return 'blocked';

      if (basicRef.current) {
        return await runBasicNavigation(nextDirection);
      }

      const session = adapter?.begin(currentCfiRef.current);
      if (!session) {
        enterBasic();
        return await runBasicNavigation(nextDirection);
      }

      const neighborReady =
        nextDirection === 'next' ? session.canNext : session.canPrevious;
      if (!neighborReady) {
        adapter.cancel({ restoreOrigin: true });
        return await runBasicNavigation(nextDirection);
      }

      setDirection(nextDirection);
      writeEdgeProgress(nextDirection, 0, session.pageWidth);
      return await runEnhancedNavigation(nextDirection, session);
    } finally {
      restoreReadyPhase();
    }
  }, [
    adapter,
    currentCfiRef,
    enterBasic,
    renditionRef,
    restoreReadyPhase,
    runBasicNavigation,
    runEnhancedNavigation,
    setPhase,
    writeEdgeProgress,
  ]);

  return {
    cancelPageTurn,
    direction,
    phase,
    turnPage,
  };
}
