import {
  clampDragDistance,
  dampBoundaryDistance,
  easeOutCubic,
  sampleEaseOutCubicKeyframes,
} from './pageTurnGesture.js';
import {
  createPageTurnDiagnostics,
  readPageTurnDebugConfig,
} from './pageTurnDiagnostics.js';

const ALIGNMENT_EPSILON_PX = 1;
const DEFAULT_PAGE_TURN_BACKEND = 'scroll';
const SUPPORTED_RTL_SCROLL_TYPES = new Set(['default', 'negative']);

function unavailable(reason) {
  return { available: false, reason };
}

function selectBackend({ compositor, forceBackend }) {
  if (forceBackend === 'scroll') return 'scroll';
  if (forceBackend === 'compositor') return compositor.available ? 'compositor' : null;
  return DEFAULT_PAGE_TURN_BACKEND === 'compositor' && compositor.available
    ? 'compositor'
    : 'scroll';
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
  let sessionGeneration = 0;

  function result(status, backend = 'scroll') {
    return { status, backend };
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

  function forcedBackend() {
    return debugConfig.enabled ? debugConfig.forceBackend : null;
  }

  function inspectScrollCapability() {
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

  function readViewGeometry(element) {
    if (typeof element?.getBoundingClientRect !== 'function') return null;
    try {
      const rect = element.getBoundingClientRect();
      const geometry = {
        bottom: Number(rect?.bottom),
        height: Number(rect?.height),
        left: Number(rect?.left),
        right: Number(rect?.right),
        top: Number(rect?.top),
        width: Number(rect?.width),
      };
      if (
        !Object.values(geometry).every(Number.isFinite) ||
        geometry.width <= 0 ||
        geometry.height <= 0 ||
        geometry.right <= geometry.left ||
        geometry.bottom <= geometry.top
      ) {
        return null;
      }
      return geometry;
    } catch {
      return null;
    }
  }

  function inspectCompositor(capability, edgeElement = null) {
    const views = capability.manager?.views;
    let displayedViews;
    try {
      displayedViews = views?.displayed?.call(views);
    } catch {
      return unavailable('views');
    }
    if (!Array.isArray(displayedViews) || displayedViews.length === 0) {
      return unavailable('views');
    }

    const viewSnapshots = [];
    const viewElements = new Set();
    for (const view of displayedViews) {
      const element = view?.element;
      if (!element?.classList?.contains('epub-view') || viewElements.has(element)) {
        return unavailable('views');
      }
      if (!element.isConnected) return unavailable('view-disconnected');
      if (element.style?.transform?.trim()) return unavailable('view-transform');
      if (
        typeof element.animate !== 'function' ||
        typeof element.getAnimations !== 'function'
      ) {
        return unavailable('waapi');
      }

      let activeAnimations;
      try {
        activeAnimations = element.getAnimations();
      } catch {
        return unavailable('view-animation');
      }
      if (!Array.isArray(activeAnimations) || activeAnimations.length > 0) {
        return unavailable('view-animation');
      }

      const geometry = readViewGeometry(element);
      if (!geometry) return unavailable('geometry');
      viewElements.add(element);
      viewSnapshots.push({
        element,
        geometry,
        transform: element.style.transform || '',
        view,
        willChange: element.style.willChange || '',
      });
    }

    if (edgeElement && typeof edgeElement.animate !== 'function') {
      return unavailable('waapi');
    }

    return {
      available: true,
      edgeSnapshot: edgeElement ? {
        element: edgeElement,
        transform: edgeElement.style.transform || '',
        willChange: edgeElement.style.willChange || '',
      } : null,
      reason: null,
      views: viewSnapshots,
    };
  }

  function inspect() {
    const capability = inspectScrollCapability();
    if (!capability.available) return capability;
    if (forcedBackend() === 'compositor') {
      const compositor = inspectCompositor(capability);
      if (!compositor.available) return unavailable(compositor.reason);
    }
    return capability;
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
    if (!session || session.boundaryOffset === offset) return;
    session.boundaryOffset = offset;
    const transform = offset
      ? 'translate3d(' + offset + 'px, 0, 0)'
      : session.previousTransform;
    if (session.scroller.style.transform !== transform) {
      session.scroller.style.transform = transform;
    }
  }

  function setEdgeDirection(direction) {
    if (!session || !['next', 'prev'].includes(direction)) return;
    if (session.edgeDirection !== direction) {
      session.edgeDirection = direction;
      session.edgeOffset = null;
    }
  }

  function transformForOffset(offset) {
    const normalizedOffset = Object.is(offset, -0) ? 0 : offset;
    return `translate3d(${normalizedOffset}px, 0, 0)`;
  }

  function setEdgeOffset(visualOffset) {
    if (!session?.edgeElement || !session.edgeDirection) return;
    const offset = session.edgeDirection === 'next'
      ? session.pageWidth + visualOffset
      : visualOffset;
    if (session.edgeOffset === offset) return;

    session.edgeOffset = offset;
    const transform = transformForOffset(offset);
    if (session.edgeElement.style.transform !== transform) {
      session.edgeElement.style.transform = transform;
    }
  }

  function writeCompositorOffset(offset, activeSession = session) {
    if (!activeSession || activeSession.backend !== 'compositor') return;
    activeSession.visualOffset = offset;
    const transform = transformForOffset(offset);
    activeSession.views.forEach((snapshot) => {
      if (snapshot.element.style.transform !== transform) {
        snapshot.element.style.transform = transform;
      }
    });
    setEdgeOffset(offset);
  }

  function restoreSessionStyles(activeSession = session) {
    if (!activeSession) return;
    if (activeSession.scroller.style.transform !== activeSession.previousTransform) {
      activeSession.scroller.style.transform = activeSession.previousTransform;
    }

    activeSession.views?.forEach((snapshot) => {
      if (snapshot.element.style.transform !== snapshot.transform) {
        snapshot.element.style.transform = snapshot.transform;
      }
      if (snapshot.element.style.willChange !== snapshot.willChange) {
        snapshot.element.style.willChange = snapshot.willChange;
      }
    });

    const edgeElement = activeSession.edgeSnapshot?.element || activeSession.edgeElement;
    if (!edgeElement) return;
    const edgeTransform = activeSession.edgeSnapshot?.transform ??
      activeSession.previousEdgeTransform;
    const edgeWillChange = activeSession.edgeSnapshot?.willChange ??
      activeSession.previousEdgeWillChange;
    if (edgeElement.style.transform !== edgeTransform) {
      edgeElement.style.transform = edgeTransform;
    }
    if (edgeElement.style.willChange !== edgeWillChange) {
      edgeElement.style.willChange = edgeWillChange;
    }
  }

  function cancelAnimationGroup(animations = []) {
    const activeAnimations = animations.splice(0);
    activeAnimations.forEach((activeAnimation) => {
      try {
        activeAnimation.cancel();
      } catch {
        // Style restoration below remains authoritative.
      }
    });
  }

  function releaseSession(activeSession = session) {
    if (!activeSession) return;
    cancelAnimationGroup(activeSession.animations);
    restoreSessionStyles(activeSession);
    activeSession.views?.splice(0);
    activeSession.edgeSnapshot = null;
  }

  function prepareSessionStyles(activeSession) {
    try {
      activeSession.views?.forEach((snapshot) => {
        if (snapshot.element.style.willChange !== 'transform') {
          snapshot.element.style.willChange = 'transform';
        }
      });
      if (
        activeSession.edgeElement &&
        activeSession.edgeElement.style.willChange !== 'transform'
      ) {
        activeSession.edgeElement.style.willChange = 'transform';
      }
      return true;
    } catch {
      releaseSession(activeSession);
      return false;
    }
  }

  function createTransformKeyframes(from, to, pageWidth = 0) {
    return sampleEaseOutCubicKeyframes().map(({ offset, value }) => ({
      offset,
      transform: transformForOffset(
        pageWidth + from + ((to - from) * value),
      ),
    }));
  }

  function readAnimationStartTime() {
    const timelineTime = environment.timeline?.currentTime ??
      globalThis.document?.timeline?.currentTime;
    return Number.isFinite(timelineTime) ? timelineTime : now();
  }

  function runAnimationGroup({ from, to, duration, direction }) {
    const activeSession = session;
    const generation = activeSession?.generation;
    const animations = [];
    const finishedPromises = [];
    const timing = {
      duration,
      easing: 'linear',
      fill: 'forwards',
    };
    const viewKeyframes = createTransformKeyframes(from, to);
    const edgeKeyframes = createTransformKeyframes(
      from,
      to,
      direction === 'next' ? activeSession.pageWidth : 0,
    );

    const animateElement = (element, keyframes) => {
      const activeAnimation = element.animate(keyframes, timing);
      const finished = activeAnimation?.finished;
      if (
        typeof activeAnimation?.cancel !== 'function' ||
        !finished ||
        typeof finished.then !== 'function' ||
        !('startTime' in activeAnimation)
      ) {
        throw new Error('waapi');
      }
      animations.push(activeAnimation);
      finishedPromises.push(finished);
    };

    try {
      activeSession.views.forEach((snapshot) => {
        animateElement(snapshot.element, viewKeyframes);
      });
      if (activeSession.edgeElement) {
        animateElement(activeSession.edgeElement, edgeKeyframes);
      }
      const startTime = readAnimationStartTime();
      animations.forEach((activeAnimation) => {
        activeAnimation.startTime = startTime;
      });
      activeSession.animations.push(...animations);
    } catch (error) {
      cancelAnimationGroup(animations);
      return Promise.reject(error);
    }

    return Promise.all(finishedPromises).then(() => ({
      activeSession,
      generation,
    }));
  }

  function begin(stableCfi = null, {
    action = 'drag',
    edgeElement = null,
    inputTime = now(),
  } = {}) {
    if (destroyed) return null;
    const capability = inspectScrollCapability();
    if (!capability.available) return null;
    const forceBackend = forcedBackend();
    const shouldInspectCompositor = forceBackend === 'compositor' || (
      forceBackend !== 'scroll' && DEFAULT_PAGE_TURN_BACKEND === 'compositor'
    );
    const compositor = shouldInspectCompositor
      ? inspectCompositor(capability, edgeElement)
      : unavailable('not-selected');
    const backend = selectBackend({ compositor, forceBackend });
    if (!backend) return null;

    session = {
      ...capability,
      animations: [],
      backend,
      stableCfi,
      edgeElement,
      edgeDirection: null,
      edgeOffset: null,
      edgeSnapshot: backend === 'compositor' ? compositor.edgeSnapshot : null,
      boundaryOffset: 0,
      diagnosticAction: action,
      diagnosticRecordId: null,
      generation: ++sessionGeneration,
      physicalScroll: Number(capability.scroller.scrollLeft),
      previousEdgeTransform: edgeElement?.style.transform || '',
      previousEdgeWillChange: edgeElement?.style.willChange || '',
      previousTransform: capability.scroller.style.transform || '',
      views: backend === 'compositor' ? compositor.views : [],
      visualOffset: 0,
    };
    if (!prepareSessionStyles(session)) {
      session = null;
      return null;
    }
    session.diagnosticRecordId = diagnostics.begin({
      action,
      backend,
      inputTime,
    });
    return {
      available: true,
      backend,
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
    setEdgeDirection(direction);

    if (session.backend === 'compositor') {
      if (missingNeighbor) {
        effectiveDistanceX = dampBoundaryDistance(pointerDistanceX);
      }
      session.boundaryOffset = missingNeighbor ? effectiveDistanceX : 0;
      writeCompositorOffset(effectiveDistanceX);
    } else {
      if (missingNeighbor) {
        effectiveDistanceX = dampBoundaryDistance(pointerDistanceX);
        writeLogical(session.origin);
        setBoundaryOffset(effectiveDistanceX);
      } else {
        setBoundaryOffset(0);
        writeLogical(session.origin - effectiveDistanceX);
      }
      setEdgeOffset(effectiveDistanceX);
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
      Math.abs(session.boundaryOffset) <= ALIGNMENT_EPSILON_PX &&
      Math.abs(session.visualOffset) <= ALIGNMENT_EPSILON_PX;
  }

  function isStableAligned() {
    if (!session) return true;
    const logical = readLogical();
    const nearest = Math.round(logical / session.pageWidth) * session.pageWidth;
    return Math.abs(logical - nearest) <= ALIGNMENT_EPSILON_PX &&
      Math.abs(session.boundaryOffset) <= ALIGNMENT_EPSILON_PX &&
      Math.abs(session.visualOffset) <= ALIGNMENT_EPSILON_PX;
  }

  function end() {
    if (session) {
      finishDiagnostic(session.diagnosticRecordId);
      releaseSession();
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
        backend: session.backend,
        inputTime,
      });
    }
    session.diagnosticAction = action;
    diagnostics.markAnimationStart(session.diagnosticRecordId, startTime);
    return session.diagnosticRecordId;
  }

  function animateCompositorRollback(options = {}) {
    const activeSession = session;
    const duration = Math.max(0, Number(options.duration) || 0);
    const startTime = now();
    const from = activeSession.visualOffset;
    const direction = activeSession.edgeDirection || (from < 0 ? 'next' : 'prev');
    setEdgeDirection(direction);
    const diagnosticRecordId = beginAnimationDiagnostics(0, options, startTime);
    const group = runAnimationGroup({
      direction,
      duration,
      from,
      to: 0,
    });

    return group.then(
      ({ activeSession: completedSession, generation }) => {
        if (
          session !== completedSession ||
          destroyed ||
          completedSession.generation !== generation
        ) {
          cancelAnimationGroup(completedSession.animations);
          return result('cancelled', 'compositor');
        }

        cancelAnimationGroup(completedSession.animations);
        restoreSessionStyles(completedSession);
        completedSession.visualOffset = 0;
        completedSession.boundaryOffset = 0;
        completedSession.edgeOffset = null;
        finishDiagnostic(diagnosticRecordId);
        return result('completed', 'compositor');
      },
      () => {
        if (session === activeSession) {
          cancelAnimationGroup(activeSession.animations);
          restoreSessionStyles(activeSession);
          activeSession.visualOffset = 0;
          activeSession.boundaryOffset = 0;
          activeSession.edgeOffset = null;
          cancelDiagnostic(diagnosticRecordId, 'unavailable');
        }
        return result('unavailable', 'compositor');
      },
    );
  }

  function animateTo(pageDelta, options = {}) {
    if (!session || ![-1, 0, 1].includes(pageDelta)) {
      return Promise.resolve(result('unavailable', session?.backend || 'scroll'));
    }
    if (session.backend === 'compositor') {
      return pageDelta === 0
        ? animateCompositorRollback(options)
        : Promise.resolve(result('unavailable', 'compositor'));
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
    setEdgeDirection(pageDelta === 0
      ? session.edgeDirection
      : pageDelta > 0 ? 'next' : 'prev');
    setEdgeOffset(session.origin - startLogical + startBoundaryOffset);

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
        setEdgeOffset(session.origin - logical + boundaryOffset);
        diagnostics.markVisualUpdate(diagnosticRecordId, frameTime);
        diagnostics.frame(diagnosticRecordId, frameTime);

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
    }
    if (session) {
      cancelDiagnostic(session.diagnosticRecordId, reason);
      releaseSession();
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
