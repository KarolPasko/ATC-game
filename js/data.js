// Shared data: the airport containers (filled in by the selected airport, see js/airports/*.js and js/airport.js),
// procedure helpers, wind, and aircraft performance and operators.
const AIRPORT = {}; // icao, name, city, control, axis, transAlt, sidTop, radarRange, ctrRadius, ...
const RUNWAYS = {}; // id -> { id, heading, thr, opp, phys, recip, dirU, v, thrU, endU, width }
const RUNWAY_PHYS = []; // physical runways in the ground frame: { phys, ids, v, u0, u1, width, outer }
const FIXES = {};
const APPROACHES = {};
const PROCS = {}; // runway configuration -> { stars, sids }
const CONFIGS = {}; // runway configuration -> { label, arr: [runways], dep: [runways], wind }
const HOLDS = {};
const SID_FIRST = {}; // runway -> first SID fix (shown with the approach fixes of the runways in use)
const OUTSTATIONS = {}; // direction -> airports
const FIX_DIRECTION = {}; // entry / exit fix -> direction
const AIRPORTS = {}; // registry of airport definitions, by ICAO code
let VIDEO_MAP = null;
let AIRLINE_POOL = [];

function addFix(name, p, type, alt) {
  FIXES[name] = { name, x: p.x, y: p.y, type, alt };
}

// Runways from the airport's runway-aligned ground frame (metres): u along `axis`, v to its left.
// Each physical runway's pavement lies at `v` from u0 to u1; ids[0] is flown towards +u (starting at u0), ids[1] the
// other way. disp0 / disp1: landing thresholds displaced from the pavement ends (take-offs still use the full length).
// thr = landing threshold, start = start of the take-off run, opp = far end of the pavement.
function defineRunways(axis, list) {
  const U = Geo.vec(axis), V = Geo.vec(axis - 90);
  const w = (u, v) => ({ x: (U.x * u + V.x * v) / 1852, y: (U.y * u + V.y * v) / 1852 });
  for (const p of list) {
    const [lo, hi] = p.ids;
    const d0 = p.disp0 || 0, d1 = p.disp1 || 0;
    RUNWAY_PHYS.push({ ...p });
    const common = { phys: p.phys, v: p.v, width: p.width, ils: p.ils !== false };
    RUNWAYS[lo] = { id: lo, heading: Geo.norm(axis), thr: w(p.u0 + d0, p.v), start: w(p.u0, p.v), opp: w(p.u1, p.v), recip: hi, dirU: 1, thrU: p.u0 + d0, startU: p.u0, endU: p.u1, ...common };
    RUNWAYS[hi] = { id: hi, heading: Geo.norm(axis + 180), thr: w(p.u1 - d1, p.v), start: w(p.u1, p.v), opp: w(p.u0, p.v), recip: lo, dirU: -1, thrU: p.u1 - d1, startU: p.u1, endU: p.u0, ...common };
  }
}

// Point on the approach to a runway: `along` nm before the threshold,
// `lateral` nm to the right (+) / left (-) of an aircraft flying the final approach course.
function approachPoint(rwyId, along, lateral = 0) {
  const r = RUNWAYS[rwyId];
  const p = Geo.offset(r.thr, r.heading + 180, along);
  return Geo.offset(p, r.heading + 90, lateral);
}

