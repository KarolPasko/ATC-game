// Airport, runway, fix and procedure data for the fictional Ravenwood International (EGRV).
const AIRPORT = {
  icao: 'EGRV',
  name: 'Ravenwood International',
  elevation: 0,
  transAlt: 6000,
  radarRange: 55, // aircraft beyond this are removed
  ctrRadius: 50, // airspace boundary drawn on the scope
};

// ---- Runways: two parallels, 08L/26R (north) and 08R/26L (south) ----
const RUNWAYS = (() => {
  const LEN = 2.0; // nm (~3700 m)
  const SEP = 0.75; // nm between centrelines
  const v = Geo.vec(260);
  const south = Geo.vec(170); // left of 260
  const centres = {
    S: { x: (south.x * SEP) / 2, y: (south.y * SEP) / 2 },
    N: { x: (-south.x * SEP) / 2, y: (-south.y * SEP) / 2 },
  };
  const east = (c) => ({ x: c.x - (v.x * LEN) / 2, y: c.y - (v.y * LEN) / 2 });
  const west = (c) => ({ x: c.x + (v.x * LEN) / 2, y: c.y + (v.y * LEN) / 2 });
  const r = {
    '26L': { id: '26L', heading: 260, thr: east(centres.S), opp: west(centres.S), phys: 'S', recip: '08R' },
    '08R': { id: '08R', heading: 80, thr: west(centres.S), opp: east(centres.S), phys: 'S', recip: '26L' },
    '26R': { id: '26R', heading: 260, thr: east(centres.N), opp: west(centres.N), phys: 'N', recip: '08L' },
    '08L': { id: '08L', heading: 80, thr: west(centres.N), opp: east(centres.N), phys: 'N', recip: '26R' },
  };
  return r;
})();

// Point on the approach to a runway: `along` nm before the threshold,
// `lateral` nm to the right (+) / left (-) of an aircraft flying the final approach course.
function approachPoint(rwyId, along, lateral = 0) {
  const r = RUNWAYS[rwyId];
  const p = Geo.offset(r.thr, r.heading + 180, along);
  return Geo.offset(p, r.heading + 90, lateral);
}

// ---- Fixes ----
const FIXES = {};
function addFix(name, p, type, alt) {
  FIXES[name] = { name, x: p.x, y: p.y, type, alt };
}

// Entry fixes (arrivals spawn here)
addFix('BOGNA', { x: 0, y: 46 }, 'entry');
addFix('TIMBA', { x: 33, y: 33 }, 'entry');
addFix('LAMSO', { x: 46, y: 3 }, 'entry');
addFix('KOPAS', { x: 31, y: -34 }, 'entry');
addFix('DEXOR', { x: -3, y: -46 }, 'entry');
addFix('VAREN', { x: -46, y: -6 }, 'entry');
addFix('MIRLO', { x: -31, y: 34 }, 'entry');
// Exit fixes (departures hand off around here)
addFix('NOVAL', { x: -10, y: 43 }, 'exit');
addFix('ESTOR', { x: 43, y: 17 }, 'exit');
addFix('SUDAN', { x: 10, y: -43 }, 'exit');
addFix('WOLFE', { x: -43, y: 12 }, 'exit');
// Enroute / transition fixes
addFix('SOTAX', { x: 2, y: 25 }, 'enroute');
addFix('NEKOS', { x: 0, y: -25 }, 'enroute');
addFix('FOXEN', { x: -6, y: -14 }, 'enroute');
addFix('NIBEX', { x: -13, y: 15 }, 'enroute');
addFix('ETRAX', { x: 13, y: 27 }, 'enroute');
addFix('SIPOR', { x: -11, y: -16 }, 'enroute');
addFix('EBRIK', { x: 16, y: -20 }, 'enroute');
addFix('ARKOS', { x: -20, y: 30 }, 'enroute');
addFix('BELTA', { x: 20, y: 38 }, 'exit');
addFix('CORVU', { x: 38, y: -15 }, 'entry');
addFix('DAMEK', { x: -18, y: -35 }, 'exit');
addFix('ELNAR', { x: -36, y: -22 }, 'exit');
addFix('FIRZO', { x: -36, y: 26 }, 'entry');
addFix('GOLVA', { x: 12, y: 15 }, 'enroute');
addFix('HEXOR', { x: 25, y: -13 }, 'enroute');
addFix('IRVAN', { x: -9, y: -32 }, 'enroute');
addFix('JUPAL', { x: 36, y: -5 }, 'exit');
addFix('LOVIS', { x: -19, y: 6 }, 'enroute');
addFix('MOSKA', { x: 6, y: -11 }, 'enroute');
addFix('OSTEP', { x: -4, y: 35 }, 'enroute');
addFix('PRAVO', { x: 16, y: -34 }, 'enroute');
addFix('RUSKO', { x: -28, y: -38 }, 'entry');
addFix('TELBA', { x: 35, y: 28 }, 'entry');
addFix('VEXAN', { x: -33, y: 8 }, 'enroute');
addFix('YAMIK', { x: 31, y: 9 }, 'enroute');
addFix('ZEPRA', { x: -4, y: 17 }, 'enroute');
// VOR/DME beacons
addFix('RVW', { x: 1.5, y: -2.4 }, 'vor');
addFix('OKR', { x: 27, y: 26 }, 'vor');
addFix('DXT', { x: -24, y: -25 }, 'vor');

