// Manchester (EGCC). Runways 05L/23R (3048 m) and 05R/23L (3050 m), 390 m apart, with runway 2 staggered to the
// south-west. In dual-runway operations arrivals land on 23R (05L) and departures leave from 23L (05R); departures
// for runway 2 cross runway 1 at D, F, G or H. Holds MIRSI (south-west), ROSUN (north) and DAYNE (south-east).
// Runway geometry, holds, navaids and SID end points are real, but their positions are approximate. The approach
// transition fixes (FF/IF/IA/NW/SE + runway) and the first SID fixes are simplified coded points.
// Not for real-world navigation.
AIRPORTS.EGCC = {
  icao: 'EGCC',
  name: 'Manchester',
  summary: 'Real layout, approximated · 23R arrivals and 23L departures, with departures crossing runway 23R',
  facts: ['Real airport, positions approximate', 'Runways 05L/23R · 05R/23L (390 m apart)', 'Dual-runway ops with runway crossings', 'MIRSI · ROSUN · DAYNE holds'],
  configs: { 23: '23R arr / 23L dep', '05': '05L arr / 05R dep', '23S': '23R single runway', '05S': '05L single runway' },
  notes: `<p>Manchester's layout and procedures here are a realistic simplification. Runway geometry, holds, navaids and SID end
    points are real but their positions are approximate, and the approach transition fixes and first SID fixes are simplified
    coded points. Don't use any of it for real navigation.</p>
    <p>Runway 1 (05L/23R) runs alongside the terminals; runway 2 (05R/23L) is 390 m to the south-east and staggered to the
    south-west. In the dual-runway configurations arrivals land on 23R (05L) and departures leave from 23L (05R), so
    <b>departures cross runway 1</b> at D, F, G or H. They stop at the stop bar (D1, F1, G1, H1), Ground hands them to Tower,
    and Tower clears them with <code>cross</code> (or right-click › Cross) once no arrival is within about 3 nm and nothing is
    rolling towards the crossing. A crossing aircraft occupies the runway until it reports vacated. The single-runway
    configurations use 23R or 05L for everything (departures from J1 or A1).</p>
    <p>Arrivals come in through the MIRSI (south-west), ROSUN (north) and DAYNE (south-east) holds, minimum FL70, then an RNAV
    transition to the ILS: SE23R, NW23R or IA23R → IF23R → FF23R. SIDs climb to 5000 ft (transition altitude 5000 ft) and end
    at EKLAD, ASMIM, DESIG, SANBA, LISTO, MONTY or KUXEM. The letter after the number is the runway: R 23R, Y 23L, S 05L, Z 05R.
    The scope also shows the Liverpool CTR and the Manchester Low Level Route (SFC–1300 ft).</p>`,

  build() {
    Object.assign(AIRPORT, {
      icao: 'EGCC', name: 'Manchester Airport', city: 'Manchester', control: 'Manchester Control',
      elevation: 0, transAlt: 5000, sidTop: 5000, radarRange: 55, ctrRadius: 50,
      axis: 51, defaultConfig: '23', pushDirs: { E: 'north-east', W: 'south-west' }, seqBuffer: 3,
      freqs: { GND: '121.850', TWR: '118.625', APP: '118.575', CTR: '133.800' },
      tmaLabel: 'MANCHESTER TMA  (simplified)', ctrLabel: 'MANCHESTER CTR SFC-3500',
      airlineWeights: {
        EXS: 9, RYR: 7, EZY: 6, TOM: 6, BAW: 1, SHT: 2, LOG: 3, EIN: 3, KLM: 3, DLH: 2, AFR: 2, SWR: 1, AUA: 1, BEL: 1,
        TAP: 1, VLG: 1, IBE: 1, SAS: 1, FIN: 1, THY: 2, UAE: 3, QTR: 2, ETD: 2, VIR: 2, AAL: 1, UAL: 1, DAL: 1, SIA: 1, CLX: 0,
      },
    });

    // ---- Runways (u along 051, v towards 321; runway 1 centred on the origin) ----
    defineRunways(51, [
      { phys: '1', ids: ['05L', '23R'], v: 0, u0: -1524, u1: 1524, width: 45, outer: -1 },
      { phys: '2', ids: ['05R', '23L'], v: -390, u0: -2850, u1: 200, width: 45, outer: -1 },
    ]);

    // Latitude/longitude to scope coordinates (nm from runway 1's midpoint).
    const LAT0 = 53.3544, LON0 = -2.2736;
    const ll = (lat, lon) => ({ x: (lon - LON0) * 60 * Math.cos(Geo.rad(LAT0)), y: (lat - LAT0) * 60 });
    const F = (name, p, type, alt) => addFix(name, p, type, alt);
    const P = (x, y) => ({ x, y });

    // VOR/DMEs
    F('MCT', ll(53.3572, -2.2622), 'vor'); F('POL', ll(53.7444, -2.1036), 'vor'); F('WAL', ll(53.3922, -3.1347), 'vor');
    F('TNT', ll(53.0539, -1.6700), 'vor'); F('GAM', ll(53.2808, -0.9483), 'vor');
    // Holds and the fixes leading to them
    F('ROSUN', ll(53.700, -2.300), 'enroute'); F('DAYNE', ll(53.130, -1.980), 'enroute'); F('MIRSI', ll(53.100, -3.000), 'enroute');
    F('BURNI', ll(53.490, -2.390), 'enroute'); F('AMLET', ll(53.260, -2.100), 'enroute');
    // STAR entry points
    F('LAKEY', P(-16, 42), 'entry'); F('SETEL', P(24, 38), 'entry');
    // SID end points
    F('EKLAD', P(-24, 30), 'exit'); F('ASMIM', P(9, 40), 'exit'); F('DESIG', P(34, 26), 'exit'); F('SANBA', P(40, 6), 'exit');
    F('LISTO', P(8, -40), 'exit'); F('MONTY', P(-30, -30), 'exit'); F('KUXEM', P(-40, -6), 'exit');

    // ---- ILS approaches with RNAV T-bar transitions: FAF 6.3 nm / 2000 ft, IF 12 nm / 3500 ft, IAFs 5000 ft ----
    // The arrival runways (23R, 05L) have an outer IAF on each side; runway 2 only on the side away from runway 1.
    const opts = { ifAlong: 12, ifAlt: 3500, iafAlt: 5000 };
    tBar('23R', { faf: 'FF23R', if: 'IF23R', straightIn: 'IA23R', outer: 'SE23R', outer2: 'NW23R' }, { ...opts, side: -1 });
    tBar('05L', { faf: 'FF05L', if: 'IF05L', straightIn: 'IA05L', outer: 'SE05L', outer2: 'NW05L' }, { ...opts, side: 1 });
    tBar('23L', { faf: 'FF23L', if: 'IF23L', straightIn: 'IA23L', outer: 'SE23L' }, { ...opts, side: -1 });
    tBar('05R', { faf: 'FF05R', if: 'IF05R', straightIn: 'IA05R', outer: 'SE05R' }, { ...opts, side: 1 });

    // First SID fixes: 4 nm beyond the departure end on the runway track.
    Object.assign(SID_FIRST, { '23R': 'MC232', '23L': 'MC231', '05L': 'MC052', '05R': 'MC051' });
    for (const [rwy, name] of Object.entries(SID_FIRST)) addFix(name, Geo.offset(RUNWAYS[rwy].opp, RUNWAYS[rwy].heading, 4), 'sid');

    // ---- Runway configurations: dual-runway (arrivals runway 1, departures runway 2) or single-runway ----
    Object.assign(CONFIGS, {
      23: { label: this.configs[23], arr: ['23R'], dep: ['23L'], wind: 245 },
      '05': { label: this.configs['05'], arr: ['05L'], dep: ['05R'], wind: 65 },
      '23S': { label: this.configs['23S'], arr: ['23R'], dep: ['23R'], wind: 245 },
      '05S': { label: this.configs['05S'], arr: ['05L'], dep: ['05L'], wind: 65 },
    });

    // STARs: entry, the hold, then a transition to an IAF of the landing runway.
    const STARS = {
      23: [
        { name: 'ROSUN1L', fixes: ['LAKEY', 'ROSUN', 'NW23R'], alts: { ROSUN: 7000 } },
        { name: 'ROSUN1S', fixes: ['SETEL', 'POL', 'ROSUN', 'NW23R'], alts: { POL: 9000, ROSUN: 7000 } },
        { name: 'ROSUN1G', fixes: ['GAM', 'POL', 'ROSUN', 'NW23R'], alts: { POL: 9000, ROSUN: 7000 } },
        { name: 'DAYNE1G', fixes: ['GAM', 'DAYNE', 'SE23R'], alts: { DAYNE: 7000 } },
        { name: 'DAYNE1T', fixes: ['TNT', 'DAYNE', 'SE23R'], alts: { DAYNE: 7000 } },
        { name: 'MIRSI1W', fixes: ['WAL', 'MIRSI', 'AMLET', 'SE23R'], alts: { MIRSI: 7000, AMLET: 6000 } },
      ],
      '05': [
        { name: 'ROSUN1L', fixes: ['LAKEY', 'ROSUN', 'BURNI', 'NW05L'], alts: { ROSUN: 7000, BURNI: 6000 } },
        { name: 'ROSUN1S', fixes: ['SETEL', 'POL', 'ROSUN', 'BURNI', 'NW05L'], alts: { POL: 9000, ROSUN: 7000, BURNI: 6000 } },
        { name: 'ROSUN1G', fixes: ['GAM', 'POL', 'ROSUN', 'BURNI', 'NW05L'], alts: { POL: 9000, ROSUN: 7000, BURNI: 6000 } },
        { name: 'DAYNE1G', fixes: ['GAM', 'DAYNE', 'SE05L'], alts: { DAYNE: 7000 } },
        { name: 'DAYNE1T', fixes: ['TNT', 'DAYNE', 'SE05L'], alts: { DAYNE: 7000 } },
        { name: 'MIRSI1W', fixes: ['WAL', 'MIRSI', 'IA05L'], alts: { MIRSI: 7000 } },
      ],
    };
    // SIDs: runway track to the first fix, then the route to the end point. Designator letter by runway:
    // R = 23R, Y = 23L, S = 05L, Z = 05R.
    const SIDS = {
      23: [['KUXEM', []], ['MONTY', []], ['LISTO', [], 2], ['SANBA', ['TNT']], ['EKLAD', []], ['ASMIM', ['BURNI']], ['DESIG', ['BURNI', 'POL']]],
      '05': [['DESIG', ['POL']], ['ASMIM', []], ['EKLAD', ['BURNI']], ['SANBA', []], ['LISTO', ['TNT'], 2], ['MONTY', ['AMLET']], ['KUXEM', ['BURNI']]],
    };
    const LETTER = { '23R': 'R', '23L': 'Y', '05L': 'S', '05R': 'Z' };
    for (const [cfg, c] of Object.entries(CONFIGS)) {
      const dir = cfg.startsWith('23') ? '23' : '05';
      const arr = c.arr[0], dep = c.dep[0];
      PROCS[cfg] = {
        stars: STARS[dir].map((s) => ({ ...s, rwy: arr })),
        sids: SIDS[dir].map(([exit, via, num = 1]) => ({ name: `${exit}${num}${LETTER[dep]}`, rwy: dep, fixes: [SID_FIRST[dep], ...via, exit] })),
      };
    }

    Object.assign(HOLDS, {
      ROSUN: { inbound: 175, turn: 'R', minAlt: 7000 },
      DAYNE: { inbound: 310, turn: 'L', minAlt: 7000 },
      MIRSI: { inbound: 60, turn: 'R', minAlt: 7000 },
      POL: { inbound: 200, turn: 'R', minAlt: 8000 },
      WAL: { inbound: 90, turn: 'R', minAlt: 8000 },
      TNT: { inbound: 330, turn: 'R', minAlt: 8000 },
      BURNI: { inbound: 160, turn: 'L', minAlt: 5000 },
      AMLET: { inbound: 300, turn: 'R', minAlt: 5000 },
    });
    iafHolds();

    Object.assign(OUTSTATIONS, {
      N: ['EGPH', 'EGPF', 'EGAA', 'BIKF', 'ENGM'],
      E: ['EHAM', 'EDDF', 'EDDM', 'LOWW', 'EKCH', 'OMDB', 'OTHH', 'OMAA', 'WSSS'],
      S: ['LEPA', 'LEMD', 'LPFR', 'LGAV', 'LIRF', 'LFPG', 'LEBL', 'GCTS', 'LTAI'],
      W: ['EIDW', 'KJFK', 'KATL', 'CYYZ', 'KORD', 'EICK'],
    });
    Object.assign(FIX_DIRECTION, {
      LAKEY: 'N', SETEL: 'E', GAM: 'E', TNT: 'S', WAL: 'W',
      EKLAD: 'N', ASMIM: 'N', DESIG: 'E', SANBA: 'E', LISTO: 'S', MONTY: 'S', KUXEM: 'W',
    });

    VIDEO_MAP = this.videoMap(ll);
  },

  // Video map: coastline and estuaries, rivers, towns, nearby airfields, Manchester and Liverpool CTRs,
  // the Manchester Low Level Route and a simplified TMA (all approximate).
  videoMap(ll) {
    const L = (pts) => pts.map(([lat, lon]) => ll(lat, lon));
    const U = Geo.vec(51), V = Geo.vec(-39);
    const rw = (u, v) => ({ x: U.x * u + V.x * v, y: U.y * u + V.y * v });
    const circle = (c, r, n = 14) => Array.from({ length: n }, (_, i) => Geo.offset(c, (360 / n) * i, r));
    const coast = L([[54.20, -2.85], [54.05, -2.86], [53.95, -3.02], [53.82, -3.06], [53.74, -3.03], [53.72, -2.95], [53.73, -2.85],
      [53.70, -2.92], [53.68, -2.98], [53.65, -3.02], [53.56, -3.10], [53.48, -3.05], [53.44, -3.01], [53.40, -2.99],
      [53.36, -2.93], [53.33, -2.83], [53.34, -2.75], [53.31, -2.78], [53.29, -2.88], [53.33, -2.96], [53.39, -3.01],
      [53.44, -3.04], [53.42, -3.10], [53.40, -3.18], [53.37, -3.19], [53.30, -3.12], [53.23, -3.04], [53.25, -3.13],
      [53.31, -3.26], [53.35, -3.32], [53.34, -3.42], [53.32, -3.50], [53.29, -3.60], [53.32, -3.83]]);
    const sea = [...coast, ...L([[53.32, -4.30], [54.30, -4.30], [54.30, -2.85]])];
    const rivers = [
      L([[53.41, -2.16], [53.415, -2.23], [53.43, -2.32], [53.44, -2.37], [53.42, -2.43], [53.39, -2.59], [53.35, -2.70], [53.34, -2.75]]), // Mersey
      L([[53.475, -2.27], [53.46, -2.33], [53.44, -2.42], [53.39, -2.55], [53.35, -2.68], [53.34, -2.75]]), // Manchester Ship Canal
      L([[53.19, -2.89], [53.20, -2.95], [53.22, -3.02], [53.23, -3.04]]), // Dee
    ];
    const town = (name, lat, lon, r) => { const c = ll(lat, lon); return { name, poly: circle(c, r), label: c }; };
    const towns = [
      town('MANCHESTER', 53.4808, -2.2426, 3.2), town('STOCKPORT', 53.4106, -2.1575, 1.6), town('LIVERPOOL', 53.4084, -2.9916, 3),
      town('WARRINGTON', 53.3900, -2.5970, 1.8), town('BOLTON', 53.5769, -2.4282, 1.8), town('WIGAN', 53.5450, -2.6325, 1.5),
      town('OLDHAM', 53.5409, -2.1114, 1.5), town('MACCLESFIELD', 53.2587, -2.1270, 1.2), town('CREWE', 53.0979, -2.4416, 1.3),
      town('STOKE', 53.0027, -2.1794, 2.4), town('CHESTER', 53.1934, -2.8931, 1.3), town('PRESTON', 53.7632, -2.7031, 1.8),
      town('BLACKBURN', 53.7480, -2.4820, 1.4), town('SHEFFIELD', 53.3811, -1.4701, 3), town('LEEDS', 53.8008, -1.5491, 3),
      town('HUDDERSFIELD', 53.6458, -1.7850, 1.5), town('ALTRINCHAM', 53.3838, -2.3530, 1.1), town('WILMSLOW', 53.3280, -2.2310, 0.8),
      town('KNUTSFORD', 53.3030, -2.3740, 0.7), town('RUNCORN', 53.3420, -2.7300, 1.2), town('ST HELENS', 53.4530, -2.7370, 1.3),
      town('SOUTHPORT', 53.6470, -3.0060, 1.2), town('BURNLEY', 53.7890, -2.2480, 1.3), town('BUXTON', 53.2591, -1.9110, 0.8),
    ];
    const af = (icao, name, lat, lon, hdg) => ({ icao, name, p: ll(lat, lon), hdg });
    const airfields = [
      af('EGGP', 'Liverpool', 53.3336, -2.8497, 87), af('EGCB', 'Barton', 53.4717, -2.3897, 90),
      af('EGNR', 'Hawarden', 53.1781, -2.9778, 43), af('EGNO', 'Warton', 53.7450, -2.8830, 72),
      af('EGNM', 'Leeds Bradford', 53.8659, -1.6606, 140), af('EGNX', 'East Midlands', 52.8311, -1.3281, 92),
      af('EGCN', 'Doncaster', 53.4805, -1.0106, 20),
    ];
    const areas = [
      { name: 'EGR311', limits: 'SFC-2200', poly: circle(ll(53.264, -2.951), 2, 16) }, // Capenhurst
    ];
    // Manchester CTR along the runways; Liverpool CTR round EGGP.
    const ctr = [rw(-14, -5), rw(-14, 4), rw(-7, 8), rw(8, 8), rw(14, 5), rw(14, -5), rw(7, -8), rw(-7, -8)];
    const gp = ll(53.3336, -2.8497);
    const extraCtrs = [{ name: 'LIVERPOOL CTR', poly: circle(gp, 8, 18) }];
    const tma = [P(-30, 30), P(-8, 34), P(16, 34), P(32, 22), P(34, 2), P(26, -22), P(6, -30), P(-16, -28), P(-32, -14), P(-36, 10)];
    // Low Level Route through the CTR, west of the airport (SFC-1300 ft).
    const lines = [
      { pts: [P(-10, 10), P(-7, -10)], label: 'LLR SFC-1300' },
      { pts: [P(-7, 10), P(-4, -10)] },
    ];
    function P(x, y) { return { x, y }; }
    return { seas: [sea], coasts: [coast], rivers, towns, airfields, areas, ctr, tma, extraCtrs, lines, sector: null };
  },

  // ---- Ground layout, in the runway-aligned frame (metres): u along 051 (north-east), v towards 321 (north-west) ----
  // Runway 1 (05L/23R) at v = 0 with the terminals to its north-west; runway 2 (05R/23L) at v = -390, staggered
  // south-west. Taxiway A runs along runway 1, taxiway V between the runways; D, F, G and H cross runway 1.
  chart: { box: { u0: -3050, u1: 1900, v0: -560, v1: 760 } },
  ground(G) {
    const { node, edge, chain, hold, holdingPoints, exits, stands, signs } = G;
    const N_HOLD = 100, N_EXIT = 140, A_V = 190, LANE_V = 300, STAND_V = 400;
    const S_HOLD = -100, V_V = -195, R2 = -390, R2_HOLD = R2 + 100, R2_EXIT = R2 + 140;
    const r1 = [], r2 = [], a = [], v = [], laneP = [], laneR = [];
    for (const rw of ['05L', '23R', '05R', '23L']) exits[rw] = [];

    // Runway 1 connectors on the terminal side; D, F, G and H continue across the runway to taxiway V and are
    // kept for crossings (arrivals vacate via the others, so they never meet departures holding short).
    const conns = [['A1', -1524, null, true], ['B1', -1150], ['D1', -380, 'D2'], ['F1', -100, 'F2'], ['G1', 100, 'G2'],
      ['H1', 800, 'H2'], ['E1', 1150], ['J1', 1524, null, true]];
    for (const [name, u, south, ils] of conns) {
      const link = south ? name[0] : name;
      const r = node(`R1@${u}`, u, 0, 'rwy');
      const h = hold(name, u, N_HOLD, r, { ils });
      const x = node(`${name}x`, u, N_EXIT, 'exit');
      const t = node(`A@${u}`, u, A_V);
      edge(r, h, link, 'conn'); edge(h, x, link, 'conn'); edge(x, t, link, 'conn');
      r1.push(r); a.push(t);
      if (!south) for (const rw of ['05L', '23R']) exits[rw].push({ name: link, rwyNode: r, exitNode: x, u });
      signs.push({ text: link, u: u + 18, v: N_HOLD + 50 });
      if (south) {
        const h2 = hold(south, u, S_HOLD, r);
        const tv = node(`V@${u}`, u, V_V);
        edge(r, h2, link, 'conn'); edge(h2, tv, link, 'conn');
        v.push(tv);
        signs.push({ text: link, u: u + 18, v: S_HOLD - 45 });
      }
    }
    holdingPoints['05L'] = 'A1';
    holdingPoints['23R'] = 'J1';
    // Rapid exits: C for 23R landings, K for 05L landings (angled ~28°).
    for (const [name, ur, ut, rw] of [['C', -500, -860, '23R'], ['K', 276, 636, '05L']]) {
      const r = node(`R1@${ur}`, ur, 0, 'rwy');
      const x = node(`${name}x`, ur + (ut - ur) * (N_EXIT / A_V), N_EXIT, 'exit');
      const t = node(`A@${ut}`, ut, A_V);
      edge(r, x, name, 'rapid'); edge(x, t, name, 'rapid');
      r1.push(r); a.push(t);
      exits[rw].push({ name, rwyNode: r, exitNode: x, u: ur, rapid: true });
      signs.push({ text: name, u: (ur + ut) / 2, v: 85 });
    }
    // Runway 2 connectors from taxiway V; V1 and V5 are the departure holding points at either end.
    [-2850, -2150, -1450, -700, 200].forEach((u, i) => {
      const name = `V${i + 1}`;
      const r = node(`R2@${u}`, u, R2, 'rwy');
      const h = hold(name, u, R2_HOLD, r, { ils: i === 0 || i === 4 });
      const x = node(`${name}x`, u, R2_EXIT, 'exit');
      const t = node(`V@${u}`, u, V_V);
      edge(r, h, name, 'conn'); edge(h, x, name, 'conn'); edge(x, t, name, 'conn');
      r2.push(r); v.push(t);
      for (const rw of ['05R', '23L']) exits[rw].push({ name, rwyNode: r, exitNode: x, u });
      signs.push({ text: name, u: u + 18, v: R2_HOLD + 45 });
    });
    holdingPoints['05R'] = 'V1';
    holdingPoints['23L'] = 'V5';

    // Terminal apron: taxilane P with links L, M and N from taxiway A; stands 1-12 nose-in to the terminals.
    for (const [name, u] of [['L', -250], ['M', 450], ['N', 1350]]) {
      const l = node(`P@${u}`, u, LANE_V);
      edge(node(`A@${u}`, u, A_V), l, name);
      a.push(`A@${u}`); laneP.push(l);
      signs.push({ text: name, u: u + 18, v: (A_V + LANE_V) / 2 });
    }
    [-150, -40, 70, 180, 290, 560, 670, 780, 890, 1000, 1110, 1220].forEach((u, i) => {
      const num = i + 1;
      const l = node(`P@${u}`, u, LANE_V), st = node(`ST${num}`, u, STAND_V, 'stand');
      edge(l, st, `stand ${num}`, 'stand');
      laneP.push(l);
      stands[num] = { num, node: st, lane: l, u, v: STAND_V, bridge: 92 };
    });
    // West apron: taxilane R with links W and Y; remote stands 21-25.
    for (const [name, u] of [['W', -1250], ['Y', -650]]) {
      const l = node(`R@${u}`, u, LANE_V);
      edge(node(`A@${u}`, u, A_V), l, name);
      a.push(`A@${u}`); laneR.push(l);
      signs.push({ text: name, u: u + 18, v: (A_V + LANE_V) / 2 });
    }
    [-1360, -1140, -1030, -920, -810].forEach((u, i) => {
      const num = 21 + i;
      const l = node(`R@${u}`, u, LANE_V), st = node(`ST${num}`, u, STAND_V, 'stand');
      edge(l, st, `stand ${num}`, 'stand');
      laneR.push(l);
      stands[num] = { num, node: st, lane: l, u, v: STAND_V, bridge: 0 };
    });
    laneR.push(node('R@-1450', -1450, LANE_V)); // room to push back from stand 21

    chain(a, 'A', 'main');
    chain(v, 'V', 'main');
    chain(laneP, 'P', 'lane');
    chain(laneR, 'R', 'lane');
    chain(r1, '05L/23R', 'rwy');
    chain(r2, '05R/23L', 'rwy');
    signs.push({ text: 'A', u: -1400, v: A_V + 14 }, { text: 'A', u: 1100, v: A_V + 14 });
    signs.push({ text: 'V', u: -2500, v: V_V + 14 }, { text: 'V', u: -1000, v: V_V + 14 }, { text: 'V', u: 500, v: V_V + 14 });
    signs.push({ text: 'P', u: 400, v: LANE_V + 14 }, { text: 'R', u: -980, v: LANE_V + 14 });
    return { TWY_W: 23 };
  },

  // ---- Chart decoration ----
  decor: {
    base({ rect, line, P, C, px, ctx }) {
      rect(-3150, -720, 1950, 980, C.grass2);
      line([P(-3150, -720), P(1950, -720), P(1950, 980), P(-3150, 980), P(-3150, -720)], '#4f6255', Math.max(px, 2), [14, 8]);
      line([P(-3030, -600), P(1830, -600), P(1830, 860), P(-3030, 860), P(-3030, -600)], C.road, 7);
      rect(-300, 230, 1420, 510, C.apron); // terminal apron
      rect(-1420, 230, -600, 470, C.apron); // west apron
      rect(-200, 700, 1300, 830, '#2f363c'); // car parks
      ctx.strokeStyle = '#4b555c'; ctx.lineWidth = Math.max(px * 0.8, 0.6);
      for (let u = -190; u < 1300; u += 12) for (const [v0, v1] of [[705, 760], [770, 825]]) { ctx.beginPath(); ctx.moveTo(u, v0); ctx.lineTo(u, v1); ctx.stroke(); }
      line([P(-300, 505), P(1420, 505)], 'rgba(230,235,238,0.55)', 1.2, [8, 6]); // apron service road
      line([P(-1500, 920), P(1900, 920)], C.road, 9); // landside road
      line([P(-300, 690), P(1420, 690)], C.road, 5);
    },
    buildings({ rect, C, ctx }) {
      rect(-300, 510, 120, 640, C.building); rect(-280, 530, 100, 620, C.building2); // T3
      rect(140, 510, 640, 660, C.building); rect(160, 530, 620, 640, C.building2); // T1
      rect(700, 510, 1420, 680, C.building); rect(720, 530, 1400, 660, C.building2); // T2
      for (let u = 200; u <= 600; u += 100) rect(u - 1, 530, u + 1, 640, C.building);
      for (let u = 800; u <= 1300; u += 125) rect(u - 1, 530, u + 1, 660, C.building);
      ctx.fillStyle = '#4b5d6e'; ctx.beginPath(); ctx.arc(-470, 600, 13, 0, Math.PI * 2); ctx.fill(); // tower
      rect(1600, 200, 1690, 270, '#4b5560'); // fire station
      rect(1560, 330, 1820, 520, '#46525c'); // maintenance hangars
      rect(-1420, 490, -900, 600, '#3f4950'); // World Freight Terminal
    },
    labels({ name, big }) {
      name('T1', 390, 585); name('T2', 1060, 595); name('T3', -90, 575);
      if (!big) return;
      name('TWR', -470, 635, '#9fb3c3'); name('RFFS', 1645, 300, '#9fb3c3'); name('MAINTENANCE', 1690, 425, '#9fb3c3');
      name('WORLD FREIGHT', -1160, 545, '#9fb3c3'); name('CAR PARKS', 550, 765, '#9fb3c3');
    },
  },
};