// ---- Pre-made RNAV transitions to the ILS ----
// Every transition ends exactly on the extended centreline at the IF, heading down the final approach course, so the
// aircraft rolls out aligned with the runway. Turns onto base and onto final are constant-radius arcs (RF legs), so the
// path is smooth and never cuts across the airport. In runway-relative terms (along = nm before the threshold, side +1 =
// right of the final approach course, A = IF distance, L = `wide`, r = `rFinal`):
//   straight-in  IA (A + 6, 0) ─ IF          (distance configurable)
//   base         B (A + r, L) ─ BT (A + r, r) ⌒ IF
//   downwind     DW (dwAlong, L) ─ DE (A + r - (L - r), L) ⌒ BT ⌒ IF
// then IF ─ FAF ─ threshold on the localizer.
const ARCS = {}; // "FROM>TO" -> { c: centre, r: radius (nm), dir: 'L' | 'R' }
function addArc(from, to, c) {
  const A = FIXES[from], B = FIXES[to];
  const cross = (A.x - c.x) * (B.y - c.y) - (A.y - c.y) * (B.x - c.x); // > 0: anticlockwise, a left turn
  ARCS[`${from}>${to}`] = { c, r: Geo.dist(c, A), dir: cross > 0 ? 'L' : 'R' };
}
// Points along a route for drawing, with arcs expanded (names: fix names, optionally starting from point `from`).
function routePoints(names, from = null) {
  const pts = from ? [from] : [];
  names.forEach((n, i) => {
    const arc = i > 0 && ARCS[`${names[i - 1]}>${n}`];
    if (arc) {
      const a0 = Geo.bearing(arc.c, FIXES[names[i - 1]]), a1 = Geo.bearing(arc.c, FIXES[n]);
      const sweep = arc.dir === 'R' ? (a1 - a0 + 360) % 360 : -((a0 - a1 + 360) % 360);
      for (let k = 1; k < 12; k++) pts.push(Geo.offset(arc.c, a0 + (sweep * k) / 12, arc.r));
    }
    pts.push(FIXES[n]);
  });
  return pts;
}

// names: { faf, if, straightIn, sides: { 1: { base, bt, dw, de }, -1: {...} } } (sides present are flown).
function approachSet(rwy, names, { ifAlong, ifAlt, iafAlt, dwAlt = iafAlt, fafAlong = 6.3, fafAlt = 2000, wide = 6, rFinal = 2.5, dwAlong = 1, primary = 1, straightIn = 6, straightInAlt = iafAlt }) {
  const A = ifAlong, L = wide, r = rFinal, rd = L - r;
  const P = (along, lateral) => approachPoint(rwy, along, lateral);
  const btAlt = Math.round((iafAlt + ifAlt) / 2 / 500) * 500;
  addFix(names.faf, P(fafAlong, 0), 'faf', fafAlt);
  addFix(names.if, P(A, 0), 'if', ifAlt);
  addFix(names.straightIn, P(A + straightIn, 0), 'iaf', straightInAlt);
  const paths = { [names.faf]: [names.faf], [names.if]: [names.if, names.faf], [names.straightIn]: [names.straightIn, names.if, names.faf] };
  const sides = {};
  for (const [k, n] of Object.entries(names.sides)) {
    const s = +k;
    addFix(n.base, P(A + r, s * L), 'iaf', iafAlt);
    addFix(n.bt, P(A + r, s * r), 'tp', btAlt);
    addFix(n.dw, P(dwAlong, s * L), 'iaf', dwAlt);
    addFix(n.de, P(A + r - rd, s * L), 'tp', iafAlt);
    addArc(n.de, n.bt, P(A + r - rd, s * r));
    addArc(n.bt, names.if, P(A, s * r));
    paths[n.bt] = [n.bt, names.if, names.faf];
    paths[n.base] = [n.base, ...paths[n.bt]];
    paths[n.de] = [n.de, ...paths[n.bt]];
    paths[n.dw] = [n.dw, ...paths[n.de]];
    sides[s] = { ...n };
  }
  const main = sides[primary] || Object.values(sides)[0];
  const other = Object.entries(sides).find(([s]) => +s !== primary)?.[1];
  // Transitions on one side only (parallel runways): traffic from the other side crosses behind the runway, 7 nm past
  // its departure end and above the departures, then joins the downwind.
  let xb = null;
  if (Object.keys(sides).length === 1) {
    xb = `XB${rwy}`;
    const len = Geo.dist(RUNWAYS[rwy].thr, RUNWAYS[rwy].opp);
    addFix(xb, P(-len - 7, 0), 'tp', Math.max(dwAlt, (AIRPORT.sidTop || 6000) + 1000));
    paths[xb] = [xb, ...paths[main.dw]];
  }
  APPROACHES[rwy] = {
    rwy, if: names.if, faf: names.faf, straightIn: names.straightIn, ifAlong: A, side: sides[primary] ? primary : +Object.keys(sides)[0],
    sides, paths, outer: main.base, outer2: other?.base || null, xb,
    iafs: [names.straightIn, ...Object.values(sides).flatMap((n) => [n.base, n.dw])],
  };
}

