// Forecast track + cone of uncertainty. Renders only the selected system's
// cone/track (not every system's, unlike annotations) -- a cone is a big,
// translucent region, and showing every system's simultaneously would
// clutter the map badly; it also means the fixed mask ids below never
// collide, since only one system's disks are ever drawn into them at once.
// If "every system's cone visible" is wanted later, the mask ids need to
// become per-system.
//
// Adapted from an old prototype's shipped technique (confirmed by its own
// test suite as the actual mechanism, not the tangent-offset ribbon
// polygon it also had lying around unused): sample the track densely, turn
// each sample into a spread-sized ellipse ("disk"), and union many
// overlapping disks via an SVG <mask> painted onto a viewport-covering
// <rect>. The outline ring comes from painting a size+pad dilated union
// white, then the normal-sized union black on top -- erasing the interior
// and leaving only a thin ring at the true boundary.
import { sampleTrack, buildConeDisks, hasLatePeriod } from './trackGeometry.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

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

function ellipseElement(disk, attrs = {}) {
  return el('ellipse', { cx: disk.cx, cy: disk.cy, rx: disk.rx, ry: disk.ry, ...attrs });
}

function boundsRect(bounds, attrs = {}) {
  return el('rect', {
    x: bounds.west, y: -bounds.north,
    width: bounds.east - bounds.west, height: bounds.north - bounds.south,
    ...attrs,
  });
}

function token(p) { return `${p.lon},${-p.lat}`; }

function trackPathData(points, samplesPerSegment) {
  const samples = sampleTrack(points, samplesPerSegment);
  if (!samples.length) return '';
  return `M${token(samples[0])}` + samples.slice(1).map((p) => `L${token(p)}`).join('');
}

export function createTrackConeRenderer(svg) {
  const layer = el('g', { id: 'track-cone-layer' });
  const defs = el('defs');
  const fullMask = el('mask', { id: 'full-cone-mask' });
  const earlyMask = el('mask', { id: 'early-cone-mask' });
  const lateOnlyMask = el('mask', { id: 'late-only-cone-mask' });
  const outlineMask = el('mask', { id: 'cone-outline-mask' });
  const earlyOutlineMask = el('mask', { id: 'early-cone-outline-mask' });
  defs.append(fullMask, earlyMask, lateOnlyMask, outlineMask, earlyOutlineMask);

  const coneGroup = el('g', { id: 'cone-layer' });
  const trackGroup = el('g', { id: 'forecast-track-layer' });
  layer.append(defs, coneGroup, trackGroup);
  svg.append(layer);

  function render({ points, bounds, width, height }) {
    fullMask.replaceChildren();
    earlyMask.replaceChildren();
    lateOnlyMask.replaceChildren();
    outlineMask.replaceChildren();
    earlyOutlineMask.replaceChildren();
    coneGroup.replaceChildren();
    trackGroup.replaceChildren();

    if (!bounds || !points || points.length === 0) return;

    const unit = screenUnit(bounds, width, height);
    const outlinePad = unit * 1.8;

    const visibleDisks = buildConeDisks(points, 36).filter((d) => d.rx > 0 && d.ry > 0);
    const earlyDisks = buildConeDisks(points, 36, { maxHour: 72 }).filter((d) => d.rx > 0 && d.ry > 0);
    const showLatePeriod = hasLatePeriod(points, 72) && earlyDisks.length > 0;

    for (const disk of visibleDisks) {
      fullMask.append(ellipseElement(disk, { fill: 'white' }));
      outlineMask.append(ellipseElement({ ...disk, rx: disk.rx + outlinePad, ry: disk.ry + outlinePad }, { fill: 'white' }));
    }
    for (const disk of earlyDisks) {
      earlyMask.append(ellipseElement(disk, { fill: 'white' }));
      earlyOutlineMask.append(ellipseElement({ ...disk, rx: disk.rx + outlinePad, ry: disk.ry + outlinePad }, { fill: 'white' }));
    }
    if (showLatePeriod) {
      for (const disk of visibleDisks) lateOnlyMask.append(ellipseElement(disk, { fill: 'white' }));
      for (const disk of earlyDisks) lateOnlyMask.append(ellipseElement(disk, { fill: 'black' }));
    }
    // Erase the original union from the dilated union, leaving only the
    // outer border ring.
    for (const disk of visibleDisks) outlineMask.append(ellipseElement(disk, { fill: 'black' }));
    for (const disk of earlyDisks) earlyOutlineMask.append(ellipseElement(disk, { fill: 'black' }));

    if (visibleDisks.length && showLatePeriod) {
      coneGroup.append(boundsRect(bounds, { class: 'forecast-cone-outline forecast-cone-outline-full', mask: 'url(#cone-outline-mask)' }));
    }
    if (showLatePeriod) {
      coneGroup.append(boundsRect(bounds, { class: 'forecast-cone cone-fill cone-day1-3', mask: 'url(#early-cone-mask)' }));
      coneGroup.append(boundsRect(bounds, { class: 'forecast-cone-late cone-day4-5', mask: 'url(#late-only-cone-mask)' }));
    } else if (visibleDisks.length) {
      coneGroup.append(boundsRect(bounds, { class: 'forecast-cone cone-fill', mask: 'url(#full-cone-mask)' }));
    }
    if (earlyDisks.length) {
      coneGroup.append(boundsRect(bounds, { class: 'forecast-cone-outline forecast-cone-outline-early', mask: 'url(#early-cone-outline-mask)' }));
    }

    if (points.length >= 2) {
      trackGroup.append(el('path', { class: 'forecast-track', d: trackPathData(points, 36) }));
    }
  }

  return { render, layer };
}
