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

  function geoAtEvent(event, bounds = getRenderedBounds()) {
    return clientPointToGeo(event.clientX, event.clientY, svg.getBoundingClientRect(), bounds);
  }

  function emitPointer(event) {
    const bounds = getRenderedBounds();
    if (!bounds) return;
    onPointerGeo?.(geoAtEvent(event, bounds));
  }

  function onPointerDown(event) {
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
    svg.setPointerCapture?.(event.pointerId);
    svg.classList.add('is-panning');
    event.preventDefault();
  }

  function onPointerMove(event) {
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
