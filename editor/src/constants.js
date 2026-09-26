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

// Intensity category scale for classified extratropical cyclones -- a
// calculated score (wind + gust + size + pressure) rather than wind alone,
// since these storms' impact depends heavily on how much area they cover.
// Ascending severity, deliberately a different hue family than
// PROBABILITY_COLORS so a classified system's color reads as a distinct
// scale, not a continuation of "formation probability."
export const CATEGORY_INFO = {
  ed: { label: 'Extratropical Depression', color: '#6b8e4e' },
  ets: { label: 'Extratropical Storm', color: '#a4a832' },
  cat1: { label: 'Category 1', color: '#c9a227' },
  cat2: { label: 'Category 2', color: '#d97f2c' },
  cat3: { label: 'Category 3', color: '#c1442c' },
  cat4: { label: 'Category 4', color: '#9c2b4e' },
  cat5: { label: 'Category 5', color: '#5c2160' },
};

// Score = [(V-35) + 0.25*(G-40)] * sqrt(R/300) + 0.5*(1010-p)
// V=sustained wind mph, G=max gust mph, R=gale-radius miles, p=central mb.
// Wind, gust, and pressure points are all floored at 0 -- a weak wind, weak
// gust, or high pressure contributes nothing rather than subtracting.
export function intensityScore({ windMph, gustMph, galeRadiusMi, pressureMb }) {
  if ([windMph, gustMph, galeRadiusMi, pressureMb].some((v) => typeof v !== 'number')) return null;
  const windPoints = Math.max(0, windMph - 35);
  const gustPoints = Math.max(0, 0.25 * (gustMph - 40));
  const sizeFactor = Math.sqrt(galeRadiusMi / 300);
  const pressurePoints = Math.max(0, 0.5 * (1010 - pressureMb));
  return (windPoints + gustPoints) * sizeFactor + pressurePoints;
}

export function intensityCategoryKey(score) {
  if (typeof score !== 'number') return null;
  if (score < 10) return 'ed';
  if (score < 20) return 'ets';
  if (score < 40) return 'cat1';
  if (score < 65) return 'cat2';
  if (score < 100) return 'cat3';
  if (score < 150) return 'cat4';
  return 'cat5';
}

// The name/stage-based label until a system is classified, then its own
// name if set, else the category label ("Category 3").
export function displayLabel(system) {
  if (system.classified) {
    const key = intensityCategoryKey(intensityScore(system));
    if (key) return system.name || CATEGORY_INFO[key].label;
  }
  return system.displayName;
}

export function systemColor(system) {
  if (system.classified) {
    const key = intensityCategoryKey(intensityScore(system));
    if (key) return CATEGORY_INFO[key].color;
  }
  return PROBABILITY_COLORS[probabilityTier(maxFormationProbabilityPct(system))];
}
