import {
  INITIAL_BOUNDS, maxFormationProbabilityPct, systemColor, displayLabel,
  intensityScore, intensityCategoryKey, categorySymbol, CATEGORY_INFO, defaultSpreadForHour,
} from './constants.js';
import { createViewState, getAspectFittedBounds, resetView } from './viewState.js';
import { attachNavigation } from './navigation.js';
import { createMapRenderer } from './mapRenderer.js';
import { createPointRenderer } from './pointRenderer.js';
import { createAnnotationRenderer } from './annotationRenderer.js';
import { createTrackConeRenderer } from './trackConeRenderer.js';
import { createSpreadEditor } from './spreadEditor.js';
import { createWindFieldRenderer } from './windFieldRenderer.js';
import { milesBetween } from './trackGeometry.js';
import { VALID_INTERVALS, nextForecastHour, recomputeForecastHours } from './forecastSchedule.js';
import { projectLonLat } from './geo.js';
import { api, detectBackend } from './api.js';

const svg = document.getElementById('map');
const systemsListEl = document.getElementById('systems-list');
const selectedPanelEl = document.getElementById('selected-panel');
const emptyHintEl = document.getElementById('empty-hint');
const toolButtons = document.querySelectorAll('[data-tool]');
const drawToolButtons = document.querySelectorAll('[data-requires-selection]');
const classifyToolButtons = document.querySelectorAll('[data-requires-classification]');
const deselectBtn = document.getElementById('deselect-btn');
const resetViewBtn = document.getElementById('reset-view-btn');
const placementHint = document.getElementById('placement-hint');

const TOOL_HINTS = {
  'create-disturbance': 'Click the map to place the new disturbance.',
  shape: 'Click to add points. Click back near the first point to close the shape. Escape cancels.',
  arrow: 'Click to add points. Double-click the last point to finish. Escape cancels.',
  'add-forecast-point': 'Click the map to add a forecast point to the track.',
};

let systems = [];
let selectedId = null;
let annotations = [];
let selectedAnnotationId = null;
let forecastPoints = [];
let selectedForecastPointId = null;
let activeWindThreshold = 'gale'; // 'gale' | 'hfw' -- which quadrant handles are shown/draggable
let drawingSession = null; // { systemId, type: 'shape'|'arrow', points: [{lon,lat}] } | null
let lastDrawClick = null; // { x, y, t } -- manual double-click detection for the arrow tool
let tool = 'select';
let viewState = createViewState(INITIAL_BOUNDS);
let mapRenderer = null;
let pointRenderer = null;
let annotationRenderer = null;
let trackConeRenderer = null;
let spreadEditor = null;
let windFieldRenderer = null;

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

// The selected system's own lat/lon is always its hour-0 "current position"
// -- forecast_points never duplicate it, so it's synthesized here and
// prepended ahead of the saved forecast points (ordered by sequence).
// Each forecast point's marker symbol reuses the exact same category scale
// as the system's own classification -- its forecast wind stands in for
// system.windMph, while gust/radius/pressure are held at the system's
// current values (this app doesn't forecast those independently per point).
// null (no symbol shown) until the point's own wind is filled in.
function pointIntensitySymbol(system, windMph) {
  return categorySymbol(intensityCategoryKey(intensityScore({
    windMph, gustMph: system.gustMph, galeRadiusMi: system.galeRadiusMi, pressureMb: system.pressureMb,
  })));
}

function selectedSystemTrackPoints() {
  const system = systems.find((s) => s.id === selectedId);
  if (!system || !system.classified) return [];
  const own = forecastPoints
    .filter((p) => p.systemId === selectedId)
    .sort((a, b) => a.sequence - b.sequence)
    .map((p) => ({
      id: p.id, lon: p.lon, lat: p.lat, hour: p.hour, spread: p.spreadMi,
      symbol: pointIntensitySymbol(system, p.windMph),
    }));
  return [{ lon: system.lon, lat: system.lat, hour: 0, spread: 0 }, ...own];
}

