// Read-only public viewer: reuses the editor's own rendering modules
// as-is (same basemap, marker, cone, and wind-field visuals) with none of
// its editing machinery -- no toolbar, no drag gestures, no annotations.
// Served from the same origin/process as the editor (mounted at /editor)
// and the /api backend, so these absolute-path imports/fetches always
// resolve correctly regardless of this module's own served path.
import {
  INITIAL_BOUNDS, systemColor, displayLabel, intensityScore, intensityCategoryKey,
  categorySymbol, windOnlyIntensityScore, CATEGORY_INFO,
} from '/editor/src/constants.js';
import { createViewState, getAspectFittedBounds } from '/editor/src/viewState.js';
import { attachNavigation } from '/editor/src/navigation.js';
import { createMapRenderer } from '/editor/src/mapRenderer.js';
import { createPointRenderer } from '/editor/src/pointRenderer.js';
import { createTrackConeRenderer } from '/editor/src/trackConeRenderer.js';
import { createWindFieldRenderer } from '/editor/src/windFieldRenderer.js';

const POLL_INTERVAL_MS = 60000;

const svg = document.getElementById('map');
const emptyStateEl = document.getElementById('empty-state');
const infoPanelEl = document.getElementById('info-panel');
const infoCloseBtn = document.getElementById('info-close');
const infoNameEl = document.getElementById('info-name');
const infoMetaEl = document.getElementById('info-meta');
const infoBodyEl = document.getElementById('info-body');
const advisoryBadgeEl = document.getElementById('advisory-badge');
const advisoryBadgeTimeEl = document.getElementById('advisory-badge-time');

let systems = [];
let forecastPoints = [];
let advisories = [];
let selectedId = null;
let viewState = createViewState(INITIAL_BOUNDS);
let mapRenderer = null;
let pointRenderer = null;
let trackConeRenderer = null;
let windFieldRenderer = null;

async function loadGeography() {
  const [land, lakes, borders, states] = await Promise.all(
    ['land', 'lakes', 'borders', 'states'].map((name) =>
      fetch(`/editor/assets/${name}.geojson`).then((r) => r.json())
    )
  );
  return { land, lakes, borders, states };
}

async function loadData() {
  const [nextSystems, nextForecastPoints, nextAdvisories] = await Promise.all([
    fetch('/api/systems').then((r) => r.json()),
    fetch('/api/forecast-points').then((r) => r.json()),
    fetch('/api/advisories').then((r) => r.json()),
  ]);
  systems = nextSystems;
  forecastPoints = nextForecastPoints;
  advisories = nextAdvisories;
  // A selected system that vanished (deleted, or a stale id from before a
  // poll) should gracefully drop the selection rather than leave a
  // dangling info panel open on nothing.
  if (selectedId && !systems.some((s) => s.id === selectedId)) selectedId = null;
}

function currentBounds() {
  const rect = svg.getBoundingClientRect();
  const aspect = rect.width / Math.max(1, rect.height);
  return getAspectFittedBounds(viewState, aspect);
}

// Mirrors editor/src/main.js's selectedSystemTrackPoints() -- a system's
// own position is always its synthetic hour-0 point, prepended ahead of
// its saved forecast points. A non-classified system never has a track.
function trackPointsFor(system) {
  if (!system || !system.classified) return [];
  const own = forecastPoints
    .filter((p) => p.systemId === system.id)
    .sort((a, b) => a.sequence - b.sequence)
    .map((p) => ({
      id: p.id, lon: p.lon, lat: p.lat, hour: p.hour, spread: p.spreadMi,
      symbol: categorySymbol(intensityCategoryKey(windOnlyIntensityScore(p.windMph))),
    }));
  return [{ lon: system.lon, lat: system.lat, hour: 0, spread: 0 }, ...own];
}

function renderMap() {
  const rect = svg.getBoundingClientRect();
  const bounds = currentBounds();
  const selected = systems.find((s) => s.id === selectedId) ?? null;
  mapRenderer.render({ bounds, width: rect.width, height: rect.height, showGrid: true });
  trackConeRenderer.render({ points: trackPointsFor(selected), selectedForecastPointId: null, bounds, width: rect.width, height: rect.height });
  windFieldRenderer.render({ system: selected, activeThreshold: null, bounds, width: rect.width, height: rect.height });
  pointRenderer.render({ systems, selectedId, bounds, width: rect.width, height: rect.height });
}

