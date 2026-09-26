import { INITIAL_BOUNDS, maxFormationProbabilityPct, systemColor } from './constants.js';
import { createViewState, getAspectFittedBounds, resetView } from './viewState.js';
import { attachNavigation } from './navigation.js';
import { createMapRenderer } from './mapRenderer.js';
import { createPointRenderer } from './pointRenderer.js';
import { createAnnotationRenderer } from './annotationRenderer.js';
import { projectLonLat } from './geo.js';
import { api, detectBackend } from './api.js';

const svg = document.getElementById('map');
const systemsListEl = document.getElementById('systems-list');
const selectedPanelEl = document.getElementById('selected-panel');
const emptyHintEl = document.getElementById('empty-hint');
const toolButtons = document.querySelectorAll('[data-tool]');
const drawToolButtons = document.querySelectorAll('[data-requires-selection]');
const deselectBtn = document.getElementById('deselect-btn');
const resetViewBtn = document.getElementById('reset-view-btn');
const placementHint = document.getElementById('placement-hint');

const TOOL_HINTS = {
  'create-disturbance': 'Click the map to place the new disturbance.',
  shape: 'Click to add points. Click back near the first point to close the shape. Escape cancels.',
  arrow: 'Click to add points. Double-click the last point to finish. Escape cancels.',
};

let systems = [];
let selectedId = null;
let annotations = [];
let selectedAnnotationId = null;
let drawingSession = null; // { systemId, type: 'shape'|'arrow', points: [{lon,lat}] } | null
let lastDrawClick = null; // { x, y, t } -- manual double-click detection for the arrow tool
let tool = 'select';
let viewState = createViewState(INITIAL_BOUNDS);
let mapRenderer = null;
let pointRenderer = null;
let annotationRenderer = null;

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
  annotationRenderer.render({ annotations, selectedAnnotationId, draft: drawingSession, systems, bounds, width: rect.width, height: rect.height });
  pointRenderer.render({ systems, selectedId, bounds, width: rect.width, height: rect.height });
}

function setView(next) {
  viewState = next;
  renderMap();
}

function setTool(next) {
  tool = next;
  drawingSession = null; // nothing is persisted until finish, so switching tools loses nothing
  lastDrawClick = null;
  for (const btn of toolButtons) btn.classList.toggle('is-active', btn.dataset.tool === tool);
  svg.classList.toggle('tool-create', tool === 'create-disturbance');
  svg.classList.toggle('tool-draw', tool === 'shape' || tool === 'arrow');
  placementHint.textContent = TOOL_HINTS[tool] || '';
  placementHint.hidden = !TOOL_HINTS[tool];
  renderMap();
}

function updateToolAvailability() {
  for (const btn of drawToolButtons) btn.disabled = selectedId === null;
}

// Selecting a system always drops any shape/arrow selection (one thing
// selected at a time, same discipline the annotation feature's design
// followed from the old cyclone editor's precedent).
function select(systemId) {
  selectedId = systemId;
  selectedAnnotationId = null;
  if (selectedId === null && (tool === 'shape' || tool === 'arrow')) {
    setTool('select'); // can't stay in a tool with no owning system
  }
  updateToolAvailability();
  renderSidebar();
  renderMap();
}