// The raw forecast_points record for the spread editor (needs spreadMi and
// id directly, unlike selectedSystemTrackPoints()'s renamed/synthetic-
// current-prepended shape). null when nothing eligible is selected -- the
// synthetic hour-0 "current" point never appears in forecastPoints at all,
// so any hit here is automatically a real, editable point.
function selectedForecastPoint() {
  return forecastPoints.find((p) => p.id === selectedForecastPointId) ?? null;
}

// Shapes/arrows belonging to a classified system are hidden once
// classified -- the forecast track/cone replaces them as that system's
// visual representation (the underlying rows aren't deleted, just no
// longer rendered or reachable from the toolbar).
function visibleAnnotations() {
  return annotations.filter((a) => !systems.find((s) => s.id === a.systemId)?.classified);
}

function renderMap() {
  const rect = svg.getBoundingClientRect();
  const bounds = currentBounds();
  mapRenderer.render({ bounds, width: rect.width, height: rect.height, showGrid: true });
  trackConeRenderer.render({ points: selectedSystemTrackPoints(), selectedForecastPointId, bounds, width: rect.width, height: rect.height });
  windFieldRenderer.render({ system: systems.find((s) => s.id === selectedId) ?? null, activeThreshold: activeWindThreshold, bounds, width: rect.width, height: rect.height });
  annotationRenderer.render({ annotations: visibleAnnotations(), selectedAnnotationId, draft: drawingSession, systems, bounds, width: rect.width, height: rect.height });
  pointRenderer.render({ systems, selectedId, bounds, width: rect.width, height: rect.height });
  spreadEditor.render({ point: selectedForecastPoint(), bounds, width: rect.width, height: rect.height });
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
  svg.classList.toggle('tool-create', tool === 'create-disturbance' || tool === 'add-forecast-point');
  svg.classList.toggle('tool-draw', tool === 'shape' || tool === 'arrow');
  placementHint.textContent = TOOL_HINTS[tool] || '';
  placementHint.hidden = !TOOL_HINTS[tool];
  renderMap();
}

// Shapes/arrows are a pre-classification sketching tool; once a system is
// classified, the forecast track/cone takes over as its visual
// representation, so Draw Shape/Arrow stop being available for it and
// Add Forecast Point starts being available.
function updateToolAvailability() {
  const system = systems.find((s) => s.id === selectedId);
  for (const btn of drawToolButtons) {
    btn.disabled = selectedId === null || !!system?.classified;
    btn.title = selectedId === null
      ? 'Select a system first'
      : (system?.classified ? "Not available once classified -- use the forecast track instead" : '');
  }
  for (const btn of classifyToolButtons) {
    btn.disabled = !system?.classified;
    btn.title = system?.classified ? '' : 'Classify a system first';
  }
}

