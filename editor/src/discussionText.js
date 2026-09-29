// Builds the plain-text content shown in the on-map discussion callout
// (see main.js's renderDiscussionCallout) -- pure text generation, no DOM,
// so it's easy to reason about and test independently of positioning.

// Exported too -- stormStats.js's own position formatting (the Ongoing
// Storm Analysis stat panel) reuses these verbatim rather than
// re-implementing the same "1 decimal place + hemisphere letter" format.
export function formatLat(lat) {
  return `${Math.abs(lat).toFixed(1)}${lat >= 0 ? 'N' : 'S'}`;
}

export function formatLon(lon) {
  return `${Math.abs(lon).toFixed(1)}${lon >= 0 ? 'E' : 'W'}`;
}

// "DD/HHMMZ" valid time, hour hours after the advisory/system's reference
// time -- mirrors NHC's own forecast-position text product format.
function formatValidTime(referenceIso, hour) {
  const t = new Date(new Date(referenceIso).getTime() + hour * 3600000);
  const dd = String(t.getUTCDate()).padStart(2, '0');
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${dd}/${hh}${mm}Z`;
}

const STATUS_SUFFIX = {
  over_water: '...OVER WATER',
  inland: '...INLAND',
  dissipated: '...DISSIPATED',
};

function hourLabel(hour) {
  return hour === 0 ? 'INIT' : `${hour}H`;
}

// One system's current position (as "hour 0") plus its forecast points, as
// an NHC-style "FORECAST POSITIONS AND MAX WINDS" block. `referenceIso` is
// the advisory's issued_at (or the system's updated_at pre-advisory) that
// forecast hours count forward from.
export function buildForecastPositionsText(system, forecastPoints, referenceIso) {
  const rows = [
    { label: hourLabel(0), hour: 0, lat: system.lat, lon: system.lon, windMph: system.windMph, status: null },
    ...[...forecastPoints]
      .sort((a, b) => a.sequence - b.sequence)
      .map((p) => ({ label: hourLabel(p.hour), hour: p.hour, lat: p.lat, lon: p.lon, windMph: p.windMph, status: p.status ?? null })),
  ];

  const labelWidth = Math.max(4, ...rows.map((r) => r.label.length));
  const lines = rows.map((r) => {
    const label = r.label.padStart(labelWidth);
    const time = formatValidTime(referenceIso, r.hour);
    if (r.status === 'dissipated') {
      return `${label}  ${time}${STATUS_SUFFIX.dissipated}`;
    }
    const lat = formatLat(r.lat).padStart(5);
    const lon = formatLon(r.lon).padStart(6);
    let windPart = '';
    if (r.windMph != null) {
      windPart = `${String(Math.round(r.windMph)).padStart(3)} MPH`;
    }
    const suffix = r.status ? STATUS_SUFFIX[r.status] : '';
    return `${label}  ${time} ${lat} ${lon}  ${windPart}${suffix}`;
  });

  return ['FORECAST POSITIONS AND MAX WINDS', '', ...lines].join('\n');
}

function fmtPct(pct) {
  return pct == null ? 'N/A' : `${pct}%`;
}

function forecasterLine(displayName, localOnly) {
  if (displayName) return `Forecaster: ${displayName}`;
  if (localOnly) return 'Forecaster: (local demo)';
  return null;
}

// Pre-classification format (Disturbance/Invest): name, free-text
// discussion, the three formation-probability windows, then a byline.
export function buildDisturbanceCalloutText(system, localOnly) {
  const lines = [
    system.displayName,
    '',
    'Discussion',
    '',
    system.discussion?.trim() || '(No discussion yet.)',
    '',
    `Chance of Extratropical development over the next 2 days...${fmtPct(system.formationProbability2dayPct)}`,
    `Chance of Extratropical development over the next 5 days...${fmtPct(system.formationProbability5dayPct)}`,
    `Chance of Extratropical development over the next 10 days...${fmtPct(system.formationProbability10dayPct)}`,
  ];
  const fLine = forecasterLine(system.discussionByDisplayName, localOnly);
  if (fLine) lines.push('', fLine);
  return lines.join('\n');
}

// Classified format: named/numbered header with the advisory number, its
// discussion text, and the forecast-positions table -- all sourced from the
// advisory's own frozen snapshot (not the system's current live data), same
// as any other read of a published advisory's data.
export function buildClassifiedCalloutText(system, advisory, localOnly) {
  if (!advisory) {
    return `${system.displayName}\n\n(No advisory published yet.)`;
  }
  const snapSystem = advisory.snapshot.system;
  const snapPoints = advisory.snapshot.forecastPoints;
  const lines = [
    `${snapSystem.displayName} Discussion (Advisory ${advisory.number})`,
    '',
    advisory.discussion?.trim() || '(No discussion text.)',
    '',
    buildForecastPositionsText(snapSystem, snapPoints, advisory.issuedAt),
  ];
  const fLine = forecasterLine(advisory.issuedByDisplayName, localOnly);
  if (fLine) lines.push('', fLine);
  return lines.join('\n');
}
