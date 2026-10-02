// Derived stats for a single system: position/pressure formatting (used by
// the Ongoing Storm Analysis page's per-system panel -- see the "TROPICAL
// STORM HANNA"-style reference card) and a plain-data stat-card builder
// (used by advisoryImageExport.js's composited image). Pure computation,
// no DOM. Lives under editor/src/ rather than public/src/ (even though
// today only the public page consumes it) so advisoryImageExport.js, which
// the editor itself needs, can import it too -- this app's convention is
// public imports from editor, never the reverse.
import { formatLat, formatLon } from './discussionText.js';
import {
  systemColor, displayLabel, intensityScore, intensityCategoryKey, categorySymbol,
  CATEGORY_INFO, maxFormationProbabilityPct,
} from './constants.js';

export function formatPosition(lat, lon) {
  return `${formatLat(lat)} ${formatLon(lon)}`;
}

export function computeMinPressure(entries) {
  const values = entries.map(({ system }) => system.pressureMb).filter((v) => v != null);
  return values.length ? Math.min(...values) : null;
}

// White text on a dark category/probability color, dark text on a light
// one -- the palette spans from pale gray-blue through near-black purple,
// so a single fixed text color would be unreadable against roughly half of
// it. Simple perceived-luminance heuristic, not full WCAG contrast math --
// this only ever has ~11 fixed palette colors to work with, verified by
// hand against all of them rather than needing to be exact for arbitrary
// input.
export function readableTextColor(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#0a1628' : '#ffffff';
}

export function formatCountdown(targetMs) {
  const deltaMs = targetMs - Date.now();
  if (deltaMs <= 0) return 'Overdue';
  const totalMinutes = Math.round(deltaMs / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Plain-data version of the Ongoing Storm Analysis page's storm-panel card
// (see historyPage.js's renderStormPanel, which builds the same kind of
// header/hero/rows into DOM) -- for advisoryImageExport.js's canvas-drawn
// card, which has no DOM to append to. Deliberately single-snapshot, not
// history-driven: reads system.pressureMb directly (labeled "Central
// pressure") rather than routing through computeMinPressure, which would
// read oddly here -- there's no multi-advisory history in scope at the
// moment a forecaster or the public downloads one image, just the current
// system and (optionally) its latest advisory.
export function buildStatCardData(system, advisory) {
  const color = systemColor(system);
  const textColor = readableTextColor(color);
  const classified = system.classified;
  const categoryKey = classified ? intensityCategoryKey(intensityScore(system)) : null;

  let kind, secondValue;
  if (classified) {
    kind = categoryKey ? CATEGORY_INFO[categoryKey].label : 'Classified';
    secondValue = categorySymbol(categoryKey) ?? '—';
  } else {
    kind = system.stage === 'invest' ? 'Invest' : 'Disturbance';
    const maxPct = maxFormationProbabilityPct(system);
    secondValue = maxPct != null ? `${maxPct}%` : '—';
  }

  const rows = [];
  if (system.formed) rows.push({ label: 'Position', value: formatPosition(system.lat, system.lon) });
  if (system.pressureMb != null) rows.push({ label: 'Central pressure', value: `${system.pressureMb} mb` });
  if (advisory) {
    rows.push({ label: classified ? 'Last fix' : 'Last updated', value: new Date(advisory.issuedAt).toLocaleString() });
    if (classified) {
      const nextAdvisoryMs = new Date(advisory.issuedAt).getTime() + system.forecastInterval * 3600000;
      rows.push({ label: 'Next advisory', value: formatCountdown(nextAdvisoryMs) });
    }
  }

  return {
    color, textColor, name: displayLabel(system), kind,
    windMph: system.windMph ?? null,
    secondValue, secondLabel: classified ? 'Category' : 'Development chance',
    rows,
  };
}
