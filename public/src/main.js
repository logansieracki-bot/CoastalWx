// Read-only public viewer: reuses the editor's own rendering modules
// as-is (same basemap, marker, point, cone, wind-field, and annotation
// visuals) with none of its editing machinery -- no toolbar, no drag
// gestures, no vertex handles. These imports are relative (not absolute
// /editor/... paths) so they
// keep resolving correctly under a path-prefixed deployment too -- e.g.
// GitHub Pages serves this repo at /NorEASterCaster/, not the domain
// root, so an absolute /editor/src/... path would 404 there even though
// the file exists (Railway, served from its own root with no prefix,
// happened to make that mistake invisible).
import {
  INITIAL_BOUNDS, systemColor, displayLabel, intensityScore, intensityCategoryKey,
  categorySymbol, windOnlyIntensityScore, CATEGORY_INFO, maxFormationProbabilityPct,
  PROBABILITY_COLORS,
} from '../editor/src/constants.js';
import { createViewState, getAspectFittedBounds } from '../editor/src/viewState.js';
import { attachNavigation } from '../editor/src/navigation.js';
import { projectLonLat } from '../editor/src/geo.js';
import { createMapRenderer } from '../editor/src/mapRenderer.js';
import { createPointRenderer } from '../editor/src/pointRenderer.js';
import { createAnnotationRenderer } from '../editor/src/annotationRenderer.js';
import { createLivePulseRenderer } from './livePulseRenderer.js';
import { createTrackConeRenderer } from '../editor/src/trackConeRenderer.js';
import { createWindFieldRenderer } from '../editor/src/windFieldRenderer.js';
import { buildDisturbanceCalloutText, buildClassifiedCalloutText } from '../editor/src/discussionText.js';
import { placeCallout } from '../editor/src/calloutPlacement.js';
import { buildConeDisks } from '../editor/src/trackGeometry.js';

const POLL_INTERVAL_MS = 60000;

// Caps how far this read-only map can be zoomed out or panned -- keeps it
// framed on the Atlantic and Eastern Pacific basins (this tool's actual
// coverage area) instead of drifting out to show the whole globe. The
// editor itself has no such limit (forecasters may need broader context).
const PUBLIC_MAX_BOUNDS = { west: -145, east: 10, south: 0, north: 75 };

function clampToBounds(bounds, box) {
  let { west, east, south, north } = bounds;
  let lonSpan = east - west;
  let latSpan = north - south;
  const boxLonSpan = box.east - box.west;
  const boxLatSpan = box.north - box.south;

  if (lonSpan > boxLonSpan) {
    const cx = (west + east) / 2;
    lonSpan = boxLonSpan;
    west = cx - lonSpan / 2;
    east = cx + lonSpan / 2;
  }
  if (latSpan > boxLatSpan) {
    const cy = (south + north) / 2;
    latSpan = boxLatSpan;
    south = cy - latSpan / 2;
    north = cy + latSpan / 2;
  }

  if (west < box.west) { east += box.west - west; west = box.west; }
  if (east > box.east) { west -= east - box.east; east = box.east; }
  if (south < box.south) { north += box.south - south; south = box.south; }
  if (north > box.north) { south -= north - box.north; north = box.north; }

  return { west, east, south, north };
}

