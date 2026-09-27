// Wind field envelope + drag handles for the selected system's current
// position. Adapted from an old prototype's windFieldRenderer.js, with its
// two thresholds renamed from tropical-cyclone terms (ts/hu = tropical
// storm force / hurricane force) to this app's own: 'gale' (still 34kt+,
// replacing the single galeRadiusMi field this app already had) and 'hfw'
// (hurricane-force wind, still 64kt+ -- a legitimate NWS marine-warning
// term for non-tropical systems too, so unlike "tropical storm," this one
// didn't need correcting, just carrying over as a new field this app
// didn't previously track).
import { buildWindEnvelope, destinationPoint } from './windFieldGeometry.js';
import { MILES_PER_DEGREE_LAT } from './constants.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const QUADRANT_BEARINGS = { ne: 45, se: 135, sw: 225, nw: 315 };

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function screenUnit(bounds, width, height) {
  return Math.max(
    (bounds.east - bounds.west) / Math.max(1, width),
    (bounds.north - bounds.south) / Math.max(1, height)
  );
}

function token(p) { return `${p.lon},${-p.lat}`; }

function hasAnyRadius(radii) {
  return ['ne', 'se', 'sw', 'nw'].some((q) => (Number(radii?.[q]) || 0) > 0);
}

export function windEnvelopePathData(center, radii, samples = 96) {
  // buildWindEnvelope always returns `samples` points even when every
  // quadrant is 0 (they just all collapse onto `center`), so the path
  // string itself is never empty -- callers must check hasAnyRadius
  // separately rather than relying on this string being falsy.
  if (!center || !radii || !hasAnyRadius(radii)) return '';
  const coords = buildWindEnvelope(center, radii, samples);
  if (!coords.length) return '';
  return `M${token(coords[0])}` + coords.slice(1).map((p) => `L${token(p)}`).join('') + 'Z';
}

export function windHandleCoordinates(center, radii) {
  const out = {};
  for (const [quadrant, bearing] of Object.entries(QUADRANT_BEARINGS)) {
    out[quadrant] = destinationPoint(center, bearing, Math.max(0, Number(radii?.[quadrant]) || 0));
  }
  return out;
}

// Unlike this project's other renderers, the two layers are NOT both
// self-appended here -- the fill needs to sit under the system's own
// marker (so a translucent envelope doesn't wash out the marker/label),
// but the drag handles need to sit on top of it (so a handle near the
// marker's diagonal X or its name label always wins the hit-test, not the
// marker). The caller appends fieldLayer and editorLayer separately,
// with pointRenderer's own layer created in between.
export function createWindFieldRenderer(svg) {
  const fieldLayer = el('g', { id: 'wind-field-fill-layer' });
  const editorLayer = el('g', { id: 'wind-field-editor-layer' });

  // `system` null/undefined -> nothing selected, clears and returns.
  // `activeThreshold` ('gale' | 'hfw' | null) picks which threshold's
  // handles are shown/draggable; both envelopes always render regardless.
  function render({ system, activeThreshold, bounds, width, height }) {
    fieldLayer.replaceChildren();
    editorLayer.replaceChildren();
    if (!system || !bounds) return;

    const center = { lon: system.lon, lat: system.lat };
    const galeRadii = { ne: system.galeRadiusNeMi, se: system.galeRadiusSeMi, sw: system.galeRadiusSwMi, nw: system.galeRadiusNwMi };
    const hfwRadii = {
      ne: system.hurricaneForceRadiusNeMi, se: system.hurricaneForceRadiusSeMi,
      sw: system.hurricaneForceRadiusSwMi, nw: system.hurricaneForceRadiusNwMi,
    };

    const galeD = windEnvelopePathData(center, galeRadii);
    if (galeD) fieldLayer.append(el('path', { class: 'wind-field wind-field-gale', d: galeD }));
    const hfwD = windEnvelopePathData(center, hfwRadii);
    if (hfwD) fieldLayer.append(el('path', { class: 'wind-field wind-field-hfw', d: hfwD }));

    if (activeThreshold !== 'gale' && activeThreshold !== 'hfw') return;
    const radii = activeThreshold === 'gale' ? galeRadii : hfwRadii;
    const unit = screenUnit(bounds, width, height);
    const handleRadius = unit * 6.5;
    // A zero-radius handle would otherwise sit exactly on the system's own
    // marker (destinationPoint with distance 0 returns the center itself),
    // making the four handles indistinguishable and hard to grab. Click
    // *correctness* near the marker is handled by z-order (editorLayer is
    // appended after pointRenderer -- see the comment on this factory) so
    // this offset is purely for visual/grab clarity, same reasoning as
    // spreadEditor's own handleRx minimum, just applied to all 4 bearings
    // instead of one.
    // handle sits due east, off the X's diagonals entirely.
    const minHandleMiles = unit * 22 * MILES_PER_DEGREE_LAT;
    const displayRadii = {};
    for (const quadrant of ['ne', 'se', 'sw', 'nw']) {
      displayRadii[quadrant] = Math.max(Number(radii[quadrant]) || 0, minHandleMiles);
    }
    const handles = windHandleCoordinates(center, displayRadii);

    for (const quadrant of ['ne', 'se', 'sw', 'nw']) {
      const handle = handles[quadrant];
      editorLayer.append(el('line', {
        class: 'wind-guide',
        x1: center.lon, y1: -center.lat, x2: handle.lon, y2: -handle.lat,
      }));
      editorLayer.append(el('circle', {
        class: `wind-handle wind-handle-${activeThreshold}`,
        'data-wind-handle': 'true', 'data-quadrant': quadrant,
        cx: handle.lon, cy: -handle.lat, r: handleRadius,
      }));
      // Live "Xmi" readout next to each handle, so the forecaster can see
      // the exact radius without having to judge it from the shape alone.
      const miles = Math.round(Math.max(0, Number(radii[quadrant]) || 0));
      const helper = el('text', {
        class: 'wind-handle-label',
        x: handle.lon, y: -handle.lat,
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-size': unit * 9,
      });
      helper.textContent = `${miles}mi`;
      editorLayer.append(helper);
    }
  }

  return { render, fieldLayer, editorLayer };
}
