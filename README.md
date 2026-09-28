# CoastalWx

**CoastalWx** is the name for this Nor'easter/coastal-low forecasting
tool -- both the product (public site, forecaster editor) and this
repository itself (formerly NorEASterCaster). Renaming the GitHub repo
also moves its GitHub Pages URL to
`https://<owner>.github.io/CoastalWx/` (a project Pages site's URL is
always derived from the repo name) -- update any bookmarks/links
pointing at the old `.../NorEASterCaster/` URL.

This repo started as an easy-to-open, single-file forecast page for
Nor'easters and coastal lows, styled after the National Hurricane Center's
advisory pages: a cone of uncertainty, an advisory stat line (pressure,
wind, movement), key messages, a forecast track table, regional impact
breakdowns, a watches/warnings list, and a plain-language forecast
discussion. That original page still exists (see below) but is no longer
the main thing this repo builds -- see **The editor** and **Public site**
further down for the real, live tool.

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

Two separate, independent deployments exist side by side:

- **GitHub Pages** (`.github/workflows/deploy-pages.yml`, every push to
  this branch): a static-only mirror of the real site's own routing --
  the **public page** at the root, the **editor** at `/editor`, and the
  earlier sample-data forecast page still at `/forecast/`. Pages serves
  static files only -- no server, no database, no `/api` -- so both
  fall back gracefully instead of breaking:
  - The public page shows clearly-labeled sample data (a "DEMO MODE"
    banner) instead of a blank map.
  - The editor falls back to saving in your browser's own `localStorage`,
    with its own honest banner -- and skips the login gate entirely
    (there's no real backend to hold accounts here, so the editor is
    directly usable rather than permanently locked out).

  One manual, one-time step this repo needs (not something the workflow
  can do on its own): in **Settings -> Pages -> Build and deployment**,
  set **Source** to **GitHub Actions**.

- **Railway** (`railway.json`, connected to this repo for auto-deploy on
  push): the real, hosted, multi-user version, backed by the same
  `/server` + SQLite described below, on a persistent volume. This is
  where real forecaster accounts, storm naming, and advisories actually
  live. Requires `server/package.json`'s `engines.node` to resolve to
  Node 22+ (for `node:sqlite`), a mounted volume with
  `NOREASTERCASTER_DB` pointed at it, and an Owner account provisioned
  once via `server/scripts/create-user.js` (see below).

## The editor (`/editor` + `/server`)

`index.html` at the repo root is the original sample-data page from
earlier in this project — it's what GitHub Pages still serves at
`/forecast/` (see Deployment above), superseded everywhere else by the
real `/public` page described in **Public site**. `/editor` and `/server`
are the actual forecaster tool: a pannable/zoomable map (top toolbar, left
data panel, map filling the rest) backed by a real database, where a
"system" starts life as a **Disturbance** — a probability-colored X you
place on the map — and progresses through Invest → Formed → Classified
(with an intensity category, and an automatically assigned storm name).

Nothing of the editor (map, toolbar, sidebar) is visible until you're
logged in — a full-screen sign-in page covers all of it first. The one
exception is local-only mode (no backend reachable, e.g. the GitHub Pages
demo): there's no real account system to sign into there at all, so the
gate is skipped and the editor works directly, same as it always has.

