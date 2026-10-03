import { visibleLatitudes, visibleLongitudes, formatLatitude, formatLongitude } from './grid.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Morphological smoothing radius for the land-clip mask below, in
// degrees (same unit system as this SVG's own viewBox -- see render()
// below). A watch/warning zone clipped to the raw land geometry reads as
// jagged/"torn" for two distinct reasons -- confirmed by direct
// reproduction, both present even with NO smoothing applied (i.e. this
// is pre-existing, not something smoothing could make worse):
//  - narrow gaps (inlets, straits between close-together islands) leave
//    a zone clipped into a scatter of disconnected slivers;
//  - thin protrusions (the tip of a peninsula or barrier island crossed
//    at a shallow angle) leave spiky, star-like points along the edge.
// A plain dilate (grow the shape and leave it grown) only ever fixes the
// first case -- dilation fills gaps, but it *adds* material, so it can
// only make a protruding spike bigger, never trim it away. Fixing both
// needs a standard image-processing "smooth a binary mask" pipeline:
// closing (dilate then erode -- fills small gaps without permanently
// growing the shape) followed by opening (erode then dilate -- removes
// thin spikes without permanently shrinking it). Bounded in practice by
// MIN_LON_SPAN (viewState.js, currently 6) -- the closest this app ever
// zooms in -- so the worst-case on-screen pixel radius this produces
// stays small regardless of zoom level. Tune up if fragmented coastlines
// still clip into visible confetti/spikes, tune down if real small
// coastal features (narrow peninsulas, close-but-genuinely-separate
// islands) start getting bridged or trimmed away.
const LAND_CLIP_SMOOTH_DEG = 0.06;

