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
// Each physical runway lies at `v` from u0 to u1; ids[0] is flown towards +u (threshold at u0), ids[1] the other way.
function defineRunways(axis, list) {
  const U = Geo.vec(axis), V = Geo.vec(axis - 90);
  const w = (u, v) => ({ x: (U.x * u + V.x * v) / 1852, y: (U.y * u + V.y * v) / 1852 });
  for (const p of list) {
    const [lo, hi] = p.ids;
    const a = w(p.u0, p.v), b = w(p.u1, p.v);
    RUNWAY_PHYS.push({ ...p });
    const common = { phys: p.phys, v: p.v, width: p.width, ils: p.ils !== false };
    RUNWAYS[lo] = { id: lo, heading: Geo.norm(axis), thr: a, opp: b, recip: hi, dirU: 1, thrU: p.u0, endU: p.u1, ...common };
    RUNWAYS[hi] = { id: hi, heading: Geo.norm(axis + 180), thr: b, opp: a, recip: lo, dirU: -1, thrU: p.u1, endU: p.u0, ...common };
  }
}

// Point on the approach to a runway: `along` nm before the threshold,
// `lateral` nm to the right (+) / left (-) of an aircraft flying the final approach course.
function approachPoint(rwyId, along, lateral = 0) {
  const r = RUNWAYS[rwyId];
  const p = Geo.offset(r.thr, r.heading + 180, along);
  return Geo.offset(p, r.heading + 90, lateral);
}

// RNAV "T-bar" to the ILS: FAF and IF on the centreline, a straight-in IAF `wing` nm behind the IF and an outer IAF
// `wing` nm abeam the IF (side +1 = right of the final approach course), so the turn at the IF is 90°.
// `names.outer2` adds a second outer IAF on the other side.
function tBar(rwy, names, { ifAlong, ifAlt, iafAlt, side, fafAlong = 6.3, fafAlt = 2000, wing = 6 }) {
  const n = names;
  addFix(n.faf, approachPoint(rwy, fafAlong), 'faf', fafAlt);
  addFix(n.if, approachPoint(rwy, ifAlong), 'if', ifAlt);
  addFix(n.outer, approachPoint(rwy, ifAlong, wing * side), 'iaf', iafAlt);
  if (n.outer2) addFix(n.outer2, approachPoint(rwy, ifAlong, -wing * side), 'iaf', iafAlt);
  addFix(n.straightIn, approachPoint(rwy, ifAlong + wing), 'iaf', iafAlt);
  APPROACHES[rwy] = {
    rwy, iafs: [n.outer, n.straightIn, n.outer2].filter(Boolean), outer: n.outer, outer2: n.outer2 || null,
    straightIn: n.straightIn, if: n.if, faf: n.faf, ifAlong, side,
  };
}

// Published holds at the IAFs: an outer IAF's inbound course leads straight on to the IF with the racetrack on the
// far side from the airport; the straight-in IAF's is the final approach course, turning towards the outer side.
function iafHolds() {
  for (const a of Object.values(APPROACHES)) {
    const r = RUNWAYS[a.rwy];
    const outerHold = (fix, side) => ({ inbound: Math.round(Geo.bearing(FIXES[fix], FIXES[a.if])), turn: side > 0 ? 'L' : 'R', minAlt: FIXES[fix].alt });
    HOLDS[a.outer] = outerHold(a.outer, a.side);
    if (a.outer2) HOLDS[a.outer2] = outerHold(a.outer2, -a.side);
    HOLDS[a.straightIn] = { inbound: r.heading, turn: a.side > 0 ? 'R' : 'L', minAlt: FIXES[a.straightIn].alt };
  }
}

// The approach fixes from `fix` (an IAF, the IF or the FAF of that runway) down to the FAF, or null.
function approachFrom(rwy, fix) {
  const a = APPROACHES[rwy];
  if (!a) return null;
  if (fix === a.faf) return [a.faf];
  if (fix === a.if) return [a.if, a.faf];
  return a.iafs.includes(fix) ? [fix, a.if, a.faf] : null;
}
// Which runway's approach a fix belongs to (null for other fixes).
function approachOf(fix) {
  return Object.values(APPROACHES).find((a) => a.iafs.includes(fix) || a.if === fix || a.faf === fix) || null;
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
  DH8D: { wake: 'M', vapp: 120, vr: 115, max: 280, climb: 1800, desc: 1800, turn: 3 },
  AT76: { wake: 'M', vapp: 112, vr: 110, max: 250, climb: 1500, desc: 1600, turn: 3 },
  A333: { wake: 'H', vapp: 140, vr: 155, max: 330, climb: 2000, desc: 2000, turn: 2.5 },
  A359: { wake: 'H', vapp: 145, vr: 155, max: 340, climb: 2200, desc: 2000, turn: 2.5 },
  B789: { wake: 'H', vapp: 147, vr: 160, max: 340, climb: 2200, desc: 2000, turn: 2.5 },
  B77W: { wake: 'H', vapp: 150, vr: 165, max: 340, climb: 2000, desc: 2000, turn: 2.5 },
  B744: { wake: 'H', vapp: 155, vr: 165, max: 340, climb: 1800, desc: 2000, turn: 2.5 },
};
const TYPE_WEIGHTS = Object.keys(TYPES);

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