// Selecting a system always drops any shape/arrow selection (one thing
// selected at a time, same discipline the annotation feature's design
// followed from the old cyclone editor's precedent).
function select(systemId) {
  selectedId = systemId;
  selectedAnnotationId = null;
  selectedForecastPointId = null;
  if (selectedId === null && (tool === 'shape' || tool === 'arrow' || tool === 'add-forecast-point')) {
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

function selectForecastPoint(point) {
  selectedForecastPointId = point.id;
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
    name.textContent = displayLabel(system);

    const pct = document.createElement('span');
    pct.className = 'systems-list__pct';
    if (system.classified) {
      const score = intensityScore(system);
      pct.textContent = score != null ? score.toFixed(1) : '—';
    } else {
      const maxPct = maxFormationProbabilityPct(system);
      pct.textContent = maxPct != null ? `${maxPct}%` : '—';
    }

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

// After any change that can shift auto-scheduled hours (add, delete, a
// mode/manual-hour/override edit, or an interval change), recompute every
// point's hour in sequence order and PATCH only the ones that actually
// changed -- earlier points are never affected by a later one, but a
// change to an earlier point can ripple forward through every auto point
// after it.
async function syncForecastSchedule(system) {
  const own = forecastPoints
    .filter((p) => p.systemId === system.id)
    .sort((a, b) => a.sequence - b.sequence);
  const recomputed = recomputeForecastHours(own, system.forecastInterval);
  for (let i = 0; i < own.length; i++) {
    const before = own[i];
    const after = recomputed[i];
    if (before.hour !== after.hour || before.hourMode !== after.hourMode || before.hourOverride !== after.hourOverride) {
      const updated = await api.updateForecastPoint(before.id, {
        hour: after.hour, hourMode: after.hourMode, hourOverride: after.hourOverride,
      });
      forecastPoints = forecastPoints.map((p) => (p.id === updated.id ? updated : p));
    }
  }
}

function renderForecastTrackSection(system) {
  const ownPoints = forecastPoints
    .filter((p) => p.systemId === system.id)
    .sort((a, b) => a.sequence - b.sequence);

  const wrap = document.createElement('div');
  wrap.className = 'annotations-section';
  const heading = document.createElement('h4');
  heading.textContent = 'Forecast track';
  wrap.append(heading);

  const intervalRow = document.createElement('div');
  intervalRow.className = 'forecast-point-row';
  const intervalLabel = document.createElement('span');
  intervalLabel.className = 'forecast-point-label';
  intervalLabel.textContent = 'Interval';
  const intervalSelect = document.createElement('select');
  intervalSelect.title = 'Default spacing between automatically-scheduled forecast points';
  for (const step of VALID_INTERVALS) {
    const opt = document.createElement('option');
    opt.value = String(step);
    opt.textContent = `${step}h`;
    intervalSelect.append(opt);
  }
  intervalSelect.value = String(system.forecastInterval);
  intervalSelect.addEventListener('change', async () => {
    const updatedSystem = await api.updateSystem(system.id, { forecastInterval: Number(intervalSelect.value) });
    systems = systems.map((s) => (s.id === updatedSystem.id ? updatedSystem : s));
    await syncForecastSchedule(updatedSystem);
    renderSidebar();
    renderMap();
  });
  intervalRow.append(intervalLabel, intervalSelect);
  wrap.append(intervalRow);

  if (ownPoints.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-hint';
    empty.textContent = 'None yet — use Add Forecast Point above.';
    wrap.append(empty);
  }

  for (const point of ownPoints) {
    const row = document.createElement('div');
    row.className = `forecast-point-row${point.id === selectedForecastPointId ? ' is-selected' : ''}`;

    const label = document.createElement('span');
    label.className = 'forecast-point-label';
    label.textContent = `+${point.hour}h`;
    label.title = 'Select this point (or drag its dot on the map)';
    label.addEventListener('click', () => selectForecastPoint(point));

    const modeSelect = document.createElement('select');
    modeSelect.title = 'How this point\'s forecast hour is scheduled';
    const modeOptions = [
      { value: 'auto', label: 'Auto' },
      { value: 'manual', label: 'Manual' },
      { value: 'override:6', label: '+6h gap' },
      { value: 'override:12', label: '+12h gap' },
      { value: 'override:24', label: '+24h gap' },
    ];
    for (const opt of modeOptions) {
      const optionEl = document.createElement('option');
      optionEl.value = opt.value;
      optionEl.textContent = opt.label;
      modeSelect.append(optionEl);
    }
    modeSelect.value = point.hourMode === 'override' ? `override:${point.hourOverride}` : (point.hourMode || 'auto');

    const hourInput = document.createElement('input');
    hourInput.type = 'number';
    hourInput.min = '0';
    hourInput.step = '1';
    hourInput.value = point.hour;
    hourInput.placeholder = 'hr';
    hourInput.title = 'Forecast hour';
    function updateHourInputState() {
      // Only a manually-scheduled hour is ever directly editable -- auto
      // and override hours are computed by syncForecastSchedule from the
      // interval/gap instead.
      hourInput.disabled = modeSelect.value !== 'manual';
    }
    modeSelect.addEventListener('change', updateHourInputState);
    updateHourInputState();

    const windInput = document.createElement('input');
    windInput.type = 'number';
    windInput.min = '0';
    windInput.step = '1';
    windInput.value = point.windMph ?? '';
    windInput.placeholder = 'mph';
    windInput.title = 'Forecast sustained wind (mph) -- drives the marker\'s intensity symbol';

    const spreadInput = document.createElement('input');
    spreadInput.type = 'number';
    spreadInput.min = '0';
    spreadInput.step = '1';
    spreadInput.value = point.spreadMi;
    spreadInput.placeholder = 'mi';
    spreadInput.title = 'Cone spread (mi)';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
      const [mode, overrideStep] = modeSelect.value.split(':');
      const updated = await api.updateForecastPoint(point.id, {
        hour: mode === 'manual' ? (hourInput.value === '' ? point.hour : Number(hourInput.value)) : point.hour,
        hourMode: mode,
        hourOverride: mode === 'override' ? Number(overrideStep) : null,
        windMph: windInput.value === '' ? null : Number(windInput.value),
        spreadMi: spreadInput.value === '' ? 0 : Number(spreadInput.value),
      });
      forecastPoints = forecastPoints.map((p) => (p.id === updated.id ? updated : p));
      await syncForecastSchedule(system);
      renderSidebar();
      renderMap();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.className = 'danger';
    deleteBtn.addEventListener('click', async () => {
      await api.deleteForecastPoint(point.id);
      forecastPoints = forecastPoints.filter((p) => p.id !== point.id);
      if (selectedForecastPointId === point.id) selectedForecastPointId = null;
      await syncForecastSchedule(system);
      renderSidebar();
      renderMap();
    });

    row.append(label, modeSelect, hourInput, windInput, spreadInput, saveBtn, deleteBtn);
    wrap.append(row);
  }

  selectedPanelEl.append(wrap);
}

// Which quadrant handles (NE/SE/SW/NW) are currently shown/draggable on
// the map for the selected system's wind field -- a 2-button toggle,
// since only one threshold's handles are ever edited at a time (both
// envelopes still always render regardless of which is active).
function renderWindFieldToggle(system) {
  const wrap = document.createElement('div');
  wrap.className = 'wind-threshold-toggle';
  const options = [
    { value: 'gale', label: 'Gale-force wind field' },
    { value: 'hfw', label: 'Hurricane-force wind field' },
  ];
  for (const opt of options) {
    const btn = document.createElement('button');
    btn.textContent = opt.label;
    btn.className = activeWindThreshold === opt.value ? 'is-active' : '';
    btn.addEventListener('click', () => {
      activeWindThreshold = opt.value;
      renderSidebar();
      renderMap();
    });
    wrap.append(btn);
  }
  return wrap;
}

// Live intensity score/category, computed from the form's current (maybe
// unsaved) wind/gust/pressure values plus the system's saved gale radius
// -- this is the "calculator": it updates as you type/drag, before Save is
// ever clicked for wind/gust/pressure. Classify itself still acts on the
// saved system record, same as Investigate/Delete.
function renderIntensitySection(system, { windInput, gustInput, pressureInput }) {
  const wrap = document.createElement('div');
  wrap.className = 'annotations-section intensity-section';
  const heading = document.createElement('h4');
  heading.textContent = 'Intensity & classification';
  wrap.append(heading);

  const readout = document.createElement('p');
  readout.className = 'intensity-readout';
  // Gale radius comes from the wind-field drag handles on the map (see
  // windThresholdMi/windFieldRenderer), which PATCH immediately on
  // release -- unlike the typed wind/gust/pressure inputs, there's no
  // unsaved draft value for it, so the readout uses the system's current
  // saved value rather than a live input.
  function updateReadout() {
    const live = {
      windMph: windInput.value === '' ? null : Number(windInput.value),
      gustMph: gustInput.value === '' ? null : Number(gustInput.value),
      galeRadiusMi: system.galeRadiusMi,
      pressureMb: pressureInput.value === '' ? null : Number(pressureInput.value),
    };
    const score = intensityScore(live);
    if (score == null) {
      readout.textContent = 'Enter wind, gust, pressure, and a gale wind field to calculate.';
    } else {
      const key = intensityCategoryKey(score);
      readout.textContent = `Score ${score.toFixed(1)} → ${CATEGORY_INFO[key].label}`;
    }
  }
  for (const input of [windInput, gustInput, pressureInput]) {
    input.addEventListener('input', updateReadout);
  }
  updateReadout();
  wrap.append(readout);

  const details = document.createElement('details');
  details.className = 'intensity-reference';
  const summary = document.createElement('summary');
  summary.textContent = 'How is this calculated?';
  details.append(summary);
  const refBody = document.createElement('div');
  refBody.innerHTML = `
    <p><strong>Counts as an extratropical cyclone once it:</strong></p>
    <ul>
      <li>Has a closed circulation that has persisted 12+ hours</li>
      <li>Shows extratropical structure (temperature contrast, usually attached fronts)</li>
      <li>Produces gale-force sustained winds (39 mph+) somewhere in its circulation</li>
      <li>Has a central pressure roughly 8 mb+ below its surroundings</li>
    </ul>
    <p><strong>Score</strong> = [(wind − 35) + 0.25 × (gust − 40)] × √(radius ÷ 300) + 0.5 × (1010 − pressure)</p>
    <ul>
      <li>Under 10: Extratropical Depression</li>
      <li>10–19: Extratropical Storm</li>
      <li>20–39: Category 1</li>
      <li>40–64: Category 2</li>
      <li>65–99: Category 3</li>
      <li>100–149: Category 4</li>
      <li>150+: Category 5</li>
    </ul>
  `;
  details.append(refBody);
  wrap.append(details);

  if (!system.classified) {
    const canClassify = system.stage === 'invest' && system.formed &&
      system.windMph != null && system.gustMph != null &&
      system.galeRadiusMi != null && system.pressureMb != null;
    const classifyBtn = document.createElement('button');
    classifyBtn.textContent = 'Classify';
    classifyBtn.disabled = !canClassify;
    classifyBtn.title = canClassify ? '' : 'Investigate it, mark it Formed, and save wind/gust/radius/pressure first.';
    classifyBtn.addEventListener('click', async () => {
      const key = intensityCategoryKey(intensityScore(system));
      const label = key ? CATEGORY_INFO[key].label : 'a category';
      if (!confirm(`Classify ${displayLabel(system)} as an extratropical cyclone (${label})? Confirm it has a closed circulation (12+ hrs), extratropical structure, gale-force winds, and a meaningful pressure gradient below its surroundings. This cannot be undone.`)) return;
      const updated = await api.updateSystem(system.id, { classified: true });
      systems = systems.map((s) => (s.id === updated.id ? updated : s));
      select(updated.id);
    });
    wrap.append(classifyBtn);
  }

  selectedPanelEl.append(wrap);
}

function renderSelectedPanel() {
  const system = systems.find((s) => s.id === selectedId);
  selectedPanelEl.replaceChildren();
  emptyHintEl.hidden = !!system;
  selectedPanelEl.hidden = !system;
  if (!system) return;

  const title = document.createElement('h3');
  title.textContent = displayLabel(system);
  selectedPanelEl.append(title);

  const meta = document.createElement('div');
  meta.className = 'selected-meta';
  meta.textContent = `${system.seasonLabel} season · ${system.lat.toFixed(2)}°N, ${Math.abs(system.lon).toFixed(2)}°W`;
  selectedPanelEl.append(meta);

  const formedBtn = document.createElement('button');
  formedBtn.className = `formed-toggle${system.formed ? ' is-active' : ''}`;
  formedBtn.textContent = system.formed ? 'Formed' : 'Not Formed';
  formedBtn.title = 'Has a closed circulation physically formed? Click to toggle.';
  formedBtn.addEventListener('click', async () => {
    const updated = await api.updateSystem(system.id, { formed: !system.formed });
    systems = systems.map((s) => (s.id === updated.id ? updated : s));
    renderSidebar();
    renderMap();
  });
  selectedPanelEl.append(formedBtn);

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

  const gustInput = document.createElement('input');
  gustInput.type = 'number';
  gustInput.step = '1';
  gustInput.value = system.gustMph ?? '';
  gustInput.placeholder = 'mph';

  const form = document.createElement('div');
  form.className = 'selected-form';
  form.append(
    field('2-day formation probability (%)', prob2Input),
    field('5-day formation probability (%)', prob5Input),
    field('10-day formation probability (%)', prob10Input),
    field('Central pressure (mb)', pressureInput),
    field('Sustained wind (mph)', windInput),
    field('Max gust (mph)', gustInput)
  );
  selectedPanelEl.append(form);

  selectedPanelEl.append(renderWindFieldToggle(system));

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
      gustMph: gustInput.value === '' ? null : Number(gustInput.value),
    });
    systems = systems.map((s) => (s.id === updated.id ? updated : s));
    renderSidebar();
    renderMap();
  });

  let investigateBtn = null;
  if (system.stage !== 'invest') {
    investigateBtn = document.createElement('button');
    investigateBtn.textContent = 'Investigate';
    investigateBtn.disabled = !system.formed;
    investigateBtn.title = system.formed ? '' : 'Mark it Formed first.';
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
    forecastPoints = forecastPoints.filter((p) => p.systemId !== system.id);
    select(null);
  });

  actions.append(saveBtn);
  if (investigateBtn) actions.append(investigateBtn);
  actions.append(deleteBtn);
  selectedPanelEl.append(actions);

  renderIntensitySection(system, { windInput, gustInput, pressureInput });
  if (system.classified) {
    renderForecastTrackSection(system);
  } else {
    renderAnnotationsSection(system);
  }
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