// Shown when no backend is reachable at all (e.g. the GitHub Pages static
// deployment, which has no /api) -- an honest, clearly-labeled stand-in
// rather than a blank map or a crash, same spirit as the editor's own
// "LOCAL-ONLY MODE" banner and the original sample-data root page.
const DEMO_SYSTEMS = [
  {
    id: 'demo-1', season: 2025, seasonLabel: '2025-26', sequenceNumber: 1,
    name: 'Marlowe', displayName: 'Marlowe', stage: 'invest',
    lat: 38.5, lon: -68.0,
    formationProbability2dayPct: null, formationProbability5dayPct: null, formationProbability10dayPct: null,
    pressureMb: 978, windMph: 65, gustMph: 85,
    galeRadiusNeMi: 220, galeRadiusSeMi: 200, galeRadiusSwMi: 180, galeRadiusNwMi: 190,
    hurricaneForceRadiusNeMi: 60, hurricaneForceRadiusSeMi: 50, hurricaneForceRadiusSwMi: 40, hurricaneForceRadiusNwMi: 45,
    galeRadiusMi: 197.5,
    formed: true, classified: true, forecastInterval: 12,
  },
  {
    id: 'demo-2', season: 2025, seasonLabel: '2025-26', sequenceNumber: 2,
    name: null, displayName: 'Disturbance 2', stage: 'disturbance',
    lat: 28, lon: -55,
    formationProbability2dayPct: 20, formationProbability5dayPct: 50, formationProbability10dayPct: 70,
    pressureMb: null, windMph: null, gustMph: null,
    galeRadiusNeMi: null, galeRadiusSeMi: null, galeRadiusSwMi: null, galeRadiusNwMi: null,
    hurricaneForceRadiusNeMi: null, hurricaneForceRadiusSeMi: null, hurricaneForceRadiusSwMi: null, hurricaneForceRadiusNwMi: null,
    galeRadiusMi: null,
    formed: false, classified: false, forecastInterval: 12,
  },
];
const DEMO_FORECAST_POINTS = [
  { id: 'demo-fp-1', systemId: 'demo-1', sequence: 1, lon: -66.5, lat: 40, hour: 12, windMph: 70, spreadMi: 40, hourMode: 'auto', hourOverride: null, status: null },
  { id: 'demo-fp-2', systemId: 'demo-1', sequence: 2, lon: -64.5, lat: 42, hour: 24, windMph: 60, spreadMi: 70, hourMode: 'auto', hourOverride: null, status: null },
  { id: 'demo-fp-3', systemId: 'demo-1', sequence: 3, lon: -61, lat: 44.5, hour: 36, windMph: 50, spreadMi: 100, hourMode: 'auto', hourOverride: null, status: 'over_water' },
];
// Pre-classification discussion/probabilities are advisory-sourced too now
// (see buildDisturbanceCalloutText) -- demo-2 needs its own demo advisory
// or its callout would show the real "(No advisory published yet.)" empty
// state instead of demoing the feature.
const DEMO_ADVISORIES = [
  {
    id: 'demo-adv-1', systemId: 'demo-1', number: 3, headline: null,
    discussion: 'Marlowe continues to weaken as it accelerates northeast over open water. No coastal impacts are expected with this system.',
    issuedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), issuedByUserId: 'demo', issuedByDisplayName: 'Demo Forecaster', cancelable: false,
    snapshot: { system: DEMO_SYSTEMS[0], forecastPoints: DEMO_FORECAST_POINTS },
  },
  {
    id: 'demo-adv-2', systemId: 'demo-2', number: 1, headline: null,
    discussion: 'Broad, disorganized area of low pressure. Some slow development is possible while it drifts north-northeast over the next several days.',
    issuedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), issuedByUserId: 'demo', issuedByDisplayName: 'Demo Forecaster', cancelable: false,
    snapshot: { system: DEMO_SYSTEMS[1], forecastPoints: [] },
  },
];
// A shape + an arrow on the non-classified demo disturbance (marker at
// lon -55, lat 28) -- demo-1 is already classified, and classified
// systems' annotations are hidden (see visibleAnnotations()), same rule
// as the editor. Kept spatially apart from the marker and from each
// other -- both centered tight on the marker looked like a mess at
// closer zoom (a real forecaster's own shape/arrow can of course still
// end up that close; this is just demo content, not a rendering limit).
const DEMO_ANNOTATIONS = [
  {
    id: 'demo-ann-1', systemId: 'demo-2', type: 'shape',
    points: [{ lon: -53, lat: 19 }, { lon: -44, lat: 18 }, { lon: -45, lat: 25 }, { lon: -54, lat: 24 }],
  },
  {
    id: 'demo-ann-2', systemId: 'demo-2', type: 'arrow',
    points: [{ lon: -55, lat: 28 }, { lon: -45, lat: 36 }],
  },
];

