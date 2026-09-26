import { INITIAL_BOUNDS, PROBABILITY_COLORS, probabilityTier } from './constants.js';
import { createViewState, getAspectFittedBounds, resetView } from './viewState.js';
import { attachNavigation } from './navigation.js';
import { createMapRenderer } from './mapRenderer.js';
import { createPointRenderer } from './pointRenderer.js';
import { api } from './api.js';

const svg = document.getElementById('map');
const mapWrap = document.getElementById('map-wrap');
const systemsListEl = document.getElementById('systems-list');
const selectedPanelEl = document.getElementById('selected-panel');
const emptyHintEl = document.getElementById('empty-hint');
const toolButtons = document.querySelectorAll('[data-tool]');
const deselectBtn = document.getElementById('deselect-btn');
const resetViewBtn = document.getElementById('reset-view-btn');
const placementHint = document.getElementById('placement-hint');

let systems = [];
let selectedId = null;
let tool = 'select';
let viewState = createViewState(INITIAL_BOUNDS);
let mapRenderer = null;
let pointRenderer = null;

async function loadGeography() {
  const [land, lakes, borders, states] = await Promise.all(
    ['land', 'lakes', 'borders', 'states'].map((name) =>
      fetch(`assets/${name}.geojson`).then((r) => r.json())
    )
  );
  return { land, lakes, borders, states };
}

function currentBounds() {
  const rect = svg.getBoundingClientRect();
  const aspect = rect.width / Math.max(1, rect.height);
  return getAspectFittedBounds(viewState, aspect);
}

function renderMap() {
  const rect = svg.getBoundingClientRect();
  const bounds = currentBounds();
  mapRenderer.render({ bounds, width: rect.width, height: rect.height, showGrid: true });
  pointRenderer.render({ systems, selectedId, bounds, width: rect.width, height: rect.height });
}

function setView(next) {
  viewState = next;
  renderMap();
}

function setTool(next) {
  tool = next;
  for (const btn of toolButtons) btn.classList.toggle('is-active', btn.dataset.tool === tool);
  svg.classList.toggle('tool-create', tool === 'create-disturbance');
  placementHint.hidden = tool !== 'create-disturbance';
}

function select(id) {
  selectedId = id;
  renderSidebar();
  renderMap();
}

function renderSystemsList() {
  systemsListEl.replaceChildren();
  if (systems.length === 0) {
    const li = document.createElement('li');
    li.className = 'systems-list__empty';
    li.textContent = 'No systems yet.';
    systemsListEl.append(li);
    return;
  }
  for (const system of systems) {
    const li = document.createElement('li');
    li.className = `systems-list__row${system.id === selectedId ? ' is-selected' : ''}`;
    li.dataset.systemId = system.id;

    const dot = document.createElement('span');
    dot.className = 'tier-dot';
    dot.style.background = PROBABILITY_COLORS[probabilityTier(system.formationProbabilityPct)];

    const name = document.createElement('span');
    name.className = 'systems-list__name';
    name.textContent = system.displayName;

    const pct = document.createElement('span');
    pct.className = 'systems-list__pct';
    pct.textContent = system.formationProbabilityPct != null ? `${system.formationProbabilityPct}%` : '—';

    li.append(dot, name, pct);
    li.addEventListener('click', () => select(system.id));
    systemsListEl.append(li);
  }
}

function field(labelText, inputEl) {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const label = document.createElement('span');
  label.className = 'field__label';
  label.textContent = labelText;
  wrap.append(label, inputEl);
  return wrap;
}