// Published holds at the approach entry points: the straight-in IAF on the final approach course, the base IAFs
// inbound along the base leg, the downwind fixes along the downwind; racetracks on the side away from the airport.
function iafHolds() {
  const turnToward = (inbound, side) => (Geo.diff(inbound, side) > 0 ? 'R' : 'L');
  for (const a of Object.values(APPROACHES)) {
    const r = RUNWAYS[a.rwy];
    HOLDS[a.straightIn] = { inbound: r.heading, turn: turnToward(r.heading, r.heading + 90 * a.side), minAlt: FIXES[a.straightIn].alt };
    for (const [k, n] of Object.entries(a.sides)) {
      const s = +k;
      const base = Math.round(Geo.bearing(FIXES[n.base], FIXES[n.bt]));
      HOLDS[n.base] = { inbound: base, turn: turnToward(base, r.heading + 180), minAlt: FIXES[n.base].alt };
      const dw = Geo.norm(r.heading + 180);
      HOLDS[n.dw] = { inbound: dw, turn: turnToward(dw, r.heading + 90 * s), minAlt: FIXES[n.dw].alt };
    }
  }
}

// The approach fixes from `fix` (an entry point of that runway's transitions, the IF or the FAF) down to the FAF, or null.
function approachFrom(rwy, fix) {
  const p = APPROACHES[rwy]?.paths[fix];
  return p ? p.slice() : null;
}
// Which runway's approach a fix belongs to (null for other fixes).
function approachOf(fix) {
  return Object.values(APPROACHES).find((a) => a.paths[fix]) || null;
}

// Plain-language name of an approach entry, e.g. "downwind north-west", "base south-east", "straight-in".
function describeEntry(rwy, fix) {
  const a = APPROACHES[rwy];
  if (!a) return fix;
  if (fix === a.straightIn) return 'straight-in';
  if (fix === a.if) return 'the IF';
  if (fix === a.faf) return 'the FAF';
  if (fix === a.xb) return 'crossing behind the runway to the downwind';
  const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  for (const [k, n] of Object.entries(a.sides)) {
    const dir = COMPASS[Math.round(Geo.norm(RUNWAYS[rwy].heading + 90 * k) / 45) % 8];
    if (fix === n.base || fix === n.bt) return `base ${dir}`;
    if (fix === n.dw || fix === n.de) return `downwind ${dir}`;
  }
  return fix;
}

// Approach entries for an aircraft at point p, best first. Behind the final: straight-in (or the IF / FAF when already
// lined up with it). On a side with transitions: base when abeam or beyond the IF, downwind when abeam the runway or
// beyond the threshold (joined at its start, or at its end when already on it). On a side without transitions (the
// parallel runway's side): out to the straight-in IAF from in front of the threshold, or across behind the runway (the
// cross-over point XB, 7 nm past the departure end) to the downwind from level with or behind it. No entry takes the
// aircraft across the airport.
function transitionFor(rwy, p) {
  const a = APPROACHES[rwy], r = RUNWAYS[rwy];
  const dx = p.x - r.thr.x, dy = p.y - r.thr.y, v = Geo.vec(r.heading);
  const along = -(dx * v.x + dy * v.y), lateral = dx * v.y - dy * v.x;
  const A = a.ifAlong, fafAlong = Geo.dist(FIXES[a.faf], r.thr);
  const cone = (from, deg) => along > from + 1 && Math.abs(lateral) <= Math.tan(Geo.rad(deg)) * (along - from);
  const s = Math.abs(lateral) < 1 || !a.sides[Math.sign(lateral)] ? a.side : Math.sign(lateral);
  const n = a.sides[s];
  const sameSide = Math.abs(lateral) < 1 || Math.sign(lateral) === s;
  // Wrong side (beyond the parallel runway, where this one has no transitions): never across the field or the other
  // final. In front of the threshold go out to the straight-in IAF; level with or behind the runway, cross behind it.
  if (!sameSide) return along >= 0 ? [a.straightIn, n.dw] : [a.xb || n.dw, a.straightIn];
  if (cone(Geo.dist(FIXES[a.straightIn], r.thr), 50)) return [a.straightIn, a.if, n.base];
  if (cone(A, 45)) return [a.if, a.straightIn, n.base];
  if (along < A + 1 && cone(fafAlong + 1.5, 35)) return [a.faf, a.if, n.base];
  if (along >= A - 1) return Math.abs(lateral) < 4.5 && along > A + 3 ? [n.bt, n.base, a.straightIn] : [n.base, n.bt, a.straightIn];
  if (along >= 3 && Math.abs(lateral) > 3) return [n.de, n.dw, n.base];
  return [n.dw, n.de, n.base];
}

