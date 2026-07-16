import {
  clampDragDistance,
  dampBoundaryDistance,
  easeOutCubic,
} from './pageTurnGesture.js';

const ALIGNMENT_EPSILON_PX = 1;
const SUPPORTED_RTL_SCROLL_TYPES = new Set(['default', 'negative']);

function unavailable(reason) {
  return { available: false, reason };
}

export function toLogicalScroll({
  scrollLeft,
  maxScroll,
  direction,
  rtlScrollType,
}) {
  if (direction === 'ltr') return scrollLeft;
  if (direction === 'rtl' && rtlScrollType === 'default') {
    return maxScroll - scrollLeft;
  }
  if (direction === 'rtl' && rtlScrollType === 'negative') {
    return -scrollLeft;
  }
  return Number.NaN;
}

export function toPhysicalScroll({
  logicalScroll,
  maxScroll,
  direction,
  rtlScrollType,
}) {
  if (direction === 'ltr') return logicalScroll;
  if (direction === 'rtl' && rtlScrollType === 'default') {
    return maxScroll - logicalScroll;
  }
  if (direction === 'rtl' && rtlScrollType === 'negative') {
    return -logicalScroll;
  }
  return Number.NaN;
}

export function createEpubPageTurnAdapter(rendition, environment = {}) {
  const requestFrame =
    environment.requestAnimationFrame || globalThis.requestAnimationFrame.bind(globalThis);
  const cancelFrame =
    environment.cancelAnimationFrame || globalThis.cancelAnimationFrame.bind(globalThis);
  const now = environment.now || (() => globalThis.performance.now());
  let animation = null;

  function stopAnimation() {
    if (!animation) return;
    cancelFrame(animation.frameId);
    const resolve = animation.resolve;
    animation = null;
    resolve({ status: 'cancelled' });
  }

  let destroyed = false;
  let session = null;

  function inspect() {
    const manager = rendition?.manager;
    if (!manager || manager.name !== 'continuous') return unavailable('manager');
    if (!manager.isPaginated) return unavailable('paginated');
    if (manager.settings?.axis !== 'horizontal') return unavailable('axis');
    if (!manager.settings?.snap || !manager.snapper) return unavailable('snap');

    const scroller = manager.container;
    if (!scroller || !Number.isFinite(Number(scroller.scrollLeft))) {
      return unavailable('scroller');
    }

    const pageWidth = Number(manager.layout?.pageWidth) * Number(manager.layout?.divisor || 1);
    if (!Number.isFinite(pageWidth) || pageWidth <= 0) return unavailable('page-width');

    const direction = manager.settings?.direction || 'ltr';
    if (direction !== 'ltr' && direction !== 'rtl') return unavailable('direction');

    const rtlScrollType = manager.settings?.rtlScrollType;
    if (direction === 'rtl' && !SUPPORTED_RTL_SCROLL_TYPES.has(rtlScrollType)) {
      return unavailable('rtl-scroll-type');
    }

    const viewportWidth = Number(scroller.clientWidth || scroller.offsetWidth);
    const contentWidth = Number(scroller.scrollWidth);
    const maxScroll = Math.max(0, contentWidth - viewportWidth);
    if (!Number.isFinite(maxScroll)) return unavailable('scroller');

    const logicalScroll = toLogicalScroll({
      scrollLeft: Number(scroller.scrollLeft),
      maxScroll,
      direction,
      rtlScrollType,
    });
    if (!Number.isFinite(logicalScroll)) return unavailable('direction');

    const origin = Math.round(logicalScroll / pageWidth) * pageWidth;
    if (Math.abs(logicalScroll - origin) > ALIGNMENT_EPSILON_PX) {
      return unavailable('alignment');
    }

    return {
      available: true,
      reason: null,
      manager,
      scroller,
      pageWidth,
      origin,
      maxScroll,
      direction,
      rtlScrollType,
      canPrevious: origin - pageWidth >= -ALIGNMENT_EPSILON_PX,
      canNext: origin + pageWidth <= maxScroll + ALIGNMENT_EPSILON_PX,
    };
  }

  function readLogical(activeSession = session) {
    if (!activeSession) return Number.NaN;
    return toLogicalScroll({
      scrollLeft: Number(activeSession.scroller.scrollLeft),
      maxScroll: activeSession.maxScroll,
      direction: activeSession.direction,
      rtlScrollType: activeSession.rtlScrollType,
    });
  }

  function writeLogical(logicalScroll, activeSession = session) {
    if (!activeSession) return;
    const clamped = Math.min(activeSession.maxScroll, Math.max(0, logicalScroll));
    activeSession.scroller.scrollLeft = toPhysicalScroll({
      logicalScroll: clamped,
      maxScroll: activeSession.maxScroll,
      direction: activeSession.direction,
      rtlScrollType: activeSession.rtlScrollType,
    });
  }

  function setBoundaryOffset(offset) {
    if (!session) return;
    session.boundaryOffset = offset;
    session.scroller.style.transform = offset
      ? 'translate3d(' + offset + 'px, 0, 0)'
      : session.previousTransform;
  }

  function begin(stableCfi = null) {
    if (destroyed) return null;
    const capability = inspect();
    if (!capability.available) return null;
    session = {
      ...capability,
      stableCfi,
      boundaryOffset: 0,
      previousTransform: capability.scroller.style.transform || '',
    };
    return {
      available: true,
      pageWidth: session.pageWidth,
      origin: session.origin,
      canPrevious: session.canPrevious,
      canNext: session.canNext,
    };
  }

  function dragBy(pointerDistanceX) {
    if (!session) return null;
    let effectiveDistanceX = clampDragDistance(pointerDistanceX, session.pageWidth);
    const direction = effectiveDistanceX < 0 ? 'next' : 'prev';
    const missingNeighbor =
      (effectiveDistanceX < 0 && !session.canNext) ||
      (effectiveDistanceX > 0 && !session.canPrevious);

    if (missingNeighbor) {
      effectiveDistanceX = dampBoundaryDistance(pointerDistanceX);
      writeLogical(session.origin);
      setBoundaryOffset(effectiveDistanceX);
    } else {
      setBoundaryOffset(0);
      writeLogical(session.origin - effectiveDistanceX);
    }

    return {
      boundary: missingNeighbor,
      direction,
      effectiveDistanceX,
      progress: Math.min(1, Math.abs(effectiveDistanceX) / session.pageWidth),
    };
  }

  function isStableAt(pageDelta) {
    if (!session || ![-1, 0, 1].includes(pageDelta)) return false;
    const target = session.origin + pageDelta * session.pageWidth;
    return Math.abs(readLogical() - target) <= ALIGNMENT_EPSILON_PX &&
      Math.abs(session.boundaryOffset) <= ALIGNMENT_EPSILON_PX;
  }

  function isStableAligned() {
    const capability = session ? null : inspect();
    if (capability) return capability.available;
    if (!session) return false;
    const logical = readLogical();
    const nearest = Math.round(logical / session.pageWidth) * session.pageWidth;
    return Math.abs(logical - nearest) <= ALIGNMENT_EPSILON_PX &&
      Math.abs(session.boundaryOffset) <= ALIGNMENT_EPSILON_PX;
  }

  function end() {
    if (session) {
      session.scroller.style.transform = session.previousTransform;
    }
    session = null;
  }

  function animateTo(pageDelta, options = {}) {
    if (!session || ![-1, 0, 1].includes(pageDelta)) {
      return Promise.resolve({ status: 'unavailable' });
    }
    if (
      (pageDelta === 1 && !session.canNext) ||
      (pageDelta === -1 && !session.canPrevious)
    ) {
      return Promise.resolve({ status: 'unavailable' });
    }

    stopAnimation();
    const duration = Math.max(0, Number(options.duration) || 0);
    const startTime = now();
    const startLogical = readLogical();
    const startBoundaryOffset = session.boundaryOffset;
    const destination = session.origin + pageDelta * session.pageWidth;

    return new Promise((resolve) => {
      const tick = () => {
        if (!session || destroyed) {
          animation = null;
          resolve({ status: 'cancelled' });
          return;
        }

        const elapsed = now() - startTime;
        const linearProgress = duration === 0 ? 1 : Math.min(1, elapsed / duration);
        const easedProgress = easeOutCubic(linearProgress);
        const logical =
          startLogical + (destination - startLogical) * easedProgress;
        const boundaryOffset = startBoundaryOffset * (1 - easedProgress);

        writeLogical(logical);
        setBoundaryOffset(boundaryOffset);
        options.onProgress?.({
          pageWidth: session.pageWidth,
          progress: Math.min(
            1,
            Math.abs(logical - session.origin) / session.pageWidth,
          ),
        });

        if (linearProgress < 1) {
          animation.frameId = requestFrame(tick);
          return;
        }

        writeLogical(destination);
        setBoundaryOffset(0);
        options.onProgress?.({
          pageWidth: session.pageWidth,
          progress: Math.abs(pageDelta),
        });
        animation = null;
        resolve({ status: 'completed' });
      };

      animation = {
        frameId: requestFrame(tick),
        resolve,
      };
    });
  }

  async function recover() {
    const stableCfi = session?.stableCfi;
    cancel({ restoreOrigin: true });
    if (!stableCfi || typeof rendition?.display !== 'function') return false;
    await rendition.display(stableCfi);
    return true;
  }

  function cancel(options = {}) {
    stopAnimation();
    if (session && options.restoreOrigin !== false) {
      writeLogical(session.origin);
      setBoundaryOffset(0);
    }
    end();
  }

  function destroy() {
    cancel({ restoreOrigin: true });
    destroyed = true;
  }

  return {
    animateTo,
    begin,
    cancel,
    destroy,
    dragBy,
    end,
    inspect,
    isStableAligned,
    isStableAt,
    recover,
  };
}