function number(value) {
  const rounded = Math.round(Number(value) * 100000) / 100000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function pointToken(coord) {
  const [lon, lat] = coord;
  return `${number(lon)},${number(-lat)}`;
}

function lineToPath(coords) {
  if (!coords?.length) return '';
  let d = `M${pointToken(coords[0])}`;
  for (let i = 1; i < coords.length; i++) d += `L${pointToken(coords[i])}`;
  return d;
}

function ringToPath(coords) {
  return coords?.length ? `${lineToPath(coords)}Z` : '';
}

export function geometryToPathData(geometry) {
  if (!geometry) return '';
  switch (geometry.type) {
    case 'Polygon':
      return geometry.coordinates.map(ringToPath).join('');
    case 'MultiPolygon':
      return geometry.coordinates.flatMap(poly => poly.map(ringToPath)).join('');
    case 'LineString':
      return lineToPath(geometry.coordinates);
    case 'MultiLineString':
      return geometry.coordinates.map(lineToPath).join('');
    default:
      return '';
  }
}

export function featureCollectionToPathData(collection) {
  return collection.features.map(feature => geometryToPathData(feature.geometry)).join('');
}

function svgElement(name, attrs = {}) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

function setPath(group, className, collection) {
  if (!collection) return null;
  const path = svgElement('path', {
    class: className,
    d: featureCollectionToPathData(collection)
  });
  group.append(path);
  return path;
}

function addText(group, { x, y, text, size, anchor = 'middle', baseline = 'middle' }) {
  const el = svgElement('text', {
    class: 'grid-label',
    x, y,
    'font-size': size,
    'text-anchor': anchor,
    'dominant-baseline': baseline
  });
  el.textContent = text;
  group.append(el);
}

export function createMapRenderer(svg, geography) {
  svg.replaceChildren();
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const geographyGroup = svgElement('g', { id: 'geography' });
  const gridGroup = svgElement('g', { id: 'grid-lines' });
  const labelGroup = svgElement('g', { id: 'grid-labels' });

  const landPath = setPath(geographyGroup, 'land', geography.land);
  setPath(geographyGroup, 'lake', geography.lakes);
  setPath(geographyGroup, 'country-borders', geography.borders);
  if (geography.states) setPath(geographyGroup, 'state-borders', geography.states);

  // Land-clip mask for watchRenderer.js's zones (id "land-clip" is a fixed,
  // well-known reference, not exported -- same convention as this app's
  // other cross-file DOM contracts like the data-wind-handle attribute
  // name). A watch/warning zone spanning a geometrically complex coastal
  // stretch clips to the file's own 1500+ separate land polygons as a
  // jagged, "torn"-looking mess -- confirmed by direct reproduction, and
  // confirmed pre-existing (identical with no smoothing applied at all,
  // i.e. today's plain full-detail clip), not something only an unlucky
  // edge case hits: a coastal_flood zone drawn over an ordinary stretch
  // of the NC Outer Banks -- not an extreme case -- clips into visible
  // spikes and gaps. Simplifying each ring's own point density (tried
  // first) measurably doesn't help -- the dataset is already coarse, and
  // the jaggedness isn't excess detail on one ring, it's gaps between
  // separate nearby land fragments and thin protruding slivers where the
  // coastline is crossed at a shallow angle. See LAND_CLIP_SMOOTH_DEG's
  // own comment above for why that needs a real open+close smoothing
  // pass, not a plain dilate. That needs a <mask>, not a <clipPath>: a
  // <clipPath>'s children ignore `filter` entirely (SVG spec), but a
  // <mask>'s content renders normally, so feMorphology filters on the
  // land shape here actually take effect. The visible .land layer above
  // (landPath) is untouched -- only this mask smooths, so the map's own
  // real coastline shape never changes, only how forgiving the "is this
  // point on land" test is for a watch zone's edge. Built once here, not
  // in render() below -- land geometry is static (pan/zoom is a viewBox
  // change, not a re-walk of the geojson).
  if (landPath) {
    const defs = svgElement('defs');
    const filter = svgElement('filter', { id: 'land-clip-smooth' });
    // Closing (dilate->erode): fills narrow gaps/inlets so nearby
    // separate fragments merge into one region, without permanently
    // growing the coastline.
    filter.append(svgElement('feMorphology', { operator: 'dilate', radius: LAND_CLIP_SMOOTH_DEG, in: 'SourceGraphic', result: 'closed-grow' }));
    filter.append(svgElement('feMorphology', { operator: 'erode', radius: LAND_CLIP_SMOOTH_DEG, in: 'closed-grow', result: 'closed' }));
    // Opening (erode->dilate): trims thin spikes/protrusions, without
    // permanently shrinking the coastline.
    filter.append(svgElement('feMorphology', { operator: 'erode', radius: LAND_CLIP_SMOOTH_DEG, in: 'closed', result: 'opened-shrink' }));
    filter.append(svgElement('feMorphology', { operator: 'dilate', radius: LAND_CLIP_SMOOTH_DEG, in: 'opened-shrink' }));
    defs.append(filter);
    const mask = svgElement('mask', { id: 'land-clip' });
    mask.append(svgElement('path', {
      d: featureCollectionToPathData(geography.land),
      fill: 'white',
      filter: 'url(#land-clip-smooth)',
    }));
    defs.append(mask);
    svg.append(defs);
  }

  svg.append(geographyGroup, gridGroup, labelGroup);

  let last = null;

  function render({ bounds, width, height, showGrid = true }) {
    const lonSpan = bounds.east - bounds.west;
    const latSpan = bounds.north - bounds.south;
    svg.setAttribute('viewBox', `${bounds.west} ${-bounds.north} ${lonSpan} ${latSpan}`);

    gridGroup.replaceChildren();
    labelGroup.replaceChildren();

    if (showGrid) {
      const pxToLon = lonSpan / Math.max(width, 1);
      const pxToLat = latSpan / Math.max(height, 1);
      const fontSize = Math.max(pxToLon, pxToLat) * 12;
      const xPad = pxToLon * 8;
      const yPad = pxToLat * 13;

      const leftInset = bounds.west + fontSize * 1.9;
      const rightInset = bounds.east - fontSize * 1.9;
      const topInset = -bounds.north + fontSize * 0.72;
      const bottomInset = -bounds.south - fontSize * 0.72;

      for (const lon of visibleLongitudes(bounds)) {
        gridGroup.append(svgElement('line', { class: 'grid-line', x1: lon, y1: -bounds.north, x2: lon, y2: -bounds.south }));
        addText(labelGroup, { x: Math.max(leftInset, Math.min(rightInset, lon)), y: -bounds.south - yPad, text: formatLongitude(lon), size: fontSize, baseline: 'hanging' });
      }
      for (const lat of visibleLatitudes(bounds)) {
        gridGroup.append(svgElement('line', { class: 'grid-line', x1: bounds.west, y1: -lat, x2: bounds.east, y2: -lat }));
        addText(labelGroup, { x: bounds.west + xPad, y: Math.max(topInset, Math.min(bottomInset, -lat)), text: formatLatitude(lat), size: fontSize, anchor: 'start' });
      }
    }

    last = { bounds: { ...bounds }, width, height, showGrid };
    return last;
  }

  return { render, getLastRender: () => last };
}
