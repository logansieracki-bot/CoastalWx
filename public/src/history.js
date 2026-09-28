// Storm History: an automatic, no-manual-entry archive built entirely from
// advisories already published through the normal editor workflow. Every
// advisory is an immutable snapshot (see server/src/advisories.js) of a
// system's position/intensity at the moment it was issued -- exactly the
// raw material a track/intensity history needs, with nothing extra to
// author. Reuses the editor's own map + constants, same relative-import
// reasoning as public/src/main.js (see its own header comment).
import {
  CATEGORY_INFO, categorySymbol, displayLabel, systemColor,
} from '../editor/src/constants.js';
import { fitBoundsToAspect } from '../editor/src/geo.js';
import { createMapRenderer } from '../editor/src/mapRenderer.js';
import { createTrackHistoryRenderer } from './trackHistoryRenderer.js';
import { createWindHistoryRenderer } from './windHistoryRenderer.js';

const CATEGORY_ORDER = ['ed', 'ets', 'cat1', 'cat2', 'cat3', 'cat4', 'cat5'];

// A short, several-advisory demo history (one storm, strengthening then
// weakening) so this page still demonstrates itself with no backend
// reachable -- same spirit as public/src/main.js's own demo fallback, but
// this page needs a real *sequence* of advisories to have anything to
// show, so it isn't the same dataset.
const DEMO_SYSTEM = {
  id: 'demo-h1', season: 2025, seasonLabel: '2025-26', sequenceNumber: 4,
  name: 'Reyes', displayName: 'Reyes', classified: true,
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
  galeRadiusNeMi: null, galeRadiusSeMi: null, galeRadiusSwMi: null, galeRadiusNwMi: null,
  hurricaneForceRadiusNeMi: null, hurricaneForceRadiusSeMi: null, hurricaneForceRadiusSwMi: null, hurricaneForceRadiusNwMi: null,
  updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
};

const svg = document.getElementById('history-chart');
const demoBannerEl = document.getElementById('demo-banner');
const listEl = document.getElementById('history-list');
const listEmptyEl = document.getElementById('history-list-empty');
const emptyStateEl = document.getElementById('history-empty-state');
const detailEl = document.getElementById('history-detail');
const statsEl = document.getElementById('history-stats');
const legendEl = document.getElementById('history-legend');
const chartTabsEl = document.getElementById('history-chart-tabs');

let systems = [];
let advisories = [];
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
    const [nextSystems, nextAdvisories] = await Promise.all([fetchJson('api/systems'), fetchJson('api/advisories')]);
    systems = nextSystems;
    advisories = nextAdvisories;
    usingDemoData = false;
  } catch {
    systems = [DEMO_SYSTEM, DEMO_INVEST];
    advisories = DEMO_ADVISORIES;
    usingDemoData = true;
  }
  demoBannerEl.hidden = !usingDemoData;
}

function advisoriesFor(systemId) {
  return advisories.filter((a) => a.systemId === systemId).sort((a, b) => a.number - b.number);
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

// The chronological record this page draws from: one entry per published
// advisory (each a frozen snapshot), or -- for a system with none yet,
// i.e. an Invest still only being watched -- a single synthetic "current"
// entry built straight from the live record, so it still plots as a
// (one-point) track instead of crashing or rendering nothing.
function historyEntriesFor(system) {
  const advs = advisoriesFor(system.id);
  if (advs.length) {
    return advs.map((a) => ({ system: a.snapshot.system, issuedAt: a.issuedAt }));
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
// immediately -- purely cosmetic "alive" motion, so anything that isn't
// cleanly "a number, then an optional non-digit tail" (dates, "None yet",
// "Invest", ...) just falls back to being set directly.
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

function statTile(label, value) {
  const wrap = document.createElement('div');
  wrap.className = 'history-stat';
  const l = document.createElement('span');
  l.className = 'history-stat__label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'history-stat__value';
  wrap.append(l, v);

  const match = /^(-?\d+(?:\.\d+)?)([^\d].*)?$/.exec(value);
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
  const points = pointsForSystem(selectedSystemId);
  const aspect = rect.width / Math.max(1, rect.height);
  const bounds = fitBoundsToAspect(boundsForPoints(points), aspect);
  mapRenderer.render({ bounds, width: rect.width, height: rect.height, showGrid: true });
  trackHistoryRenderer.render({ points, bounds, width: rect.width, height: rect.height });
  windHistoryRenderer.render({ snapshots: snapshotsForSystem(selectedSystemId) });
}

function setChartView(view) {
  chartView = view;
  chartTabsEl.querySelectorAll('.history-chart-tab').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.view === view);
  });
  svg.classList.toggle('is-wind-view', view === 'wind');
}

function formatProbabilities(system) {
  const windows = [['2d', system.formationProbability2dayPct], ['5d', system.formationProbability5dayPct], ['10d', system.formationProbability10dayPct]];
  const parts = windows.filter(([, pct]) => pct != null).map(([label, pct]) => `${label} ${pct}%`);
  return parts.length ? parts.join(' · ') : '—';
}

function renderDetail() {
  const system = systems.find((s) => s.id === selectedSystemId);
  if (!system) {
    emptyStateEl.hidden = false;
    detailEl.hidden = true;
    return;
  }
  emptyStateEl.hidden = true;
  detailEl.hidden = false;

  const advs = advisoriesFor(system.id);

  if (advs.length) {
    const latest = advs[advs.length - 1];
    const latestSnap = latest.snapshot.system;
    const peakWind = Math.max(...advs.map((a) => a.snapshot.system.windMph ?? 0));
    statsEl.replaceChildren(
      statTile('System', displayLabel(system)),
      statTile('Season', system.seasonLabel),
      statTile('Current wind', latestSnap.windMph != null ? `${Math.round(latestSnap.windMph)} mph` : '—'),
      statTile('Peak wind', `${Math.round(peakWind)} mph`),
      statTile('Central pressure', latestSnap.pressureMb != null ? `${latestSnap.pressureMb} mb` : '—'),
      statTile('Advisories', String(advs.length)),
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
  document.body.insertAdjacentHTML('beforeend', `<div class="fatal-error">Failed to load Storm History: ${err.message}</div>`);
});
