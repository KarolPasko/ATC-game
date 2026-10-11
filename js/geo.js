// Geometry helpers. World units are nautical miles, x = east, y = north.
// Headings/bearings are compass degrees (0 = north, clockwise).
const Geo = {
  rad: (d) => (d * Math.PI) / 180,
  deg: (r) => (r * 180) / Math.PI,
  norm: (h) => ((h % 360) + 360) % 360,
  vec: (h) => ({ x: Math.sin((h * Math.PI) / 180), y: Math.cos((h * Math.PI) / 180) }),
  bearing: (a, b) => Geo.norm(Geo.deg(Math.atan2(b.x - a.x, b.y - a.y))),
  dist: (a, b) => Math.hypot(b.x - a.x, b.y - a.y),
  // Signed shortest angle from heading a to heading b (positive = turn right).
  diff: (a, b) => ((b - a + 540) % 360) - 180,
  offset: (p, h, d) => {
    const v = Geo.vec(h);
    return { x: p.x + v.x * d, y: p.y + v.y * d };
  },
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
  // Turn radius in nm for a ground speed (kt) and turn rate (deg/s).
  turnRadius: (kt, rate) => kt / 3600 / Geo.rad(rate),
  fmtHdg: (h) => String(Math.round(Geo.norm(h)) || 360).padStart(3, '0'),
};