function renderSelectedPanel() {
  const system = systems.find((s) => s.id === selectedId);
  selectedPanelEl.replaceChildren();
  emptyHintEl.hidden = !!system;
  selectedPanelEl.hidden = !system;
  if (!system) return;

  const title = document.createElement('h3');
  title.textContent = system.displayName;
  selectedPanelEl.append(title);

  const meta = document.createElement('div');
  meta.className = 'selected-meta';
  meta.textContent = `${system.seasonLabel} season · ${system.lat.toFixed(2)}°N, ${Math.abs(system.lon).toFixed(2)}°W`;
  selectedPanelEl.append(meta);

  const probInput = document.createElement('input');
  probInput.type = 'number';
  probInput.min = '0';
  probInput.max = '100';
  probInput.value = system.formationProbabilityPct ?? '';
  probInput.placeholder = '0-100';

  const pressureInput = document.createElement('input');
  pressureInput.type = 'number';
  pressureInput.step = '0.1';
  pressureInput.value = system.pressureMb ?? '';
  pressureInput.placeholder = 'mb';

  const windInput = document.createElement('input');
  windInput.type = 'number';
  windInput.step = '1';
  windInput.value = system.windMph ?? '';
  windInput.placeholder = 'mph';

  const form = document.createElement('div');
  form.className = 'selected-form';
  form.append(
    field('Formation probability (%)', probInput),
    field('Central pressure (mb)', pressureInput),
    field('Sustained wind (mph)', windInput)
  );
  selectedPanelEl.append(form);

  const actions = document.createElement('div');
  actions.className = 'selected-actions';

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.className = 'primary';
  saveBtn.addEventListener('click', async () => {
    const updated = await api.updateSystem(system.id, {
      formationProbabilityPct: probInput.value === '' ? null : Number(probInput.value),
      pressureMb: pressureInput.value === '' ? null : Number(pressureInput.value),
      windMph: windInput.value === '' ? null : Number(windInput.value),
    });
    systems = systems.map((s) => (s.id === updated.id ? updated : s));
    renderSidebar();
    renderMap();
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = 'Delete';
  deleteBtn.className = 'danger';
  deleteBtn.addEventListener('click', async () => {
    if (!confirm(`Delete ${system.displayName}? This cannot be undone.`)) return;
    await api.deleteSystem(system.id);
    systems = systems.filter((s) => s.id !== system.id);
    selectedId = null;
    renderSidebar();
    renderMap();
  });

  actions.append(saveBtn, deleteBtn);
  selectedPanelEl.append(actions);
}

function renderSidebar() {
  renderSystemsList();
  renderSelectedPanel();
}

async function handleMapClick(geo) {
  if (tool === 'create-disturbance') {
    const created = await api.createSystem({ lat: geo.lat, lon: geo.lon, formationProbabilityPct: 0 });
    systems = [...systems, created];
    selectedId = created.id;
    setTool('select');
    renderSidebar();
    renderMap();
    return;
  }
  // Select tool: blank-map click deselects.
  if (selectedId !== null) select(null);
}

function setupMapClick() {
  let downGeo = null;
  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const rect = svg.getBoundingClientRect();
    downGeo = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  });
  svg.addEventListener('pointerup', (event) => {
    if (!downGeo) return;
    const rect = svg.getBoundingClientRect();
    const upX = event.clientX - rect.left;
    const upY = event.clientY - rect.top;
    const moved = Math.hypot(upX - downGeo.x, upY - downGeo.y);
    downGeo = null;
    if (moved > 4) return; // treat as a drag/pan, not a click

    // Did we click an existing point?
    const target = event.target.closest?.('[data-system-id]');
    if (target) {
      select(target.dataset.systemId);
      return;
    }
    const bounds = currentBounds();
    const lon = bounds.west + (upX / rect.width) * (bounds.east - bounds.west);
    const lat = bounds.north - (upY / rect.height) * (bounds.north - bounds.south);
    handleMapClick({ lon, lat });
  });
}

async function init() {
  const geography = await loadGeography();
  mapRenderer = createMapRenderer(svg, geography);
  pointRenderer = createPointRenderer(svg);

  attachNavigation({
    svg,
    getView: () => viewState,
    setView,
    getRenderedBounds: () => mapRenderer.getLastRender()?.bounds,
    shouldStartPan: () => tool !== 'create-disturbance',
  });

  setupMapClick();

  for (const btn of toolButtons) {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  }
  deselectBtn.addEventListener('click', () => select(null));
  resetViewBtn.addEventListener('click', () => setView(resetView(viewState)));

  window.addEventListener('resize', renderMap);

  systems = await api.listSystems();
  setTool('select');
  renderSidebar();
  renderMap();
}

init().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<div class="fatal-error">Failed to start editor: ${err.message}</div>`);
});