const svg = document.getElementById('map');
const demoBannerEl = document.getElementById('demo-banner');
const heroStatusEl = document.getElementById('hero-status');
const activityTickerEl = document.getElementById('activity-ticker');
const activityTickerTextEl = document.getElementById('activity-ticker-text');
const liveStatusTextEl = document.getElementById('live-status-text');
const systemListEl = document.getElementById('system-list');
const discussionCalloutEl = document.getElementById('discussion-callout');
const systemListEmptyEl = document.getElementById('system-list-empty');
const sidebarOverviewEl = document.getElementById('sidebar-overview');
const mapLegendProbabilityEl = document.getElementById('map-legend-probability');
const mapLegendCategoryEl = document.getElementById('map-legend-category');

const CATEGORY_ORDER = ['ed', 'ets', 'cat1', 'cat2', 'cat3', 'cat4', 'cat5'];
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Local, unitless count-up -- same easing/rAF shape as history.js's own
// animateNumber, kept as its own small copy rather than a shared import
// (same "duplicate the tiny helper per file" convention this app already
// uses for screenUnit() across its renderers).
function animateNumber(el, target, duration = 600) {
  if (reduceMotion()) { el.textContent = String(target); return; }
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = String(Math.round(target * eased));
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

let systems = [];
let forecastPoints = [];
let advisories = [];
let annotations = [];
let selectedId = null;
let usingDemoData = false;
let viewState = createViewState(INITIAL_BOUNDS);
let mapRenderer = null;
let pointRenderer = null;
let annotationRenderer = null;
let trackConeRenderer = null;
let windFieldRenderer = null;
let livePulseRenderer = null;

async function loadGeography() {
  // Relative to the document (not this module) -- fetch() resolves against
  // the page's own URL, and editor/ sits alongside wherever this page's
  // index.html is rooted in both deployments (see the import comment above
  // for why this can't be an absolute /editor/... path).
  const [land, lakes, borders, states] = await Promise.all(
    ['land', 'lakes', 'borders', 'states'].map((name) =>
      fetch(`editor/assets/${name}.geojson`).then((r) => r.json())
    )
  );
  return { land, lakes, borders, states };
}

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

async function loadData() {
  try {
    const [nextSystems, nextForecastPoints, nextAdvisories, nextAnnotations] = await Promise.all([
      fetchJson('api/systems'), fetchJson('api/forecast-points'), fetchJson('api/advisories'), fetchJson('api/annotations'),
    ]);
    systems = nextSystems;
    forecastPoints = nextForecastPoints;
    advisories = nextAdvisories;
    // Wire format is [[lon, lat], ...] pairs (see server/src/annotations.js);
    // the renderer wants {lon, lat} objects, same conversion the editor's
    // own api.js does for its remote backend.
    annotations = nextAnnotations.map((a) => ({ ...a, points: a.points.map(([lon, lat]) => ({ lon, lat })) }));
    usingDemoData = false;
  } catch {
    systems = DEMO_SYSTEMS;
    forecastPoints = DEMO_FORECAST_POINTS;
    advisories = DEMO_ADVISORIES;
    annotations = DEMO_ANNOTATIONS;
    usingDemoData = true;
  }
  demoBannerEl.hidden = !usingDemoData;
  // A selected system that vanished (deleted, or a stale id from before a
  // poll) should gracefully drop the selection rather than leave a
  // dangling detail card open on nothing.
  if (selectedId && !systems.some((s) => s.id === selectedId)) selectedId = null;
}

function currentBounds() {
  const rect = svg.getBoundingClientRect();
  const aspect = rect.width / Math.max(1, rect.height);
  return getAspectFittedBounds(viewState, aspect);
}

// Shared by trackPointsFor (live) and publicViewFor (advisory-snapshotted)
// below -- both feed it the same {id, lon, lat, hour, spreadMi, windMph}
// shape (forecastPoints.js's toApi() and an advisory's own snapshot use
// identical field names), just from a different source array. A system's
// own position is always its synthetic hour-0 point, prepended ahead of
// the real forecast points.
function mapTrackPoints(rawPoints, system) {
  const own = rawPoints
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((p) => ({
      id: p.id, lon: p.lon, lat: p.lat, hour: p.hour, spread: p.spreadMi,
      symbol: categorySymbol(intensityCategoryKey(windOnlyIntensityScore(p.windMph))),
    }));
  return [{ lon: system.lon, lat: system.lat, hour: 0, spread: 0 }, ...own];
}

// Mirrors editor/src/main.js's selectedSystemTrackPoints(). LIVE forecast
// points for a system -- only right for a not-yet-classified system (which
// never has a track at all) or internally before advisory-gating applies;
// see publicViewFor for what a classified system's track actually shows.
function trackPointsFor(system) {
  if (!system || !system.classified) return [];
  return mapTrackPoints(forecastPoints.filter((p) => p.systemId === system.id), system);
}

function latestAdvisoryFor(systemId) {
  const own = advisories.filter((a) => a.systemId === systemId);
  return own.reduce((latest, a) => (!latest || new Date(a.issuedAt) > new Date(latest.issuedAt) ? a : latest), null);
}

// Once Classified, everything shown publicly for a system -- marker color/
// symbol, wind/gust/pressure, the forecast cone/track, the wind field --
// comes from the latest PUBLISHED advisory's frozen snapshot, never live
// editor data, so a forecaster can freely edit/save in the editor without
// anything changing here until they actually publish (or a scheduled
// advisory auto-publishes). This is the same rule
// buildClassifiedCalloutText already follows for the discussion text (see
// editor/src/discussionText.js); this extends it to everything else.
// Pre-classification systems need no such override here: wind/gust/
// pressure/formation-probabilities/discussion are only ever written to the
// live system record at the moment an advisory publishes (see systems.js's
// ADVISORY_SETTABLE_FIELDS and advisories.js's publishAdvisory) -- so the
// live row already *is* the latest published state for those fields, by
// construction, not by a gating read here. Position/wind-field-radius
// genuinely do stay live pre-classification (no advisory concept covers
// them), matching NHC's own live-updating Tropical Weather Outlook.
function publicViewFor(system) {
  if (!system.classified) return { system, points: trackPointsFor(system) };
  const advisory = latestAdvisoryFor(system.id);
  if (advisory) {
    const snapSystem = advisory.snapshot.system;
    return { system: snapSystem, points: mapTrackPoints(advisory.snapshot.forecastPoints, snapSystem) };
  }
  // Classified but nothing has ever been published for it -- keep its
  // identity and live position (not sensitive forecast data, and there's
  // no prior official position to freeze on instead) but strip every
  // intensity field, so systemColor() falls back to its probability-tier
  // color instead of guessing a category from still-unpublished numbers.
  return {
    system: {
      ...system,
      windMph: null, gustMph: null, pressureMb: null, galeRadiusMi: null,
      galeRadiusNeMi: null, galeRadiusSeMi: null, galeRadiusSwMi: null, galeRadiusNwMi: null,
      hurricaneForceRadiusNeMi: null, hurricaneForceRadiusSeMi: null, hurricaneForceRadiusSwMi: null, hurricaneForceRadiusNwMi: null,
    },
    points: [],
  };
}

// Mirrors editor/src/main.js's visibleAnnotations() -- a classified
// system's shapes/arrows are hidden, its forecast track/cone replacing
// them as its visual representation, same rule here as in the editor.
function visibleAnnotations() {
  return annotations.filter((a) => !systems.find((s) => s.id === a.systemId)?.classified);
}

// Bounding boxes (map-container-relative) of everything on the map the
// callout shouldn't cover -- mirrors editor/src/main.js's
// collectObstacleRects exactly (same selectors, same shared renderers).
// The cone is deliberately excluded here too -- see coneObstacleRect and
// the matching comment in editor/src/main.js for why (it's a full-map
// <rect> clipped by an SVG mask, so its real DOM bounding box is the
// entire visible map, not its painted shape).
const OBSTACLE_SELECTORS = [
  '.point-x-outline', '.point-label', '.forecast-track', '.forecast-point-marker',
  '.wind-field',
  '.annotation-shape-fill', '.annotation-arrow-line',
];
function collectObstacleRects(mapRect) {
  const rects = [];
  for (const selector of OBSTACLE_SELECTORS) {
    for (const el of svg.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        rects.push({ left: r.left - mapRect.left, top: r.top - mapRect.top, right: r.right - mapRect.left, bottom: r.bottom - mapRect.top });
      }
    }
  }
  return rects;
}

