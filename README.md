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

## Deployment

The **editor** auto-deploys to GitHub Pages via
`.github/workflows/deploy-pages.yml` on every push to this branch, and is
what you get at the site root. The earlier sample-data public forecast page
still deploys too, just at `/forecast/`, so it isn't lost.

Pages only serves static files -- no server, no database -- so the deployed
editor can't reach the real backend described below. It detects that at
startup and falls back to saving in your browser's own `localStorage`
instead, with an honest banner saying so; nothing about the editor is
broken or non-functional there, it's just local-only-per-browser until
real hosting exists. Run it with a real backend (see below) for shared,
durable storage.

One manual, one-time step this repo needs (not something the workflow can
do on its own): in **Settings -> Pages -> Build and deployment**, set
**Source** to **GitHub Actions**.

## The editor (`/editor` + `/server`)

`index.html` at the repo root is the public-facing page above, still running
on sample data. `/editor` and `/server` are the start of the actual
forecaster tool that will publish to it: a pannable/zoomable map (top
toolbar, left data panel, map filling the rest) backed by a real database,
where a "system" starts life as a **Disturbance** — a probability-colored
X you place on the map — and will progress through Invest → ETD → named
ETS → Category 1-5 as later milestones add the rest of the lifecycle.

Disturbances (place, drag, edit formation probability/pressure/wind) and
per-system shapes/arrows (freeform smoothed shape and arrow annotations,
each owned by a system, editable vertex-by-vertex, always visible when
their system isn't selected) are both in place now. No cone, the
Invest/ETD/ETS promotion ladder, watches/warnings, or auth yet — those
land in later milestones on top of this same foundation.

To run it:

```
cd server
npm install
npm start
```

Then open `http://localhost:3000` — the server serves the editor's static
files and its JSON API (`/api/systems`) from one process, so there's no
separate dev server or CORS to think about. Data lives in a local SQLite
file (`server/data/`, gitignored) via Node's built-in `node:sqlite` — no
external database to install for development. Production hosting (a real
Postgres or similar, plus auth so the editor isn't publicly writable) is a
later, separate decision.

The map geometry (`editor/assets/*.geojson`) and the pan/zoom/rendering
approach are adapted from an earlier prototype of this same idea, cropped
down to the Atlantic/US basin to keep the repo small.

## Disclaimer

This is an independent hobby project, not affiliated with NOAA, the National
Weather Service, or the National Hurricane Center. For real winter weather
watches, warnings, and forecasts, use your local NWS office at
[weather.gov](https://www.weather.gov).
