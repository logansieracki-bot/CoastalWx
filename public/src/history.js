// Ongoing Storm Analysis: an automatic, no-manual-entry archive built
// entirely from advisories already published through the normal editor
// workflow. Every advisory is an immutable snapshot (see
// server/src/advisories.js) of a system's position/intensity at the
// moment it was issued -- exactly the raw material a track/intensity
// history needs, with nothing extra to author. Reuses the editor's own
// map + constants, same relative-import reasoning as public/src/main.js
// (see its own header comment).
import {
  CATEGORY_INFO, categorySymbol, displayLabel, systemColor,
  intensityScore, intensityCategoryKey, maxFormationProbabilityPct,
} from '../editor/src/constants.js';
import { fitBoundsToAspect } from '../editor/src/geo.js';
import { createMapRenderer } from '../editor/src/mapRenderer.js';
import { createTrackHistoryRenderer } from './trackHistoryRenderer.js';
import { createWindHistoryRenderer } from './windHistoryRenderer.js';
import { formatPosition, computeMovement, computeMinPressure } from './stormStats.js';

const CATEGORY_ORDER = ['ed', 'ets', 'cat1', 'cat2', 'cat3', 'cat4', 'cat5'];

// A short, several-advisory demo history (one storm, strengthening then
// weakening) so this page still demonstrates itself with no backend
// reachable -- same spirit as public/src/main.js's own demo fallback, but
// this page needs a real *sequence* of advisories to have anything to
// show, so it isn't the same dataset.
const DEMO_SYSTEM = {
  id: 'demo-h1', season: 2025, seasonLabel: '2025-26', sequenceNumber: 4,
  name: 'Reyes', displayName: 'Reyes', classified: true, forecastInterval: 12,
};
// Per-quadrant gale radii (avg matches the old single galeRadiusMi figure
// exactly, kept alongside it since intensityScore() still takes the
// averaged number) plus hurricane-force radii once windMph crosses the
// 64kt/~74mph threshold -- real advisory snapshots carry both shapes
// (see systems.js's toApi()), so the demo data should too, or the Wind
// History tab would have nothing to draw for it.
const DEMO_SNAPSHOTS = [
  { lon: -72, lat: 24, windMph: 45, gustMph: 60, pressureMb: 1001, galeRadiusMi: 90,
    galeRadiusNeMi: 100, galeRadiusSeMi: 90, galeRadiusSwMi: 70, galeRadiusNwMi: 100 },
  { lon: -70, lat: 27, windMph: 60, gustMph: 78, pressureMb: 992, galeRadiusMi: 130,
    galeRadiusNeMi: 150, galeRadiusSeMi: 130, galeRadiusSwMi: 100, galeRadiusNwMi: 140 },
  { lon: -68, lat: 30.5, windMph: 80, gustMph: 100, pressureMb: 978, galeRadiusMi: 170,
    galeRadiusNeMi: 190, galeRadiusSeMi: 170, galeRadiusSwMi: 140, galeRadiusNwMi: 180,
    hurricaneForceRadiusNeMi: 60, hurricaneForceRadiusSeMi: 50, hurricaneForceRadiusSwMi: 35, hurricaneForceRadiusNwMi: 55 },
  { lon: -65.5, lat: 34, windMph: 95, gustMph: 118, pressureMb: 965, galeRadiusMi: 190,
    galeRadiusNeMi: 210, galeRadiusSeMi: 190, galeRadiusSwMi: 160, galeRadiusNwMi: 200,
    hurricaneForceRadiusNeMi: 80, hurricaneForceRadiusSeMi: 70, hurricaneForceRadiusSwMi: 50, hurricaneForceRadiusNwMi: 75 },
  { lon: -61, lat: 38, windMph: 85, gustMph: 105, pressureMb: 972, galeRadiusMi: 180,
    galeRadiusNeMi: 200, galeRadiusSeMi: 180, galeRadiusSwMi: 150, galeRadiusNwMi: 190,
    hurricaneForceRadiusNeMi: 65, hurricaneForceRadiusSeMi: 55, hurricaneForceRadiusSwMi: 40, hurricaneForceRadiusNwMi: 60 },
  { lon: -55, lat: 42.5, windMph: 60, gustMph: 78, pressureMb: 988, galeRadiusMi: 140,
    galeRadiusNeMi: 150, galeRadiusSeMi: 140, galeRadiusSwMi: 120, galeRadiusNwMi: 150 },
];
const DEMO_ADVISORIES = DEMO_SNAPSHOTS.map((snap, i) => ({
  id: `demo-h-adv-${i + 1}`, systemId: DEMO_SYSTEM.id, number: i + 1,
  issuedAt: new Date(Date.now() - (DEMO_SNAPSHOTS.length - i) * 6 * 60 * 60 * 1000).toISOString(),
  snapshot: { system: { ...DEMO_SYSTEM, ...snap }, forecastPoints: [] },
}));