// Mirrors editor/src/main.js's coneObstacleRect exactly.
function coneObstacleRect(trackPoints, bounds, width, height) {
  if (!trackPoints || trackPoints.length < 2) return null;
  const disks = buildConeDisks(trackPoints, 24);
  if (!disks.length) return null;
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const d of disks) {
    west = Math.min(west, d.cx - d.rx);
    east = Math.max(east, d.cx + d.rx);
    south = Math.min(south, -d.cy - d.ry);
    north = Math.max(north, -d.cy + d.ry);
  }
  const topLeft = projectLonLat(west, north, bounds, width, height);
  const bottomRight = projectLonLat(east, south, bounds, width, height);
  return {
    left: Math.min(topLeft.x, bottomRight.x), right: Math.max(topLeft.x, bottomRight.x),
    top: Math.min(topLeft.y, bottomRight.y), bottom: Math.max(topLeft.y, bottomRight.y),
  };
}

// Same on-map callout as the editor (see editor/src/main.js's
// renderDiscussionCallout + editor/src/discussionText.js), reusing the
// exact same text builders -- shown here too since a forecaster's
// discussion (and, once classified, the advisory text) is public
// information, same as everything else already on this page.
function renderDiscussionCallout(selected, selectedView, bounds, rect) {
  if (!selected) {
    discussionCalloutEl.hidden = true;
    return;
  }

  discussionCalloutEl.textContent = selected.classified
    ? buildClassifiedCalloutText(selected, latestAdvisoryFor(selected.id), usingDemoData)
    : buildDisturbanceCalloutText(selected, latestAdvisoryFor(selected.id), usingDemoData);
  discussionCalloutEl.hidden = false;

  const { x, y } = projectLonLat(selected.lon, selected.lat, bounds, rect.width, rect.height);
  const obstacles = collectObstacleRects(rect);
  const cone = coneObstacleRect(selectedView.points, bounds, rect.width, rect.height);
  if (cone) obstacles.push(cone);
  const { left, top } = placeCallout({
    markerX: x, markerY: y,
    width: discussionCalloutEl.offsetWidth, height: discussionCalloutEl.offsetHeight,
    mapWidth: rect.width, mapHeight: rect.height,
    obstacles,
  });

  discussionCalloutEl.style.left = `${left}px`;
  discussionCalloutEl.style.top = `${top}px`;
}

