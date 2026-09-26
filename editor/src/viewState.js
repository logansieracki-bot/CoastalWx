import { MIN_LON_SPAN, MAX_LON_SPAN, MAX_LATITUDE } from './constants.js';
import { fitBoundsToAspect } from './geo.js';

function copyBounds(bounds) {
  return { west: bounds.west, east: bounds.east, south: bounds.south, north: bounds.north };
}

function span(bounds) {
  return {
    lon: bounds.east - bounds.west,
    lat: bounds.north - bounds.south
  };
}

function clampLatitudeBounds(bounds) {
  const latSpan = bounds.north - bounds.south;
  if (latSpan >= MAX_LATITUDE * 2) {
    return { ...bounds, south: -MAX_LATITUDE, north: MAX_LATITUDE };
  }

  let { south, north } = bounds;
  if (north > MAX_LATITUDE) {
    const shift = north - MAX_LATITUDE;
    north -= shift;
    south -= shift;
  }
  if (south < -MAX_LATITUDE) {
    const shift = -MAX_LATITUDE - south;
    south += shift;
    north += shift;
  }
  return { ...bounds, south, north };
}

export function createViewState(initialBounds) {
  const bounds = copyBounds(initialBounds);
  return {
    bounds,
    initialBounds: copyBounds(initialBounds)
  };
}

export function getAspectFittedBounds(viewState, viewportAspect) {
  return fitBoundsToAspect(viewState.bounds, viewportAspect);
}

export function panView(viewState, deltaLon, deltaLat) {
  const moved = {
    west: viewState.bounds.west + deltaLon,
    east: viewState.bounds.east + deltaLon,
    south: viewState.bounds.south + deltaLat,
    north: viewState.bounds.north + deltaLat
  };
  return {
    ...viewState,
    bounds: clampLatitudeBounds(moved)
  };
}

export function zoomViewAt(viewState, factor, anchor) {
  if (!(factor > 0)) throw new RangeError('zoom factor must be greater than zero');
  const current = viewState.bounds;
  const currentSpan = span(current);
  const anchorRx = (anchor.lon - current.west) / currentSpan.lon;
  const anchorRy = (current.north - anchor.lat) / currentSpan.lat;

  let newLonSpan = currentSpan.lon * factor;
  newLonSpan = Math.max(MIN_LON_SPAN, Math.min(MAX_LON_SPAN, newLonSpan));
  const actualFactor = newLonSpan / currentSpan.lon;
  let newLatSpan = currentSpan.lat * actualFactor;
  newLatSpan = Math.min(MAX_LATITUDE * 2, newLatSpan);

  const west = anchor.lon - anchorRx * newLonSpan;
  const east = west + newLonSpan;
  const north = anchor.lat + anchorRy * newLatSpan;
  const south = north - newLatSpan;

  return {
    ...viewState,
    bounds: clampLatitudeBounds({ west, east, south, north })
  };
}

export function resetView(viewState) {
  return {
    ...viewState,
    bounds: copyBounds(viewState.initialBounds)
  };
}