async function placeForecastPoint(geo) {
  const system = systems.find((s) => s.id === selectedId);
  if (!system) return;
  const own = forecastPoints.filter((p) => p.systemId === selectedId).sort((a, b) => a.sequence - b.sequence);
  const hour = nextForecastHour(own, system.forecastInterval);
  const created = await api.createForecastPoint(selectedId, {
    lon: geo.lon, lat: geo.lat, hour, hourMode: 'auto', spreadMi: defaultSpreadForHour(hour),
  });
  forecastPoints = [...forecastPoints, created];
  // Stays in this tool, unlike Create Disturbance -- a track needs several
  // points placed in one sitting. Escape or picking another tool exits it,
  // same as Draw Shape/Arrow.
  renderSidebar();
  renderMap();
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

// Maps a wind field quadrant drag to the system field it edits, e.g.
// ('gale', 'ne') -> 'galeRadiusNeMi', ('hfw', 'sw') -> 'hurricaneForceRadiusSwMi'.
function windRadiusFieldKey(threshold, quadrant) {
  const prefix = threshold === 'hfw' ? 'hurricaneForceRadius' : 'galeRadius';
  return `${prefix}${quadrant[0].toUpperCase()}${quadrant.slice(1)}Mi`;
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
  // 'annotation' (click an annotation's fill/line) |
  // 'forecast-point' (drag/select a track point) | 'blank' (click/pan empty space)
  //
  // Hit-testing a specific existing element always wins, regardless of the
  // active tool -- clicking directly on a marker, vertex, or forecast point
  // unambiguously means "interact with that thing," so you're never forced
  // to switch back to Select just to nudge something while, say, Add
  // Forecast Point is active. Only a blank-space click is tool-dependent
  // (place/draw vs. pan/deselect).

  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    // Without this, dragging any of the hit-tested targets below (marker,
    // vertex, forecast point, spread handle) also fires the browser's
    // native text-selection-drag behavior, highlighting sidebar/toolbar
    // text as a side effect -- navigation.js's own pan-drag already calls
    // this, but shouldStartPan excludes these targets, so it never ran for
    // them.
    event.preventDefault();
    const spreadHandleHit = event.target.closest?.('[data-spread-handle]');
    const windHandleHit = event.target.closest?.('[data-wind-handle]');
    const vertexHit = event.target.closest?.('[data-vertex-index]');
    const annotationHit = event.target.closest?.('[data-annotation-id]');
    const systemHit = event.target.closest?.('[data-system-id]');
    const forecastPointHit = event.target.closest?.('[data-forecast-point-id]');

    if (spreadHandleHit && selectedForecastPointId) {
      gesture = { kind: 'spread', pointId: selectedForecastPointId, downX: event.clientX, downY: event.clientY };
      svg.setPointerCapture?.(event.pointerId);
    } else if (windHandleHit) {
      gesture = {
        kind: 'wind-handle',
        quadrant: windHandleHit.dataset.quadrant,
        threshold: activeWindThreshold,
        downX: event.clientX, downY: event.clientY, moved: false,
      };
      svg.setPointerCapture?.(event.pointerId);
    } else if (vertexHit) {
      gesture = {
        kind: 'vertex',
        annotationId: vertexHit.dataset.annotationId,
        vertexIndex: Number(vertexHit.dataset.vertexIndex),
        downX: event.clientX, downY: event.clientY, moved: false,
      };
      svg.setPointerCapture?.(event.pointerId);
    } else if (annotationHit) {
      gesture = { kind: 'annotation', annotationId: annotationHit.dataset.annotationId, downX: event.clientX, downY: event.clientY };
    } else if (systemHit) {
      gesture = { kind: 'point', id: systemHit.dataset.systemId, downX: event.clientX, downY: event.clientY, moved: false };
      svg.setPointerCapture?.(event.pointerId);
    } else if (forecastPointHit) {
      gesture = { kind: 'forecast-point', id: forecastPointHit.dataset.forecastPointId, downX: event.clientX, downY: event.clientY, moved: false };
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
    if (gesture?.kind === 'forecast-point') {
      const dist = Math.hypot(event.clientX - gesture.downX, event.clientY - gesture.downY);
      if (dist <= 4) return;
      gesture.moved = true;
      const point = forecastPoints.find((p) => p.id === gesture.id);
      if (!point) return;
      const geo = geoAtClient(event, svg.getBoundingClientRect());
      point.lat = geo.lat;
      point.lon = geo.lon;
      renderMap();
      return;
    }
    if (gesture?.kind === 'spread') {
      const dist = Math.hypot(event.clientX - gesture.downX, event.clientY - gesture.downY);
      if (dist <= 4) return;
      gesture.moved = true;
      const point = forecastPoints.find((p) => p.id === gesture.pointId);
      if (!point) return;
      const geo = geoAtClient(event, svg.getBoundingClientRect());
      point.spreadMi = Math.round(Math.min(1500, Math.max(0, milesBetween(point, geo))));
      renderMap();
      return;
    }
    if (gesture?.kind === 'wind-handle') {
      const dist = Math.hypot(event.clientX - gesture.downX, event.clientY - gesture.downY);
      if (dist <= 4) return;
      gesture.moved = true;
      const system = systems.find((s) => s.id === selectedId);
      if (!system) return;
      const geo = geoAtClient(event, svg.getBoundingClientRect());
      const key = windRadiusFieldKey(gesture.threshold, gesture.quadrant);
      system[key] = Math.round(Math.min(1500, Math.max(0, milesBetween(system, geo))));
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

    if (current.kind === 'forecast-point') {
      const point = forecastPoints.find((p) => p.id === current.id);
      if (current.moved && point) {
        const updated = await api.updateForecastPoint(point.id, { lat: point.lat, lon: point.lon });
        forecastPoints = forecastPoints.map((p) => (p.id === updated.id ? updated : p));
        renderSidebar();
        renderMap();
      } else if (point) {
        selectForecastPoint(point);
      }
      return;
    }

    if (current.kind === 'spread') {
      const point = forecastPoints.find((p) => p.id === current.pointId);
      if (current.moved && point) {
        const updated = await api.updateForecastPoint(point.id, { spreadMi: point.spreadMi });
        forecastPoints = forecastPoints.map((p) => (p.id === updated.id ? updated : p));
        renderSidebar();
        renderMap();
      }
      return; // a plain click on the handle (no drag) is a no-op
    }

    if (current.kind === 'wind-handle') {
      const system = systems.find((s) => s.id === selectedId);
      if (current.moved && system) {
        const key = windRadiusFieldKey(current.threshold, current.quadrant);
        const updated = await api.updateSystem(system.id, { [key]: system[key] });
        systems = systems.map((s) => (s.id === updated.id ? updated : s));
        renderSidebar();
        renderMap();
      }
      return; // a plain click on the handle (no drag) is a no-op
    }

    // Blank space: a real drag here was a pan (navigation.js already moved
    // the camera) -- only act on it if it was a plain click.
    const dist = Math.hypot(event.clientX - current.downX, event.clientY - current.downY);
    if (dist > 4) return;
    const geo = geoAtClient(event, svg.getBoundingClientRect());
    if (tool === 'create-disturbance') {
      await placeDisturbance(geo);
    } else if (tool === 'add-forecast-point') {
      await placeForecastPoint(geo);
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
  trackConeRenderer = createTrackConeRenderer(svg);
  windFieldRenderer = createWindFieldRenderer(svg);
  svg.append(windFieldRenderer.fieldLayer);
  annotationRenderer = createAnnotationRenderer(svg);
  pointRenderer = createPointRenderer(svg);
  // windFieldRenderer's handles are appended here, after pointRenderer --
  // see windFieldRenderer.js's own comment: they need to paint on top of
  // the system's marker/label so a handle near either always wins clicks.
  svg.append(windFieldRenderer.editorLayer);
  spreadEditor = createSpreadEditor(svg);

  attachNavigation({
    svg,
    getView: () => viewState,
    setView,
    getRenderedBounds: () => mapRenderer.getLastRender()?.bounds,
    // Panning works in every tool now, same as the hit-tested gestures above
    // -- a real drag on blank space is unambiguous regardless of which tool
    // is active, and a plain click (no real movement) still reaches
    // setupPointerHandling's own tool-specific place/draw logic below.
    shouldStartPan: (event) =>
      !event.target.closest?.('[data-system-id]') &&
      !event.target.closest?.('[data-annotation-id]') &&
      !event.target.closest?.('[data-vertex-index]') &&
      !event.target.closest?.('[data-forecast-point-id]') &&
      !event.target.closest?.('[data-spread-handle]') &&
      !event.target.closest?.('[data-wind-handle]'),
  });

  setupPointerHandling();

  for (const btn of toolButtons) {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  }
  deselectBtn.addEventListener('click', () => select(null));
  resetViewBtn.addEventListener('click', () => setView(resetView(viewState)));

  window.addEventListener('resize', renderMap);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && (tool === 'shape' || tool === 'arrow' || tool === 'add-forecast-point')) setTool('select');
  });

  await detectBackend();
  document.getElementById('local-mode-banner').hidden = !api.isLocalOnly();

  [systems, annotations, forecastPoints] = await Promise.all([api.listSystems(), api.listAnnotations(), api.listForecastPoints()]);
  updateToolAvailability();
  setTool('select');
  renderSidebar();
  renderMap();
}

init().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<div class="fatal-error">Failed to start editor: ${err.message}</div>`);
});