// A currently-watched Invest with zero advisories (advisories require
// classification, and an Invest by definition isn't classified yet) --
// demonstrates that the history/ongoing-analysis list also carries active
// pre-classification systems, not just fully-advisoried ones.
const DEMO_INVEST = {
  id: 'demo-h2', season: 2025, seasonLabel: '2025-26', sequenceNumber: 7,
  name: null, displayName: 'Invest 7', stage: 'invest', classified: false, formed: true,
  lon: -48, lat: 21,
  formationProbability2dayPct: 20, formationProbability5dayPct: 60, formationProbability10dayPct: 80,
  windMph: null, gustMph: null, pressureMb: null,
  galeRadiusNeMi: 70, galeRadiusSeMi: 60, galeRadiusSwMi: 45, galeRadiusNwMi: 65,
  hurricaneForceRadiusNeMi: null, hurricaneForceRadiusSeMi: null, hurricaneForceRadiusSwMi: null, hurricaneForceRadiusNwMi: null,
  updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
};
// system_position_log rows captured as this same Invest moved over the
// past ~20 hours -- demonstrates that an Invest (no advisories, so no
// server/src/advisories.js snapshots exist for it) still builds up a real
// multi-point track/wind history from the automatic position log alone.
// The last entry intentionally matches DEMO_INVEST's own current fields.
const NO_GALE_RADII = { galeRadiusNeMi: null, galeRadiusSeMi: null, galeRadiusSwMi: null, galeRadiusNwMi: null };
const DEMO_INVEST_LOG = [
  { lon: -54, lat: 17, formationProbability2dayPct: 10, formationProbability5dayPct: 30, formationProbability10dayPct: 50, ...NO_GALE_RADII },
  { lon: -52, lat: 18.5, formationProbability2dayPct: 15, formationProbability5dayPct: 45, formationProbability10dayPct: 65, ...NO_GALE_RADII },
  { lon: -50, lat: 19.5, formationProbability2dayPct: 20, formationProbability5dayPct: 55, formationProbability10dayPct: 75,
    galeRadiusNeMi: 60, galeRadiusSeMi: 50, galeRadiusSwMi: 40, galeRadiusNwMi: 55 },
  { lon: -48, lat: 21, formationProbability2dayPct: 20, formationProbability5dayPct: 60, formationProbability10dayPct: 80,
    galeRadiusNeMi: 70, galeRadiusSeMi: 60, galeRadiusSwMi: 45, galeRadiusNwMi: 65 },
];
const DEMO_POSITION_LOG = DEMO_INVEST_LOG.map((snap, i) => ({
  id: `demo-h-log-${i + 1}`, systemId: DEMO_INVEST.id,
  recordedAt: new Date(Date.now() - (DEMO_INVEST_LOG.length - i) * 5 * 60 * 60 * 1000).toISOString(),
  snapshot: { ...DEMO_INVEST, ...snap },
}));

const svg = document.getElementById('history-chart');
const demoBannerEl = document.getElementById('demo-banner');
const listEl = document.getElementById('history-list');
const listEmptyEl = document.getElementById('history-list-empty');
const emptyStateEl = document.getElementById('history-empty-state');
const detailEl = document.getElementById('history-detail');
const statsEl = document.getElementById('history-stats');
const legendEl = document.getElementById('history-legend');
const chartTabsEl = document.getElementById('history-chart-tabs');
const stormPanelEl = document.getElementById('storm-panel');
const chartWrapEl = document.getElementById('history-chart-wrap');
const pointPopupEl = document.getElementById('point-popup');

