// Ongoing Storm Analysis: an automatic, no-manual-entry archive built
// entirely from advisories already published through the normal editor
// workflow. Every advisory is an immutable snapshot (see
// server/src/advisories.js) of a system's position/intensity at the
// moment it was issued -- exactly the raw material a track/intensity
// history needs, with nothing extra to author. All the actual chart/
// stat-panel/popup rendering lives in historyPage.js, shared with
// public/src/past.js -- this file only supplies this page's own data
// source (active, non-archived systems) and demo fallback.
import { createHistoryPage } from './historyPage.js';

// A short, several-advisory demo history (one storm, strengthening then
// weakening) so this page still demonstrates itself with no backend
// reachable -- same spirit as public/src/main.js's own demo fallback, but
// this page needs a real *sequence* of advisories to have anything to
// show, so it isn't the same dataset.
const DEMO_SYSTEM = {
  id: 'demo-h1', season: 2025, seasonLabel: '2025-26', sequenceNumber: 4,
  name: 'Reyes', displayName: 'Reyes', classified: true, forecastInterval: 12,
};
// Per-quadrant gale radii (avg matches the old single galeRadiusMi figure
// exactly, kept alongside it since intensityScore() still takes the
// averaged number) plus hurricane-force radii once windMph crosses the
// 64kt/~74mph threshold -- real advisory snapshots carry both shapes
// (see systems.js's toApi()), so the demo data should too, or the Wind
// History tab would have nothing to draw for it.
const DEMO_SNAPSHOTS = [
  { lon: -72, lat: 24, windMph: 45, gustMph: 60, pressureMb: 1001, galeRadiusMi: 90,
    galeRadiusNeMi: 100, galeRadiusSeMi: 90, galeRadiusSwMi: 70, galeRadiusNwMi: 100 },
  { lon: -70, lat: 27, windMph: 60, gustMph: 78, pressureMb: 992, galeRadiusMi: 130,
    galeRadiusNeMi: 150, galeRadiusSeMi: 130, galeRadiusSwMi: 100, galeRadiusNwMi: 140 },
  { lon: -68, lat: 30.5, windMph: 80, gustMph: 100, pressureMb: 978, galeRadiusMi: 170,
    galeRadiusNeMi: 190, galeRadiusSeMi: 170, galeRadiusSwMi: 140, galeRadiusNwMi: 180,
    hurricaneForceRadiusNeMi: 60, hurricaneForceRadiusSeMi: 50, hurricaneForceRadiusSwMi: 35, hurricaneForceRadiusNwMi: 55 },
  { lon: -65.5, lat: 34, windMph: 95, gustMph: 118, pressureMb: 965, galeRadiusMi: 190,
    galeRadiusNeMi: 210, galeRadiusSeMi: 190, galeRadiusSwMi: 160, galeRadiusNwMi: 200,
    hurricaneForceRadiusNeMi: 80, hurricaneForceRadiusSeMi: 70, hurricaneForceRadiusSwMi: 50, hurricaneForceRadiusNwMi: 75 },
  { lon: -61, lat: 38, windMph: 85, gustMph: 105, pressureMb: 972, galeRadiusMi: 180,
    galeRadiusNeMi: 200, galeRadiusSeMi: 180, galeRadiusSwMi: 150, galeRadiusNwMi: 190,
    hurricaneForceRadiusNeMi: 65, hurricaneForceRadiusSeMi: 55, hurricaneForceRadiusSwMi: 40, hurricaneForceRadiusNwMi: 60 },
  { lon: -55, lat: 42.5, windMph: 60, gustMph: 78, pressureMb: 988, galeRadiusMi: 140,
    galeRadiusNeMi: 150, galeRadiusSeMi: 140, galeRadiusSwMi: 120, galeRadiusNwMi: 150 },
];
const DEMO_ADVISORIES = DEMO_SNAPSHOTS.map((snap, i) => ({
  id: `demo-h-adv-${i + 1}`, systemId: DEMO_SYSTEM.id, number: i + 1,
  issuedAt: new Date(Date.now() - (DEMO_SNAPSHOTS.length - i) * 6 * 60 * 60 * 1000).toISOString(),
  snapshot: { system: { ...DEMO_SYSTEM, ...snap }, forecastPoints: [] },
}));

