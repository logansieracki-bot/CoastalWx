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

// "Draws" the line in from oldest to newest point via the classic
// stroke-dasharray/dashoffset trick, rather than appearing all at once.
// The double rAF is required, not decorative -- a single frame lets the
// browser coalesce the initial (offset = full length) and final
// (offset = 0) style writes into one paint, skipping the transition
// entirely; the extra frame forces the starting state to actually paint
// first.
function animateDrawIn(path) {
  if (reduceMotion()) return;
  const length = path.getTotalLength();
  path.style.strokeDasharray = String(length);
  path.style.strokeDashoffset = String(length);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      path.style.transition = 'stroke-dashoffset 1.1s ease-out';
      path.style.strokeDashoffset = '0';
    });
  });
}

export function createTrackHistoryRenderer(svg) {
  const layer = el('g', { id: 'track-history-layer' });
  svg.append(layer);

  // `points`: [{lon, lat, color, label}], oldest first.
  function render({ points, bounds, width, height }) {
    layer.replaceChildren();
    if (!points.length || !bounds) return;

    const unit = screenUnit(bounds, width, height);

    if (points.length >= 2) {
      const d = `M${points.map((p) => `${p.lon},${-p.lat}`).join(' L')}`;
      const path = el('path', { class: 'track-history-line', d });
      layer.append(path);
      animateDrawIn(path);
    }

    points.forEach((p, i) => {
      const isLast = i === points.length - 1;
      const r = unit * (isLast ? 8.5 : 5.5);
      const dot = el('circle', {
        class: `track-history-dot${isLast ? ' track-history-dot--current' : ''}`,
        cx: p.lon, cy: -p.lat, r, fill: p.color,
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