function renderMap() {
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const bounds = currentBounds();
  const selected = systems.find((s) => s.id === selectedId) ?? null;
  const selectedView = selected ? publicViewFor(selected) : null;
  // Systems as the public map should actually show them -- a classified
  // one swapped for its latest published advisory's snapshot (or
  // intensity-stripped if none exists yet). Shared by the marker layer and
  // the live-pulse ring so their colors never disagree with each other.
  const publicSystems = systems.map((s) => publicViewFor(s).system);
  mapRenderer.render({ bounds, width: rect.width, height: rect.height, showGrid: true });
  trackConeRenderer.render({ points: selectedView ? selectedView.points : [], selectedForecastPointId: null, bounds, width: rect.width, height: rect.height });
  windFieldRenderer.render({ system: selectedView ? selectedView.system : null, activeThreshold: null, bounds, width: rect.width, height: rect.height });
  renderDiscussionCallout(selected, selectedView, bounds, rect);
  annotationRenderer.render({ annotations: visibleAnnotations(), selectedAnnotationId: null, draft: null, systems, bounds, width: rect.width, height: rect.height });
  livePulseRenderer.render({ systems: publicSystems, bounds, width: rect.width, height: rect.height });
  pointRenderer.render({ systems: publicSystems, selectedId, bounds, width: rect.width, height: rect.height });
}

