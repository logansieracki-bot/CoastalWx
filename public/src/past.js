// Past Storm Analysis: the same chart/stat-panel/popup UI as Ongoing
// Storm Analysis (public/src/history.js), but sourced from archived
// systems instead of active ones -- see server/src/systems.js's
// GET /systems/archived. Archiving (the editor's "Delete" button, see
// server/src/systems.js's DELETE /systems/:id) is a soft delete: the
// system stops appearing on the live map/editor, but its advisories,
// forecast points, annotations, watches, and position log all survive
// untouched (nothing about them is archive-specific -- they're the exact
// same GET /advisories and GET /position-log rows Ongoing Storm Analysis
// itself reads), so this page can show its full track/intensity history
// exactly as if it were still active. All the actual rendering lives in
// historyPage.js, shared between both pages.
import { createHistoryPage } from './historyPage.js';
import { initTopbarNav } from './topbarNav.js';

initTopbarNav();

// A single small demo fixture (one classified, now-archived storm, a
// handful of advisories) so this page still demonstrates itself with no
// backend reachable -- same spirit as history.js's own demo data, kept
// deliberately smaller since this page doesn't need to demonstrate the
// Invest/position-log path too (history.js's demo already covers that).
const DEMO_SYSTEM = {
  id: 'demo-p1', season: 2024, seasonLabel: '2024-25', sequenceNumber: 9,
  name: 'Corwin', displayName: 'Corwin', classified: true, forecastInterval: 12,
  archivedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
};
const DEMO_SNAPSHOTS = [
  { lon: -58, lat: 22, windMph: 50, gustMph: 65, pressureMb: 998, galeRadiusMi: 100,
    galeRadiusNeMi: 110, galeRadiusSeMi: 100, galeRadiusSwMi: 80, galeRadiusNwMi: 105 },
  { lon: -56, lat: 25.5, windMph: 70, gustMph: 90, pressureMb: 985, galeRadiusMi: 140,
    galeRadiusNeMi: 160, galeRadiusSeMi: 140, galeRadiusSwMi: 110, galeRadiusNwMi: 150 },
  { lon: -53, lat: 29, windMph: 55, gustMph: 72, pressureMb: 993, galeRadiusMi: 110,
    galeRadiusNeMi: 120, galeRadiusSeMi: 110, galeRadiusSwMi: 90, galeRadiusNwMi: 115 },
];
const DEMO_ADVISORIES = DEMO_SNAPSHOTS.map((snap, i) => ({
  id: `demo-p-adv-${i + 1}`, systemId: DEMO_SYSTEM.id, number: i + 1,
  issuedAt: new Date(Date.now() - (21 - i) * 24 * 60 * 60 * 1000).toISOString(),
  snapshot: { system: { ...DEMO_SYSTEM, ...snap }, forecastPoints: [] },
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
        fetchJson('api/systems/archived'), fetchJson('api/advisories'), fetchJson('api/position-log'),
      ]);
      return { systems, advisories, positionLog, usingDemoData: false };
    } catch {
      return {
        systems: [DEMO_SYSTEM], advisories: DEMO_ADVISORIES,
        positionLog: [], usingDemoData: true,
      };
    }
  },
  // GET /api/systems/archived is already scoped to exactly the systems
  // this page should show -- unlike Ongoing Storm Analysis, there's no
  // further "does this one have enough history to be worth listing" rule
  // to apply here.
  includeSystem: () => true,
});
