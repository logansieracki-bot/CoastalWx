// A soft radiating ring behind every active system's marker on the public
// live map -- purely decorative "this is live" motion, kept as its own
// tiny public-only layer rather than folded into editor/src/pointRenderer.js
// (shared with the forecaster tool, where this animation would just be
// visual noise on a dense working map). Sits directly under the point
// layer in z-order -- see wiring in main.js -- so the X marker itself
// stays crisp while the ring radiates out from behind it.
import { systemColor } from '../editor/src/constants.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function screenUnit(bounds, width, height) {
  const lonPerPx = (bounds.east - bounds.west) / Math.max(1, width);
  const latPerPx = (bounds.north - bounds.south) / Math.max(1, height);
  return Math.max(lonPerPx, latPerPx);
}

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function createLivePulseRenderer(svg) {
  const layer = el('g', { id: 'live-pulse-layer' });
  svg.append(layer);

  function render({ systems, bounds, width, height }) {
    layer.replaceChildren();
    if (!bounds || reduceMotion()) return;

    const unit = screenUnit(bounds, width, height);
    const r = unit * 10;

    systems.forEach((system, i) => {
      const ring = el('circle', {
        class: 'live-pulse',
        cx: system.lon, cy: -system.lat, r,
        fill: systemColor(system),
      });
      // Five staggered offsets cycling through the animation loop so
      // markers don't all pulse in unison -- reads as more organic.
      ring.style.animationDelay = `${(i % 5) * -0.55}s`;
      layer.append(ring);
    });
  }

  return { render };
}