let systems = [];
let currentEntries = [];
let advisories = [];
let positionLog = [];
let usingDemoData = false;
let selectedSystemId = null;
let chartView = 'track';
let mapRenderer = null;
let trackHistoryRenderer = null;
let windHistoryRenderer = null;

async function loadGeography() {
  // Relative to the document, not this module -- see public/src/main.js's
  // header comment for why this can't be an absolute /editor/... path.
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
    const [nextSystems, nextAdvisories, nextPositionLog] = await Promise.all([
      fetchJson('api/systems'), fetchJson('api/advisories'), fetchJson('api/position-log'),
    ]);
    systems = nextSystems;
    advisories = nextAdvisories;
    positionLog = nextPositionLog;
    usingDemoData = false;
  } catch {
    systems = [DEMO_SYSTEM, DEMO_INVEST];
    advisories = DEMO_ADVISORIES;
    positionLog = DEMO_POSITION_LOG;
    usingDemoData = true;
  }
  demoBannerEl.hidden = !usingDemoData;
}

function advisoriesFor(systemId) {
  return advisories.filter((a) => a.systemId === systemId).sort((a, b) => a.number - b.number);
}

function positionLogFor(systemId) {
  return positionLog.filter((r) => r.systemId === systemId).sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
}

// Systems with at least one published advisory (a full snapshot history),
// plus any currently-active Invest -- an Invest never gets an advisory
// (advisories require classification), but it's still an ongoing system
// worth tracking here, not just the fully-advisoried, named cyclones.
// Plain Disturbances (pre-Invest) stay off this list, same as before.
function systemsForHistoryPage() {
  const withAdvisories = new Set(advisories.map((a) => a.systemId));
  return systems.filter((s) => withAdvisories.has(s.id) || s.stage === 'invest');
}

// The chronological record this page draws from, in priority order:
// 1. One entry per published advisory (each a frozen snapshot) -- richest
//    and most authoritative, but only ever exists once a system has been
//    classified and a forecaster has actually published one.
// 2. Failing that, the automatic position log (system_position_log,
//    written server-side every time the system's lat/lon moves -- see
//    server/src/systems.js) -- this is what gives an Invest, or even a
//    plain pre-Invest Disturbance, a real multi-point track/wind history
//    instead of only ever having "wherever it is right now."
// 3. Failing *that* too (a brand new system that hasn't moved since this
//    logging existed, or a backend that predates it), a single synthetic
//    "current" entry built straight from the live record, so it still
//    plots as a one-point track instead of rendering nothing.
function historyEntriesFor(system) {
  const advs = advisoriesFor(system.id);
  if (advs.length) {
    return advs.map((a) => ({ system: a.snapshot.system, issuedAt: a.issuedAt }));
  }
  const log = positionLogFor(system.id);
  if (log.length) {
    return log.map((row) => ({ system: row.snapshot, issuedAt: row.recordedAt }));
  }
  return [{ system, issuedAt: system.updatedAt || system.createdAt || new Date().toISOString() }];
}

// One point per entry, colored by *that entry's own* state -- systemColor
// already picks category color once classified or formation-probability
// color before that, so a track literally traces the strengthening/
// weakening (or, pre-classification, the growing/fading development
// chance) story rather than freezing on the system's current color.
function pointsForSystem(systemId) {
  const system = systems.find((s) => s.id === systemId);
  if (!system) return [];
  return historyEntriesFor(system).map(({ system: snap }) => ({
    lon: snap.lon, lat: snap.lat, color: systemColor(snap),
  }));
}

// Same entries, as wind-envelope radii per quadrant -- one gale + one
// hurricane-force envelope per entry, reusing exactly the fields
// windFieldRenderer.js's live-map renderer already reads off a system.
function snapshotsForSystem(systemId) {
  const system = systems.find((s) => s.id === systemId);
  if (!system) return [];
  return historyEntriesFor(system).map(({ system: snap }) => ({
    lon: snap.lon, lat: snap.lat,
    galeRadii: { ne: snap.galeRadiusNeMi, se: snap.galeRadiusSeMi, sw: snap.galeRadiusSwMi, nw: snap.galeRadiusNwMi },
    hfwRadii: {
      ne: snap.hurricaneForceRadiusNeMi, se: snap.hurricaneForceRadiusSeMi,
      sw: snap.hurricaneForceRadiusSwMi, nw: snap.hurricaneForceRadiusNwMi,
    },
  }));
}

