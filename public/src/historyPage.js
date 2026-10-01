// Shared chart/stat-panel/popup rendering for both "Ongoing Storm
// Analysis" (public/src/history.js, active systems) and "Past Storm
// Analysis" (public/src/past.js, archived systems) -- the two pages are
// visually and behaviorally identical (same chart, same branded stat
// panel, same track/wind tabs, same clickable point popups) and differ
// only in WHICH systems they show: everything here is agnostic to that,
// parameterized via `loadData`/`includeSystem` in createHistoryPage()'s
// config. Reuses the editor's own map + constants, same relative-import
// reasoning as public/src/main.js (see its own header comment).
import {
  CATEGORY_INFO, categorySymbol, displayLabel, systemColor,
  intensityScore, intensityCategoryKey, maxFormationProbabilityPct,
} from '../editor/src/constants.js';
import { fitBoundsToAspect } from '../editor/src/geo.js';
import { destinationPoint } from '../editor/src/windFieldGeometry.js';
import { createMapRenderer } from '../editor/src/mapRenderer.js';
import { createTrackHistoryRenderer } from './trackHistoryRenderer.js';
import { createWindHistoryRenderer } from './windHistoryRenderer.js';
import { formatPosition, computeMinPressure } from './stormStats.js';

const CATEGORY_ORDER = ['ed', 'ets', 'cat1', 'cat2', 'cat3', 'cat4', 'cat5'];