function setView(next) {
  viewState = next;
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

function latestAdvisoryFor(systemId) {
  const own = advisories.filter((a) => a.systemId === systemId);
  return own.reduce((latest, a) => (!latest || new Date(a.issuedAt) > new Date(latest.issuedAt) ? a : latest), null);
}

function renderAdvisoryBadge(system) {
  const advisory = system ? latestAdvisoryFor(system.id) : null;
  advisoryBadgeEl.hidden = !advisory;
  if (advisory) advisoryBadgeTimeEl.textContent = new Date(advisory.issuedAt).toLocaleString();
}

// No intensity/category information is shown at all until a system is
// Classified -- only its formation probabilities -- matching the public
// page's core rule ("no intensity scale until its active").
function renderInfoPanel() {
  const system = systems.find((s) => s.id === selectedId) ?? null;
  infoPanelEl.hidden = !system;
  renderAdvisoryBadge(system);
  if (!system) return;

  infoNameEl.textContent = displayLabel(system);
  infoNameEl.style.color = systemColor(system);

  const metaParts = [`${system.seasonLabel} season`, `${system.lat.toFixed(1)}°N, ${Math.abs(system.lon).toFixed(1)}°W`];
  if (!system.classified) metaParts.push(system.stage === 'invest' ? 'Invest' : 'Disturbance');
  infoMetaEl.textContent = metaParts.join(' · ');

  infoBodyEl.replaceChildren();

  if (!system.classified) {
    const probs = [
      ['2-day formation chance', system.formationProbability2dayPct],
      ['5-day formation chance', system.formationProbability5dayPct],
      ['10-day formation chance', system.formationProbability10dayPct],
    ];
    for (const [label, value] of probs) {
      infoBodyEl.append(infoRow(label, value == null ? 'Not assessed' : `${value}%`));
    }
    return;
  }

  const key = intensityCategoryKey(intensityScore(system));
  const category = document.createElement('div');
  category.className = 'info-category';
  category.style.background = CATEGORY_INFO[key]?.color ?? systemColor(system);
  category.textContent = CATEGORY_INFO[key]?.label ?? 'Classified';
  infoBodyEl.append(category);

  infoBodyEl.append(infoRow('Sustained wind', system.windMph != null ? `${system.windMph} mph` : '—'));
  infoBodyEl.append(infoRow('Max gust', system.gustMph != null ? `${system.gustMph} mph` : '—'));
  infoBodyEl.append(infoRow('Central pressure', system.pressureMb != null ? `${system.pressureMb} mb` : '—'));

  const forecastOnly = trackPointsFor(system).filter((p) => p.hour > 0);
  if (forecastOnly.length) {
    const heading = document.createElement('h3');
    heading.className = 'info-subheading';
    heading.textContent = 'Forecast track';
    infoBodyEl.append(heading);
    const list = document.createElement('ul');
    list.className = 'info-track-list';
    for (const point of forecastOnly) {
      const li = document.createElement('li');
      li.textContent = `+${point.hour}h${point.symbol ? ` ${point.symbol}` : ''}`;
      list.append(li);
    }
    infoBodyEl.append(list);
  }
}

function select(systemId) {
  selectedId = systemId;
  renderInfoPanel();
  renderMap();
}

svg.addEventListener('click', (event) => {
  const hit = event.target.closest?.('[data-system-id]');
  if (hit) select(hit.dataset.systemId);
});
infoCloseBtn.addEventListener('click', () => select(null));

async function refresh() {
  await loadData();
  emptyStateEl.hidden = systems.length > 0;
  renderInfoPanel();
  renderMap();
}

async function init() {
  const geography = await loadGeography();
  mapRenderer = createMapRenderer(svg, geography);
  windFieldRenderer = createWindFieldRenderer(svg);
  svg.append(windFieldRenderer.fieldLayer); // under the cone/markers -- see windFieldRenderer.js
  trackConeRenderer = createTrackConeRenderer(svg);
  pointRenderer = createPointRenderer(svg);

  attachNavigation({
    svg,
    getView: () => viewState,
    setView,
    getRenderedBounds: () => mapRenderer.getLastRender()?.bounds,
    shouldStartPan: (event) => !event.target.closest?.('[data-system-id]'),
  });

  window.addEventListener('resize', renderMap);

  await refresh();
  setInterval(() => { refresh().catch((err) => console.error(err)); }, POLL_INTERVAL_MS);
}

init().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<div class="fatal-error">Failed to load NorEASterCaster: ${err.message}</div>`);
});