function setView(next) {
  viewState = { ...next, bounds: clampToBounds(next.bounds, PUBLIC_MAX_BOUNDS) };
  renderMap();
}

function infoRow(label, value) {
  const row = document.createElement('div');
  row.className = 'info-row';
  const l = document.createElement('span');
  l.className = 'info-row__label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'info-row__value';
  v.textContent = value;
  row.append(l, v);
  return row;
}

// No intensity/category information is shown at all until a system is
// Classified -- only its formation probabilities -- matching the public
// page's core rule ("no intensity scale until its active").
function buildCardDetail(system, view) {
  const wrap = document.createElement('div');
  wrap.className = 'system-card__detail';

  const metaSource = system.classified ? view.system : system;
  const meta = document.createElement('p');
  meta.className = 'system-card__meta';
  const metaParts = [`${system.seasonLabel} season`, `${metaSource.lat.toFixed(1)}°N, ${Math.abs(metaSource.lon).toFixed(1)}°W`];
  if (!system.classified) metaParts.push(system.stage === 'invest' ? 'Invest' : 'Disturbance');
  meta.textContent = metaParts.join(' · ');
  wrap.append(meta);

  if (!system.classified) {
    const probs = [
      ['2-day formation chance', system.formationProbability2dayPct],
      ['5-day formation chance', system.formationProbability5dayPct],
      ['10-day formation chance', system.formationProbability10dayPct],
    ];
    for (const [label, value] of probs) wrap.append(infoRow(label, value == null ? 'Not assessed' : `${value}%`));
    return wrap;
  }

  const pub = view.system;
  wrap.append(infoRow('Sustained wind', pub.windMph != null ? `${pub.windMph} mph` : '—'));
  wrap.append(infoRow('Max gust', pub.gustMph != null ? `${pub.gustMph} mph` : '—'));
  wrap.append(infoRow('Central pressure', pub.pressureMb != null ? `${pub.pressureMb} mb` : '—'));

  const forecastOnly = view.points.filter((p) => p.hour > 0);
  if (forecastOnly.length) {
    const heading = document.createElement('h4');
    heading.className = 'system-card__subheading';
    heading.textContent = 'Forecast track';
    wrap.append(heading);
    const list = document.createElement('ul');
    list.className = 'info-track-list';
    for (const point of forecastOnly) {
      const li = document.createElement('li');
      li.textContent = `+${point.hour}h${point.symbol ? ` ${point.symbol}` : ''}`;
      list.append(li);
    }
    wrap.append(list);
  }

  const advisory = latestAdvisoryFor(system.id);
  wrap.append(advisory
    ? infoRow('Latest advisory', new Date(advisory.issuedAt).toLocaleString())
    : infoRow('Status', 'No advisory published yet.'));

  return wrap;
}

function cardTag(system, pub) {
  const tag = document.createElement('span');
  tag.className = 'system-card__tag';
  if (system.classified) {
    const key = intensityCategoryKey(intensityScore(pub));
    tag.textContent = CATEGORY_INFO[key]?.label ?? 'Classified';
    tag.style.background = CATEGORY_INFO[key]?.color ?? systemColor(pub);
  } else {
    const maxPct = maxFormationProbabilityPct(system);
    tag.textContent = maxPct != null ? `${maxPct}% chance` : 'Monitoring';
    tag.style.background = systemColor(system);
  }
  return tag;
}