// Clicking a shape/arrow directly always selects it, regardless of which
// system (if any) was previously selected -- it atomically becomes the
// owner's selection too, so the invariant "selectedAnnotationId set implies
// selectedId === its systemId" always holds.
function selectAnnotation(annotation) {
  selectedId = annotation.systemId;
  selectedAnnotationId = annotation.id;
  updateToolAvailability();
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
    dot.style.background = systemColor(system);

    const name = document.createElement('span');
    name.className = 'systems-list__name';
    name.textContent = system.displayName;

    const maxPct = maxFormationProbabilityPct(system);
    const pct = document.createElement('span');
    pct.className = 'systems-list__pct';
    pct.textContent = maxPct != null ? `${maxPct}%` : '—';

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

function renderAnnotationsSection(system) {
  const ownAnnotations = annotations.filter((a) => a.systemId === system.id);

  const wrap = document.createElement('div');
  wrap.className = 'annotations-section';
  const heading = document.createElement('h4');
  heading.textContent = 'Shapes & arrows';
  wrap.append(heading);

  if (ownAnnotations.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-hint';
    empty.textContent = 'None yet — use Draw Shape or Draw Arrow above.';
    wrap.append(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'systems-list';
    for (const ann of ownAnnotations) {
      const li = document.createElement('li');
      li.className = `systems-list__row${ann.id === selectedAnnotationId ? ' is-selected' : ''}`;
      const name = document.createElement('span');
      name.className = 'systems-list__name';
      name.textContent = `${ann.type === 'shape' ? 'Shape' : 'Arrow'} (${ann.points.length} pts)`;
      li.append(name);
      li.addEventListener('click', () => selectAnnotation(ann));
      list.append(li);
    }
    wrap.append(list);
  }
  selectedPanelEl.append(wrap);

  const selectedAnn = ownAnnotations.find((a) => a.id === selectedAnnotationId);
  if (!selectedAnn) return;

  const panel = document.createElement('div');
  panel.className = 'annotations-section selected-annotation-panel';
  const title = document.createElement('h4');
  title.textContent = `${selectedAnn.type === 'shape' ? 'Shape' : 'Arrow'} selected`;
  const meta = document.createElement('p');
  meta.className = 'empty-hint';
  meta.textContent = `${selectedAnn.points.length} vertices. Drag a handle to move it; click the shape/line to add a vertex.`;
  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = 'Delete shape/arrow';
  deleteBtn.className = 'danger';
  deleteBtn.addEventListener('click', async () => {
    if (!confirm(`Delete this ${selectedAnn.type}? This cannot be undone.`)) return;
    await api.deleteAnnotation(selectedAnn.id);
    annotations = annotations.filter((a) => a.id !== selectedAnn.id);
    selectedAnnotationId = null;
    renderSidebar();
    renderMap();
  });
  panel.append(title, meta, deleteBtn);
  selectedPanelEl.append(panel);
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

  function probabilityInput(value) {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '100';
    input.value = value ?? '';
    input.placeholder = '0-100';
    return input;
  }

  const prob2Input = probabilityInput(system.formationProbability2dayPct);
  const prob5Input = probabilityInput(system.formationProbability5dayPct);
  const prob10Input = probabilityInput(system.formationProbability10dayPct);

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
    field('2-day formation probability (%)', prob2Input),
    field('5-day formation probability (%)', prob5Input),
    field('10-day formation probability (%)', prob10Input),
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
      formationProbability2dayPct: prob2Input.value === '' ? null : Number(prob2Input.value),
      formationProbability5dayPct: prob5Input.value === '' ? null : Number(prob5Input.value),
      formationProbability10dayPct: prob10Input.value === '' ? null : Number(prob10Input.value),
      pressureMb: pressureInput.value === '' ? null : Number(pressureInput.value),
      windMph: windInput.value === '' ? null : Number(windInput.value),
    });
    systems = systems.map((s) => (s.id === updated.id ? updated : s));
    renderSidebar();
    renderMap();
  });

  let investigateBtn = null;
  if (system.stage !== 'invest') {
    investigateBtn = document.createElement('button');
    investigateBtn.textContent = 'Investigate';
    investigateBtn.addEventListener('click', async () => {
      if (!confirm(`Investigate ${system.displayName}? It will become an Invest.`)) return;
      const updated = await api.updateSystem(system.id, { stage: 'invest' });
      systems = systems.map((s) => (s.id === updated.id ? updated : s));
      select(updated.id);
    });
  }

  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = 'Delete';
  deleteBtn.className = 'danger';
  deleteBtn.addEventListener('click', async () => {
    if (!confirm(`Delete ${system.displayName}? This cannot be undone.`)) return;
    await api.deleteSystem(system.id);
    systems = systems.filter((s) => s.id !== system.id);
    annotations = annotations.filter((a) => a.systemId !== system.id);
    select(null);
  });

  actions.append(saveBtn);
  if (investigateBtn) actions.append(investigateBtn);
  actions.append(deleteBtn);
  selectedPanelEl.append(actions);

  renderAnnotationsSection(system);
}

function renderSidebar() {
  renderSystemsList();
  renderSelectedPanel();
}

async function placeDisturbance(geo) {
  const created = await api.createSystem({
    lat: geo.lat, lon: geo.lon,
    formationProbability2dayPct: 0,
    formationProbability5dayPct: 0,
    formationProbability10dayPct: 0,
  });
  systems = [...systems, created];
  setTool('select');
  select(created.id);
}

function geoAtClient(event, rect) {
  const bounds = currentBounds();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  return {
    lon: bounds.west + (x / rect.width) * (bounds.east - bounds.west),
    lat: bounds.north - (y / rect.height) * (bounds.north - bounds.south),
  };
}

