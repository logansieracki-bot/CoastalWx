// Storm History: an automatic, no-manual-entry archive built entirely from
// advisories already published through the normal editor workflow. Every
// advisory is an immutable snapshot (see server/src/advisories.js) of a
// system's position/intensity at the moment it was issued -- exactly the
// raw material a track/intensity history needs, with nothing extra to
// author. Reuses the editor's own map + constants, same relative-import
// reasoning as public/src/main.js (see its own header comment).
import {
  intensityScore, intensityCategoryKey, CATEGORY_INFO, displayLabel,
} from '../editor/src/constants.js';
import { fitBoundsToAspect } from '../editor/src/geo.js';
import { createMapRenderer } from '../editor/src/mapRenderer.js';
import { createTrackHistoryRenderer } from './trackHistoryRenderer.js';

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
const DEMO_SNAPSHOTS = [
  { lon: -72, lat: 24, windMph: 45, gustMph: 60, galeRadiusMi: 90, pressureMb: 1001 },
  { lon: -70, lat: 27, windMph: 60, gustMph: 78, galeRadiusMi: 130, pressureMb: 992 },
  { lon: -68, lat: 30.5, windMph: 80, gustMph: 100, galeRadiusMi: 170, pressureMb: 978 },
  { lon: -65.5, lat: 34, windMph: 95, gustMph: 118, galeRadiusMi: 190, pressureMb: 965 },
  { lon: -61, lat: 38, windMph: 85, gustMph: 105, galeRadiusMi: 180, pressureMb: 972 },
  { lon: -55, lat: 42.5, windMph: 60, gustMph: 78, galeRadiusMi: 140, pressureMb: 988 },
];
const DEMO_ADVISORIES = DEMO_SNAPSHOTS.map((snap, i) => ({
  id: `demo-h-adv-${i + 1}`, systemId: DEMO_SYSTEM.id, number: i + 1,
  issuedAt: new Date(Date.now() - (DEMO_SNAPSHOTS.length - i) * 6 * 60 * 60 * 1000).toISOString(),
  snapshot: { system: { ...DEMO_SYSTEM, ...snap }, forecastPoints: [] },
}));

const svg = document.getElementById('history-chart');
const demoBannerEl = document.getElementById('demo-banner');
const listEl = document.getElementById('history-list');
const listEmptyEl = document.getElementById('history-list-empty');
const emptyStateEl = document.getElementById('history-empty-state');
const detailEl = document.getElementById('history-detail');
const statsEl = document.getElementById('history-stats');
const legendEl = document.getElementById('history-legend');

let systems = [];
let advisories = [];
let usingDemoData = false;
let selectedSystemId = null;
let mapRenderer = null;
let trackHistoryRenderer = null;

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
    systems = [DEMO_SYSTEM];
    advisories = DEMO_ADVISORIES;
    usingDemoData = true;
  }
  demoBannerEl.hidden = !usingDemoData;
}

function advisoriesFor(systemId) {
  return advisories.filter((a) => a.systemId === systemId).sort((a, b) => a.number - b.number);
}

// Only systems with at least one published advisory have any history to
// show -- which, since advisories require classification, is already
// exactly "systems that were ever a named/classified cyclone."
function systemsWithHistory() {
  const withAdvisories = new Set(advisories.map((a) => a.systemId));
  return systems.filter((s) => withAdvisories.has(s.id));
}

function categoryFor(snapshotSystem) {
  return intensityCategoryKey(intensityScore(snapshotSystem));
}

// One point per advisory, colored by *that advisory's own* category --
// not the system's current one -- so the track's color literally traces
// the strengthening/weakening story.
function pointsForSystem(systemId) {
  return advisoriesFor(systemId).map((a) => {
    const snap = a.snapshot.system;
    const key = categoryFor(snap);
    return {
      lon: snap.lon, lat: snap.lat,
      color: key ? CATEGORY_INFO[key].color : '#8a8a8a',
    };
  });
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

function statTile(label, value) {
  const wrap = document.createElement('div');
  wrap.className = 'history-stat';
  const l = document.createElement('span');
  l.className = 'history-stat__label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'history-stat__value';
  v.textContent = value;
  wrap.append(l, v);
  return wrap;
}

function renderLegend() {
  legendEl.replaceChildren();
  for (const key of CATEGORY_ORDER) {
    const item = document.createElement('div');
    item.className = 'history-legend__item';
    const swatch = document.createElement('span');
    swatch.className = 'history-legend__swatch';
    swatch.style.background = CATEGORY_INFO[key].color;
    const label = document.createElement('span');
    label.textContent = CATEGORY_INFO[key].label;
    item.append(swatch, label);
    legendEl.append(item);
  }
}

function renderChart(points) {
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const aspect = rect.width / Math.max(1, rect.height);
  const bounds = fitBoundsToAspect(boundsForPoints(points), aspect);
  mapRenderer.render({ bounds, width: rect.width, height: rect.height, showGrid: true });
  trackHistoryRenderer.render({ points, bounds, width: rect.width, height: rect.height });
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

  renderLegend();
  renderChart(pointsForSystem(system.id));
}

function renderList() {
  const withHistory = systemsWithHistory();
  listEmptyEl.hidden = withHistory.length > 0;
  listEl.querySelectorAll('.system-card').forEach((el) => el.remove());

  for (const system of withHistory) {
    const advs = advisoriesFor(system.id);
    // The latest advisory's own snapshot, not the live system record --
    // consistent with this page treating advisories as the source of
    // truth, and the only thing guaranteed to carry wind/gust/pressure
    // (the bare demo system record doesn't).
    const key = categoryFor(advs[advs.length - 1].snapshot.system);

    const card = document.createElement('article');
    card.className = `system-card${system.id === selectedSystemId ? ' is-selected' : ''}`;
    card.dataset.systemId = system.id;

    const summary = document.createElement('button');
    summary.type = 'button';
    summary.className = 'system-card__summary';
    const dot = document.createElement('span');
    dot.className = 'system-card__dot';
    dot.style.background = key ? CATEGORY_INFO[key].color : '#8a8a8a';
    const name = document.createElement('span');
    name.className = 'system-card__name';
    name.textContent = displayLabel(system);
    const badge = document.createElement('span');
    badge.className = 'history-list-badge';
    badge.textContent = `${advs.length} advisor${advs.length === 1 ? 'y' : 'ies'}`;
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
  if (selectedSystemId) renderChart(pointsForSystem(selectedSystemId));
});

async function init() {
  const geography = await loadGeography();
  mapRenderer = createMapRenderer(svg, geography);
  trackHistoryRenderer = createTrackHistoryRenderer(svg);

  await loadData();
  renderList();
  const first = systemsWithHistory()[0];
  if (first) selectSystem(first.id);
}

init().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<div class="fatal-error">Failed to load Storm History: ${err.message}</div>`);
});
