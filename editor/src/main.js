import {
  INITIAL_BOUNDS, maxFormationProbabilityPct, systemColor, displayLabel,
  intensityScore, intensityCategoryKey, categorySymbol, windOnlyIntensityScore, CATEGORY_INFO, defaultSpreadForHour,
  WATCH_LEVEL_LABELS, WATCH_PRODUCTS,
} from './constants.js';
import { createViewState, getAspectFittedBounds, resetView } from './viewState.js';
import { attachNavigation } from './navigation.js';
import { createMapRenderer } from './mapRenderer.js';
import { createPointRenderer } from './pointRenderer.js';
import { createAnnotationRenderer } from './annotationRenderer.js';
import { createTrackConeRenderer } from './trackConeRenderer.js';
import { createSpreadEditor } from './spreadEditor.js';
import { createWindFieldRenderer } from './windFieldRenderer.js';
import { milesBetween, buildConeDisks } from './trackGeometry.js';
import { VALID_INTERVALS, nextForecastHour, recomputeForecastHours } from './forecastSchedule.js';
import { projectLonLat } from './geo.js';
import { api, detectBackend } from './api.js';
import { buildDisturbanceCalloutText, buildClassifiedCalloutText } from './discussionText.js';
import { placeCallout } from './calloutPlacement.js';
import { exportSvgAsPng } from './imageExport.js';
import { createWatchRenderer } from './watchRenderer.js';

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
const discussionCalloutEl = document.getElementById('discussion-callout');
const loginGateEl = document.getElementById('login-gate');
const editorShellEl = document.getElementById('editor-shell');
const loginForm = document.getElementById('login-form');
const loginUsernameInput = document.getElementById('login-username');
const loginPasswordInput = document.getElementById('login-password');
const loginErrorEl = document.getElementById('login-error');
const loginGateLocalNoticeEl = document.getElementById('login-gate-local-notice');
const userStatusEl = document.getElementById('user-status');
const userStatusLabelEl = document.getElementById('user-status-label');
const logoutBtn = document.getElementById('logout-btn');
const accountPanelSectionEl = document.getElementById('account-panel-section');
const accountPanelEl = document.getElementById('account-panel');