function pointToSegmentDistance(p, a, b) {
  const dx = b.lon - a.lon, dy = b.lat - a.lat;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.lon - a.lon, p.lat - a.lat);
  let t = ((p.lon - a.lon) * dx + (p.lat - a.lat) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.lon - (a.lon + t * dx), p.lat - (a.lat + t * dy));
}

// Which index to splice a new vertex into, based on which existing segment
// the click landed nearest to (segments wrap for a closed shape).
function nearestSegmentInsertIndex(points, geo, closed) {
  let bestIdx = 1, bestDist = Infinity;
  const n = points.length;
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const d = pointToSegmentDistance(geo, points[i], points[(i + 1) % n]);
    if (d < bestDist) { bestDist = d; bestIdx = i + 1; }
  }
  return bestIdx;
}

async function insertVertex(annotation, geo) {
  const idx = nearestSegmentInsertIndex(annotation.points, geo, annotation.type === 'shape');
  const nextPoints = [...annotation.points.slice(0, idx), geo, ...annotation.points.slice(idx)];
  const updated = await api.updateAnnotation(annotation.id, { points: nextPoints });
  annotations = annotations.map((a) => (a.id === updated.id ? updated : a));
  renderSidebar();
  renderMap();
}

async function finishDrawing() {
  const session = drawingSession;
  drawingSession = null;
  lastDrawClick = null;
  if (!session) return;
  const created = await api.createAnnotation(session.systemId, { type: session.type, points: session.points });
  annotations = [...annotations, created];
  setTool('select');
  selectAnnotation(created);
}

async function handleDrawClick(geo, event) {
  if (!drawingSession) {
    drawingSession = { systemId: selectedId, type: tool, points: [geo] };
    lastDrawClick = { x: event.clientX, y: event.clientY, t: Date.now() };
    renderMap();
    return;
  }

  if (tool === 'shape') {
    const bounds = currentBounds();
    const rect = svg.getBoundingClientRect();
    const firstScreen = projectLonLat(drawingSession.points[0].lon, drawingSession.points[0].lat, bounds, rect.width, rect.height);
    const clickScreen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const closeDist = Math.hypot(clickScreen.x - firstScreen.x, clickScreen.y - firstScreen.y);
    if (closeDist <= 14 && drawingSession.points.length >= 2) {
      await finishDrawing();
      return;
    }
    drawingSession.points.push(geo);
    renderMap();
    return;
  }

  // Arrow: manual double-click detection (raw pointer events, not the
  // native dblclick event, to stay consistent with the rest of this file's
  // manual gesture handling).
  const now = Date.now();
  const isDoubleClick = lastDrawClick &&
    now - lastDrawClick.t <= 550 &&
    Math.hypot(event.clientX - lastDrawClick.x, event.clientY - lastDrawClick.y) <= 6;
  if (isDoubleClick && drawingSession.points.length >= 2) {
    await finishDrawing();
    return;
  }
  drawingSession.points.push(geo);
  lastDrawClick = { x: event.clientX, y: event.clientY, t: now };
  renderMap();
}

