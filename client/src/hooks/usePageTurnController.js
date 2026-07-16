import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PAGE_TURN_RULES,
  classifyDirection,
  decidePageDelta,
  getRecentVelocity,
  getSettleDuration,
  getTapZone,
} from '../utils/pageTurnGesture.js';

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
  disabled = false,
  edgeRef,
  onCenterTap,
  reducedMotion = false,
  renditionRef,
}) {
  const [phase, setPhaseState] = useState('basic');
  const [direction, setDirection] = useState(null);
  const phaseRef = useRef('basic');
  const basicRef = useRef(true);
  const relocationWaitRef = useRef(null);
  const pointerRef = useRef(null);
  const dragFrameRef = useRef(null);
  const pendingDragDistanceRef = useRef(0);

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

  const clearDragFrame = useCallback(() => {
    if (dragFrameRef.current !== null) {
      cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
  }, []);

  const releasePointer = useCallback((pointer = pointerRef.current) => {
    if (!pointer) return;
    try {
      if (pointer.target?.hasPointerCapture?.(pointer.pointerId)) {
        pointer.target.releasePointerCapture(pointer.pointerId);
      }
    } catch {
      // Pointer capture can already be gone after browser cancellation.
    }
  }, []);

  const writeDragFrame = useCallback((distanceX) => {
    const result = adapter?.dragBy(distanceX);
    if (result && pointerRef.current) {
      writeEdgeProgress(
        result.direction,
        result.progress,
        pointerRef.current.session.pageWidth,
      );
    }
    return result;
  }, [adapter, writeEdgeProgress]);

  const queueDragFrame = useCallback((distanceX) => {
    pendingDragDistanceRef.current = distanceX;
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = requestAnimationFrame(() => {
      dragFrameRef.current = null;
      writeDragFrame(pendingDragDistanceRef.current);
    });
  }, [writeDragFrame]);

  const finishPointer = useCallback(() => {
    clearDragFrame();
    releasePointer();
    pointerRef.current = null;
  }, [clearDragFrame, releasePointer]);

  const cancelPageTurn = useCallback(() => {
    relocationWaitRef.current?.cancel();
    relocationWaitRef.current = null;
    finishPointer();
    adapter?.cancel({ restoreOrigin: true });
    restoreReadyPhase();
  }, [adapter, finishPointer, restoreReadyPhase]);

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

  useEffect(() => {
    const cancelForLifecycle = () => cancelPageTurn('viewport');
    const cancelWhenHidden = () => {
      if (document.visibilityState === 'hidden') cancelPageTurn('hidden');
    };
    window.addEventListener('resize', cancelForLifecycle);
    window.addEventListener('orientationchange', cancelForLifecycle);
    document.addEventListener('visibilitychange', cancelWhenHidden);
    return () => {
      window.removeEventListener('resize', cancelForLifecycle);
      window.removeEventListener('orientationchange', cancelForLifecycle);
      document.removeEventListener('visibilitychange', cancelWhenHidden);
      cancelPageTurn('unmount');
    };
  }, [cancelPageTurn]);

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

  const handlePointerDown = useCallback((event) => {
    if (
      disabled ||
      !['idle', 'basic'].includes(phaseRef.current) ||
      (event.pointerType === 'touch' && event.isPrimary === false)
    ) {
      return;
    }

    const touch = event.pointerType === 'touch';
    let session = null;
    let mode = touch ? 'basic' : 'tap';
    if (touch && !basicRef.current) {
      session = adapter?.begin(currentCfiRef.current);
      if (session) mode = 'enhanced';
      else enterBasic();
    }

    pointerRef.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      target: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      locked: null,
      captured: false,
      mode,
      session,
      samples: [{ x: event.clientX, time: event.timeStamp }],
    };
    setPhase('pending');
  }, [adapter, currentCfiRef, disabled, enterBasic, setPhase]);

  const handlePointerMove = useCallback((event) => {
    const pointer = pointerRef.current;
    if (!pointer || event.pointerId !== pointer.pointerId || pointer.pointerType !== 'touch') return;
    const dx = event.clientX - pointer.startX;
    const dy = event.clientY - pointer.startY;
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
    pointer.samples.push({ x: event.clientX, time: event.timeStamp });
    if (pointer.samples.length > 12) pointer.samples.shift();

    if (!pointer.locked) {
      const lock = classifyDirection(dx, dy);
      if (lock === 'pending') return;
      if (lock === 'vertical') {
        adapter?.cancel({ restoreOrigin: true });
        finishPointer();
        restoreReadyPhase();
        return;
      }
      pointer.locked = 'horizontal';
      if (pointer.mode === 'enhanced') {
        const nextDirection = dx < 0 ? 'next' : 'prev';
        setDirection(nextDirection);
        setPhase('dragging');
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
          pointer.captured = true;
        } catch {
          pointer.captured = false;
        }
      }
    }

    if (pointer.locked === 'horizontal') {
      if (event.cancelable) event.preventDefault();
      if (pointer.mode === 'enhanced') queueDragFrame(dx);
    }
  }, [adapter, finishPointer, queueDragFrame, restoreReadyPhase, setPhase]);

  const handlePointerUp = useCallback((event) => {
    const pointer = pointerRef.current;
    if (!pointer || event.pointerId !== pointer.pointerId) return;
    const dx = event.clientX - pointer.startX;
    const dy = event.clientY - pointer.startY;
    pointer.samples.push({ x: event.clientX, time: event.timeStamp });

    const settle = async () => {
      if (pointer.pointerType !== 'touch' || !pointer.locked) {
        adapter?.cancel({ restoreOrigin: true });
        finishPointer();
        restoreReadyPhase();
        if (Math.max(Math.abs(dx), Math.abs(dy)) >= PAGE_TURN_RULES.directionLockPx) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const zone = getTapZone(event.clientX, rect.left, rect.width);
        if (zone === 'center') onCenterTap?.();
        else await turnPage(zone);
        return;
      }

      if (pointer.locked !== 'horizontal') {
        cancelPageTurn('vertical');
        return;
      }

      clearDragFrame();
      const dragResult = pointer.mode === 'enhanced'
        ? writeDragFrame(dx)
        : {
            effectiveDistanceX: dx,
            progress: pointer.session ? Math.abs(dx) / pointer.session.pageWidth : 0,
          };
      const velocityX = getRecentVelocity(pointer.samples);
      const width = pointer.session?.pageWidth ||
        adapter?.inspect?.().pageWidth ||
        event.currentTarget.getBoundingClientRect().width;
      const delta = decidePageDelta({
        distanceX: dx,
        velocityX,
        pageWidth: width,
      });
      const nextDirection = delta === 1
        ? 'next'
        : delta === -1
          ? 'prev'
          : dx < 0
            ? 'next'
            : 'prev';
      finishPointer();

      if (pointer.mode !== 'enhanced') {
        restoreReadyPhase();
        if (delta) await turnPage(nextDirection);
        return;
      }

      setPhase('settling');
      if (delta === 0) {
        const duration = getSettleDuration(
          Math.abs(dragResult?.effectiveDistanceX || 0),
          pointer.session.pageWidth,
        );
        await adapter.animateTo(0, {
          duration,
          onProgress: ({ pageWidth, progress }) => {
            writeEdgeProgress(nextDirection, progress, pageWidth);
          },
        });
        adapter.end();
        restoreReadyPhase();
        return;
      }

      const neighborReady =
        delta === 1 ? pointer.session.canNext : pointer.session.canPrevious;
      if (!neighborReady) {
        await adapter.animateTo(0, {
          duration: PAGE_TURN_RULES.settleDurationMinMs,
          onProgress: ({ pageWidth, progress }) => {
            writeEdgeProgress(nextDirection, progress, pageWidth);
          },
        });
        adapter.end();
        const location = await readCurrentLocation(renditionRef.current).catch(() => null);
        if (!isBoundary(location, nextDirection)) {
          await runBasicNavigation(nextDirection);
        }
        restoreReadyPhase();
        return;
      }

      const remaining = Math.max(
        0,
        pointer.session.pageWidth - Math.abs(dragResult?.effectiveDistanceX || 0),
      );
      const waiter = createRelocationWait(
        renditionRef.current,
        () => adapter.isStableAt(delta),
        PAGE_TURN_RULES.relocatedTimeoutMs,
      );
      relocationWaitRef.current = waiter;
      const animation = await adapter.animateTo(delta, {
        duration: getSettleDuration(remaining, pointer.session.pageWidth),
        onProgress: ({ pageWidth, progress }) => {
          writeEdgeProgress(nextDirection, progress, pageWidth);
        },
      });
      const location = animation.status === 'completed' ? await waiter.promise : null;
      if (!location || !adapter.isStableAt(delta)) {
        waiter.cancel();
        await adapter.recover();
        enterBasic();
      } else {
        adapter.end();
      }
      relocationWaitRef.current = null;
      restoreReadyPhase();
    };

    void settle();
  }, [
    adapter,
    cancelPageTurn,
    clearDragFrame,
    enterBasic,
    finishPointer,
    onCenterTap,
    renditionRef,
    restoreReadyPhase,
    runBasicNavigation,
    setPhase,
    turnPage,
    writeDragFrame,
    writeEdgeProgress,
  ]);

  const handlePointerCancel = useCallback((event) => {
    if (pointerRef.current?.pointerId !== event.pointerId) return;
    cancelPageTurn('pointercancel');
  }, [cancelPageTurn]);

  return {
    cancelPageTurn,
    direction,
    handlePointerCancel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    phase,
    turnPage,
  };
}
