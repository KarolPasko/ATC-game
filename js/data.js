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
addFix('GIBRA', { x: 26, y: 4 }, 'enroute');
addFix('NEKOS', { x: 0, y: -25 }, 'enroute');
addFix('ULMAR', { x: -26, y: 0 }, 'enroute');
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
addFix('KUTRA', { x: -22, y: -10 }, 'enroute');
addFix('LOVIS', { x: -19, y: 6 }, 'enroute');
addFix('MOSKA', { x: 6, y: -11 }, 'enroute');
addFix('NURPA', { x: 23, y: 19 }, 'enroute');
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

// Approach fixes: IAF (15 nm, 8 nm offset), IF (11 nm), FAF (6.3 nm, on the 3° glideslope at 2000 ft)
const APPROACHES = {
  '26R': ['NORAX', 'MELAN', 'RIVOS'],
  '26L': ['SUREK', 'TOBEK', 'LONKA'],
  '08L': ['KELVO', 'PIRAM', 'ODINA'],
  '08R': ['ZUBIN', 'HALOR', 'ESKIN'],
};
const IAF_SIDE = { '26R': 8, '26L': -8, '08L': -8, '08R': 8 }; // outer side of each runway
// North runways (08L/26R) fly their intermediate approach 1000 ft higher, so arrivals for the
// two parallels have vertical separation until established on their localizers.
for (const [rwy, [iaf, ifx, faf]] of Object.entries(APPROACHES)) {
  const north = RUNWAYS[rwy].phys === 'N';
  addFix(iaf, approachPoint(rwy, north ? 17 : 15, IAF_SIDE[rwy]), 'iaf', north ? 5000 : 4000);
  addFix(ifx, approachPoint(rwy, north ? 14 : 11, 0), 'if', north ? 4000 : 3000);
  addFix(faf, approachPoint(rwy, 6.3, 0), 'faf', 2000);
}

// SID first fixes: 4 nm beyond the departure end, splaying 15° away from the parallel runway
// so simultaneous departures diverge immediately.
const SID_FIRST = { '26R': 'ROKEL', '26L': 'SALMA', '08L': 'KORAN', '08R': 'LIPEX' };
for (const [rwy, name] of Object.entries(SID_FIRST)) {
  const r = RUNWAYS[rwy];
  const awayFromParallel = (r.phys === 'N') === (r.heading === 260) ? 15 : -15;
  addFix(name, Geo.offset(r.opp, r.heading + awayFromParallel, 4), 'sid');
}

// ---- Procedures per runway configuration ----
const PROCS = {
  '26': {
    stars: [
      { name: 'BOGNA1R', rwy: '26R', fixes: ['BOGNA', 'OSTEP', 'SOTAX', 'GOLVA', 'NORAX'] },
      { name: 'MIRLO1R', rwy: '26R', fixes: ['MIRLO', 'SOTAX', 'NORAX'] },
      { name: 'TIMBA1R', rwy: '26R', fixes: ['TIMBA', 'NURPA', 'NORAX'] },
      { name: 'LAMSO1L', rwy: '26L', fixes: ['LAMSO', 'GIBRA', 'SUREK'] },
      { name: 'KOPAS1L', rwy: '26L', fixes: ['KOPAS', 'HEXOR', 'SUREK'] },
      { name: 'DEXOR1L', rwy: '26L', fixes: ['DEXOR', 'NEKOS', 'SUREK'] },
      { name: 'VAREN1L', rwy: '26L', fixes: ['VAREN', 'ULMAR', 'KUTRA', 'FOXEN', 'SUREK'] },
      { name: 'TELBA1R', rwy: '26R', fixes: ['TELBA', 'OKR', 'NURPA', 'NORAX'] },
      { name: 'FIRZO1R', rwy: '26R', fixes: ['FIRZO', 'ARKOS', 'ZEPRA', 'GOLVA', 'NORAX'] },
      { name: 'RUSKO1L', rwy: '26L', fixes: ['RUSKO', 'IRVAN', 'MOSKA', 'SUREK'] },
      { name: 'CORVU1L', rwy: '26L', fixes: ['CORVU', 'HEXOR', 'SUREK'] },
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
      { name: 'BOGNA1D', rwy: '08L', fixes: ['BOGNA', 'SOTAX', 'KELVO'] },
      { name: 'MIRLO1D', rwy: '08L', fixes: ['MIRLO', 'KELVO'] },
      { name: 'TIMBA1D', rwy: '08L', fixes: ['TIMBA', 'SOTAX', 'KELVO'] },
      { name: 'LAMSO1E', rwy: '08R', fixes: ['LAMSO', 'GIBRA', 'NEKOS', 'ZUBIN'] },
      { name: 'KOPAS1E', rwy: '08R', fixes: ['KOPAS', 'NEKOS', 'ZUBIN'] },
      { name: 'DEXOR1E', rwy: '08R', fixes: ['DEXOR', 'NEKOS', 'ZUBIN'] },
      { name: 'VAREN1E', rwy: '08R', fixes: ['VAREN', 'ZUBIN'] },
      { name: 'TELBA1D', rwy: '08L', fixes: ['TELBA', 'OKR', 'ETRAX', 'ZEPRA', 'KELVO'] },
      { name: 'FIRZO1D', rwy: '08L', fixes: ['FIRZO', 'KELVO'] },
      { name: 'RUSKO1E', rwy: '08R', fixes: ['RUSKO', 'DXT', 'ZUBIN'] },
      { name: 'CORVU1E', rwy: '08R', fixes: ['CORVU', 'HEXOR', 'MOSKA', 'ZUBIN'] },
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
// Published holding patterns: inbound course, turn direction, minimum holding altitude.
const HOLDS = {
  BOGNA: { inbound: 180, turn: 'R', minAlt: 9000 },
  TIMBA: { inbound: 225, turn: 'R', minAlt: 9000 },
  LAMSO: { inbound: 265, turn: 'L', minAlt: 9000 },
  KOPAS: { inbound: 315, turn: 'R', minAlt: 9000 },
  DEXOR: { inbound: 360, turn: 'L', minAlt: 9000 },
  VAREN: { inbound: 85, turn: 'R', minAlt: 9000 },
  MIRLO: { inbound: 135, turn: 'L', minAlt: 9000 },
  SOTAX: { inbound: 175, turn: 'R', minAlt: 6000 },
  GIBRA: { inbound: 260, turn: 'R', minAlt: 6000 },
  NEKOS: { inbound: 5, turn: 'R', minAlt: 6000 },
  ULMAR: { inbound: 90, turn: 'L', minAlt: 6000 },
  NORAX: { inbound: 200, turn: 'R', minAlt: 5000 },
  SUREK: { inbound: 300, turn: 'L', minAlt: 4000 },
  KELVO: { inbound: 125, turn: 'L', minAlt: 5000 },
  ZUBIN: { inbound: 35, turn: 'R', minAlt: 4000 },
  RVW: { inbound: 80, turn: 'R', minAlt: 4000 },
  OKR: { inbound: 225, turn: 'R', minAlt: 7000 },
  DXT: { inbound: 45, turn: 'L', minAlt: 7000 },
};
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
