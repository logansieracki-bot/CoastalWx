// Automatic/manual/override forecast-hour scheduling for a system's track
// points. Adapted from an old prototype's stormState.js (hourMode/
// hourOverride/forecastInterval/recomputeForecastHours), simplified since
// this app never mixes a synthetic "current" point into the points array
// being scheduled (unlike the source, where points[0] always needed special
// casing) -- every point passed in here is a real, hour>0 forecast point.
//
// Each point has an hourMode:
//   'auto'     -- hour is the next open slot, `forecastInterval` after the
//                 previous point's hour (skipping past anything already
//                 taken by an earlier manual/override point).
//   'manual'   -- hour is whatever the forecaster typed; later auto points
//                 continue stepping forward from it.
//   'override' -- hour is the previous point's hour plus a one-off interval
//                 (hourOverride) instead of the system's default interval,
//                 for a single wider/narrower gap without changing every
//                 other point.
export const VALID_INTERVALS = [6, 12, 24];

function validInterval(value, fallback = 12) {
  const n = Number(value);
  return VALID_INTERVALS.includes(n) ? n : fallback;
}

// The hour a brand-new auto point would land on, given the points that
// exist before it's added (used only to give a new point a sane initial
// hour before it exists to run through recomputeForecastHours itself).
export function nextForecastHour(points, interval) {
  const step = validInterval(interval);
  const automaticCount = points.filter((p) => (p.hourMode ?? 'auto') === 'auto').length;
  return (automaticCount + 1) * step;
}

// Recomputes every point's hour in sequence order. Returns a new array
// (does not mutate `points`) -- callers diff old vs. new to see which
// points actually changed and only PATCH those.
export function recomputeForecastHours(points, interval) {
  const step = validInterval(interval);
  let autoSlot = 0;
  let lastHour = 0;
  return points.map((point) => {
    const mode = ['auto', 'manual', 'override'].includes(point.hourMode) ? point.hourMode : 'auto';
    if (mode === 'manual') {
      const hour = Math.max(0, Number(point.hour) || 0);
      lastHour = hour;
      return { ...point, hourMode: 'manual', hourOverride: null, hour };
    }
    if (mode === 'override') {
      const gapStep = validInterval(point.hourOverride, step);
      const hour = lastHour + gapStep;
      lastHour = hour;
      return { ...point, hourMode: 'override', hourOverride: gapStep, hour };
    }
    do {
      autoSlot += 1;
    } while (autoSlot * step <= lastHour);
    const hour = autoSlot * step;
    lastHour = hour;
    return { ...point, hourMode: 'auto', hourOverride: null, hour };
  });
}