function renderSystemList() {
  systemListEl.querySelectorAll('.system-card').forEach((el) => el.remove());
  systemListEmptyEl.hidden = systems.length > 0;

  for (const system of systems) {
    const card = document.createElement('article');
    card.className = `system-card${system.id === selectedId ? ' is-selected' : ''}`;
    card.dataset.systemId = system.id;

    const view = publicViewFor(system);
    const summary = document.createElement('button');
    summary.type = 'button';
    summary.className = 'system-card__summary';
    const dot = document.createElement('span');
    dot.className = 'system-card__dot';
    dot.style.background = systemColor(view.system);
    const name = document.createElement('span');
    name.className = 'system-card__name';
    name.textContent = displayLabel(system);
    summary.append(dot, name, cardTag(system, view.system));
    summary.addEventListener('click', () => select(selectedId === system.id ? null : system.id));
    card.append(summary);

    if (system.id === selectedId) card.append(buildCardDetail(system, view));
    systemListEl.append(card);
  }
}

function overviewTile(label, value) {
  const wrap = document.createElement('div');
  wrap.className = 'sidebar-overview__tile';
  const v = document.createElement('span');
  v.className = 'sidebar-overview__value';
  const l = document.createElement('span');
  l.className = 'sidebar-overview__label';
  l.textContent = label;
  wrap.append(v, l);
  animateNumber(v, value);
  return wrap;
}

// A compact at-a-glance dashboard header for the sidebar, above the list
// itself -- restates the same activity-ticker data as two numeric tiles
// rather than only a prose sentence, so the sidebar reads as a dashboard
// summary and not just a bare list.
function renderSidebarOverview() {
  const unclassified = systems.filter((s) => !s.classified).length;
  sidebarOverviewEl.replaceChildren(
    overviewTile('Tracked', systems.length),
    overviewTile('Areas of interest', unclassified),
  );
}

// Static -- the marker color scale itself never changes -- so this is
// built once at init() rather than on every refresh(), reading the exact
// same palettes/abbreviations the markers themselves use (PROBABILITY_
// COLORS, CATEGORY_INFO, categorySymbol) so it can never drift out of
// sync with what's actually drawn on the map.
function renderMapLegend() {
  for (const key of ['none', 'low', 'medium', 'high']) {
    const swatch = document.createElement('span');
    swatch.style.background = PROBABILITY_COLORS[key];
    swatch.title = { none: 'None expected', low: 'Low chance', medium: 'Medium chance', high: 'High chance' }[key];
    mapLegendProbabilityEl.append(swatch);
  }
  for (const key of CATEGORY_ORDER) {
    const swatch = document.createElement('span');
    swatch.style.background = CATEGORY_INFO[key].color;
    swatch.title = CATEGORY_INFO[key].label;
    swatch.textContent = categorySymbol(key) ?? '';
    mapLegendCategoryEl.append(swatch);
  }
}

function renderHeroStatus() {
  const count = systems.length;
  heroStatusEl.textContent = count === 0
    ? 'No active disturbances or systems'
    : `${count} system${count === 1 ? '' : 's'} being tracked`;
}