// A currently-watched Invest with zero advisories (advisories require
// classification, and an Invest by definition isn't classified yet) --
// demonstrates that the history/ongoing-analysis list also carries active
// pre-classification systems, not just fully-advisoried ones.
const DEMO_INVEST = {
  id: 'demo-h2', season: 2025, seasonLabel: '2025-26', sequenceNumber: 7,
  name: null, displayName: 'Invest 7', stage: 'invest', classified: false, formed: true,
  lon: -48, lat: 21,
  formationProbability2dayPct: 20, formationProbability5dayPct: 60, formationProbability10dayPct: 80,
  windMph: null, gustMph: null, pressureMb: null,
  galeRadiusNeMi: 70, galeRadiusSeMi: 60, galeRadiusSwMi: 45, galeRadiusNwMi: 65,
  hurricaneForceRadiusNeMi: null, hurricaneForceRadiusSeMi: null, hurricaneForceRadiusSwMi: null, hurricaneForceRadiusNwMi: null,
  updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
};
// system_position_log rows captured as this same Invest moved over the
// past ~20 hours -- demonstrates that an Invest (no advisories, so no
// server/src/advisories.js snapshots exist for it) still builds up a real
// multi-point track/wind history from the automatic position log alone.
// The last entry intentionally matches DEMO_INVEST's own current fields.
const NO_GALE_RADII = { galeRadiusNeMi: null, galeRadiusSeMi: null, galeRadiusSwMi: null, galeRadiusNwMi: null };
const DEMO_INVEST_LOG = [
  { lon: -54, lat: 17, formationProbability2dayPct: 10, formationProbability5dayPct: 30, formationProbability10dayPct: 50, ...NO_GALE_RADII },
  { lon: -52, lat: 18.5, formationProbability2dayPct: 15, formationProbability5dayPct: 45, formationProbability10dayPct: 65, ...NO_GALE_RADII },
  { lon: -50, lat: 19.5, formationProbability2dayPct: 20, formationProbability5dayPct: 55, formationProbability10dayPct: 75,
    galeRadiusNeMi: 60, galeRadiusSeMi: 50, galeRadiusSwMi: 40, galeRadiusNwMi: 55 },
  { lon: -48, lat: 21, formationProbability2dayPct: 20, formationProbability5dayPct: 60, formationProbability10dayPct: 80,
    galeRadiusNeMi: 70, galeRadiusSeMi: 60, galeRadiusSwMi: 45, galeRadiusNwMi: 65 },
];
const DEMO_POSITION_LOG = DEMO_INVEST_LOG.map((snap, i) => ({
  id: `demo-h-log-${i + 1}`, systemId: DEMO_INVEST.id,
  recordedAt: new Date(Date.now() - (DEMO_INVEST_LOG.length - i) * 5 * 60 * 60 * 1000).toISOString(),
  snapshot: { ...DEMO_INVEST, ...snap },
}));

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

createHistoryPage({
  async loadData() {
    try {
      const [systems, advisories, positionLog] = await Promise.all([
        fetchJson('api/systems'), fetchJson('api/advisories'), fetchJson('api/position-log'),
      ]);
      return { systems, advisories, positionLog, usingDemoData: false };
    } catch {
      return {
        systems: [DEMO_SYSTEM, DEMO_INVEST], advisories: DEMO_ADVISORIES,
        positionLog: DEMO_POSITION_LOG, usingDemoData: true,
      };
    }
  },
  // Systems with at least one published advisory (a full snapshot history
  // -- publishing is allowed at any stage, see server/src/advisories.js),
  // plus any currently-active Invest that hasn't published one yet -- still
  // an ongoing system worth tracking here, not just the fully-advisoried,
  // named cyclones. A plain Disturbance with zero advisories stays off this
  // list. GET /api/systems already excludes archived systems server-side,
  // so nothing extra is needed here to keep those off this page.
  includeSystem: (system, advisories) =>
    advisories.some((a) => a.systemId === system.id) || system.stage === 'invest',
});
