// Ravenwood International (EGRV): a fictional airport with parallel runways 08L/26R (north) and 08R/26L (south),
// the terminal between them, and its own STARs, SIDs, holds and video map.
AIRPORTS.EGRV = {
  icao: 'EGRV',
  name: 'Ravenwood International',
  summary: 'Fictional airport · parallel runways 08L/26R and 08R/26L, both used for arrivals and departures',
  facts: ['Fictional, south-west coast', 'Parallel runways 08L/26R · 08R/26L', 'Mixed mode on both runways', '24 stands · terminal between the runways'],
  configs: { 26: 'Runways 26L / 26R', '08': 'Runways 08L / 08R' },
  notes: `<p>Ravenwood International is fictional. Parallel runways 08L/26R (north) and 08R/26L (south) are 1.4 km apart with the
    terminal between them, and both take arrivals and departures. Departures use holding points A1/A7 (north runway) and B1/B7
    (south); arrivals vacate via the rapid exits K1–K4 and M1–M4 or the connectors.</p>
    <p>Arrivals enter on 11 STARs and fly an RNAV T-bar transition to the ILS (outer IAF, straight-in IAF, IF, FAF). The north
    runway's approach is 1000 ft higher than the south one's, so arrivals stay separated until established. SIDs climb to
    6000 ft (transition altitude 6000 ft) and splay 15° away from the parallel runway.</p>`,

  build() {
    Object.assign(AIRPORT, {
      icao: 'EGRV', name: 'Ravenwood International', city: 'Ravenwood',
      elevation: 0, transAlt: 6000, sidTop: 6000, radarRange: 55, ctrRadius: 50,
      axis: 80, defaultConfig: '26', pushDirs: { E: 'east', W: 'west' },
      freqs: { GND: '121.800', TWR: '118.500', APP: '119.725', CTR: '128.400' },
      tmaLabel: 'RAVENWOOD TMA  2500-FL195', ctrLabel: 'EGRV CTR SFC-2500',
    });

    // ---- Runways: two parallels 1389 m apart, 3704 m long ----
    defineRunways(80, [
      { phys: 'N', ids: ['08L', '26R'], v: 694.5, u0: -1852, u1: 1852, width: 60, outer: 1 },
      { phys: 'S', ids: ['08R', '26L'], v: -694.5, u0: -1852, u1: 1852, width: 60, outer: -1 },
    ]);

    // ---- Fixes ----
    const F = (name, x, y, type) => addFix(name, { x, y }, type);
    // Entry fixes (arrivals spawn here)
    F('BOGNA', 0, 46, 'entry'); F('TIMBA', 33, 33, 'entry'); F('LAMSO', 46, 3, 'entry'); F('KOPAS', 31, -34, 'entry');
    F('DEXOR', -3, -46, 'entry'); F('VAREN', -46, -6, 'entry'); F('MIRLO', -31, 34, 'entry');
    // Exit fixes (departures hand off around here)
    F('NOVAL', -10, 43, 'exit'); F('ESTOR', 43, 17, 'exit'); F('SUDAN', 10, -43, 'exit'); F('WOLFE', -43, 12, 'exit');
    // Enroute / transition fixes
    F('SOTAX', 2, 25, 'enroute'); F('NEKOS', 0, -25, 'enroute'); F('FOXEN', -6, -14, 'enroute'); F('NIBEX', -13, 15, 'enroute');
    F('ETRAX', 13, 27, 'enroute'); F('SIPOR', -11, -16, 'enroute'); F('EBRIK', 16, -20, 'enroute'); F('ARKOS', -20, 30, 'enroute');
    F('BELTA', 20, 38, 'exit'); F('CORVU', 38, -15, 'entry'); F('DAMEK', -18, -35, 'exit'); F('ELNAR', -36, -22, 'exit');
    F('FIRZO', -36, 26, 'entry'); F('GOLVA', 12, 15, 'enroute'); F('HEXOR', 25, -13, 'enroute'); F('IRVAN', -9, -32, 'enroute');
    F('JUPAL', 36, -5, 'exit'); F('LOVIS', -19, 6, 'enroute'); F('MOSKA', 6, -11, 'enroute'); F('OSTEP', -4, 35, 'enroute');
    F('PRAVO', 16, -34, 'enroute'); F('RUSKO', -28, -38, 'entry'); F('TELBA', 35, 28, 'entry'); F('VEXAN', -33, 8, 'enroute');
    F('YAMIK', 31, 9, 'enroute'); F('ZEPRA', -4, 17, 'enroute');
    // VOR/DME beacons
    F('RVW', 1.5, -2.4, 'vor'); F('OKR', 27, 26, 'vor'); F('DXT', -24, -25, 'vor');

    // ---- Approaches: pre-made RNAV transitions to the ILS for every runway end (see approachSet in data.js) ----
    //   FAF  on the centreline at 6.3 nm, 2000 ft (on the 3° glideslope).
    //   IF   11 nm / 3000 ft for the south runways, 14 nm / 4000 ft for the north ones, so arrivals for the two
    //        parallels keep 1000 ft apart until established, and always join the glideslope from below.
    //   Straight-in IAF 6 nm behind the IF; base IAF and downwind on the side away from the parallel runway, with
    //   arcs onto base and final. South 4000 ft, north 5000 ft.
    const NAMES = {
      '26R': { straightIn: 'MAVEK', if: 'MELAN', faf: 'RIVOS', side: { base: 'NORAX', dw: 'DOLVA', de: 'DE26R', bt: 'BT26R' } },
      '26L': { straightIn: 'LUTOS', if: 'TOBEK', faf: 'LONKA', side: { base: 'SUREK', dw: 'SAVOK', de: 'DE26L', bt: 'BT26L' } },
      '08L': { straightIn: 'PELOR', if: 'PIRAM', faf: 'ODINA', side: { base: 'KELVO', dw: 'KIRNA', de: 'DE08L', bt: 'BT08L' } },
      '08R': { straightIn: 'HUBAN', if: 'HALOR', faf: 'ESKIN', side: { base: 'ZUBIN', dw: 'ZELOT', de: 'DE08R', bt: 'BT08R' } },
    };
    for (const [rwy, n] of Object.entries(NAMES)) {
      const r = RUNWAYS[rwy], north = r.phys === 'N';
      const side = north === (r.heading === 260) ? 1 : -1; // +1 when the outer side is right of the final approach course
      approachSet(rwy, { ...n, sides: { [side]: n.side } }, {
        ifAlong: north ? 14 : 11, ifAlt: north ? 4000 : 3000, iafAlt: north ? 5000 : 4000, primary: side,
      });
    }

    // STAR feeder fixes: the straight-in IAFs are joined on a 45° cut from the side away from the parallel runway,
    // 8 nm before the IAF, so the two straight-in streams never meet.
    const feederFix = (name, rwy) => {
      const a = APPROACHES[rwy];
      addFix(name, Geo.offset(FIXES[a.straightIn], RUNWAYS[rwy].heading + 180 - 45 * a.side, 8), 'enroute');
    };
    feederFix('NURPA', '26R'); feederFix('GIBRA', '26L'); feederFix('ULMAR', '08L'); feederFix('KUTRA', '08R');
    // Lead-in to the 08L base IAF, on the extension of the base leg.
    addFix('RAXOL', Geo.offset(FIXES.KELVO, Geo.bearing(FIXES.BT08L, FIXES.KELVO), 12), 'enroute');

    // SID first fixes: 4 nm beyond the departure end, splaying 15° away from the parallel runway.
    Object.assign(SID_FIRST, { '26R': 'ROKEL', '26L': 'SALMA', '08L': 'KORAN', '08R': 'LIPEX' });
    for (const [rwy, name] of Object.entries(SID_FIRST)) {
      const r = RUNWAYS[rwy];
      const away = (r.phys === 'N') === (r.heading === 260) ? 15 : -15;
      addFix(name, Geo.offset(r.opp, r.heading + away, 4), 'sid');
    }

    // ---- Procedures per runway configuration ----
    // STARs end at an IAF and continue with that runway's approach. Arrivals from the approach end use the
    // straight-in IAF, the others the outer IAF; north arrivals land on the north runway, south ones on the south.
    // `alts`: altitude constraints flown when "descending via" after the approach clearance.
    Object.assign(CONFIGS, {
      26: { label: this.configs[26], arr: ['26L', '26R'], dep: ['26L', '26R'], wind: 255 },
      '08': { label: this.configs['08'], arr: ['08L', '08R'], dep: ['08L', '08R'], wind: 75 },
    });
    Object.assign(PROCS, {
      26: {
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
    });

    // Published holding patterns: inbound course, turn direction, minimum holding altitude.
    Object.assign(HOLDS, {
      BOGNA: { inbound: 180, turn: 'R', minAlt: 9000 }, TIMBA: { inbound: 225, turn: 'R', minAlt: 9000 },
      LAMSO: { inbound: 265, turn: 'L', minAlt: 9000 }, KOPAS: { inbound: 315, turn: 'R', minAlt: 9000 },
      DEXOR: { inbound: 360, turn: 'L', minAlt: 9000 }, VAREN: { inbound: 85, turn: 'R', minAlt: 9000 },
      MIRLO: { inbound: 135, turn: 'L', minAlt: 9000 }, SOTAX: { inbound: 175, turn: 'R', minAlt: 7000 },
      NURPA: { inbound: 215, turn: 'R', minAlt: 7000 }, GIBRA: { inbound: 305, turn: 'L', minAlt: 7000 },
      HEXOR: { inbound: 300, turn: 'R', minAlt: 7000 }, NEKOS: { inbound: 5, turn: 'R', minAlt: 7000 },
      ULMAR: { inbound: 120, turn: 'L', minAlt: 7000 }, KUTRA: { inbound: 35, turn: 'R', minAlt: 7000 },
      RAXOL: { inbound: 170, turn: 'R', minAlt: 7000 }, RVW: { inbound: 80, turn: 'R', minAlt: 4000 },
      OKR: { inbound: 225, turn: 'R', minAlt: 7000 }, DXT: { inbound: 45, turn: 'L', minAlt: 7000 },
    });
    iafHolds();

    // Outstations by direction, used for flight plan origins/destinations.
    Object.assign(OUTSTATIONS, {
      N: ['EKCH', 'ENGM', 'ESSA', 'EGPH'], E: ['EDDF', 'EDDM', 'LOWW', 'EHAM'],
      S: ['LEMD', 'LFMN', 'LIRF', 'LPPT'], W: ['KJFK', 'EIDW', 'CYYZ', 'KBOS'],
    });
    Object.assign(FIX_DIRECTION, {
      BOGNA: 'N', MIRLO: 'N', TIMBA: 'N', LAMSO: 'E', KOPAS: 'S', DEXOR: 'S', VAREN: 'W',
      NOVAL: 'N', ESTOR: 'E', SUDAN: 'S', WOLFE: 'W',
      TELBA: 'E', FIRZO: 'W', RUSKO: 'S', CORVU: 'E', BELTA: 'N', ELNAR: 'W', DAMEK: 'S', JUPAL: 'E',
    });

    VIDEO_MAP = this.videoMap();
  },

  // Video map (fictional but plausible): coastline, river, towns, nearby airfields, danger/restricted areas,
  // the CTR and TMA, and the approach sector split. Coordinates in nm (x east, y north).
  videoMap() {
    const U = Geo.vec(80), V = Geo.vec(350);
    const rw = (u, v) => ({ x: U.x * u + V.x * v, y: U.y * u + V.y * v });
    const circle = (c, r, n = 24) => Array.from({ length: n }, (_, i) => Geo.offset(c, (360 / n) * i, r));
    const P = (x, y) => ({ x, y });
    // Sea to the south-west; the coast runs from the north-west round to the south.
    const coast = [P(-64, 62), P(-62, 40), P(-60, 24), P(-50, 18), P(-44, 9), P(-38, 4), P(-34, -4), P(-31, -11), P(-27, -16), P(-24, -23),
      P(-19, -29), P(-14, -34), P(-8, -40), P(-2, -46), P(3, -52), P(6, -62)];
    const sea = [...coast, P(6, -90), P(-100, -90), P(-100, 62)];
    const river = [P(48, 40), P(38, 33), P(30, 29), P(22, 24), P(15, 17), P(9, 11), P(3, 7), P(-4, 5), P(-11, 3),
      P(-17, 0), P(-23, -3), P(-29, -5), P(-35, -2)];
    const towns = [
      { name: 'RAVENWOOD', poly: [P(3, -3.5), P(7, -2.5), P(10, -4), P(10.5, -7), P(8, -9.5), P(4, -9), P(2, -6.5)], label: P(6.5, -6) },
      { name: 'ASHBY', poly: circle(P(-14, 13), 1.6, 10), label: P(-14, 13) },
      { name: 'KELMOUTH', poly: [P(-29, -12), P(-26, -11), P(-24.5, -13.5), P(-26, -16), P(-28.5, -15.5)], label: P(-26.5, -13.5) },
      { name: 'STANFIELD', poly: circle(P(21, -16), 1.8, 10), label: P(21, -16) },
      { name: 'NORTHAM', poly: circle(P(7, 31), 1.4, 10), label: P(7, 31) },
    ];
    const airfields = [
      { icao: 'EGRA', name: 'Ashby', p: P(-16.5, 16.5), hdg: 30 },
      { icao: 'EGKM', name: 'Kelmouth', p: P(-23, -17.5), hdg: 110 },
      { icao: 'EGSF', name: 'Stanfield', p: P(24.5, -20.5), hdg: 60 },
    ];
    const areas = [
      { name: 'EGD201', limits: 'SFC-FL050', poly: [P(27, -25), P(36, -23), P(38.5, -32), P(29.5, -35)] },
      { name: 'EGD322', limits: 'SFC-FL120', poly: [P(-52, -18), P(-42, -20), P(-40, -31), P(-50, -34), P(-56, -27)] },
      { name: 'EGR105', limits: 'SFC-2500', poly: circle(P(-7, -21), 2, 16) },
    ];
    // CTR: a box along the runways (12 nm each way) widening to 6 nm either side.
    const ctr = [rw(-13, -3), rw(-13, 3), rw(-6, 6), rw(6, 6), rw(13, 3), rw(13, -3), rw(6, -6), rw(-6, -6)];
    const tma = [P(-12, 47), P(14, 47), P(36, 38), P(48, 18), P(49, -8), P(40, -30), P(22, -45), P(-4, -48),
      P(-26, -40), P(-44, -26), P(-49, -4), P(-46, 18), P(-32, 38)];
    // Approach sector split along the runway axis (north / south).
    const sector = [rw(-50, 0.4), rw(50, 0.4)];
    return {
      seas: [sea], coasts: [coast], rivers: [river], towns, airfields, areas, ctr, tma, sector,
      sectorLabels: ['APP N', 'APP S'],
    };
  },

  // ---- Ground layout, in the runway-aligned frame (metres): u along 080 (east), v towards 350 (north) ----
  // Runway 08L/26R at v = +694.5, 08R/26L at v = -694.5; parallel taxiways A (north) and B (south), apron taxilanes
  // P and Q, cross taxiways E and F, and the terminal between the runways.
  chart: { fit: { w: 4200, h: 1900, cx: 0, cy: 0 } },
  ground(G) {
    const { node, edge, chain, hold, holdingPoints, exits, stands, signs } = G;
    const RWY_V = 694.5, TWY_V = 494.5, HOLD_V = 604.5, EXIT_V = 545, LANE_V = 380, STAND_V = 262;
    const sides = [
      { s: 1, twy: 'A', lane: 'P', link: 'J', exitPre: 'K', rwyW: '08L', rwyE: '26R', stand0: 1 },
      { s: -1, twy: 'B', lane: 'Q', link: 'H', exitPre: 'M', rwyW: '08R', rwyE: '26L', stand0: 21 },
    ];
    const CONNECTORS = [-1852, -1250, -600, 0, 600, 1250, 1852];
    // Rapid exits: [runway u, taxiway u, landing direction]
    const RAPID = [[250, -110, 260], [-450, -810, 260], [-250, 110, 80], [450, 810, 80]];
    const STAND_U = Array.from({ length: 12 }, (_, i) => -825 + i * 150);
    const LINKS = [-600, 0, 600];

    for (const sd of sides) {
      const { s } = sd;
      const rwyNodes = [], twyNodes = [], laneNodes = [];
      const phys = s > 0 ? 'N' : 'S';
      exits[sd.rwyW] = []; exits[sd.rwyE] = [];
      // Connectors with holding points (pattern B ILS markings on the end connectors)
      CONNECTORS.forEach((u, i) => {
        const name = `${sd.twy}${i + 1}`;
        const r = node(`R${phys}${u}`, u, s * RWY_V, 'rwy');
        const h = hold(name, u, s * HOLD_V, r, { ils: Math.abs(u) > 1800 });
        const x = node(`${name}x`, u, s * EXIT_V, 'exit');
        const t = node(`${sd.twy}@${u}`, u, s * TWY_V);
        edge(r, h, name, 'conn'); edge(h, x, name, 'conn'); edge(x, t, name, 'conn');
        rwyNodes.push(r); twyNodes.push(t);
        for (const rw of [sd.rwyW, sd.rwyE]) exits[rw].push({ name, rwyNode: r, exitNode: x, u });
        signs.push({ text: name, u: u + 18, v: s * (HOLD_V - 40) });
      });
      holdingPoints[sd.rwyW] = `${sd.twy}1`;
      holdingPoints[sd.rwyE] = `${sd.twy}7`;
      // Rapid exit taxiways (angled ~30°)
      RAPID.forEach(([ur, ut, dir], i) => {
        const name = `${sd.exitPre}${i + 1}`;
        const r = node(`R${phys}${ur}`, ur, s * RWY_V, 'rwy');
        const k = (s * RWY_V - s * EXIT_V) / (s * RWY_V - s * TWY_V);
        const x = node(`${name}x`, ur + (ut - ur) * k, s * EXIT_V, 'exit');
        const t = node(`${sd.twy}@${ut}`, ut, s * TWY_V);
        edge(r, x, name, 'rapid'); edge(x, t, name, 'rapid');
        rwyNodes.push(r); twyNodes.push(t);
        const rw = dir === 260 ? sd.rwyE : sd.rwyW;
        exits[rw].push({ name, rwyNode: r, exitNode: x, u: ur, rapid: true });
        signs.push({ text: name, u: (ur + ut) / 2, v: s * (TWY_V + 105) });
      });
      // Apron links (J1-3 north, H1-3 south) and the taxilane
      LINKS.forEach((u, i) => {
        const name = `${sd.link}${i + 1}`;
        const l = node(`${sd.lane}@${u}`, u, s * LANE_V);
        edge(`${sd.twy}@${u}`, l, name);
        laneNodes.push(l);
        signs.push({ text: name, u: u + 20, v: s * ((TWY_V + LANE_V) / 2) });
      });
      // Stands, nose-in towards the terminal
      STAND_U.forEach((u, i) => {
        const num = sd.stand0 + i;
        const l = node(`${sd.lane}@${u}`, u, s * LANE_V);
        const st = node(`ST${num}`, u, s * STAND_V, 'stand');
        edge(l, st, `stand ${num}`, 'stand');
        laneNodes.push(l);
        stands[num] = { num, node: st, lane: l, u, v: s * STAND_V, bridge: 94 };
      });
      // Taxilane ends join the cross taxiways E (west) and F (east)
      const lw = node(`${sd.lane}@-1100`, -1100, s * LANE_V), le = node(`${sd.lane}@1100`, 1100, s * LANE_V);
      laneNodes.push(lw, le);
      edge(lw, node(`E@${s * LANE_V}`, -1250, s * LANE_V), sd.lane, 'lane');
      edge(le, node(`F@${s * LANE_V}`, 1250, s * LANE_V), sd.lane, 'lane');
      chain(twyNodes, sd.twy, 'main');
      chain(laneNodes, sd.lane, 'lane');
      chain(rwyNodes, phys === 'N' ? '08L/26R' : '08R/26L', 'rwy');
      signs.push({ text: sd.twy, u: -1550, v: s * TWY_V + 14 }, { text: sd.twy, u: 1000, v: s * TWY_V + 14 });
      signs.push({ text: sd.lane, u: -1000, v: s * LANE_V + 14 });
    }
    // Cross taxiways E and F link both sides around the terminal.
    for (const [name, u] of [['E', -1250], ['F', 1250]]) {
      const list = [`A@${u}`, node(`${name}@${LANE_V}`, u, LANE_V), node(`${name}@0`, u, 0), node(`${name}@${-LANE_V}`, u, -LANE_V), `B@${u}`];
      for (let i = 1; i < list.length; i++) edge(list[i - 1], list[i], name);
      signs.push({ text: name, u: u + 16, v: 120 });
    }
    return { TWY_W: 23 };
  },

  // ---- Chart decoration: boundary, aprons, roads, buildings and their labels ----
  decor: {
    base({ rect, line, P, C, px, ctx }) {
      // Airport boundary, perimeter road, landside
      rect(-2700, -1180, 2700, 1180, C.grass2);
      line([P(-2700, -1180), P(2700, -1180), P(2700, 1180), P(-2700, 1180), P(-2700, -1180)], '#4f6255', Math.max(px, 2), [14, 8]);
      line([P(-2560, -1060), P(2560, -1060), P(2560, 1060), P(-2560, 1060), P(-2560, -1060)], C.road, 7);
      // Aprons, cargo apron and car parks
      rect(-1150, 150, 1150, 440, C.apron);
      rect(-1150, -440, 1150, -150, C.apron);
      rect(-1700, -130, -1290, 130, C.apron); // cargo / GA apron
      rect(-1240, -140, -975, -25, '#2f363c'); rect(-1240, 25, -975, 140, '#2f363c'); // car parks
      ctx.strokeStyle = '#4b555c'; ctx.lineWidth = Math.max(px * 0.8, 0.6);
      for (let u = -1230; u < -980; u += 12) for (const [v0, v1] of [[-135, -82], [-78, -30], [30, 78], [82, 135]]) { ctx.beginPath(); ctx.moveTo(u, v0); ctx.lineTo(u, v1); ctx.stroke(); }
      // Service roads around the aprons (white dashed)
      for (const sg of [1, -1]) line([P(-1150, sg * 432), P(1150, sg * 432)], 'rgba(230,235,238,0.55)', 1.2, [8, 6]);
      line([P(-1270, -470), P(-1270, 470)], 'rgba(230,235,238,0.4)', 1.2, [8, 6]);
      line([P(-1250, 0), P(-1300, 0)], C.twy, 23); // stub to the cargo apron
    },
    buildings({ rect, C, ctx }) {
      // Terminal with roof detail, tower, fire station, hangars
      rect(-950, -150, 950, 150, C.building);
      rect(-900, -100, 900, 100, C.building2);
      for (let u = -800; u <= 800; u += 200) rect(u - 1, -100, u + 1, 100, C.building);
      ctx.fillStyle = '#4b5d6e'; ctx.beginPath(); ctx.arc(-1105, 0, 13, 0, Math.PI * 2); ctx.fill(); // tower
      rect(1120, -35, 1190, 35, '#4b5560'); // fire station
      rect(1185, -20, 1240, 20, '#3f4950');
      rect(-1650, 25, -1540, 105, '#46525c'); rect(-1650, -105, -1540, -25, '#46525c'); // hangars
    },
    labels({ name, big }) {
      name('TERMINAL', 0, 0);
      if (!big) return;
      name('TWR', -1105, -30, '#9fb3c3'); name('RFFS', 1155, -55, '#9fb3c3'); name('CARGO / GA', -1495, 0, '#9fb3c3');
      name('P', -1107, -83, '#9fb3c3'); name('P', -1107, 83, '#9fb3c3');
    },
  },
};