// Full lateral route of a STAR: its fixes after the entry, then the approach from its IAF.
function starRoute(star) {
  return star.fixes.slice(1, -1).concat(approachFrom(star.rwy, star.fixes[star.fixes.length - 1]));
}

const HOLD_SPEED = (alt) => (alt <= 14000 ? 230 : alt <= 20000 ? 240 : 265);
const HOLD_LEG = (alt) => (alt <= 14000 ? 60 : 90); // seconds

// Surface wind (direction it blows FROM); it veers and strengthens with height.
const WIND = { dir: 250, spd: 12 };
function windAt(alt) {
  const k = Math.min(alt, 25000) / 1000;
  return { dir: WIND.dir + k * 1.2, spd: WIND.spd + k * 1.6 };
}

// ---- Aircraft performance ----
// vapp: final approach speed, vr: rotate, max: max IAS, climb/desc: ft/min, turn: deg/s
const TYPES = {
  A320: { wake: 'M', vapp: 138, vr: 145, max: 340, climb: 2500, desc: 2200, turn: 3 },
  A20N: { wake: 'M', vapp: 136, vr: 142, max: 340, climb: 2600, desc: 2200, turn: 3 },
  A321: { wake: 'M', vapp: 142, vr: 150, max: 340, climb: 2300, desc: 2200, turn: 3 },
  A21N: { wake: 'M', vapp: 140, vr: 148, max: 340, climb: 2400, desc: 2200, turn: 3 },
  B738: { wake: 'M', vapp: 145, vr: 150, max: 340, climb: 2500, desc: 2200, turn: 3 },
  B38M: { wake: 'M', vapp: 143, vr: 148, max: 340, climb: 2600, desc: 2200, turn: 3 },
  E190: { wake: 'M', vapp: 130, vr: 135, max: 320, climb: 2800, desc: 2200, turn: 3 },
  E195: { wake: 'M', vapp: 132, vr: 138, max: 320, climb: 2600, desc: 2200, turn: 3 },
  DH8D: { wake: 'M', vapp: 120, vr: 115, max: 280, climb: 1800, desc: 1800, turn: 3, prop: true },
  AT76: { wake: 'M', vapp: 112, vr: 110, max: 250, climb: 1500, desc: 1600, turn: 3, prop: true },
  A333: { wake: 'H', vapp: 140, vr: 155, max: 330, climb: 2000, desc: 2000, turn: 2.5 },
  A359: { wake: 'H', vapp: 145, vr: 155, max: 340, climb: 2200, desc: 2000, turn: 2.5 },
  B789: { wake: 'H', vapp: 147, vr: 160, max: 340, climb: 2200, desc: 2000, turn: 2.5 },
  B77W: { wake: 'H', vapp: 150, vr: 165, max: 340, climb: 2000, desc: 2000, turn: 2.5 },
  B744: { wake: 'H', vapp: 155, vr: 165, max: 340, climb: 1800, desc: 2000, turn: 2.5 },
  // Light aircraft (wake category L): cct = circuit speed, accel = kt/s on the take-off roll.
  C152: { wake: 'L', vapp: 60, vr: 50, max: 105, climb: 600, desc: 600, turn: 3, cct: 80, accel: 2, prop: true, ga: true },
  C172: { wake: 'L', vapp: 65, vr: 55, max: 125, climb: 700, desc: 700, turn: 3, cct: 90, accel: 2.2, prop: true, ga: true },
  PA28: { wake: 'L', vapp: 70, vr: 60, max: 125, climb: 650, desc: 700, turn: 3, cct: 90, accel: 2.2, prop: true, ga: true },
  DA40: { wake: 'L', vapp: 70, vr: 59, max: 140, climb: 750, desc: 700, turn: 3, cct: 95, accel: 2.4, prop: true, ga: true },
  SR22: { wake: 'L', vapp: 80, vr: 70, max: 180, climb: 1000, desc: 800, turn: 3, cct: 105, accel: 3, prop: true, ga: true },
};
const TYPE_WEIGHTS = Object.keys(TYPES).filter((t) => !TYPES[t].ga);

