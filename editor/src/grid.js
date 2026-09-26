import { LAT_GRID_STEP, LON_GRID_STEP } from './constants.js';

function normalizeZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

function visibleValues(min, max, step) {
  if (!(max >= min)) throw new RangeError('max must be greater than or equal to min');
  const first = Math.ceil(min / step) * step;
  const values = [];
  for (let value = first; value <= max + 1e-9; value += step) {
    values.push(normalizeZero(Number(value.toFixed(10))));
  }
  return values;
}

export function visibleLatitudes(bounds) {
  return visibleValues(bounds.south, bounds.north, LAT_GRID_STEP);
}

export function visibleLongitudes(bounds) {
  return visibleValues(bounds.west, bounds.east, LON_GRID_STEP);
}

export function formatLatitude(value) {
  const v = normalizeZero(value);
  if (v === 0) return '0°';
  return `${Math.abs(v)}${v > 0 ? 'N' : 'S'}`;
}

export function formatLongitude(value) {
  const v = normalizeZero(value);
  if (v === 0) return '0°';
  if (Math.abs(v) === 180) return '180°';
  return `${Math.abs(v)}${v > 0 ? 'E' : 'W'}`;
}