// `loadData`: async () => { systems, advisories, positionLog, usingDemoData }
//   -- each page's own entry point owns fetching (which systems endpoint
//   to hit) and its own demo-mode fallback data.
// `includeSystem`: (system, advisories) => boolean -- which systems from
//   the fetched list actually appear in this page's picker.
export function createHistoryPage({ loadData, includeSystem }) {
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
  // The popup's own positioning container -- the chart's surface, not the
  // outer wrap, since below the 860px breakpoint (history.css) the wrap
  // also contains the full-width storm panel stacked above the surface,
  // which would otherwise offset every popup downward by the panel's height.
  const chartSurfaceEl = document.getElementById('history-chart-surface');
  const pointPopupEl = document.getElementById('point-popup');

  let systems = [];
  let currentEntries = [];
  let advisories = [];
  let positionLog = [];
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

  function advisoriesFor(systemId) {
    return advisories.filter((a) => a.systemId === systemId).sort((a, b) => a.number - b.number);
  }

  function positionLogFor(systemId) {
    return positionLog.filter((r) => r.systemId === systemId).sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
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

  // historyEntriesFor(), restricted to entries with a confirmed position --
  // a not-yet-Formed disturbance's lat/lon is never shown or plotted, same
  // rule as the live map (see pointRenderer.js's hideUnformed). Used for
  // anything position-bearing (the track/wind chart, the Position row);
  // historyEntriesFor() itself stays unfiltered so header/color/development-
  // chance info still works for a system that's never been Formed at all.
  function formedEntriesFor(system) {
    return historyEntriesFor(system).filter(({ system: snap }) => snap.formed);
  }

  // One point per entry, colored by *that entry's own* state -- systemColor
  // already picks category color once classified or formation-probability
  // color before that, so a track literally traces the strengthening/
  // weakening (or, pre-classification, the growing/fading development
  // chance) story rather than freezing on the system's current color.
  function pointsForSystem(systemId) {
    const system = systems.find((s) => s.id === systemId);
    if (!system) return [];
    return formedEntriesFor(system).map(({ system: snap }) => ({
      lon: snap.lon, lat: snap.lat, color: systemColor(snap),
    }));
  }

  // Same entries, as wind-envelope radii per quadrant -- one gale + one
  // hurricane-force envelope per entry, reusing exactly the fields
  // windFieldRenderer.js's live-map renderer already reads off a system.
  function snapshotsForSystem(systemId) {
    const system = systems.find((s) => s.id === systemId);
    if (!system) return [];
    return formedEntriesFor(system).map(({ system: snap }) => ({
      lon: snap.lon, lat: snap.lat,
      galeRadii: { ne: snap.galeRadiusNeMi, se: snap.galeRadiusSeMi, sw: snap.galeRadiusSwMi, nw: snap.galeRadiusNwMi },
      hfwRadii: {
        ne: snap.hurricaneForceRadiusNeMi, se: snap.hurricaneForceRadiusSeMi,
        sw: snap.hurricaneForceRadiusSwMi, nw: snap.hurricaneForceRadiusNwMi,
      },
    }));
  }

  // Bounds computed from track points alone have no idea how far a wide
  // gale radius actually reaches -- the Wind tab would silently clip a
  // swath's outer rings off-screen. Expand the point set fed to
  // boundsForPoints with each snapshot's four quadrant extents (reusing
  // windFieldGeometry.js's own center+bearing+distance math, the same thing
  // that draws the rings in the first place) so both tabs frame on the
  // widest of the track or the swath, never just the track.
  const QUADRANT_BEARINGS = { ne: 45, se: 135, sw: 225, nw: 315 };
  function radiusExtentPoints(snapshots) {
    const points = [];
    for (const snap of snapshots) {
      for (const [quadrant, bearing] of Object.entries(QUADRANT_BEARINGS)) {
        const miles = snap.galeRadii?.[quadrant];
        if (miles) points.push(destinationPoint({ lon: snap.lon, lat: snap.lat }, bearing, miles));
      }
    }
    return points;
  }

  // `fallbackCenter`: a not-yet-Formed system can have zero points (see
  // formedEntriesFor) -- frame the map on its live lon/lat anyway (just
  // camera framing, not a plotted position) rather than collapsing to
  // Infinity/-Infinity and producing NaN bounds.
  function boundsForPoints(points, fallbackCenter) {
    if (points.length === 0 && fallbackCenter) points = [fallbackCenter];
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
    currentEntries = system ? formedEntriesFor(system) : [];
    hidePointPopup();
    const points = pointsForSystem(selectedSystemId);
    const snapshots = snapshotsForSystem(selectedSystemId);
    const aspect = rect.width / Math.max(1, rect.height);
    const boundsPoints = [...points, ...radiusExtentPoints(snapshots)];
    const bounds = fitBoundsToAspect(boundsForPoints(boundsPoints, system && { lon: system.lon, lat: system.lat }), aspect);
    mapRenderer.render({ bounds, width: rect.width, height: rect.height, showGrid: true });
    trackHistoryRenderer.render({ points, bounds, width: rect.width, height: rect.height });
    windHistoryRenderer.render({ snapshots });
  }

  function hidePointPopup() {
    pointPopupEl.hidden = true;
  }

  function positionPointPopup(dotEl) {
    const dotRect = dotEl.getBoundingClientRect();
    const surfaceRect = chartSurfaceEl.getBoundingClientRect();
    const popupRect = pointPopupEl.getBoundingClientRect();
    let left = dotRect.left - surfaceRect.left + dotRect.width / 2 + 14;
    let top = dotRect.top - surfaceRect.top - popupRect.height / 2;
    left = Math.min(Math.max(8, left), surfaceRect.width - popupRect.width - 8);
    top = Math.min(Math.max(8, top), surfaceRect.height - popupRect.height - 8);
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
    // No confirmed position to show until Formed -- same rule as the live
    // map (pointRenderer.js's hideUnformed) and the track/wind chart above
    // (formedEntriesFor).
    if (latest.formed) rows.append(panelRow('Position', formatPosition(latest.lat, latest.lon)));

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

  function pickedSystems() {
    return systems.filter((s) => includeSystem(s, advisories));
  }

  function renderList() {
    const picked = pickedSystems();
    listEmptyEl.hidden = picked.length > 0;
    listEl.querySelectorAll('.system-card').forEach((el) => el.remove());

    for (const system of picked) {
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

    const loaded = await loadData();
    systems = loaded.systems;
    advisories = loaded.advisories;
    positionLog = loaded.positionLog;
    demoBannerEl.hidden = !loaded.usingDemoData;

    renderList();
    const first = pickedSystems()[0];
    if (first) selectSystem(first.id);
  }

  init().catch((err) => {
    console.error(err);
    document.body.insertAdjacentHTML('beforeend', `<div class="fatal-error">Failed to load: ${err.message}</div>`);
  });
}
