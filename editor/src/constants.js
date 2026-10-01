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

// A forecast point only ever has a forecast wind, never a full reading
// (gust/gale-radius/pressure), so its own intensity symbol can't reuse
// intensityScore() itself -- it uses just that formula's wind term (the
// same "points above 35 mph, floored at 0" the system-level score also
// starts from), scored against the same category thresholds. This is
// deliberately NOT the system's current gust/radius/pressure plugged in
// alongside the point's forecast wind -- a point's symbol reflects its
// own forecast wind alone, not a mix of forecast and present conditions.
export function windOnlyIntensityScore(windMph) {
  if (typeof windMph !== 'number') return null;
  return Math.max(0, windMph - 35);
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

// One-character symbol for a category key -- used inside forecast-point
// markers on the track, where a full label won't fit. Categories 1-5 use
// their digit rather than a letter since that's already how CATEGORY_INFO's
// own labels ("Category 3") abbreviate in speech.
const CATEGORY_SYMBOL = { ed: 'D', ets: 'S', cat1: '1', cat2: '2', cat3: '3', cat4: '4', cat5: '5' };
export function categorySymbol(key) {
  return CATEGORY_SYMBOL[key] ?? null;
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

// A watch/warning's severity axis, deliberately a third hue family
// distinct from both PROBABILITY_COLORS (blue) and CATEGORY_INFO (green
// through purple) -- standard NWS watch=yellow/warning=red convention,
// not NHC's hurricane-specific magenta-watch one, since this app is
// coastal/Nor'easter-focused, not hurricane-focused.
export const WATCH_LEVEL_COLORS = {
  watch: '#eab308',
  warning: '#dc2626',
};

export const WATCH_LEVEL_LABELS = { watch: 'Watch', warning: 'Warning' };

export function watchColor(level) {
  return WATCH_LEVEL_COLORS[level] ?? WATCH_LEVEL_COLORS.watch;
}

// Kept in sync by hand with the identical allowlist in
// server/src/watches.js (validated server-side there; this is only ever
// the display label both the editor's drafting UI and the public page's
// per-system attribution read from) -- same "duplicate the tiny
// allowlist per file" convention this app already uses for
// forecastPoints.js's POINT_STATUSES, just shared here across the two
// client pages since both need the same labels (unlike POINT_STATUSES,
// which is editor-only).
export const WATCH_PRODUCTS = [
  { value: 'coastal_flood', label: 'Coastal Flood' },
  { value: 'storm_surge', label: 'Storm Surge' },
  { value: 'high_wind', label: 'High Wind' },
  { value: 'winter_storm', label: 'Winter Storm' },
  { value: 'blizzard', label: 'Blizzard' },
  { value: 'gale', label: 'Gale' },
];

export function watchProductLabel(product) {
  return WATCH_PRODUCTS.find((p) => p.value === product)?.label ?? product;
}

// Used everywhere a mile radius needs converting to a degree radius (cone
// spread, forecast-point geometry) -- one shared constant instead of being
// redefined per file.
export const MILES_PER_DEGREE_LAT = 69.0934;

// Default cone-radius (spread, in miles) suggested for a new forecast point
// at a given lead-time hour: a piecewise-linear curve through control
// points at the hours NHC actually issues advisory points, extrapolated
// past 120h. Just a starting point the forecaster can freely override --
// not a rule, there's no historical-track-error data behind it.
const SPREAD_PRESETS = [
  [0, 0],
  [12, 20],
  [24, 35],
  [36, 50],
  [48, 65],
  [72, 100],
  [96, 140],
  [120, 180],
];

export function defaultSpreadForHour(hour) {
  const h = Math.max(0, Number(hour) || 0);
  if (h >= 120) return 180 + ((h - 120) / 24) * 40;
  for (let i = 1; i < SPREAD_PRESETS.length; i++) {
    const [h1, s1] = SPREAD_PRESETS[i];
    if (h <= h1) {
      const [h0, s0] = SPREAD_PRESETS[i - 1];
      return s0 + (s1 - s0) * ((h - h0) / (h1 - h0));
    }
  }
  return 0;
}