// "A, B, and C" -- Oxford comma, correct for 1/2/3+ items.
function joinWithAnd(items) {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// Real, auto-generated summary of current activity -- built from the same
// systems data as the rest of the page, not placeholder text. Named
// (classified) systems get an NHC-style "issuing advisories on" mention;
// everything else pre-classification is summarized as a plain count.
// Built with DOM nodes (not innerHTML) so storm names -- while forecaster-
// entered, not public input -- are never interpreted as markup.
function renderActivityTicker() {
  const named = systems.filter((s) => s.classified && s.name);
  const unnamed = systems.filter((s) => !s.classified);

  if (systems.length === 0) {
    activityTickerEl.hidden = true;
    return;
  }
  activityTickerEl.hidden = false;

  activityTickerTextEl.replaceChildren();
  if (named.length) {
    activityTickerTextEl.append('CoastalWx issuing advisories on ');
    const strong = document.createElement('strong');
    strong.textContent = joinWithAnd(named.map((s) => s.displayName));
    activityTickerTextEl.append(strong);
  }
  if (unnamed.length) {
    if (named.length) activityTickerTextEl.append(' — ');
    activityTickerTextEl.append(`monitoring ${unnamed.length} additional area${unnamed.length === 1 ? '' : 's'} of interest`);
  }
  activityTickerTextEl.append('.');
}

// A denser, numbers-first companion to the ticker above -- the ticker
// reads as a sentence, this reads as at-a-glance stats, the same pairing
// the design reference uses (a news-style ticker plus a separate live-
// status bar). All computed straight from the same `systems` array, no
// separate fetch.
function renderLiveStatusBar() {
  const activeCount = systems.length;
  const investCount = systems.filter((s) => s.stage === 'invest').length;

  const publicSystems = systems.map((s) => publicViewFor(s).system);
  let highestCategoryKey = null;
  for (const s of publicSystems) {
    if (!s.classified) continue;
    const key = intensityCategoryKey(intensityScore(s));
    if (key && (!highestCategoryKey || CATEGORY_ORDER.indexOf(key) > CATEGORY_ORDER.indexOf(highestCategoryKey))) {
      highestCategoryKey = key;
    }
  }
  const peakWind = publicSystems.reduce((max, s) => (s.windMph != null && s.windMph > max ? s.windMph : max), 0);

  const parts = [
    `${activeCount} active`,
    `${investCount} invest${investCount === 1 ? '' : 's'}`,
    `Highest: ${highestCategoryKey ? CATEGORY_INFO[highestCategoryKey].label : '—'}`,
    `Peak wind: ${peakWind > 0 ? `${Math.round(peakWind)} mph` : '—'}`,
    'Auto-refresh every 60s',
  ];
  liveStatusTextEl.textContent = parts.join(' · ');
}

function select(systemId, { scroll = false } = {}) {
  selectedId = systemId;
  renderSystemList();
  renderMap();
  if (systemId && scroll) {
    systemListEl.querySelector(`[data-system-id="${systemId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// Tracks whether the pointer moved enough between down and up to count as a
// pan drag (navigation.js's own gesture) rather than a plain click -- same
// 4px threshold and shape as editor/src/main.js's blank-space click check.
// Without this, releasing a pan drag over open water would fire a click
// there and immediately deselect whatever was selected.
let clickDownX = null;
let clickDownY = null;
svg.addEventListener('pointerdown', (event) => {
  clickDownX = event.clientX;
  clickDownY = event.clientY;
});
svg.addEventListener('click', (event) => {
  const hit = event.target.closest?.('[data-system-id]');
  if (hit) { select(hit.dataset.systemId, { scroll: true }); return; }
  const dist = clickDownX == null ? 0 : Math.hypot(event.clientX - clickDownX, event.clientY - clickDownY);
  if (dist > 4) return;
  select(null);
});

async function refresh() {
  await loadData();
  renderHeroStatus();
  renderActivityTicker();
  renderLiveStatusBar();
  renderSidebarOverview();
  renderSystemList();
  renderMap();
}

async function init() {
  const geography = await loadGeography();
  mapRenderer = createMapRenderer(svg, geography);
  windFieldRenderer = createWindFieldRenderer(svg);
  svg.append(windFieldRenderer.fieldLayer); // under the cone/markers -- see windFieldRenderer.js
  trackConeRenderer = createTrackConeRenderer(svg);
  annotationRenderer = createAnnotationRenderer(svg);
  livePulseRenderer = createLivePulseRenderer(svg);
  pointRenderer = createPointRenderer(svg, { hideUnformed: true });

  attachNavigation({
    svg,
    getView: () => viewState,
    setView,
    getRenderedBounds: () => mapRenderer.getLastRender()?.bounds,
    shouldStartPan: (event) => !event.target.closest?.('[data-system-id]'),
  });

  window.addEventListener('resize', renderMap);
  renderMapLegend();

  await refresh();
  setInterval(() => { refresh().catch((err) => console.error(err)); }, POLL_INTERVAL_MS);
}

init().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<div class="fatal-error">Failed to load CoastalWx: ${err.message}</div>`);
});
