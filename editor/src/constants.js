export const LAT_GRID_STEP = 5;
export const LON_GRID_STEP = 10;
export const MIN_LON_SPAN = 6;
export const MAX_LON_SPAN = 200;
export const MAX_LATITUDE = 85;

// Initial camera: Gulf/Caribbean through Atlantic Canada.
export const INITIAL_BOUNDS = { west: -95, east: -25, south: 10, north: 55 };

// Formation-probability color ramp (Disturbance/Invest markers): one hue,
// light -> dark = low -> high chance of development. 0%/unset is neutral gray,
// not "very light blue" -- it means "nothing expected," a different thing.
export const PROBABILITY_COLORS = {
  none: '#898781',
  low: '#6da7ec',
  medium: '#2a78d6',
  high: '#104281',
};

export function probabilityTier(pct) {
  if (pct === null || pct === undefined || pct <= 0) return 'none';
  if (pct <= 30) return 'low';
  if (pct <= 60) return 'medium';
  return 'high';
}

// A system tracks three formation-probability windows (2/5/10-day); the
// color-driving figure is whichever window is currently highest.
export function maxFormationProbabilityPct(system) {
  const vals = [
    system.formationProbability2dayPct,
    system.formationProbability5dayPct,
    system.formationProbability10dayPct,
  ].filter((v) => typeof v === 'number');
  return vals.length ? Math.max(...vals) : null;
}

export function systemColor(system) {
  return PROBABILITY_COLORS[probabilityTier(maxFormationProbabilityPct(system))];
}
