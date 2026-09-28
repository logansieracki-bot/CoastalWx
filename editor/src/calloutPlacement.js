// Picks a position for a map callout box that avoids covering other things
// already on the map -- other systems' markers/labels, a forecast cone,
// a wind field, a shape/arrow, whatever's there. Works against actual
// rendered bounding boxes (see collectObstacleRects in main.js), not any
// hand-modeled assumption about a particular element's geometry, so it
// holds up regardless of that element's own shape, size, or position.

function rectOverlapArea(a, b) {
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return w * h;
}

function totalOverlap(rect, obstacles) {
  let sum = 0;
  for (const ob of obstacles) sum += rectOverlapArea(rect, ob);
  return sum;
}

function clampRect(left, top, width, height, mapWidth, mapHeight, margin) {
  return {
    left: Math.max(margin, Math.min(left, mapWidth - width - margin)),
    top: Math.max(margin, Math.min(top, mapHeight - height - margin)),
  };
}

// Order matters only as a tie-breaker (first found wins at a given
// distance) -- right/left/below/above before the diagonals, since those
// read most naturally as "next to" the marker.
const DIRECTIONS = [
  { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
  { dx: 1, dy: 1 }, { dx: -1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: -1 },
];

function candidateRect(direction, dist, markerX, markerY, width, height) {
  const { dx, dy } = direction;
  let left, top;
  if (dx !== 0 && dy === 0) {
    left = dx > 0 ? markerX + dist : markerX - dist - width;
    top = markerY - height / 2;
  } else if (dy !== 0 && dx === 0) {
    top = dy > 0 ? markerY + dist : markerY - dist - height;
    left = markerX - width / 2;
  } else {
    const d = dist * 0.75; // diagonals: same distance "as the crow flies", not per-axis
    left = dx > 0 ? markerX + d : markerX - d - width;
    top = dy > 0 ? markerY + d : markerY - d - height;
  }
  return { left, top };
}

// `obstacles`: array of {left, top, right, bottom} rects, in the same
// pixel space as markerX/markerY/mapWidth/mapHeight (map-container-
// relative, not viewport-relative -- see main.js's collectObstacleRects).
export function placeCallout({ markerX, markerY, width, height, mapWidth, mapHeight, obstacles, margin = 12, gap = 40 }) {
  let best = null; // least-bad candidate seen so far, in case nothing is fully clear

  // Pass 1: radiate outward from the marker -- cheap, and keeps the
  // callout visually "attached" to its subject whenever there's room.
  for (const dist of [gap, gap * 2, gap * 3.5, gap * 6, gap * 10]) {
    for (const direction of DIRECTIONS) {
      const raw = candidateRect(direction, dist, markerX, markerY, width, height);
      const { left, top } = clampRect(raw.left, raw.top, width, height, mapWidth, mapHeight, margin);
      const rect = { left, top, right: left + width, bottom: top + height };
      const overlap = totalOverlap(rect, obstacles);
      if (overlap === 0) return { left, top };
      if (!best || overlap < best.overlap) best = { left, top, overlap };
    }
  }

  // Pass 2: nothing near the marker was clear (a very crowded or heavily
  // zoomed-in view, e.g. a wind field radius filling most of the screen)
  // -- scan the whole visible map on a coarse grid instead, so a clear
  // spot farther away still beats a nearby overlapping one.
  const cols = 8;
  const rows = 6;
  const spanW = Math.max(0, mapWidth - width - margin * 2);
  const spanH = Math.max(0, mapHeight - height - margin * 2);
  let bestClear = null;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const left = margin + (spanW * c) / (cols - 1);
      const top = margin + (spanH * r) / (rows - 1);
      const rect = { left, top, right: left + width, bottom: top + height };
      const overlap = totalOverlap(rect, obstacles);
      if (overlap === 0) {
        const dist = Math.hypot(left + width / 2 - markerX, top + height / 2 - markerY);
        if (!bestClear || dist < bestClear.dist) bestClear = { left, top, dist };
      } else if (!best || overlap < best.overlap) {
        best = { left, top, overlap };
      }
    }
  }
  if (bestClear) return { left: bestClear.left, top: bestClear.top };

  // Pathological case: obstacles cover the entire visible map -- nothing
  // to do but take whatever overlapped least.
  return best ? { left: best.left, top: best.top } : clampRect(markerX + gap, markerY - height / 2, width, height, mapWidth, mapHeight, margin);
}