// Mirrors server/src/auth.js's ROLES/rank ordering exactly -- the two sides
// never share a module, so this is duplicated the same way currentSeason()
// and averageRadius() already are between server/src/systems.js and
// editor/src/api.js.
const ROLES = ['owner', 'admin', 'forecaster', 'junior_forecaster'];
const ROLE_RANK = { owner: 4, admin: 3, forecaster: 2, junior_forecaster: 1 };
function hasRole(user, minRole) {
  return !!user && (ROLE_RANK[user.role] ?? 0) >= (ROLE_RANK[minRole] ?? 0);
}
function roleLabel(role) {
  return { owner: 'Owner', admin: 'Admin', forecaster: 'Forecaster', junior_forecaster: 'Junior Forecaster' }[role] ?? role;
}
// Local-only mode (no backend reachable, e.g. the GitHub Pages demo) has no
// real account system at all -- every role check is bypassed there so the
// local sandbox stays fully usable solo, matching its pre-accounts
// behavior. Against a real backend, this is a real role check.
function canWriteRole(minRole) {
  return api.isLocalOnly() || hasRole(currentUser, minRole);
}

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
let currentUser = null; // {id, username, displayName, role} | null -- from api.me()
let advisories = [];
let scheduledAdvisories = [];
let watches = [];
let activeWindThreshold = 'gale'; // 'gale' | 'hfw' -- which quadrant handles are shown/draggable
let drawingSession = null; // { systemId, type: 'shape'|'arrow', points: [{lon,lat}] } | null
// Set by the Watches section's "Add zone" button, alongside setTool('shape')
// -- consumed the moment a drawing session actually starts (tagging it as a
// watch draft instead of a plain annotation), then cleared. setTool() itself
// also clears it, so switching tools away before drawing anything can't
// leave it stale for some later, unrelated shape-drawing session.
let pendingWatchDraft = null; // { product, level } | null
let lastDrawClick = null; // { x, y, t } -- manual double-click detection for the arrow tool
let tool = 'select';
let viewState = createViewState(INITIAL_BOUNDS);
let mapRenderer = null;
let pointRenderer = null;
let annotationRenderer = null;
let trackConeRenderer = null;
let spreadEditor = null;
let windFieldRenderer = null;
let watchRenderer = null;

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
function selectedSystemTrackPoints() {
  const system = systems.find((s) => s.id === selectedId);
  if (!system || !system.classified) return [];
  const own = forecastPoints
    .filter((p) => p.systemId === selectedId)
    .sort((a, b) => a.sequence - b.sequence)
    .map((p) => ({
      id: p.id, lon: p.lon, lat: p.lat, hour: p.hour, spread: p.spreadMi,
      symbol: categorySymbol(intensityCategoryKey(windOnlyIntensityScore(p.windMph))),
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

function latestAdvisoryFor(systemId) {
  return advisories
    .filter((a) => a.systemId === systemId)
    .reduce((latest, a) => (!latest || a.number > latest.number ? a : latest), null);
}

// Bounding boxes (map-container-relative, matching the coordinate space
// the callout's own left/top are set in) of everything on the map the
// callout shouldn't cover -- every system's marker/label, any track/wind
// field, and any visible shape/arrow. Read from the real rendered
// elements rather than recomputed from their data, so this holds up
// regardless of that element's own shape, size, or position.
//
// The cone itself is a deliberate exception (see coneObstacleRect): it's
// painted as a full-map-bounds <rect> clipped by an SVG <mask>
// (trackConeRenderer.js's own technique for unioning many ellipses), and
// a mask changes what's painted, not the element's geometry -- so
// getBoundingClientRect() on it always reports the *entire visible map*,
// not the cone's actual shape. Using that as an obstacle would make
// every position on the map count as "covered."
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

// The cone's real screen-space extent, computed the same way
// trackConeRenderer.js builds its mask ellipses (buildConeDisks) instead
// of read from the DOM -- see collectObstacleRects's comment for why.
// One combined box (not one rect per disk) is precise enough for
// placement purposes and far cheaper.
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

// Text callout shown on the map next to the selected system, until it's
// deselected -- a disturbance/invest discussion form pre-classification, or
// the latest advisory's discussion + forecast-positions text once
// classified. Positioned from the system's own projected marker position,
// flipped/clamped to stay within the visible map area.
function renderDiscussionCallout() {
  const rect = svg.getBoundingClientRect();
  const system = systems.find((s) => s.id === selectedId);
  if (!system || rect.width === 0 || rect.height === 0) {
    discussionCalloutEl.hidden = true;
    return;
  }

  discussionCalloutEl.textContent = system.classified
    ? buildClassifiedCalloutText(system, latestAdvisoryFor(system.id), api.isLocalOnly())
    : buildDisturbanceCalloutText(system, latestAdvisoryFor(system.id), api.isLocalOnly());
  discussionCalloutEl.hidden = false;

  const bounds = currentBounds();
  const { x, y } = projectLonLat(system.lon, system.lat, bounds, rect.width, rect.height);
  const obstacles = collectObstacleRects(rect);
  const cone = coneObstacleRect(selectedSystemTrackPoints(), bounds, rect.width, rect.height);
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
  // The map has zero size while it's behind the login gate (display:none
  // ancestor) -- nothing to draw yet, and computing bounds against a
  // zero-size viewport throws. updateAuthGate() re-renders once it's shown.
  if (rect.width === 0 || rect.height === 0) return;
  const bounds = currentBounds();
  mapRenderer.render({ bounds, width: rect.width, height: rect.height, showGrid: true });
  watchRenderer.render({ watches });
  trackConeRenderer.render({ points: selectedSystemTrackPoints(), selectedForecastPointId, bounds, width: rect.width, height: rect.height });
  windFieldRenderer.render({ system: systems.find((s) => s.id === selectedId) ?? null, activeThreshold: activeWindThreshold, bounds, width: rect.width, height: rect.height });
  annotationRenderer.render({ annotations: visibleAnnotations(), selectedAnnotationId, draft: drawingSession, systems, bounds, width: rect.width, height: rect.height });
  pointRenderer.render({ systems, selectedId, bounds, width: rect.width, height: rect.height });
  renderDiscussionCallout();
  spreadEditor.render({ point: selectedForecastPoint(), bounds, width: rect.width, height: rect.height });
}

function setView(next) {
  viewState = next;
  renderMap();
}

function setTool(next) {
  tool = next;
  drawingSession = null; // nothing is persisted until finish, so switching tools loses nothing
  pendingWatchDraft = null;
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

// The whole editor is behind this gate: nothing of it (map, toolbar,
// sidebar) is visible until you're logged in. Local-only mode (no backend
// reachable) is the one exception -- there's no real account system to log
// into there at all, so it bypasses the gate entirely and shows the editor
// directly, same as it always has.
function updateAuthGate() {
  const localOnly = api.isLocalOnly();
  const showEditor = localOnly || !!currentUser;
  loginGateEl.hidden = showEditor;
  editorShellEl.hidden = !showEditor;

  loginForm.hidden = localOnly; // sign-in can never succeed with no backend
  loginGateLocalNoticeEl.hidden = !localOnly;

  userStatusEl.hidden = !currentUser;
  if (currentUser) {
    userStatusLabelEl.innerHTML = `Logged in as <strong>${currentUser.displayName}</strong> (${roleLabel(currentUser.role)})`;
  }
  // Accounts are a real-backend concept through and through (there's
  // nothing to manage locally) -- never bypassed by local-only mode, unlike
  // canWriteRole()'s ordinary forecasting actions.
  accountPanelSectionEl.hidden = localOnly || !hasRole(currentUser, 'admin');
  if (!localOnly && hasRole(currentUser, 'admin')) renderAccountPanel();
}

// Owner/Admin-only account list + creation form -- Owner additionally gets
// a role dropdown per user (promote/demote), Admin sees roles as plain text.
async function renderAccountPanel() {
  const users = await api.listUsers().catch(() => []);
  accountPanelEl.replaceChildren();
  const isOwner = currentUser.role === 'owner';

  for (const user of users) {
    const row = document.createElement('div');
    row.className = 'account-user-row';
    const name = document.createElement('span');
    name.className = 'account-user-row__name';
    name.innerHTML = `${user.displayName}<small>@${user.username}</small>`;
    row.append(name);

    if (isOwner) {
      const roleSelect = document.createElement('select');
      for (const role of ROLES) {
        const opt = document.createElement('option');
        opt.value = role;
        opt.textContent = roleLabel(role);
        roleSelect.append(opt);
      }
      roleSelect.value = user.role;
      roleSelect.disabled = user.id === currentUser.id; // can't accidentally demote yourself
      roleSelect.title = roleSelect.disabled ? "Can't change your own role" : '';
      roleSelect.addEventListener('change', async () => {
        await api.updateUserRole(user.id, roleSelect.value);
        renderAccountPanel();
      });
      row.append(roleSelect);
    } else {
      const roleTag = document.createElement('span');
      roleTag.className = 'account-user-row__name';
      roleTag.textContent = roleLabel(user.role);
      row.append(roleTag);
    }
    accountPanelEl.append(row);
  }

  const form = document.createElement('div');
  form.className = 'account-create-form';
  const usernameInput = document.createElement('input');
  usernameInput.placeholder = 'Username';
  const displayNameInput = document.createElement('input');
  displayNameInput.placeholder = 'Display name';
  const passwordInput = document.createElement('input');
  passwordInput.type = 'password';
  passwordInput.placeholder = 'Password (8+ characters)';
  form.append(usernameInput, displayNameInput, passwordInput);

  // Only Owner can choose a new account's role -- Admin-created accounts
  // default to Junior Forecaster (enforced server-side too).
  let roleSelectForCreate = null;
  if (isOwner) {
    roleSelectForCreate = document.createElement('select');
    for (const role of ROLES) {
      const opt = document.createElement('option');
      opt.value = role;
      opt.textContent = roleLabel(role);
      roleSelectForCreate.append(opt);
    }
    roleSelectForCreate.value = 'junior_forecaster';
    form.append(roleSelectForCreate);
  }

  const errorEl = document.createElement('div');
  errorEl.className = 'account-error';
  const createBtn = document.createElement('button');
  createBtn.textContent = 'Create account';
  createBtn.addEventListener('click', async () => {
    errorEl.textContent = '';
    try {
      await api.createUser({
        username: usernameInput.value,
        password: passwordInput.value,
        displayName: displayNameInput.value,
        role: roleSelectForCreate?.value,
      });
      renderAccountPanel();
    } catch (err) {
      errorEl.textContent = err.message === 'username_taken' ? 'That username is already taken.' : err.message;
    }
  });
  form.append(createBtn, errorEl);
  accountPanelEl.append(form);
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

function productSelect(value) {
  const select = document.createElement('select');
  for (const opt of WATCH_PRODUCTS) {
    const optionEl = document.createElement('option');
    optionEl.value = opt.value;
    optionEl.textContent = opt.label;
    select.append(optionEl);
  }
  select.value = value ?? WATCH_PRODUCTS[0].value;
  return select;
}

function levelSelect(value) {
  const select = document.createElement('select');
  for (const [val, label] of Object.entries(WATCH_LEVEL_LABELS)) {
    const optionEl = document.createElement('option');
    optionEl.value = val;
    optionEl.textContent = label;
    select.append(optionEl);
  }
  select.value = value ?? 'watch';
  return select;
}

// Not gated on classified (unlike Shapes & Arrows / Forecast track above)
// -- a watch/warning is relevant at every stage, and specifically stays
// relevant *more* as a system intensifies, not less (see
// public/src/main.js's visibleWatchesFrom, which deliberately has no
// classified filter either). Drawing a new zone reuses the exact same
// map-click gesture as Draw Shape (see handleDrawClick/finishDrawing) --
// "Add zone" here just sets the tool and tags the upcoming session with
// the product/level chosen below, rather than adding a whole separate
// drawing mechanism (or a 6th permanent toolbar button).
function renderWatchesSection(system) {
  const ownWatches = watches.filter((w) => w.systemId === system.id);
  const canWrite = canWriteRole('forecaster');

  const wrap = document.createElement('div');
  wrap.className = 'annotations-section';
  const heading = document.createElement('h4');
  heading.textContent = 'Watches & warnings';
  wrap.append(heading);

  if (ownWatches.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-hint';
    empty.textContent = 'None yet — pick a product and level below, then Add zone.';
    wrap.append(empty);
  } else {
    for (const watch of ownWatches) {
      const row = document.createElement('div');
      row.className = 'forecast-point-row';

      const product = productSelect(watch.product);
      const level = levelSelect(watch.level);
      product.disabled = level.disabled = !canWrite;

      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Save';
      saveBtn.disabled = !canWrite;
      saveBtn.title = canWrite ? 'Escalating/de-escalating is just changing the level here and saving' : 'Requires Forecaster role or higher';
      saveBtn.addEventListener('click', async () => {
        const updated = await api.updateWatch(watch.id, { product: product.value, level: level.value });
        watches = watches.map((w) => (w.id === updated.id ? updated : w));
        renderSidebar();
        renderMap();
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.className = 'danger';
      deleteBtn.disabled = !canWrite;
      deleteBtn.title = canWrite ? '' : 'Requires Forecaster role or higher';
      deleteBtn.addEventListener('click', async () => {
        if (!confirm('Delete this watch/warning zone? This cannot be undone.')) return;
        await api.deleteWatch(watch.id);
        watches = watches.filter((w) => w.id !== watch.id);
        renderSidebar();
        renderMap();
      });

      row.append(product, level, saveBtn, deleteBtn);
      wrap.append(row);
    }
  }

  const newRow = document.createElement('div');
  newRow.className = 'forecast-point-row';
  const newProduct = productSelect();
  const newLevel = levelSelect();
  newProduct.disabled = newLevel.disabled = !canWrite;
  const addZoneBtn = document.createElement('button');
  addZoneBtn.textContent = 'Add zone';
  addZoneBtn.className = 'primary';
  addZoneBtn.disabled = !canWrite;
  addZoneBtn.title = canWrite
    ? 'Draw a new zone on the map -- click to place points, click near the start (or double-click) to finish'
    : 'Requires Forecaster role or higher';
  addZoneBtn.addEventListener('click', () => {
    setTool('shape');
    pendingWatchDraft = { product: newProduct.value, level: newLevel.value };
  });
  newRow.append(newProduct, newLevel, addZoneBtn);
  wrap.append(newRow);

  selectedPanelEl.append(wrap);
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

    // Manual land-status tag for this point, used only by the
    // FORECAST POSITIONS AND MAX WINDS text in the discussion callout
    // (see discussionText.js) -- e.g. "...OVER WATER" / "...INLAND", or
    // "DISSIPATED" in place of a position once the system is expected to
    // have dissipated by that forecast hour.
    const statusSelect = document.createElement('select');
    statusSelect.title = 'Land status for the forecast-positions text (optional)';
    const statusOptions = [
      { value: '', label: '—' },
      { value: 'over_water', label: 'Over water' },
      { value: 'inland', label: 'Inland' },
      { value: 'dissipated', label: 'Dissipated' },
    ];
    for (const opt of statusOptions) {
      const optionEl = document.createElement('option');
      optionEl.value = opt.value;
      optionEl.textContent = opt.label;
      statusSelect.append(optionEl);
    }
    statusSelect.value = point.status ?? '';

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
        status: statusSelect.value === '' ? null : statusSelect.value,
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

    row.append(label, modeSelect, hourInput, windInput, spreadInput, statusSelect, saveBtn, deleteBtn);
    wrap.append(row);
  }

  selectedPanelEl.append(wrap);
}

const ADVISORY_CANCEL_WINDOW_MS = 60 * 60 * 1000; // mirrors server/src/advisories.js's CANCEL_WINDOW_MS
function isAdvisoryCancelable(advisory) {
  return Date.now() < new Date(advisory.issuedAt).getTime() + ADVISORY_CANCEL_WINDOW_MS;
}

function renderAdvisoriesSection(system) {
  const own = advisories.filter((a) => a.systemId === system.id).sort((a, b) => b.number - a.number);

  const wrap = document.createElement('div');
  wrap.className = 'annotations-section';
  const heading = document.createElement('h4');
  heading.textContent = 'Advisories';
  wrap.append(heading);

  // Advisories are an inherently real-backend concept (an immutable record
  // tied to a real issuing account) -- unlike ordinary forecasting actions,
  // this is never bypassed for local-only mode.
  const localOnly = api.isLocalOnly();
  const canPublish = !localOnly && hasRole(currentUser, 'forecaster');

  // Formation probabilities, pressure, wind, and gust are drafted here and
  // only ever take effect on the live system record at the moment this
  // advisory actually publishes (see server/src/advisories.js's
  // publishAdvisory) -- there is no separate "Save" for them anymore, so a
  // forecaster can freely edit/cancel without anything public changing
  // until they actually click Publish or Plan to Publish. Prefilled from
  // the system's current officially-published values as the starting
  // point for drafting the next advisory.
  function probabilityInput(value) {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '100';
    input.value = value ?? '';
    input.placeholder = '0-100';
    input.disabled = !canPublish;
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
  pressureInput.disabled = !canPublish;

  const windInput = document.createElement('input');
  windInput.type = 'number';
  windInput.step = '1';
  windInput.value = system.windMph ?? '';
  windInput.placeholder = 'mph';
  windInput.disabled = !canPublish;

  const gustInput = document.createElement('input');
  gustInput.type = 'number';
  gustInput.step = '1';
  gustInput.value = system.gustMph ?? '';
  gustInput.placeholder = 'mph';
  gustInput.disabled = !canPublish;

  wrap.append(
    field('2-day formation probability (%)', prob2Input),
    field('5-day formation probability (%)', prob5Input),
    field('10-day formation probability (%)', prob10Input),
    field('Central pressure (mb)', pressureInput),
    field('Sustained wind (mph)', windInput),
    field('Max gust (mph)', gustInput)
  );

  const discussionTextarea = document.createElement('textarea');
  discussionTextarea.rows = 4;
  discussionTextarea.placeholder = 'Discussion for this advisory (reasoning, trends, confidence)...';
  discussionTextarea.disabled = !canPublish;
  wrap.append(field('Discussion', discussionTextarea));

  // Same discussion text either way -- Publish issues it right now; Plan
  // to Publish holds it and lets scheduledAdvisoryRunner.js (server-side)
  // issue it unattended at this time instead, for a forecaster who won't
  // be at a computer then.
  const scheduledForInput = document.createElement('input');
  scheduledForInput.type = 'datetime-local';
  scheduledForInput.disabled = !canPublish;
  const minWhen = new Date(Date.now() + 60000);
  scheduledForInput.min = new Date(minWhen - minWhen.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  wrap.append(field('Scheduled for (Plan to Publish only)', scheduledForInput));

  // The drafted fields above, read at the moment Publish/Plan to Publish
  // is actually clicked -- shared by both buttons below since it's the
  // exact same payload either way, just immediate vs. held for later.
  function draftFields() {
    return {
      formationProbability2dayPct: prob2Input.value === '' ? null : Number(prob2Input.value),
      formationProbability5dayPct: prob5Input.value === '' ? null : Number(prob5Input.value),
      formationProbability10dayPct: prob10Input.value === '' ? null : Number(prob10Input.value),
      pressureMb: pressureInput.value === '' ? null : Number(pressureInput.value),
      windMph: windInput.value === '' ? null : Number(windInput.value),
      gustMph: gustInput.value === '' ? null : Number(gustInput.value),
    };
  }

  const actions = document.createElement('div');
  actions.className = 'selected-actions';

  const publishBtn = document.createElement('button');
  publishBtn.textContent = 'Publish Advisory';
  publishBtn.className = 'primary';
  publishBtn.disabled = !canPublish;
  publishBtn.title = localOnly ? 'Advisories require the real hosted backend -- not available in local-only mode' : (canPublish ? '' : 'Requires Forecaster role or higher');
  publishBtn.addEventListener('click', async () => {
    if (!confirm(`Publish advisory #${own.length + 1} for ${displayLabel(system)}? This creates a permanent record of its current data${system.classified ? ' and forecast track' : ''}.`)) return;
    const created = await api.createAdvisory(system.id, { discussion: discussionTextarea.value.trim() || null, ...draftFields() });
    advisories = [...advisories, created];
    // The advisory's own snapshot is exactly the system's post-publish live
    // row (applySystemFields ran server-side right before it was taken) --
    // reuse it instead of a second round-trip to re-fetch the system.
    systems = systems.map((s) => (s.id === created.snapshot.system.id ? created.snapshot.system : s));
    renderSidebar();
    renderMap(); // the on-map discussion callout reads `advisories` too
  });
  actions.append(publishBtn);

  const scheduleBtn = document.createElement('button');
  scheduleBtn.textContent = 'Plan to Publish';
  scheduleBtn.disabled = !canPublish;
  scheduleBtn.title = canPublish ? 'Prepares this advisory now; it publishes automatically at the time set above' : publishBtn.title;
  scheduleBtn.addEventListener('click', async () => {
    if (!scheduledForInput.value) { alert('Pick a date and time first.'); return; }
    const when = new Date(scheduledForInput.value);
    if (!(when.getTime() > Date.now())) { alert('Scheduled time must be in the future.'); return; }
    if (!confirm(`Plan an advisory for ${displayLabel(system)} to publish automatically at ${when.toLocaleString()}?`)) return;
    const created = await api.createScheduledAdvisory(system.id, {
      discussion: discussionTextarea.value.trim() || null,
      scheduledFor: when.toISOString(),
      ...draftFields(),
    });
    scheduledAdvisories = [...scheduledAdvisories, created];
    scheduledForInput.value = '';
    renderSidebar();
  });
  actions.append(scheduleBtn);
  wrap.append(actions);

  const ownScheduled = scheduledAdvisories
    .filter((s) => s.systemId === system.id)
    .sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor));
  if (ownScheduled.length) {
    const schedHeading = document.createElement('h4');
    schedHeading.textContent = 'Scheduled';
    wrap.append(schedHeading);
    for (const sched of ownScheduled) {
      const row = document.createElement('div');
      row.className = 'account-user-row';
      const name = document.createElement('span');
      name.className = 'account-user-row__name';
      name.textContent = `Publishes ${new Date(sched.scheduledFor).toLocaleString()}`;
      row.append(name);

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.className = 'danger';
      cancelBtn.disabled = !canPublish;
      cancelBtn.title = canPublish ? 'Cancels this planned advisory -- it will never publish' : (localOnly ? 'Advisories require the real hosted backend' : 'Requires Forecaster role or higher');
      cancelBtn.addEventListener('click', async () => {
        if (!confirm('Cancel this planned advisory? It will never publish.')) return;
        await api.cancelScheduledAdvisory(sched.id);
        scheduledAdvisories = scheduledAdvisories.filter((s) => s.id !== sched.id);
        renderSidebar();
      });
      row.append(cancelBtn);
      wrap.append(row);
    }
  }

  if (own.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-hint';
    empty.textContent = 'None published yet.';
    wrap.append(empty);
  } else {
    for (const advisory of own) {
      const row = document.createElement('div');
      row.className = 'account-user-row';
      const name = document.createElement('span');
      name.className = 'account-user-row__name';
      name.textContent = `Advisory #${advisory.number} — ${new Date(advisory.issuedAt).toLocaleString()}`;
      row.append(name);

      if (isAdvisoryCancelable(advisory)) {
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.className = 'danger';
        cancelBtn.disabled = !canPublish;
        cancelBtn.title = canPublish ? 'Emergency-cancel: fully deletes this advisory (only available for 1 hour after publishing)' : (localOnly ? 'Advisories require the real hosted backend' : 'Requires Forecaster role or higher');
        cancelBtn.addEventListener('click', async () => {
          if (!confirm(`Emergency-cancel Advisory #${advisory.number}? This permanently deletes it. This cannot be undone.`)) return;
          await api.cancelAdvisory(advisory.id);
          advisories = advisories.filter((a) => a.id !== advisory.id);
          renderSidebar();
          renderMap(); // the on-map discussion callout reads `advisories` too
        });
        row.append(cancelBtn);
      }
      wrap.append(row);
    }
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

// Intensity score/category, computed from the system's current officially
// published wind/gust/pressure/gale-radius (there's no "unsaved draft" to
// read anymore -- those fields only ever change at the moment an advisory
// actually publishes; see renderAdvisoriesSection for where they're
// drafted). Classify itself acts on this same saved record, same as
// Investigate/Delete.
function renderIntensitySection(system) {
  const wrap = document.createElement('div');
  wrap.className = 'annotations-section intensity-section';
  const heading = document.createElement('h4');
  heading.textContent = 'Intensity & classification';
  wrap.append(heading);

  const readout = document.createElement('p');
  readout.className = 'intensity-readout';
  const score = intensityScore(system);
  if (score == null) {
    readout.textContent = 'Publish an advisory with wind, gust, pressure, and a gale wind field to calculate.';
  } else {
    const key = intensityCategoryKey(score);
    readout.textContent = `Score ${score.toFixed(1)} → ${CATEGORY_INFO[key].label}`;
  }
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
    const canClassifyRole = canWriteRole('forecaster');
    classifyBtn.disabled = !canClassify || !canClassifyRole;
    classifyBtn.title = !canClassifyRole
      ? 'Requires Forecaster role or higher'
      : (canClassify ? '' : 'Investigate it, mark it Formed, and save wind/gust/radius/pressure first.');
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

  const downloadImageBtn = document.createElement('button');
  downloadImageBtn.textContent = 'Download Map Image';
  downloadImageBtn.title = 'Save the current map view as a PNG, to share outside the app.';
  downloadImageBtn.addEventListener('click', async () => {
    try {
      const waterColor = getComputedStyle(document.documentElement).getPropertyValue('--water-color').trim();
      const safeName = displayLabel(system).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      await exportSvgAsPng(svg, {
        fileName: `${safeName}-${new Date().toISOString().slice(0, 10)}.png`,
        backgroundColor: waterColor,
      });
    } catch (err) {
      alert(`Couldn't export the map image: ${err.message}`);
    }
  });
  selectedPanelEl.append(downloadImageBtn);

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

  selectedPanelEl.append(renderWindFieldToggle(system));

  const actions = document.createElement('div');
  actions.className = 'selected-actions';

  let investigateBtn = null;
  if (system.stage !== 'invest') {
    investigateBtn = document.createElement('button');
    investigateBtn.textContent = 'Investigate';
    const canInvestigateRole = canWriteRole('forecaster');
    investigateBtn.disabled = !system.formed || !canInvestigateRole;
    investigateBtn.title = !canInvestigateRole
      ? 'Requires Forecaster role or higher'
      : (system.formed ? '' : 'Mark it Formed first.');
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
  const canDeleteRole = canWriteRole('forecaster');
  deleteBtn.disabled = !canDeleteRole;
  deleteBtn.title = canDeleteRole ? '' : 'Requires Forecaster role or higher';
  deleteBtn.addEventListener('click', async () => {
    if (!confirm(`Delete ${system.displayName}? Its advisories and track history will move to Past Storm Analysis.`)) return;
    await api.deleteSystem(system.id);
    systems = systems.filter((s) => s.id !== system.id);
    annotations = annotations.filter((a) => a.systemId !== system.id);
    forecastPoints = forecastPoints.filter((p) => p.systemId !== system.id);
    advisories = advisories.filter((a) => a.systemId !== system.id);
    scheduledAdvisories = scheduledAdvisories.filter((s) => s.systemId !== system.id);
    watches = watches.filter((w) => w.systemId !== system.id);
    select(null);
  });

  if (investigateBtn) actions.append(investigateBtn);
  actions.append(deleteBtn);
  selectedPanelEl.append(actions);

  renderIntensitySection(system);
  if (system.classified) {
    renderForecastTrackSection(system);
  } else {
    renderAnnotationsSection(system);
  }
  // Watches/warnings, like Advisories just below, are never gated on
  // classified -- relevant (and drawable) at every stage.
  renderWatchesSection(system);
  // Advisories can be published at any stage -- Disturbance, Invest, or
  // Classified (see server/src/advisories.js) -- so this section is never
  // gated on classified, unlike the track/cone and annotations sections above.
  renderAdvisoriesSection(system);
}

function renderSidebar() {
  renderSystemsList();
  renderSelectedPanel();
}

async function placeDisturbance(geo) {
  const created = await api.createSystem({ lat: geo.lat, lon: geo.lon });
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
  if (session.watchDraft) {
    const created = await api.createWatch(session.systemId, {
      product: session.watchDraft.product, level: session.watchDraft.level, points: session.points,
    });
    watches = [...watches, created];
    setTool('select');
    renderSidebar();
    renderMap();
    return;
  }
  const created = await api.createAnnotation(session.systemId, { type: session.type, points: session.points });
  annotations = [...annotations, created];
  setTool('select');
  selectAnnotation(created);
}

async function handleDrawClick(geo, event) {
  if (!drawingSession) {
    drawingSession = { systemId: selectedId, type: tool, points: [geo], watchDraft: pendingWatchDraft };
    pendingWatchDraft = null;
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
  // Broadest, most "background" non-basemap layer -- a hazard zone fill
  // sits under the selected system's own wind field and every system's
  // cone/track/marker, all of which should read as clearly on top of it.
  watchRenderer = createWatchRenderer(svg);
  // windFieldRenderer's fill goes under the cone (appended before
  // trackConeRenderer is created, since that renderer self-appends
  // immediately) so the forecast cone reads as the topmost map-level
  // shape rather than getting washed out by a translucent wind field.
  windFieldRenderer = createWindFieldRenderer(svg);
  svg.append(windFieldRenderer.fieldLayer);
  trackConeRenderer = createTrackConeRenderer(svg);
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

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginErrorEl.textContent = '';
    try {
      const { user } = await api.login(loginUsernameInput.value, loginPasswordInput.value);
      currentUser = user;
      loginUsernameInput.value = '';
      loginPasswordInput.value = '';
      scheduledAdvisories = await api.listScheduledAdvisories().catch(() => []);
      updateAuthGate();
      renderSidebar();
      // The map was zero-size (and skipped rendering) while behind the
      // gate -- now that it's visible, it needs its first real render.
      renderMap();
    } catch (err) {
      loginErrorEl.textContent = err.message === 'invalid_credentials' ? 'Incorrect username or password.' : err.message;
    }
  });

  logoutBtn.addEventListener('click', async () => {
    await api.logout();
    currentUser = null;
    updateAuthGate();
    renderSidebar();
  });

  window.addEventListener('resize', renderMap);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && (tool === 'shape' || tool === 'arrow' || tool === 'add-forecast-point')) setTool('select');
  });

  await detectBackend();
  document.getElementById('local-mode-banner').hidden = !api.isLocalOnly();

  [systems, annotations, forecastPoints, advisories, watches, currentUser] = await Promise.all([
    api.listSystems(), api.listAnnotations(), api.listForecastPoints(), api.listAdvisories(), api.listWatches(),
    api.me().then((r) => r.user),
  ]);
  // Scheduled (draft/unpublished) advisories require a logged-in session
  // server-side -- fetched separately, only once we actually know we're
  // authenticated (a persisted session cookie) or in local-only mode
  // (where the stand-in harmlessly resolves to []), never bundled into the
  // Promise.all above: that runs before login is known, and one 401 in a
  // Promise.all fails every fetch in it, not just its own.
  if (api.isLocalOnly() || currentUser) {
    scheduledAdvisories = await api.listScheduledAdvisories().catch(() => []);
  }
  updateToolAvailability();
  updateAuthGate();
  setTool('select');
  renderSidebar();
  renderMap();
}

init().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<div class="fatal-error">Failed to start editor: ${err.message}</div>`);
});