function boundsForPoints(points) {
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const p of points) {
    west = Math.min(west, p.lon); east = Math.max(east, p.lon);
    south = Math.min(south, p.lat); north = Math.max(north, p.lat);
  }
  // A minimum span so a 1-2 point track (freshly classified, one
  // advisory) still frames as a readable map, not an extreme close-up.
  const lonSpan = Math.max(6, east - west);
  const latSpan = Math.max(6, north - south);
  const cx = (west + east) / 2;
  const cy = (south + north) / 2;
  const padLon = lonSpan * 0.65;
  const padLat = latSpan * 0.65;
  return { west: cx - padLon, east: cx + padLon, south: cy - padLat, north: cy + padLat };
}

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Counts a stat's leading number up from 0 rather than setting it
// immediately -- purely cosmetic "alive" motion. Only called for tiles
// that are actually a measurement (see the `animate` flag on statTile) --
// a regex-based "does this look like a number" guess used to decide this
// instead, and wrongly caught things like a "2025-26" season label,
// animating its leading "2025" up from zero (briefly showing nonsense
// like "1992-26" mid-flight) -- explicit opt-in per call site instead.
function animateNumber(el, target, suffix, duration = 700) {
  if (reduceMotion()) { el.textContent = `${target}${suffix}`; return; }
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = `${Math.round(target * eased)}${suffix}`;
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// `animate: true` only for tiles that are genuinely a measurement counting
// up to a value (wind, pressure, a count) -- everything else (names,
// dates, season labels, freeform text) always renders as plain text, even
// when it happens to start with a digit.
function statTile(label, value, { animate = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'history-stat';
  const l = document.createElement('span');
  l.className = 'history-stat__label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'history-stat__value';
  wrap.append(l, v);

  const match = animate ? /^(-?\d+(?:\.\d+)?)([^\d].*)?$/.exec(value) : null;
  if (match) {
    animateNumber(v, Number(match[1]), match[2] ?? '');
  } else {
    v.textContent = value;
  }
  return wrap;
}

// A vertical color-scale bar (severity ascending bottom-to-top), not a
// stacked swatch+label list -- fills real chart chrome instead of a small
// corner box, mirroring the reference design's own scale bar. Each
// segment carries only its short symbol (categorySymbol, the same one-
// character abbreviation the marker glyphs already use); the full name
// is a hover tooltip via `title`, and the container's aria-label keeps it
// readable without hovering.
function renderLegend() {
  legendEl.replaceChildren();
  for (const key of [...CATEGORY_ORDER].reverse()) {
    const seg = document.createElement('div');
    seg.className = 'history-scale__seg';
    seg.style.background = CATEGORY_INFO[key].color;
    seg.title = CATEGORY_INFO[key].label;
    const label = document.createElement('span');
    label.className = 'history-scale__label';
    label.textContent = categorySymbol(key) ?? '';
    seg.append(label);
    legendEl.append(seg);
  }
}

// Both layers render unconditionally on every call -- cheap, and it keeps
// switching tabs a pure CSS show/hide (via the .is-wind-view class below)
// instead of needing to track/clear whichever layer isn't current.
function renderChart() {
  if (!selectedSystemId) return;
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const system = systems.find((s) => s.id === selectedSystemId);
  // Kept in module state, indexed identically to the points/dots
  // trackHistoryRenderer.js draws (each dot carries data-index) -- clicking
  // a dot looks the full entry back up here, since the renderer only ever
  // sees the reduced {lon, lat, color} shape, not the whole snapshot.
  currentEntries = system ? historyEntriesFor(system) : [];
  hidePointPopup();
  const points = pointsForSystem(selectedSystemId);
  const aspect = rect.width / Math.max(1, rect.height);
  const bounds = fitBoundsToAspect(boundsForPoints(points), aspect);
  mapRenderer.render({ bounds, width: rect.width, height: rect.height, showGrid: true });
  trackHistoryRenderer.render({ points, bounds, width: rect.width, height: rect.height });
  windHistoryRenderer.render({ snapshots: snapshotsForSystem(selectedSystemId) });
}

function hidePointPopup() {
  pointPopupEl.hidden = true;
}

function positionPointPopup(dotEl) {
  const dotRect = dotEl.getBoundingClientRect();
  const wrapRect = chartWrapEl.getBoundingClientRect();
  const popupRect = pointPopupEl.getBoundingClientRect();
  let left = dotRect.left - wrapRect.left + dotRect.width / 2 + 14;
  let top = dotRect.top - wrapRect.top - popupRect.height / 2;
  left = Math.min(Math.max(8, left), wrapRect.width - popupRect.width - 8);
  top = Math.min(Math.max(8, top), wrapRect.height - popupRect.height - 8);
  pointPopupEl.style.left = `${left}px`;
  pointPopupEl.style.top = `${top}px`;
}

// A compact info card for one specific track point -- whichever entry the
// clicked dot corresponds to, not the system's overall/current state (see
// renderStormPanel for that). Reuses panelRow/formatProbabilities so its
// styling and probability formatting stay identical to the main panel's.
function showPointPopup(entry, dotEl) {
  const snap = entry.system;
  pointPopupEl.replaceChildren();

  const time = document.createElement('div');
  time.className = 'point-popup__time';
  time.textContent = new Date(entry.issuedAt).toLocaleString();

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'point-popup__close';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.addEventListener('click', hidePointPopup);

  const rows = document.createElement('div');
  rows.className = 'point-popup__rows';
  rows.append(panelRow('Position', formatPosition(snap.lat, snap.lon)));
  if (snap.classified) {
    const categoryKey = intensityCategoryKey(intensityScore(snap));
    rows.append(panelRow('Category', categoryKey ? CATEGORY_INFO[categoryKey].label : 'Classified'));
    rows.append(panelRow('Wind', snap.windMph != null ? `${Math.round(snap.windMph)} mph` : '—'));
    rows.append(panelRow('Pressure', snap.pressureMb != null ? `${snap.pressureMb} mb` : '—'));
  } else {
    rows.append(panelRow('Formation chance', formatProbabilities(snap)));
  }

  pointPopupEl.append(closeBtn, time, rows);
  pointPopupEl.hidden = false;
  positionPointPopup(dotEl);
}

svg.addEventListener('click', (event) => {
  const dot = event.target.closest?.('.track-history-dot');
  if (!dot) { hidePointPopup(); return; }
  const entry = currentEntries[Number(dot.dataset.index)];
  if (entry) showPointPopup(entry, dot);
});

function setChartView(view) {
  chartView = view;
  chartTabsEl.querySelectorAll('.history-chart-tab').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.view === view);
  });
  svg.classList.toggle('is-wind-view', view === 'wind');
  hidePointPopup(); // its anchor dot is a Track-view-only element, gone once wind view hides that layer
}

