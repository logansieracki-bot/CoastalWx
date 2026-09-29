// Draws a system's full advisory history as a track: a line through every
// published advisory's snapshotted position, with a dot at each one
// colored by that advisory's own intensity category (not the system's
// current one) -- so the color itself tells the strengthening/weakening
// story over time, the same way NHC's own best-track plots do. Points are
// passed in pre-computed (see history.js's pointsForSystem) since scoring
// a snapshot uses the same intensityScore() the live map uses, just
// applied to old data instead of current.
const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

// Mirrors editor/src/pointRenderer.js's screenUnit -- 1 unit = 1 CSS pixel
// worth of geographic span, so markers stay a fixed on-screen size
// regardless of the chart's own bounds/zoom.
function screenUnit(bounds, width, height) {
  const lonPerPx = (bounds.east - bounds.west) / Math.max(1, width);
  const latPerPx = (bounds.north - bounds.south) / Math.max(1, height);
  return Math.max(lonPerPx, latPerPx);
}

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// "Draws" a segment in via the classic stroke-dasharray/dashoffset trick,
// staggered by `delayMs` so a multi-segment line still reads as one
// continuous oldest-to-newest sweep rather than every segment animating
// at once. The double rAF is required, not decorative -- a single frame
// lets the browser coalesce the initial (offset = full length) and final
// (offset = 0) style writes into one paint, skipping the transition
// entirely; the extra frame forces the starting state to actually paint
// first.
function animateDrawIn(path, delayMs) {
  if (reduceMotion()) return;
  const length = path.getTotalLength();
  path.style.strokeDasharray = String(length);
  path.style.strokeDashoffset = String(length);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      path.style.transition = `stroke-dashoffset .5s ease-out ${delayMs}ms`;
      path.style.strokeDashoffset = '0';
    });
  });
}

let gradientSeq = 0;

export function createTrackHistoryRenderer(svg) {
  const layer = el('g', { id: 'track-history-layer' });
  svg.append(layer);

  // `points`: [{lon, lat, color, label}], oldest first.
  function render({ points, bounds, width, height }) {
    layer.replaceChildren();
    if (!points.length || !bounds) return;

    const unit = screenUnit(bounds, width, height);

    // One short segment per pair of consecutive points, each stroked with
    // its own linear gradient from the earlier point's color to the
    // later one's -- "interpolates" the track's color between fixes the
    // same way NHC's own best-track plots do, instead of one flat-color
    // line. gradientUnits="userSpaceOnUse" with the segment's own raw
    // lon/-lat endpoints means the gradient direction always follows the
    // segment itself, whichever way it runs.
    if (points.length >= 2) {
      const defs = el('defs');
      layer.append(defs);
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        const gradId = `track-grad-${gradientSeq++}`;
        const gradient = el('linearGradient', {
          id: gradId, gradientUnits: 'userSpaceOnUse', x1: a.lon, y1: -a.lat, x2: b.lon, y2: -b.lat,
        });
        gradient.append(el('stop', { offset: '0%', 'stop-color': a.color }));
        gradient.append(el('stop', { offset: '100%', 'stop-color': b.color }));
        defs.append(gradient);

        const seg = el('path', { class: 'track-history-line', d: `M${a.lon},${-a.lat} L${b.lon},${-b.lat}` });
        seg.style.stroke = `url(#${gradId})`; // inline style, not the attrs helper -- must outrank the CSS class's own flat fallback stroke
        layer.append(seg);
        animateDrawIn(seg, i * 90);
      }
    }

    points.forEach((p, i) => {
      const isLast = i === points.length - 1;
      const r = unit * (isLast ? 8.5 : 5.5);
      const dot = el('circle', {
        class: `track-history-dot${isLast ? ' track-history-dot--current' : ''}`,
        cx: p.lon, cy: -p.lat, r, fill: p.color,
        'data-index': i,
      });
      if (!reduceMotion()) {
        dot.style.animation = 'history-dot-pop .45s cubic-bezier(.2,1.4,.4,1) both';
        dot.style.animationDelay = `${i * 90}ms`;
      }
      layer.append(dot);
    });
  }

  return { render };
}
