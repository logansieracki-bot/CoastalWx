# NorEASterCaster

An easy-to-open, single-file forecast page for Nor'easters and coastal lows,
styled after the National Hurricane Center's advisory pages: a cone of
uncertainty, an advisory stat line (pressure, wind, movement), key messages,
a forecast track table, regional impact breakdowns, a watches/warnings list,
and a plain-language forecast discussion.

## Using it

Open `index.html` in any browser — there's no build step and no external
dependencies (no CDN scripts, no map tiles, no network calls). Everything,
including the coastline map, is plain HTML/CSS/SVG/JS in that one file.

Right now it's showing **sample data for a fictional storm** ("Winter Storm
Orion"), clearly marked as demo content in the page itself.

## Wiring up real data

Everything on the page is driven by a handful of JS objects near the top of
the `<script>` block in `index.html`:

- **`TRACK`** — an array of past/current/forecast fixes (`lon`, `lat`,
  `p` central pressure in mb, `w` sustained wind in mph, `kind`). The map,
  the cone, the stat tiles (pressure trend, movement, bombogenesis check),
  and the track table all derive from this one array — edit it and
  everything recomputes.
- **`STORM`** — name, advisory number, issue time, headline status.
- **`KEY_MESSAGES`**, **`IMPACTS`**, **`WATCHES`**, **`DISCUSSION`** — the
  bulleted messages, regional snow/wind/flooding/ice breakdown, the
  watches & warnings list, and the forecast-discussion text block.

To go live, the most realistic next step is a small fetch step that pulls
from a public feed and reshapes it into this same `TRACK`/`STORM` shape —
for example:

- NWS API (`api.weather.gov`) for active alerts/zones to populate `WATCHES`.
- NOAA/NWS Weather Prediction Center (WPC) surface analyses for the low's
  position and central pressure, to populate `TRACK`.
- A model's bulletin (e.g. GFS/ECMWF-derived text products) for the
  forecast discussion.

That's a separate, real-data-source decision (which feed, how often to
refresh, whether it needs a small backend to avoid CORS issues calling
those APIs directly from a static page) — the current file is intentionally
just the front end, with mock data standing in until that's decided.

## Map

The coastline (NC to Atlantic Canada) is a hand-simplified schematic, not a
survey-accurate basemap — it's plain SVG paths with no map tiles or
geographic data files, so the page stays a single dependency-free file. The
lon/lat → pixel projection is a small function in the script, so real
coordinates just work.

## Disclaimer

This is an independent hobby project, not affiliated with NOAA, the National
Weather Service, or the National Hurricane Center. For real winter weather
watches, warnings, and forecasts, use your local NWS office at
[weather.gov](https://www.weather.gov).