// Some SIDs are for jets only or propeller aircraft only (e.g. SANBA and LISTO off Manchester's 23s).
function sidAllowed(sid, type) {
  if (!sid.only) return true;
  return (sid.only === 'prop') === !!TYPES[type]?.prop;
}

// Operators with their radio telephony callsigns, typical fleets and how common they are.
const AIRLINES = [
  { icao: 'BAW', name: 'Speedbird', fleet: ['A320', 'A20N', 'A321', 'B789', 'B77W', 'A359'], w: 3 },
  { icao: 'SHT', name: 'Shuttle', fleet: ['A320', 'A20N'], w: 2 },
  { icao: 'EZY', name: 'Easy', fleet: ['A320', 'A20N', 'A21N'], w: 4 },
  { icao: 'RYR', name: 'Ryanair', fleet: ['B738', 'B38M'], w: 4 },
  { icao: 'EXS', name: 'Channex', fleet: ['B738', 'A321', 'A21N'], w: 4 },
  { icao: 'TOM', name: 'Tomjet', fleet: ['B738', 'B38M', 'B789'], w: 3 },
  { icao: 'LOG', name: 'Logan', fleet: ['AT76', 'DH8D', 'E190'], w: 2 },
  { icao: 'EIN', name: 'Shamrock', fleet: ['A320', 'A20N', 'A333'], w: 2 },
  { icao: 'KLM', name: 'KLM', fleet: ['B738', 'E190', 'E195', 'B789'], w: 2 },
  { icao: 'DLH', name: 'Lufthansa', fleet: ['A320', 'A21N', 'A359'], w: 2 },
  { icao: 'AFR', name: 'Airfrans', fleet: ['A320', 'A20N', 'B77W'], w: 1 },
  { icao: 'SWR', name: 'Swiss', fleet: ['A20N', 'A320'], w: 1 },
  { icao: 'AUA', name: 'Austrian', fleet: ['A320', 'E195'], w: 1 },
  { icao: 'BEL', name: 'Beeline', fleet: ['A320'], w: 1 },
  { icao: 'TAP', name: 'Air Portugal', fleet: ['A20N', 'A321'], w: 1 },
  { icao: 'VLG', name: 'Vueling', fleet: ['A320', 'A20N'], w: 1 },
  { icao: 'IBE', name: 'Iberia', fleet: ['A320', 'A321', 'A333'], w: 1 },
  { icao: 'SAS', name: 'Scandinavian', fleet: ['A20N', 'A320'], w: 1 },
  { icao: 'FIN', name: 'Finnair', fleet: ['A320', 'A321'], w: 1 },
  { icao: 'THY', name: 'Turkish', fleet: ['A321', 'B738', 'A333', 'B77W'], w: 1 },
  { icao: 'UAE', name: 'Emirates', fleet: ['B77W'], w: 2 },
  { icao: 'QTR', name: 'Qatari', fleet: ['B789', 'A359', 'B77W'], w: 1 },
  { icao: 'ETD', name: 'Etihad', fleet: ['B789', 'A359'], w: 1 },
  { icao: 'VIR', name: 'Virgin', fleet: ['A333', 'B789', 'A359'], w: 1 },
  { icao: 'AAL', name: 'American', fleet: ['B77W', 'B789'], w: 1 },
  { icao: 'UAL', name: 'United', fleet: ['B789', 'B77W'], w: 1 },
  { icao: 'DAL', name: 'Delta', fleet: ['A333', 'A359'], w: 1 },
  { icao: 'CLX', name: 'Cargolux', fleet: ['B744'], w: 1 },
  { icao: 'SIA', name: 'Singapore', fleet: ['A359'], w: 0 },
];
