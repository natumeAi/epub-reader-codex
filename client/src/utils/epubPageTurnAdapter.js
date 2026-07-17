import {
  clampDragDistance,
  dampBoundaryDistance,
  easeOutCubic,
} from './pageTurnGesture.js';
import {
  createPageTurnDiagnostics,
  readPageTurnDebugConfig,
} from './pageTurnDiagnostics.js';

const ALIGNMENT_EPSILON_PX = 1;
const SUPPORTED_RTL_SCROLL_TYPES = new Set(['default', 'negative']);

function unavailable(reason) {
  return { available: false, reason };
}

export function configureEpubPageGap(rendition, pageGap) {
  const manager = rendition?.manager;
  const gap = Number(pageGap);
  if (
    !manager?.settings ||
    typeof manager.updateLayout !== 'function' ||
    !Number.isFinite(gap) ||
    gap < 0
  ) {
    return false;
  }

  manager.settings.gap = gap;
  manager.updateLayout();
  return true;
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
  const debugConfig = environment.debugConfig || readPageTurnDebugConfig();
  const diagnostics = environment.diagnostics || createPageTurnDiagnostics({
    enabled: debugConfig.enabled,
    cancelAnimationFrame: cancelFrame,
    now,
    requestAnimationFrame: requestFrame,
  });
  let animation = null;
  let destroyed = false;
  let session = null;

  function result(status) {
    return { status, backend: 'scroll' };
  }

  function clearDiagnosticReference(recordId) {
    if (session?.diagnosticRecordId === recordId) {
      session.diagnosticRecordId = null;
    }
  }

  function finishDiagnostic(recordId, endTime = now()) {
    if (recordId === null || recordId === undefined) return;
    clearDiagnosticReference(recordId);
    diagnostics.finish(recordId, endTime);
  }

  function cancelDiagnostic(recordId, reason = 'cancelled', endTime = now()) {
    if (recordId === null || recordId === undefined) return;
    clearDiagnosticReference(recordId);
    diagnostics.cancel(recordId, reason, endTime);
  }

  function stopAnimation(reason = 'cancelled') {
    if (!animation) return;
    const activeAnimation = animation;
    cancelFrame(activeAnimation.frameId);
    animation = null;
    cancelDiagnostic(activeAnimation.diagnosticRecordId, reason);
    activeAnimation.resolve(result('cancelled'));
  }

  function inspect() {
    if (debugConfig.enabled && debugConfig.forceBackend === 'compositor') {
      return unavailable('forced-compositor-unavailable');
    }
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

  function begin(stableCfi = null, {
    action = 'drag',
    edgeElement = null,
    inputTime = now(),
  } = {}) {
    if (destroyed) return null;
    const capability = inspect();
    if (!capability.available) return null;
    const diagnosticRecordId = diagnostics.begin({
      action,
      backend: 'scroll',
      inputTime,
    });
    session = {
      ...capability,
      stableCfi,
      edgeElement,
      boundaryOffset: 0,
      diagnosticAction: action,
      diagnosticRecordId,
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

    const frameTime = now();
    diagnostics.markAnimationStart(session.diagnosticRecordId, frameTime);
    diagnostics.markVisualUpdate(session.diagnosticRecordId, frameTime);
    diagnostics.frame(session.diagnosticRecordId, frameTime);

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
    if (!session) return true;
    const logical = readLogical();
    const nearest = Math.round(logical / session.pageWidth) * session.pageWidth;
    return Math.abs(logical - nearest) <= ALIGNMENT_EPSILON_PX &&
      Math.abs(session.boundaryOffset) <= ALIGNMENT_EPSILON_PX;
  }

  function end() {
    if (session) {
      finishDiagnostic(session.diagnosticRecordId);
      session.scroller.style.transform = session.previousTransform;
    }
    session = null;
  }

  function beginAnimationDiagnostics(pageDelta, options, startTime) {
    const action = options.action || (
      session.diagnosticAction && session.diagnosticAction !== 'drag'
        ? session.diagnosticAction
        : pageDelta === 0
          ? 'rollback'
          : 'commit'
    );
    const inputTime = Number.isFinite(options.inputTime)
      ? options.inputTime
      : startTime;

    if (
      session.diagnosticRecordId !== null &&
      session.diagnosticRecordId !== undefined &&
      session.diagnosticAction !== action
    ) {
      finishDiagnostic(session.diagnosticRecordId, inputTime);
    }

    if (session.diagnosticRecordId === null || session.diagnosticRecordId === undefined) {
      session.diagnosticRecordId = diagnostics.begin({
        action,
        backend: 'scroll',
        inputTime,
      });
    }
    session.diagnosticAction = action;
    diagnostics.markAnimationStart(session.diagnosticRecordId, startTime);
    return session.diagnosticRecordId;
  }

  function animateTo(pageDelta, options = {}) {
    if (!session || ![-1, 0, 1].includes(pageDelta)) {
      return Promise.resolve(result('unavailable'));
    }
    if (
      (pageDelta === 1 && !session.canNext) ||
      (pageDelta === -1 && !session.canPrevious)
    ) {
      return Promise.resolve(result('unavailable'));
    }

    stopAnimation();
    const duration = Math.max(0, Number(options.duration) || 0);
    const startTime = now();
    const startLogical = readLogical();
    const startBoundaryOffset = session.boundaryOffset;
    const destination = session.origin + pageDelta * session.pageWidth;
    const startsAtDestination = pageDelta !== 0 &&
      Math.abs(startLogical - destination) <= ALIGNMENT_EPSILON_PX;
    const diagnosticRecordId = beginAnimationDiagnostics(pageDelta, options, startTime);

    return new Promise((resolve) => {
      const tick = (timestamp) => {
        const frameTime = Number.isFinite(timestamp) ? timestamp : now();
        if (!session || destroyed) {
          animation = null;
          cancelDiagnostic(diagnosticRecordId, 'cancelled', frameTime);
          resolve(result('cancelled'));
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
        diagnostics.markVisualUpdate(diagnosticRecordId, frameTime);
        diagnostics.frame(diagnosticRecordId, frameTime);
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

        if (startsAtDestination) {
          const reportLocation = rendition?.reportLocation;
          if (typeof reportLocation !== 'function') {
            animation = null;
            cancelDiagnostic(diagnosticRecordId, 'unavailable');
            resolve(result('unavailable'));
            return;
          }

          const activeAnimation = animation;
          Promise.resolve()
            .then(() => reportLocation.call(rendition))
            .then(
              () => {
                if (animation !== activeAnimation) return;
                animation = null;
                finishDiagnostic(diagnosticRecordId);
                resolve(result('completed'));
              },
              () => {
                if (animation !== activeAnimation) return;
                animation = null;
                cancelDiagnostic(diagnosticRecordId, 'unavailable');
                resolve(result('unavailable'));
              },
            );
          return;
        }

        animation = null;
        finishDiagnostic(diagnosticRecordId);
        resolve(result('completed'));
      };

      animation = {
        diagnosticRecordId,
        frameId: requestFrame(tick),
        resolve,
      };
    });
  }

  async function recover() {
    const stableCfi = session?.stableCfi;
    cancel({ reason: 'recover', restoreOrigin: true });
    if (!stableCfi || typeof rendition?.display !== 'function') return false;
    try {
      await rendition.display(stableCfi);
      return true;
    } catch {
      return false;
    }
  }

  function cancel(options = {}) {
    const reason = options.reason || 'cancelled';
    stopAnimation(reason);
    if (session && options.restoreOrigin !== false) {
      writeLogical(session.origin);
      setBoundaryOffset(0);
    }
    if (session) {
      cancelDiagnostic(session.diagnosticRecordId, reason);
      session.scroller.style.transform = session.previousTransform;
    }
    session = null;
  }

  function destroy() {
    cancel({ reason: 'destroy', restoreOrigin: true });
    diagnostics.destroy();
    destroyed = true;
  }

  function setPageGap(pageGap) {
    if (destroyed) return false;
    cancel({ reason: 'page-gap', restoreOrigin: true });
    return configureEpubPageGap(rendition, pageGap);
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
    setPageGap,
  };
}