Disturbances (place, drag, edit 2/5/10-day formation probability, pressure,
and wind) and per-system shapes/arrows (freeform smoothed shape and arrow
annotations, each owned by a system, editable vertex-by-vertex, always
visible when their system isn't selected) are both in place now. A
Disturbance can be promoted to an Invest (Investigate button, with a
confirmation), toggled Formed/Not Formed (whether it currently has a
physically-existing closed circulation), and — once investigated, formed,
and given wind/gust/gale-radius/pressure readings — Classified as an
extratropical cyclone. Classifying computes an intensity category (from
Extratropical Depression through the in-between Extratropical Storm tier
up to Category 5) from a calculated score (not wind speed alone, since
these storms' impact depends heavily on how large they are), via a live
built-in calculator right on the selected-system panel; an in-app
reference explains the formula and the criteria for what counts as a
trackable extratropical cyclone at all. A
system's marker, sidebar dot, and every shape/arrow it owns all share one
color — the intensity category color once classified, otherwise whichever
of its three probability windows is currently highest.

Investigate requires the system already be Formed, and cones are for
classified systems only: once a system is Classified, its shapes/arrows
are hidden (the rows aren't deleted, just no longer shown or drawable)
and its forecast track takes over as its visual representation. Place
forecast points (Add Forecast Point button) at increasing lead-time
hours, each with an editable forecast hour, forecast sustained wind, and
cone "spread" (radius, in miles) — either typed in the sidebar or set by
dragging a handle right on the map, next to the selected point. The map
draws an NHC-style cone of uncertainty and track line through the
system's current position and every forecast point, with a black-
outlined Day 1-3 solid cone and a white-outlined Day 4-5 continuation
once a point passes 72 hours. Each forecast point also gets a dot marker
with its lead-time hour and a one-character intensity symbol (D/S/1-5,
the same category scale as the system's own classification, computed
from that point's forecast wind held against the system's current
gust/gale-radius/pressure) once its wind is filled in. Forecast points
are selectable and draggable directly on the map, the same as the
system's own marker, regardless of which toolbar tool is active — only a
click on truly blank space is tool-dependent (place/draw vs. pan or
deselect), so there's no need to keep switching back to Select just to
reposition something or pan the view. Only the selected system's
cone/track renders, to keep the map readable.

Each forecast point's hour can be scheduled Auto (the next open slot at
the system's default interval — 6h/12h/24h, picked in the Forecast track
section), Manual (a typed hour, with later auto points stepping forward
from it), or Override (a one-off gap after that point only, independent
of the system's default interval). Adding, deleting, or rescheduling any
point recomputes every point's hour in sequence order, so a change to an
earlier point ripples forward through the auto points after it without
ever moving an earlier one.

A selected system's current position also carries a wind field: NE/SE/SW/
NW quadrant radii for gale-force and hurricane-force winds, each
independently draggable on the map (a 2-button toggle picks which
threshold's handles are active, with a live mile readout next to each
one), rendered as a smoothed envelope rather than a hard-cornered
diamond. This replaced the old single "gale radius" number field — the
intensity calculator now averages the four gale quadrants for that part
of its formula.

Downgrading and watches/warnings are still later milestones on top of this
same foundation.

## Accounts & roles

Write access (anything beyond viewing) requires logging in. Four roles,
each a superset of the one below it:

- **Owner** — everything, including promoting/demoting roles. Exactly one
  account starts as Owner (provisioned via the bootstrap script below).
- **Admin** — can create new accounts (defaulting to Junior Forecaster;
  only Owner can hand out a higher role or change one later), plus
  everything Forecaster can.
- **Forecaster** — Investigate/Classify/Delete a system, publish or
  emergency-cancel an advisory, plus everything Junior Forecaster can.
- **Junior Forecaster** — routine data entry: disturbances, forecast
  points, wind field, formation probabilities, wind/gust/pressure
  readings, saving.

The very first (Owner) account can't be created through the app itself
(there's nobody logged in yet to create it) — it's provisioned directly
against the database:

```
node server/scripts/create-user.js <username> <password> ["display name"] [role]
```

On a live deployment this needs to run *inside* the actual container
(`railway ssh -- node server/scripts/create-user.js ...`), not against a
local copy — `railway run` executes locally with Railway's environment
variables injected, which wouldn't touch the real mounted database.
Passwords are hashed (scrypt) immediately and never written to a file,
commit, or log in plain text. Once an Owner/Admin account exists, use the
Accounts panel in the editor sidebar for every account after that.

## Storm naming

Once a system is **Classified**, it's automatically given the next unused
name for its season from the `storm_names` table (seeded with a
placeholder alphabetical list, A through W skipping Q/U/X/Y/Z — edit that
table directly for real names). A name is permanently retired the moment
it's assigned, even if that system later weakens.

## Advisories

Once classified, a system's panel gets a **Publish Advisory** button
(Forecaster role or higher, confirmation-gated) that snapshots its full
current data and forecast track as an immutable, auto-numbered record.
For exactly one hour after publishing, that advisory shows an emergency
**Cancel** button (same role, a second confirmation) that fully and
permanently deletes it — not a retraction, a true undo. After the hour,
it's permanent. The one-hour window is enforced by the server itself, not
just hidden client-side once it passes.

## Discussions

Selecting any system opens a text callout right on the map, next to its
marker, until it's deselected — a plain-language companion to the
numbers in the sidebar, styled after NHC's own text products:

- **Disturbance/Invest** — a free-text discussion (editable by any of the
  four roles, saved alongside the rest of that system's routine data)
  plus its three formation-probability windows and a "Forecaster:" byline
  naming whoever last saved it.
- **Classified** — the *latest advisory's* discussion (written at publish
  time, immutable afterward like the rest of that advisory) under a
  "`<name>` Discussion (Advisory `N`)" heading, followed by a
  FORECAST POSITIONS AND MAX WINDS table built from that same advisory's
  frozen snapshot: each position's valid time, lat/lon, and wind in both
  knots and mph, with an optional manual OVER WATER / INLAND / DISSIPATED
  tag per forecast point (set from a small select on that point's row in
  the Forecast track section).

## Public site

The bare domain serves a separate, real, **read-only** site (`/public`) —
deliberately distinct from the editor, not a reskinned version of it: a
dark, map-first design with a persistent sidebar listing every
disturbance/invest/classified system as an expandable card (click a card,
or its marker on the map, to open its detail inline). It shares the
editor's own map/marker/cone/wind-field rendering code (imported
directly, not duplicated) but none of its editing machinery — there is no
write-capable UI on this page at all, not even a disabled one. Before a
system is Classified, its card shows only formation probabilities — no
intensity or category information appears until it's active; once
Classified, the card also shows its latest advisory's issued time.

If no backend is reachable at all (the GitHub Pages deployment), the page
falls back to a couple of clearly-labeled sample systems with a "DEMO
MODE" banner, rather than an empty map or a broken page.

To run it:

```
cd server
npm install
npm start
```

Then open `http://localhost:3000` for the **public page**, or
`http://localhost:3000/editor` for the **forecaster tool** — one process
serves both, plus the JSON API (`/api/*`), so there's no separate dev
server or CORS to think about. Data lives in a local SQLite file
(`server/data/`, gitignored) via Node's built-in `node:sqlite` — no
external database to install for development.

The map geometry (`editor/assets/*.geojson`) and the pan/zoom/rendering
approach are adapted from an earlier prototype of this same idea, cropped
down to the Atlantic/US basin to keep the repo small.

## Disclaimer

This is an independent hobby project, not affiliated with NOAA, the National
Weather Service, or the National Hurricane Center. For real winter weather
watches, warnings, and forecasts, use your local NWS office at
[weather.gov](https://www.weather.gov).
