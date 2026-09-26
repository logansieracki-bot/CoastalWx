import { systemColor, displayLabel } from './constants.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

// Screen-constant scale: 1 unit = 1 CSS pixel worth of geographic span, so
// markers stay a fixed on-screen size regardless of zoom level.
function screenUnit(bounds, width, height) {
  const lonPerPx = (bounds.east - bounds.west) / Math.max(1, width);
  const latPerPx = (bounds.north - bounds.south) / Math.max(1, height);
  return Math.max(lonPerPx, latPerPx);
}

export function createPointRenderer(svg) {
  const layer = el('g', { id: 'system-point-layer' });
  svg.append(layer);

  function render({ systems, selectedId, bounds, width, height }) {
    layer.replaceChildren();
    const unit = screenUnit(bounds, width, height);
    const arm = unit * 9;
    const ringRadius = unit * 16;
    const labelFont = unit * 11.5;
    const labelDy = unit * 20;

    for (const system of systems) {
      const isSelected = system.id === selectedId;
      const color = systemColor(system);

      const group = el('g', {
        class: `system-point${isSelected ? ' selected' : ''}`,
        'data-system-id': system.id,
        transform: `translate(${system.lon} ${-system.lat})`
      });

      if (isSelected) {
        group.append(el('circle', { class: 'point-selection-ring', cx: 0, cy: 0, r: ringRadius }));
      }

      // X marker built from stroked lines (not a stroked text glyph, which
      // spikes badly at the crossing point when stroke and glyph size are
      // close in scale): a wide black line underneath, a narrower colored
      // line on top, both non-scaling so they stay a constant screen size.
      const diag1 = [-arm, -arm, arm, arm];
      const diag2 = [-arm, arm, arm, -arm];
      for (const [x1, y1, x2, y2] of [diag1, diag2]) {
        group.append(el('line', { class: 'point-x-outline', x1, y1, x2, y2 }));
      }
      for (const [x1, y1, x2, y2] of [diag1, diag2]) {
        group.append(el('line', { class: 'point-x-fill', x1, y1, x2, y2, stroke: color }));
      }

      const label = el('text', {
        class: 'point-label',
        x: 0, y: labelDy,
        'font-size': labelFont,
        'text-anchor': 'middle'
      });
      label.textContent = displayLabel(system);
      group.append(label);

      layer.append(group);
    }
  }

  return { render, layer };
}
