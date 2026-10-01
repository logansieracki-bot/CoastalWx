import { unprojectXY } from './geo.js';
import { panView, zoomViewAt } from './viewState.js';

export function clientPointToGeo(clientX, clientY, rect, bounds) {
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  return unprojectXY(x, y, bounds, rect.width, rect.height);
}

export function wheelDeltaToZoomFactor(deltaY) {
  if (deltaY === 0) return 1;
  return Math.max(0.55, Math.min(1.8, Math.exp(deltaY * 0.0015)));
}

export function attachNavigation({
  svg,
  getView,
  setView,
  getRenderedBounds,
  onPointerGeo,
  shouldStartPan = () => true
}) {
  let drag = null;
  // Multi-touch pinch-to-zoom -- a Map so each finger's own last-known
  // position survives regardless of pointerdown/move/up ordering between
  // the two. Gated purely on how many pointers are simultaneously down,
  // not on shouldStartPan (unlike single-finger pan): you can't
  // "pinch-select" a marker/annotation the way one touch can, so pinch
  // should work no matter what's under either finger.
  const pointers = new Map();
  let pinch = null; // { lastDistance } | null, non-null only while exactly 2 pointers are down

  function geoAtEvent(event, bounds = getRenderedBounds()) {
    return clientPointToGeo(event.clientX, event.clientY, svg.getBoundingClientRect(), bounds);
  }

  // setPointerCapture can throw (e.g. the pointer already released by the
  // time this runs) -- best-effort only. Capture just keeps events
  // flowing if a finger briefly crosses the element's bounds mid-gesture;
  // losing it isn't fatal, but letting the exception escape uncaught
  // would abort whichever caller's gesture-start logic hadn't finished
  // yet (for the pinch-start caller, that would silently skip setting
  // `pinch` entirely and the gesture would never engage).
  function tryCapture(pointerId) {
    try { svg.setPointerCapture?.(pointerId); } catch { /* best-effort */ }
  }

  function pinchMidpoint() {
    const [a, b] = [...pointers.values()];
    return { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 };
  }

  function pinchDistance() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function emitPointer(event) {
    const bounds = getRenderedBounds();
    if (!bounds) return;
    onPointerGeo?.(geoAtEvent(event, bounds));
  }

  function onPointerDown(event) {
    if (pointers.size >= 2) return; // a 3rd+ simultaneous finger is a no-op, no 3-finger gestures
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 2) {
      // A 2nd finger just joined -- end any single-finger pan in favor of
      // pinch-zoom, and seed the starting distance immediately (not
      // deferred to the first move) so there's no wasted first frame.
      if (drag) { drag = null; svg.classList.remove('is-panning'); }
      for (const id of pointers.keys()) tryCapture(id);
      pinch = { lastDistance: pinchDistance() };
      event.preventDefault();
      return;
    }

    if (event.button !== 0) return;
    if (!shouldStartPan(event)) return;
    const bounds = getRenderedBounds();
    if (!bounds) return;
    const rect = svg.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      startGeo: clientPointToGeo(event.clientX, event.clientY, rect, bounds),
      displayBounds: { ...bounds },
      view: getView()
    };
    tryCapture(event.pointerId);
    svg.classList.add('is-panning');
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pinch && pointers.size === 2) {
      const bounds = getRenderedBounds();
      if (!bounds) return;
      const rect = svg.getBoundingClientRect();
      const mid = pinchMidpoint();
      const anchor = clientPointToGeo(mid.clientX, mid.clientY, rect, bounds);
      const dist = pinchDistance();
      // Recomputed fresh each tick against the CURRENT distance (not
      // accumulated from gesture-start), same incremental-update style
      // onWheel already uses per scroll tick -- avoids any compounding
      // drift over a long pinch. Fingers spreading apart (dist grows)
      // means factor < 1, which zooms in -- same sign convention
      // wheelDeltaToZoomFactor already establishes for this map.
      if (dist > 0 && pinch.lastDistance > 0) {
        const current = getView();
        const source = { ...current, bounds: { ...bounds } };
        const next = zoomViewAt(source, pinch.lastDistance / dist, anchor);
        next.initialBounds = current.initialBounds;
        setView(next);
        onPointerGeo?.(anchor);
      }
      pinch.lastDistance = dist;
      return;
    }

    emitPointer(event);
    if (!drag || event.pointerId !== drag.pointerId) return;
    const rect = svg.getBoundingClientRect();
    const currentGeo = clientPointToGeo(
      event.clientX,
      event.clientY,
      rect,
      drag.displayBounds
    );
    const deltaLon = drag.startGeo.lon - currentGeo.lon;
    const deltaLat = drag.startGeo.lat - currentGeo.lat;
    const source = {
      ...drag.view,
      bounds: { ...drag.displayBounds }
    };
    const next = panView(source, deltaLon, deltaLat);
    next.initialBounds = drag.view.initialBounds;
    setView(next);
  }

  function endDrag(event) {
    pointers.delete(event.pointerId);
    // Deliberately simple: dropping below 2 fingers just ends the pinch
    // rather than trying to seamlessly resume a single-finger pan with
    // whichever pointer is left -- the user can start a fresh drag.
    if (pointers.size < 2) pinch = null;
    if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
    drag = null;
    svg.classList.remove('is-panning');
  }

  function onWheel(event) {
    const bounds = getRenderedBounds();
    if (!bounds) return;
    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    const anchor = clientPointToGeo(event.clientX, event.clientY, rect, bounds);
    const current = getView();
    const source = { ...current, bounds: { ...bounds } };
    const next = zoomViewAt(source, wheelDeltaToZoomFactor(event.deltaY), anchor);
    next.initialBounds = current.initialBounds;
    setView(next);
    onPointerGeo?.(anchor);
  }

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('pointerleave', event => {
    if (pointers.has(event.pointerId)) {
      if (event.buttons === 0) endDrag(event);
      return;
    }
    if (!drag) onPointerGeo?.(null);
    else if (event.buttons === 0) endDrag(event);
  });
  svg.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    svg.removeEventListener('pointerdown', onPointerDown);
    svg.removeEventListener('pointermove', onPointerMove);
    svg.removeEventListener('pointerup', endDrag);
    svg.removeEventListener('pointercancel', endDrag);
    svg.removeEventListener('wheel', onWheel);
  };
}