// ---- Approaches: an RNAV "T-bar" to the ILS for every runway end ----
//   FAF  on the centreline at 6.3 nm, 2000 ft (on the 3° glideslope).
//   IF   on the centreline: 11 nm / 3000 ft for the south runways, 14 nm / 4000 ft for the north ones, so arrivals
//        for the two parallels keep 1000 ft apart until established, and always join the glideslope from below.
//   IAFs 6 nm from the IF: a straight-in IAF on the extended centreline, and an outer IAF exactly abeam the IF on the
//        side away from the parallel runway (so the turn at the IF is 90°). South 4000 ft, north 5000 ft.
const APPROACHES = {};
const APPROACH_NAMES = {
  '26R': { outer: 'NORAX', straightIn: 'MAVEK', if: 'MELAN', faf: 'RIVOS' },
  '26L': { outer: 'SUREK', straightIn: 'LUTOS', if: 'TOBEK', faf: 'LONKA' },
  '08L': { outer: 'KELVO', straightIn: 'PELOR', if: 'PIRAM', faf: 'ODINA' },
  '08R': { outer: 'ZUBIN', straightIn: 'HUBAN', if: 'HALOR', faf: 'ESKIN' },
};
for (const [rwy, n] of Object.entries(APPROACH_NAMES)) {
  const r = RUNWAYS[rwy];
  const north = r.phys === 'N';
  const ifAlong = north ? 14 : 11;
  const iafAlt = north ? 5000 : 4000;
  // +1 when the outer side is to the right of the final approach course.
  const side = north === (r.heading === 260) ? 1 : -1;
  addFix(n.faf, approachPoint(rwy, 6.3), 'faf', 2000);
  addFix(n.if, approachPoint(rwy, ifAlong), 'if', north ? 4000 : 3000);
  addFix(n.outer, approachPoint(rwy, ifAlong, 6 * side), 'iaf', iafAlt);
  addFix(n.straightIn, approachPoint(rwy, ifAlong + 6), 'iaf', iafAlt);
  APPROACHES[rwy] = { rwy, iafs: [n.outer, n.straightIn], outer: n.outer, straightIn: n.straightIn, if: n.if, faf: n.faf, ifAlong, side };
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

// STAR feeder fixes: the straight-in IAFs are joined on a 45° cut from the side away from the parallel runway,
// 8 nm before the IAF, so the two straight-in streams never meet.
function feederFix(name, rwy) {
  const a = APPROACHES[rwy];
  const r = RUNWAYS[rwy];
  addFix(name, Geo.offset(FIXES[a.straightIn], r.heading + 180 - 45 * a.side, 8), 'enroute');
}
feederFix('NURPA', '26R');
feederFix('GIBRA', '26L');
feederFix('ULMAR', '08L');
feederFix('KUTRA', '08R');
// Lead-in to the 08L outer IAF, on the extension of the IAF→IF leg.
addFix('RAXOL', Geo.offset(FIXES.KELVO, Geo.bearing(FIXES.PIRAM, FIXES.KELVO), 12), 'enroute');

// SID first fixes: 4 nm beyond the departure end, splaying 15° away from the parallel runway
// so simultaneous departures diverge immediately.
const SID_FIRST = { '26R': 'ROKEL', '26L': 'SALMA', '08L': 'KORAN', '08R': 'LIPEX' };
for (const [rwy, name] of Object.entries(SID_FIRST)) {
  const r = RUNWAYS[rwy];
  const awayFromParallel = (r.phys === 'N') === (r.heading === 260) ? 15 : -15;
  addFix(name, Geo.offset(r.opp, r.heading + awayFromParallel, 4), 'sid');
}

// ---- Procedures per runway configuration ----
// STARs end at an IAF and continue with that runway's approach. Arrivals from the approach end use the
// straight-in IAF, the others the outer IAF; north arrivals land on the north runway, south ones on the south.
// `alts`: altitude constraints flown when "descending via" after the approach clearance (around 25 nm out).
const PROCS = {
  '26': {
    stars: [
      { name: 'BOGNA1R', rwy: '26R', fixes: ['BOGNA', 'SOTAX', 'NORAX'], alts: { SOTAX: 7000 } },
      { name: 'MIRLO1R', rwy: '26R', fixes: ['MIRLO', 'ARKOS', 'SOTAX', 'NORAX'], alts: { SOTAX: 7000 } },
      { name: 'FIRZO1R', rwy: '26R', fixes: ['FIRZO', 'ARKOS', 'SOTAX', 'NORAX'], alts: { SOTAX: 7000 } },
      { name: 'TIMBA1R', rwy: '26R', fixes: ['TIMBA', 'NURPA', 'MAVEK'], alts: { NURPA: 7000 } },
      { name: 'TELBA1R', rwy: '26R', fixes: ['TELBA', 'NURPA', 'MAVEK'], alts: { NURPA: 7000 } },
      { name: 'LAMSO1L', rwy: '26L', fixes: ['LAMSO', 'GIBRA', 'LUTOS'], alts: { GIBRA: 7000 } },
      { name: 'CORVU1L', rwy: '26L', fixes: ['CORVU', 'GIBRA', 'LUTOS'], alts: { GIBRA: 7000 } },
      { name: 'KOPAS1L', rwy: '26L', fixes: ['KOPAS', 'HEXOR', 'SUREK'], alts: { HEXOR: 7000 } },
      { name: 'DEXOR1L', rwy: '26L', fixes: ['DEXOR', 'NEKOS', 'SUREK'], alts: { NEKOS: 7000 } },
      { name: 'RUSKO1L', rwy: '26L', fixes: ['RUSKO', 'IRVAN', 'NEKOS', 'SUREK'], alts: { NEKOS: 7000 } },
      { name: 'VAREN1L', rwy: '26L', fixes: ['VAREN', 'DXT', 'NEKOS', 'SUREK'], alts: { NEKOS: 7000 } },
    ],
    sids: [
      { name: 'NOVAL2R', rwy: '26R', fixes: ['ROKEL', 'NIBEX', 'NOVAL'] },
      { name: 'ESTOR2R', rwy: '26R', fixes: ['ROKEL', 'NIBEX', 'ETRAX', 'ESTOR'] },
      { name: 'WOLFE2L', rwy: '26L', fixes: ['SALMA', 'LOVIS', 'WOLFE'] },
      { name: 'SUDAN2L', rwy: '26L', fixes: ['SALMA', 'SIPOR', 'SUDAN'] },
      { name: 'BELTA2R', rwy: '26R', fixes: ['ROKEL', 'NIBEX', 'ZEPRA', 'BELTA'] },
      { name: 'ELNAR2L', rwy: '26L', fixes: ['SALMA', 'KUTRA', 'ELNAR'] },
      { name: 'DAMEK2L', rwy: '26L', fixes: ['SALMA', 'SIPOR', 'DAMEK'] },
      { name: 'JUPAL2L', rwy: '26L', fixes: ['SALMA', 'SIPOR', 'EBRIK', 'JUPAL'] },
    ],
  },
  '08': {
    stars: [
      { name: 'BOGNA1D', rwy: '08L', fixes: ['BOGNA', 'SOTAX', 'KELVO'], alts: { SOTAX: 7000 } },
      { name: 'TIMBA1D', rwy: '08L', fixes: ['TIMBA', 'SOTAX', 'KELVO'], alts: { SOTAX: 7000 } },
      { name: 'TELBA1D', rwy: '08L', fixes: ['TELBA', 'OKR', 'SOTAX', 'KELVO'], alts: { SOTAX: 7000 } },
      { name: 'MIRLO1D', rwy: '08L', fixes: ['MIRLO', 'RAXOL', 'KELVO'], alts: { RAXOL: 7000 } },
      { name: 'FIRZO1D', rwy: '08L', fixes: ['FIRZO', 'ULMAR', 'PELOR'], alts: { ULMAR: 7000 } },
      { name: 'VAREN1E', rwy: '08R', fixes: ['VAREN', 'KUTRA', 'HUBAN'], alts: { KUTRA: 7000 } },
      { name: 'RUSKO1E', rwy: '08R', fixes: ['RUSKO', 'DXT', 'KUTRA', 'HUBAN'], alts: { KUTRA: 7000 } },
      { name: 'KOPAS1E', rwy: '08R', fixes: ['KOPAS', 'NEKOS', 'ZUBIN'], alts: { NEKOS: 7000 } },
      { name: 'DEXOR1E', rwy: '08R', fixes: ['DEXOR', 'NEKOS', 'ZUBIN'], alts: { NEKOS: 7000 } },
      { name: 'LAMSO1E', rwy: '08R', fixes: ['LAMSO', 'HEXOR', 'FOXEN', 'ZUBIN'], alts: { HEXOR: 7000, FOXEN: 5000 } },
      { name: 'CORVU1E', rwy: '08R', fixes: ['CORVU', 'HEXOR', 'FOXEN', 'ZUBIN'], alts: { HEXOR: 7000, FOXEN: 5000 } },
    ],
    sids: [
      { name: 'NOVAL3L', rwy: '08L', fixes: ['KORAN', 'ETRAX', 'NOVAL'] },
      { name: 'ESTOR3L', rwy: '08L', fixes: ['KORAN', 'ESTOR'] },
      { name: 'SUDAN3R', rwy: '08R', fixes: ['LIPEX', 'EBRIK', 'SUDAN'] },
      { name: 'WOLFE3R', rwy: '08R', fixes: ['LIPEX', 'SIPOR', 'WOLFE'] },
      { name: 'BELTA3L', rwy: '08L', fixes: ['KORAN', 'GOLVA', 'BELTA'] },
      { name: 'JUPAL3L', rwy: '08L', fixes: ['KORAN', 'JUPAL'] },
      { name: 'ELNAR3R', rwy: '08R', fixes: ['LIPEX', 'SIPOR', 'ELNAR'] },
      { name: 'DAMEK3R', rwy: '08R', fixes: ['LIPEX', 'MOSKA', 'IRVAN', 'DAMEK'] },
    ],
  },
};
// Full lateral route of a STAR: its fixes after the entry, then the approach from its IAF.
function starRoute(star) {
  return star.fixes.slice(1, -1).concat(approachFrom(star.rwy, star.fixes[star.fixes.length - 1]));
}

// Published holding patterns: inbound course, turn direction, minimum holding altitude.
// IAF holds: the outer IAF's inbound course leads straight on to the IF and its racetrack lies on the far side from
// the airport; the straight-in IAF's is the final approach course, turning away from the parallel runway.
const HOLDS = {
  BOGNA: { inbound: 180, turn: 'R', minAlt: 9000 },
  TIMBA: { inbound: 225, turn: 'R', minAlt: 9000 },
  LAMSO: { inbound: 265, turn: 'L', minAlt: 9000 },
  KOPAS: { inbound: 315, turn: 'R', minAlt: 9000 },
  DEXOR: { inbound: 360, turn: 'L', minAlt: 9000 },
  VAREN: { inbound: 85, turn: 'R', minAlt: 9000 },
  MIRLO: { inbound: 135, turn: 'L', minAlt: 9000 },
  SOTAX: { inbound: 175, turn: 'R', minAlt: 7000 },
  NURPA: { inbound: 215, turn: 'R', minAlt: 7000 },
  GIBRA: { inbound: 305, turn: 'L', minAlt: 7000 },
  HEXOR: { inbound: 300, turn: 'R', minAlt: 7000 },
  NEKOS: { inbound: 5, turn: 'R', minAlt: 7000 },
  ULMAR: { inbound: 120, turn: 'L', minAlt: 7000 },
  KUTRA: { inbound: 35, turn: 'R', minAlt: 7000 },
  RAXOL: { inbound: 170, turn: 'R', minAlt: 7000 },
  RVW: { inbound: 80, turn: 'R', minAlt: 4000 },
  OKR: { inbound: 225, turn: 'R', minAlt: 7000 },
  DXT: { inbound: 45, turn: 'L', minAlt: 7000 },
};
for (const a of Object.values(APPROACHES)) {
  const r = RUNWAYS[a.rwy];
  const away = a.side > 0 ? 'R' : 'L'; // turning towards the outer side
  HOLDS[a.outer] = { inbound: Math.round(Geo.bearing(FIXES[a.outer], FIXES[a.if])), turn: away === 'R' ? 'L' : 'R', minAlt: FIXES[a.outer].alt };
  HOLDS[a.straightIn] = { inbound: r.heading, turn: away, minAlt: FIXES[a.straightIn].alt };
}
const HOLD_SPEED = (alt) => (alt <= 14000 ? 230 : alt <= 20000 ? 240 : 265);
const HOLD_LEG = (alt) => (alt <= 14000 ? 60 : 90); // seconds

// Surface wind (direction it blows FROM); it veers and strengthens with height.
const WIND = { dir: 250, spd: 12 };
function windAt(alt) {
  const k = Math.min(alt, 25000) / 1000;
  return { dir: WIND.dir + k * 1.2, spd: WIND.spd + k * 1.6 };
}

const SID_TOP = 6000; // initial climb altitude on all SIDs

// ---- Aircraft performance ----
// vapp: final approach speed, vr: rotate, max: max IAS, climb/desc: ft/min, turn: deg/s
const TYPES = {
  A320: { wake: 'M', vapp: 138, vr: 145, max: 340, climb: 2500, desc: 2200, turn: 3 },
  A321: { wake: 'M', vapp: 142, vr: 150, max: 340, climb: 2300, desc: 2200, turn: 3 },
  B738: { wake: 'M', vapp: 145, vr: 150, max: 340, climb: 2500, desc: 2200, turn: 3 },
  E190: { wake: 'M', vapp: 130, vr: 135, max: 320, climb: 2800, desc: 2200, turn: 3 },
  DH8D: { wake: 'M', vapp: 120, vr: 115, max: 280, climb: 1800, desc: 1800, turn: 3 },
  A359: { wake: 'H', vapp: 145, vr: 155, max: 340, climb: 2200, desc: 2000, turn: 2.5 },
  B77W: { wake: 'H', vapp: 150, vr: 165, max: 340, climb: 2000, desc: 2000, turn: 2.5 },
  B744: { wake: 'H', vapp: 155, vr: 165, max: 340, climb: 1800, desc: 2000, turn: 2.5 },
};
const TYPE_WEIGHTS = ['A320', 'A320', 'A321', 'B738', 'B738', 'E190', 'DH8D', 'A359', 'B77W', 'B744'];

const AIRLINES = [
  { icao: 'BAW', name: 'Speedbird' }, { icao: 'EZY', name: 'Easy' }, { icao: 'RYR', name: 'Ryanair' },
  { icao: 'DLH', name: 'Lufthansa' }, { icao: 'AFR', name: 'Airfrans' }, { icao: 'KLM', name: 'KLM' },
  { icao: 'UAE', name: 'Emirates' }, { icao: 'VIR', name: 'Virgin' }, { icao: 'SAS', name: 'Scandinavian' },
  { icao: 'IBE', name: 'Iberia' }, { icao: 'AAL', name: 'American' }, { icao: 'UAL', name: 'United' },
];

// Outstations by direction, used for flight plan origins/destinations.
const OUTSTATIONS = {
  N: ['EKCH', 'ENGM', 'ESSA', 'EGPH'],
  E: ['EDDF', 'EDDM', 'LOWW', 'EHAM'],
  S: ['LEMD', 'LFMN', 'LIRF', 'LPPT'],
  W: ['KJFK', 'EIDW', 'CYYZ', 'KBOS'],
};
const FIX_DIRECTION = {
  BOGNA: 'N', MIRLO: 'N', TIMBA: 'N', LAMSO: 'E', KOPAS: 'S', DEXOR: 'S', VAREN: 'W',
  NOVAL: 'N', ESTOR: 'E', SUDAN: 'S', WOLFE: 'W',
  TELBA: 'E', FIRZO: 'W', RUSKO: 'S', CORVU: 'E', BELTA: 'N', ELNAR: 'W', DAMEK: 'S', JUPAL: 'E',
};
