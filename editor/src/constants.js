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

// This app's own gale-force threshold -- same 34kt+ convention
// windFieldRenderer.js's 'gale' wind-radius threshold already uses,
// converted to mph (its field values are always mph, 34kt was only ever
// a naming reference).
export const GALE_FORCE_MPH = 39;

// Score = [(V-30) + 0.15*(G-45)] * min(1, sqrt(R/400)) + 0.5*(1010-p)
// V=sustained wind mph, G=max gust mph, R=gale-radius miles, p=central mb.
// Wind, gust, and pressure points are all floored at 0 -- a weak wind, weak
// gust, or high pressure contributes nothing rather than subtracting. Size
// factor is capped at 1 -- an oversized wind field earns no bonus credit
// beyond the system's own wind+gust contribution, it just stops suppressing
// it (see windFieldRenderer.js's wind-radius editor for how R is set).
// R is optional -- a system can be classified before its wind field is
// drawn out (see editor/src/main.js's canClassify), so a missing radius
// here just means no size scaling yet (factor 1), same as
// pointIntensityScore's identical "no radius data yet" fallback below.
// Sub-gale wind is hard-capped to Extratropical Depression regardless of
// how deep the pressure term runs -- category is fundamentally a wind-
// speed bucket (closed circulation alone doesn't make a Storm), the same
// real-world convention a depression/storm/hurricane split follows.
export function intensityScore({ windMph, gustMph, galeRadiusMi, pressureMb }) {
  if ([windMph, gustMph, pressureMb].some((v) => typeof v !== 'number')) return null;
  const windPoints = Math.max(0, windMph - 30);
  const gustPoints = Math.max(0, 0.15 * (gustMph - 45));
  const sizeFactor = typeof galeRadiusMi === 'number' ? Math.min(1, Math.sqrt(galeRadiusMi / 400)) : 1;
  const pressurePoints = Math.max(0, 0.5 * (1010 - pressureMb));
  const score = (windPoints + gustPoints) * sizeFactor + pressurePoints;
  return windMph < GALE_FORCE_MPH ? Math.min(score, 8) : score;
}

// A forecast point's own intensity symbol: wind alone (same "points above
// 30 mph, floored at 0" term intensityScore() starts from) once it has no
// radius data yet, scaled down by the same capped size factor once it does
// (see editor/src/windFieldRenderer.js's createPointWindFieldRenderer).
// Deliberately NOT the system's own current gust/pressure plugged in
// alongside the point's forecast wind -- a point's symbol reflects its own
// forecast wind (and, once set, its own forecast radius) alone, not a mix
// of forecast and present conditions.
export function pointIntensityScore(windMph, galeRadiusMi) {
  if (typeof windMph !== 'number') return null;
  const windPoints = Math.max(0, windMph - 30);
  if (typeof galeRadiusMi !== 'number') return windPoints;
  const sizeFactor = Math.min(1, Math.sqrt(galeRadiusMi / 400));
  return windPoints * sizeFactor;
}

export function intensityCategoryKey(score) {
  if (typeof score !== 'number') return null;
  if (score < 9) return 'ed';
  if (score < 20) return 'ets';
  if (score < 45) return 'cat1';
  if (score < 72) return 'cat2';
  if (score < 108) return 'cat3';
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

// One base hue per product -- the family a zone's color belongs to.
// Severity within that family is lightness/saturation (WATCH_LEVEL_SHADE
// below), not a different hue, so pale -> dark == mild -> severe stays
// readable the same way PROBABILITY_COLORS/CATEGORY_INFO already do.
// Not fully collision-free against CATEGORY_INFO's green->purple sweep --
// 6 more distinct hues don't fit the wheel without some proximity, and
// that's an accepted tradeoff (different map layers, never compared side
// by side) rather than an oversight.
export const WATCH_PRODUCT_HUES = {
  coastal_flood: 190, // cyan
  storm_surge: 265,   // violet
  high_wind: 20,      // orange
  winter_storm: 215,  // blue
  blizzard: 320,      // magenta
  gale: 150,          // sea green
};

// Advisory is the mildest of the three, not a mid-tier between watch and
// warning -- real NWS severity order is advisory < watch < warning.
export const WATCH_LEVEL_LABELS = { advisory: 'Advisory', watch: 'Watch', warning: 'Warning' };

// Same mild -> severe lightness/saturation ramp applied to every product's
// own hue -- pale/low-saturation for Advisory, dark/saturated for Warning.
const WATCH_LEVEL_SHADE = {
  advisory: { s: 55, l: 80 },
  watch: { s: 65, l: 55 },
  warning: { s: 75, l: 35 },
};

export function watchColor(product, level) {
  const hue = WATCH_PRODUCT_HUES[product] ?? WATCH_PRODUCT_HUES.coastal_flood;
  const shade = WATCH_LEVEL_SHADE[level] ?? WATCH_LEVEL_SHADE.watch;
  return `hsl(${hue}, ${shade.s}%, ${shade.l}%)`;
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

// Which overlap treatment a product's zones get when two of them overlap
// on the same system (see watchRenderer.js): 'lane' for coastline-hugging
// hazards (rendered as a fill plus outline-only additional zones so none
// hide each other), 'stripe' for area/polygon hazards (rendered as a
// diagonal two-color pattern over the overlap region). Scoped to same-
// geometry-type pairs only -- a lane zone overlapping a stripe zone just
// renders stacked as normal, no cross-category blending.
export const WATCH_GEOMETRY_TYPE = {
  coastal_flood: 'lane',
  storm_surge: 'lane',
  high_wind: 'stripe',
  winter_storm: 'stripe',
  blizzard: 'stripe',
  gale: 'stripe',
};

export function watchGeometryType(product) {
  return WATCH_GEOMETRY_TYPE[product] ?? 'stripe';
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