// Owns click-to-select/deselect/place, drag-to-move-a-point, drag-to-move-
// an-annotation-vertex, click-to-select/insert-vertex on an annotation, and
// the shape/arrow drawing-session clicks. Pure panning on blank map space is
// still navigation.js's job (see shouldStartPan in init()) -- this only ever
// takes over a gesture that started ON something, or a plain click, so the
// two never fight over the same pointer.
function setupPointerHandling() {
  let gesture = null;
  // kinds: 'point' (drag marker) | 'vertex' (drag annotation vertex) |
  // 'annotation' (click an annotation's fill/line) | 'blank' (click/pan empty space)

  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const vertexHit = event.target.closest?.('[data-vertex-index]');
    const annotationHit = event.target.closest?.('[data-annotation-id]');
    const systemHit = event.target.closest?.('[data-system-id]');

    if (tool === 'select' && vertexHit) {
      gesture = {
        kind: 'vertex',
        annotationId: vertexHit.dataset.annotationId,
        vertexIndex: Number(vertexHit.dataset.vertexIndex),
        downX: event.clientX, downY: event.clientY, moved: false,
      };
      svg.setPointerCapture?.(event.pointerId);
    } else if (tool === 'select' && annotationHit) {
      gesture = { kind: 'annotation', annotationId: annotationHit.dataset.annotationId, downX: event.clientX, downY: event.clientY };
    } else if (tool === 'select' && systemHit) {
      gesture = { kind: 'point', id: systemHit.dataset.systemId, downX: event.clientX, downY: event.clientY, moved: false };
      svg.setPointerCapture?.(event.pointerId);
    } else {
      gesture = { kind: 'blank', downX: event.clientX, downY: event.clientY };
    }
  });

  svg.addEventListener('pointermove', (event) => {
    if (gesture?.kind === 'point') {
      const dist = Math.hypot(event.clientX - gesture.downX, event.clientY - gesture.downY);
      if (dist <= 4) return;
      gesture.moved = true;
      const system = systems.find((s) => s.id === gesture.id);
      if (!system) return;
      const geo = geoAtClient(event, svg.getBoundingClientRect());
      system.lat = geo.lat;
      system.lon = geo.lon;
      renderMap();
      return;
    }
    if (gesture?.kind === 'vertex') {
      const dist = Math.hypot(event.clientX - gesture.downX, event.clientY - gesture.downY);
      if (dist <= 4) return;
      gesture.moved = true;
      const ann = annotations.find((a) => a.id === gesture.annotationId);
      if (!ann) return;
      ann.points[gesture.vertexIndex] = geoAtClient(event, svg.getBoundingClientRect());
      renderMap();
      return;
    }
  });

  svg.addEventListener('pointerup', async (event) => {
    const current = gesture;
    gesture = null;
    if (!current) return;

    if (current.kind === 'point') {
      const system = systems.find((s) => s.id === current.id);
      if (current.moved && system) {
        const updated = await api.updateSystem(system.id, { lat: system.lat, lon: system.lon });
        systems = systems.map((s) => (s.id === updated.id ? updated : s));
        renderSidebar();
        renderMap();
      } else {
        select(current.id);
      }
      return;
    }

    if (current.kind === 'vertex') {
      const ann = annotations.find((a) => a.id === current.annotationId);
      if (current.moved && ann) {
        const updated = await api.updateAnnotation(ann.id, { points: ann.points });
        annotations = annotations.map((a) => (a.id === updated.id ? updated : a));
        renderSidebar();
        renderMap();
      }
      return; // a plain click on a handle of the already-selected annotation is a no-op
    }

    if (current.kind === 'annotation') {
      const dist = Math.hypot(event.clientX - current.downX, event.clientY - current.downY);
      if (dist > 4) return;
      const ann = annotations.find((a) => a.id === current.annotationId);
      if (!ann) return;
      if (ann.id === selectedAnnotationId) {
        await insertVertex(ann, geoAtClient(event, svg.getBoundingClientRect()));
      } else {
        selectAnnotation(ann);
      }
      return;
    }

    // Blank space: a real drag here was a pan (navigation.js already moved
    // the camera) -- only act on it if it was a plain click.
    const dist = Math.hypot(event.clientX - current.downX, event.clientY - current.downY);
    if (dist > 4) return;
    const geo = geoAtClient(event, svg.getBoundingClientRect());
    if (tool === 'create-disturbance') {
      await placeDisturbance(geo);
    } else if (tool === 'shape' || tool === 'arrow') {
      await handleDrawClick(geo, event);
    } else if (selectedId !== null) {
      select(null);
    }
  });
}

async function init() {
  const geography = await loadGeography();
  mapRenderer = createMapRenderer(svg, geography);
  annotationRenderer = createAnnotationRenderer(svg);
  pointRenderer = createPointRenderer(svg);

  attachNavigation({
    svg,
    getView: () => viewState,
    setView,
    getRenderedBounds: () => mapRenderer.getLastRender()?.bounds,
    shouldStartPan: (event) =>
      tool !== 'create-disturbance' && tool !== 'shape' && tool !== 'arrow' &&
      !event.target.closest?.('[data-system-id]') &&
      !event.target.closest?.('[data-annotation-id]') &&
      !event.target.closest?.('[data-vertex-index]'),
  });

  setupPointerHandling();

  for (const btn of toolButtons) {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  }
  deselectBtn.addEventListener('click', () => select(null));
  resetViewBtn.addEventListener('click', () => setView(resetView(viewState)));

  window.addEventListener('resize', renderMap);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && (tool === 'shape' || tool === 'arrow')) setTool('select');
  });

  await detectBackend();
  document.getElementById('local-mode-banner').hidden = !api.isLocalOnly();

  [systems, annotations] = await Promise.all([api.listSystems(), api.listAnnotations()]);
  updateToolAvailability();
  setTool('select');
  renderSidebar();
  renderMap();
}

init().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<div class="fatal-error">Failed to start editor: ${err.message}</div>`);
});
