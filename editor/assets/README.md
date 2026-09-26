# Map assets

Coastline/land/lake/border/state geometry: full world extent,
coordinate-rounded (~3 decimal places, ~110m precision) from a prior
project's GeoJSON (itself derived from the GSHHS/Basemap boundary
datasets). Plain WGS84 lon/lat, no projection applied — the editor uses
raw lon/-lat as SVG coordinates directly and controls the "camera" via the
SVG viewBox. `INITIAL_BOUNDS` in `src/constants.js` is what actually
limits the default view to the Atlantic/US basin, not the data itself.

An earlier version of these files tried to pre-crop to that basin by
excluding whole features whose bounding box didn't touch it. That broke
badly on this dataset, whose land layer represents huge landmasses as very
few giant multi-part features: a couple of continent-spanning features got
pulled in anyway because part of their bbox grazed the crop region (e.g.
Africa, via its westernmost tip), while others were silently dropped in
full (Europe) since no kept feature happened to touch them. Rounding
without excluding anything avoids that failure mode entirely, at the cost
of a larger commit (~10MB total instead of ~3MB).