function formatProbabilities(system) {
  const windows = [['2d', system.formationProbability2dayPct], ['5d', system.formationProbability5dayPct], ['10d', system.formationProbability10dayPct]];
  const parts = windows.filter(([, pct]) => pct != null).map(([label, pct]) => `${label} ${pct}%`);
  return parts.length ? parts.join(' · ') : '—';
}

// White text on a dark category/probability color, dark text on a light
// one -- the palette spans from pale gray-blue through near-black purple,
// so a single fixed text color would be unreadable against roughly half
// of it. Simple perceived-luminance heuristic, not full WCAG contrast math
// -- this only ever has ~11 fixed palette colors to work with, verified by
// hand against all of them rather than needing to be exact for arbitrary input.
function readableTextColor(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#0a1628' : '#ffffff';
}

function panelRow(label, value) {
  const row = document.createElement('div');
  row.className = 'storm-panel__row';
  const l = document.createElement('span');
  l.className = 'storm-panel__row-label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'storm-panel__row-value';
  v.textContent = value;
  row.append(l, v);
  return row;
}

function formatMovement(movement) {
  if (!movement) return 'Stationary';
  return `${movement.compass} ${Math.round(movement.speedMph)} mph`;
}

function formatCountdown(targetMs) {
  const deltaMs = targetMs - Date.now();
  if (deltaMs <= 0) return 'Overdue';
  const totalMinutes = Math.round(deltaMs / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// The reference "TROPICAL STORM HANNA" card, adapted to this app's own
// category scale and MPH-only convention: a category/probability-colored
// header, two hero stats, then a handful of derived rows built from
// stormStats.js. The classified and pre-classification (Invest/
// Disturbance) variants share the same header/position/movement rows but
// diverge on the rest -- a classified system has wind/pressure/ACE/next-
// advisory to show; a pre-classification one has development chance
// instead, and no advisory schedule to estimate at all.
function renderStormPanel(system) {
  const entries = historyEntriesFor(system);
  const latest = entries[entries.length - 1].system;
  const color = systemColor(latest);
  const textColor = readableTextColor(color);

  stormPanelEl.replaceChildren();
  stormPanelEl.hidden = false;

  const header = document.createElement('div');
  header.className = 'storm-panel__header';
  header.style.background = color;
  header.style.color = textColor;
  const kind = document.createElement('span');
  kind.className = 'storm-panel__kind';
  const name = document.createElement('span');
  name.className = 'storm-panel__name';
  name.textContent = displayLabel(system);

  const hero = document.createElement('div');
  hero.className = 'storm-panel__hero';
  const windStat = document.createElement('div');
  windStat.className = 'storm-panel__hero-stat';
  const windValue = document.createElement('span');
  windValue.className = 'storm-panel__hero-value';
  windValue.textContent = latest.windMph != null ? Math.round(latest.windMph) : '—';
  const windLabel = document.createElement('span');
  windLabel.className = 'storm-panel__hero-label';
  windLabel.textContent = latest.windMph != null ? 'Max wind (mph)' : 'Max wind';
  windStat.append(windValue, windLabel);

  const secondStat = document.createElement('div');
  secondStat.className = 'storm-panel__hero-stat';
  const secondValue = document.createElement('span');
  secondValue.className = 'storm-panel__hero-value';
  const secondLabel = document.createElement('span');
  secondLabel.className = 'storm-panel__hero-label';

  const rows = document.createElement('div');
  rows.className = 'storm-panel__rows';
  rows.append(panelRow('Position', formatPosition(latest.lat, latest.lon)));
  rows.append(panelRow('Movement', formatMovement(computeMovement(entries))));

  if (system.classified) {
    const categoryKey = intensityCategoryKey(intensityScore(latest));
    kind.textContent = categoryKey ? CATEGORY_INFO[categoryKey].label : 'Classified';
    secondValue.textContent = categorySymbol(categoryKey) ?? '—';
    secondLabel.textContent = 'Category';

    const minPressure = computeMinPressure(entries);
    rows.append(panelRow('Min pressure', minPressure != null ? `${minPressure} mb` : '—'));
    const latestEntry = entries[entries.length - 1];
    rows.append(panelRow('Last fix', new Date(latestEntry.issuedAt).toLocaleString()));
    const nextAdvisoryMs = new Date(latestEntry.issuedAt).getTime() + system.forecastInterval * 3600000;
    rows.append(panelRow('Next advisory', formatCountdown(nextAdvisoryMs)));
  } else {
    kind.textContent = system.stage === 'invest' ? 'Invest' : 'Disturbance';
    const maxPct = maxFormationProbabilityPct(system);
    secondValue.textContent = maxPct != null ? `${maxPct}%` : '—';
    secondLabel.textContent = 'Development chance';

    const minPressure = computeMinPressure(entries);
    if (minPressure != null) rows.append(panelRow('Min pressure', `${minPressure} mb`));
    const latestEntry = entries[entries.length - 1];
    rows.append(panelRow('Last updated', new Date(latestEntry.issuedAt).toLocaleString()));
  }

  secondStat.append(secondValue, secondLabel);
  hero.append(windStat, secondStat);
  header.append(kind, name);
  stormPanelEl.append(header, hero, rows);
}

function renderDetail() {
  const system = systems.find((s) => s.id === selectedSystemId);
  if (!system) {
    emptyStateEl.hidden = false;
    detailEl.hidden = true;
    stormPanelEl.hidden = true;
    return;
  }
  emptyStateEl.hidden = true;
  detailEl.hidden = false;
  renderStormPanel(system);

  const advs = advisoriesFor(system.id);

  if (advs.length) {
    const latest = advs[advs.length - 1];
    const latestSnap = latest.snapshot.system;
    const peakWind = Math.max(...advs.map((a) => a.snapshot.system.windMph ?? 0));
    statsEl.replaceChildren(
      statTile('System', displayLabel(system)),
      statTile('Season', system.seasonLabel),
      statTile('Current wind', latestSnap.windMph != null ? `${Math.round(latestSnap.windMph)} mph` : '—', { animate: latestSnap.windMph != null }),
      statTile('Peak wind', `${Math.round(peakWind)} mph`, { animate: true }),
      statTile('Central pressure', latestSnap.pressureMb != null ? `${latestSnap.pressureMb} mb` : '—', { animate: latestSnap.pressureMb != null }),
      statTile('Advisories', String(advs.length), { animate: true }),
      statTile('Latest advisory', new Date(latest.issuedAt).toLocaleString()),
    );
  } else {
    // An Invest: no advisory has ever been published for it, so there's no
    // wind/pressure/advisory-count story to tell yet -- show the
    // development-watch stats that actually apply pre-classification.
    statsEl.replaceChildren(
      statTile('System', displayLabel(system)),
      statTile('Season', system.seasonLabel),
      statTile('Stage', system.stage === 'invest' ? 'Invest' : 'Disturbance'),
      statTile('Formation chance', formatProbabilities(system)),
      statTile('Advisories', 'None yet'),
      statTile('Last updated', system.updatedAt ? new Date(system.updatedAt).toLocaleString() : '—'),
    );
  }

  renderLegend();
  renderChart();
}

function renderList() {
  const withHistory = systemsForHistoryPage();
  listEmptyEl.hidden = withHistory.length > 0;
  listEl.querySelectorAll('.system-card').forEach((el) => el.remove());

  for (const system of withHistory) {
    const advs = advisoriesFor(system.id);
    const entries = historyEntriesFor(system);
    const dotColor = systemColor(entries[entries.length - 1].system);

    const card = document.createElement('article');
    card.className = `system-card${system.id === selectedSystemId ? ' is-selected' : ''}`;
    card.dataset.systemId = system.id;

    const summary = document.createElement('button');
    summary.type = 'button';
    summary.className = 'system-card__summary';
    const dot = document.createElement('span');
    dot.className = 'system-card__dot';
    dot.style.background = dotColor;
    const name = document.createElement('span');
    name.className = 'system-card__name';
    name.textContent = displayLabel(system);
    const badge = document.createElement('span');
    badge.className = 'history-list-badge';
    badge.textContent = advs.length ? `${advs.length} advisor${advs.length === 1 ? 'y' : 'ies'}` : 'Active';
    summary.append(dot, name, badge);
    summary.addEventListener('click', () => selectSystem(system.id));
    card.append(summary);
    listEl.append(card);
  }
}

function selectSystem(id) {
  selectedSystemId = id;
  renderList();
  renderDetail();
}

window.addEventListener('resize', () => {
  if (selectedSystemId) renderChart();
});

async function init() {
  const geography = await loadGeography();
  mapRenderer = createMapRenderer(svg, geography);
  trackHistoryRenderer = createTrackHistoryRenderer(svg);
  windHistoryRenderer = createWindHistoryRenderer(svg);
  // Both layers are already kept current on every renderChart() call --
  // switching tabs only needs the CSS visibility toggle, no re-render.
  chartTabsEl.querySelectorAll('.history-chart-tab').forEach((btn) => {
    btn.addEventListener('click', () => setChartView(btn.dataset.view));
  });

  await loadData();
  renderList();
  const first = systemsForHistoryPage()[0];
  if (first) selectSystem(first.id);
}

init().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<div class="fatal-error">Failed to load Ongoing Storm Analysis: ${err.message}</div>`);
});
