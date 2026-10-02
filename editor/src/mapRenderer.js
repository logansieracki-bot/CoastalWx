import { visibleLatitudes, visibleLongitudes, formatLatitude, formatLongitude } from './grid.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

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
  // name). Reuses landPath's own already-computed `d` rather than re-
  // deriving it from geography.land a second time, which would redo the
  // expensive path-string generation over 1500+ land polygons. Built once
  // here, not in render() below -- land geometry is static (pan/zoom is a
  // viewBox change, not a re-walk of the geojson), same as landPath itself.
  if (landPath) {
    const defs = svgElement('defs');
    const clipPath = svgElement('clipPath', { id: 'land-clip' });
    clipPath.append(svgElement('path', { d: landPath.getAttribute('d') }));
    defs.append(clipPath);
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
