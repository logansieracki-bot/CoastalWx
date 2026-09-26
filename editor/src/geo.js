import { MAX_LATITUDE } from './constants.js';

export function normalizeLongitude(lon) {
  return ((lon + 180) % 360 + 360) % 360 - 180;
}

export function clampLatitude(lat) {
  return Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
}

export function fitBoundsToAspect(bounds, viewportAspect) {
  if (!(viewportAspect > 0)) {
    throw new RangeError('viewportAspect must be greater than zero');
  }

  let { west, east, south, north } = bounds;
  const lonSpan = east - west;
  const latSpan = north - south;

  if (!(lonSpan > 0) || !(latSpan > 0)) {
    throw new RangeError('bounds must have positive longitude and latitude spans');
  }

  const requestedAspect = lonSpan / latSpan;

  if (requestedAspect < viewportAspect) {
    const neededLonSpan = latSpan * viewportAspect;
    const extra = (neededLonSpan - lonSpan) / 2;
    west -= extra;
    east += extra;
  } else if (requestedAspect > viewportAspect) {
    const neededLatSpan = lonSpan / viewportAspect;
    const extra = (neededLatSpan - latSpan) / 2;
    south -= extra;
    north += extra;
  }

  return { west, east, south, north };
}

export function unprojectXY(x, y, bounds, width, height) {
  const lonSpan = bounds.east - bounds.west;
  const latSpan = bounds.north - bounds.south;
  if (!(width > 0) || !(height > 0) || !(lonSpan > 0) || !(latSpan > 0)) {
    throw new RangeError('inverse projection requires positive viewport and geographic spans');
  }

  return {
    lon: bounds.west + (x / width) * lonSpan,
    lat: bounds.north - (y / height) * latSpan
  };
}
