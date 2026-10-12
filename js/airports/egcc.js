// Manchester (EGCC), from the UK AIP where the research found it: runway 05L/23R (3048 m, thresholds displaced 427 m and
// 183 m) next to the terminals, and runway 05R/23L (3050 m, 23L displaced 184 m) 390 m to the south-east and staggered
// 1849 m to the south-west. Dual-runway operations: westerly arrivals 23R / departures 23L (departures cross runway 1),
// easterly arrivals 05R / departures 05L (arrivals cross runway 1); single-runway operations on runway 1. Holds ROSUN
// (north), MIRSI (north-west) and DAYNE (south-east). Runway, hold, navaid and some SID fix positions are real; STAR
// entry points, some SID fixes and the taxiway layout are approximations, and the approach transition fixes are
// simplified coded points. Not for real-world navigation.
AIRPORTS.EGCC = {
  icao: 'EGCC',
  name: 'Manchester',
  summary: 'Real layout, approximated · dual-runway operations with runway crossings · ROSUN, MIRSI and DAYNE holds',
  facts: ['Real airport, from the UK AIP where possible', 'Runways 05L/23R · 05R/23L (390 m apart, staggered)', 'Runway crossings · displaced thresholds', 'GA ramp on the South Side'],
  configs: { 23: '23R arr / 23L dep', '05': '05R arr / 05L dep', '23S': '23R single runway', '05S': '05L single runway' },
  notes: `<p>Manchester here follows the UK AIP where the research could find it: runway lengths, thresholds (05L and 23R are
    displaced), the 390 m spacing and 1849 m stagger of runway 2, the ROSUN, MIRSI and DAYNE holds and the local VORs. STAR
    entry points, some SID fixes and the taxiways are approximate, and the approach transition fixes are simplified coded
    points. Don't use any of it for real navigation.</p>
    <p><b>Runway use.</b> Westerly dual-runway: arrivals 23R, departures 23L. Easterly dual-runway: arrivals 05R, departures
    05L. Quiet periods and nights: everything on runway 1 (23R or 05L). Runway 1 is next to the terminals, so in westerly
    operations <b>departures cross runway 23R</b> at F, G or H to reach 23L, and in easterly operations <b>arrivals cross
    runway 05L</b> after landing on 05R. A crossing aircraft stops at the stop bar, Ground hands it to Tower, and Tower clears
    it with <code>cross</code> (or right-click › Cross) once no arrival is within about 3 nm and nothing is rolling towards
    the crossing. It occupies the runway until it reports vacated.</p>
    <p><b>Departure holding points:</b> 23R J1 or M1, 05L A1 or AG1, 23L VA1 or VB1, 05R VE1. SIDs stop at 5000 ft (the
    transition altitude): EKLAD, KUXEM, SANBA (jets only), LISTO (props on 23), POL and SONEX off the 23s; ASMIM, LISTO, POL and
    DESIG off the 05s. The letter after the number is the runway: R 23R, Y 23L, S 05L, Z 05R. Departures stay with Tower until
    passing 2500 ft.</p>
    <p><b>Arrivals</b> come through ROSUN (north), MIRSI (north-west) and DAYNE (south-east), minimum FL70, then a pre-made
    transition: downwind (DN/DS), base (NW/SE) or straight-in, with arcs onto final ending at the IF (TICZU for 23R, NODUC for
    23L, C05LI / C05RI for the 05s). The scope also shows the Liverpool CTR, the North West Transit Corridor (EGR323) and VFR
    reporting points.</p>
    <p><b>General aviation</b> uses the South Side ramp (stands 91–96). Circuits are flown on runway 2 in dual-runway operations
    (south-east of it, away from runway 1) and on runway 1 otherwise. Real circuit training at Manchester needs prior
    permission and is rare, so at most one aircraft is in the circuit here, and none in high traffic.</p>`,

  // 23L departures via SONEX or POL use the VB1 intersection (as VATSIM UK does); the others the full length from VA1.
  depHoldFor(ac) {
    if (ac.rwy === '23L' && /^(SONEX|POL)/.test(ac.sid || '')) return 'VB1';
    return null;
  },

  build() {
    Object.assign(AIRPORT, {
      icao: 'EGCC', name: 'Manchester Airport', city: 'Manchester', control: 'Scottish Control',
      elevation: 0, transAlt: 5000, sidTop: 5000, radarRange: 55, ctrRadius: 50, twrHandoffAlt: 2500, goAroundAlt: 3500,
      axis: 51.06, defaultConfig: '23', pushDirs: { E: 'north-east', W: 'south-west' }, seqBuffer: 3,
      freqs: { GND: '121.850', TWR: '118.625', APP: '118.575', CTR: '135.715' },
      tmaLabel: 'MANCHESTER TMA  A 3500-FL195 (simplified)', ctrLabel: 'MANCHESTER CTR D SFC-3500',
      airlineWeights: {
        EXS: 9, RYR: 7, EZY: 6, TOM: 6, BAW: 1, SHT: 2, LOG: 3, EIN: 3, KLM: 3, DLH: 2, AFR: 2, SWR: 1, AUA: 1, BEL: 1,
        TAP: 1, VLG: 1, IBE: 1, SAS: 1, FIN: 1, THY: 2, UAE: 3, QTR: 2, ETD: 2, VIR: 2, AAL: 1, UAL: 1, DAL: 1, SIA: 1, CLX: 0,
      },
      // General aviation: at most one aircraft in the circuit (none in high traffic), on runway 2 in dual-runway
      // operations and runway 1 otherwise, always on the south-east side (side: +1 = right of the take-off direction).
      ga: {
        cap: { low: 1, med: 1, high: 0 },
        runway: { 23: '23L', '05': '05R', '23S': '23R', '05S': '05L' },
        side: { '23L': -1, '05R': 1, '23R': -1, '05L': 1 },
      },
    });

    // ---- Runways: pavement ends and landing thresholds from the UK AIP (u along 051.06°T, v towards 321°) ----
    defineRunways(51.06, [
      { phys: '1', ids: ['05L', '23R'], v: 0, u0: -1524, u1: 1524, disp0: 427, disp1: 183, width: 45, outer: -1 },
      { phys: '2', ids: ['05R', '23L'], v: -390, u0: -3373, u1: -324, disp1: 184, width: 45, outer: -1, ils: true },
    ]);

    // Latitude/longitude to scope coordinates (nm from the aerodrome reference point, the middle of runway 1).
    const LAT0 = 53.353611, LON0 = -2.275;
    const ll = (lat, lon) => ({ x: (lon - LON0) * 60 * Math.cos(Geo.rad(LAT0)), y: (lat - LAT0) * 60 });
    const F = (name, p, type, alt) => addFix(name, p, type, alt);
    const P = (x, y) => ({ x, y });

    // VOR/DMEs (MCT is on the airfield and is the DME reference for the SIDs)
    F('MCT', ll(53.356944, -2.262222), 'vor'); F('POL', ll(53.743889, -2.103333), 'vor'); F('WAL', ll(53.393, -3.135), 'vor');
    F('TNT', ll(53.053902, -1.670000), 'vor'); F('GAM', ll(53.2808, -0.9483), 'vor');
    // Holds (UK AIP positions)
    F('ROSUN', ll(53.668889, -2.349167), 'enroute'); F('MIRSI', ll(53.538056, -2.711667), 'enroute');
    F('DAYNE', ll(53.238611, -2.029167), 'enroute');
    // STAR entry points and route fixes (2022 RNAV1 "M" STARs; positions approximate, kept inside the scope)
    F('LAKEY', P(-21, 42), 'entry'); F('DIZZE', P(-11, 31), 'enroute'); F('SETEL', P(7, 46), 'entry');
    F('LIBSO', P(45, 17), 'entry'); F('OTBED', P(47, 1), 'entry');
    F('ELVOS', ll(52.7003, -1.3069), 'entry'); F('QUSHI', P(21, -22), 'enroute'); F('LESTA', P(27, -45), 'entry');
    F('AXCIS', P(-46, 22), 'entry'); F('MALUD', P(-48, 4), 'entry'); F('PENIL', P(-45, -16), 'entry');
    // SID fixes: TABLY, LISTO and DESIG from the AIP / navigation data; the others approximate from the SID descriptions.
    F('TABLY', ll(53.27194, -2.45056), 'enroute'); F('XUMAT', P(-1.6, 6.9), 'enroute'); F('XOBRO', P(-5, 3), 'enroute');
    F('EKLAD', P(-20, -5.6), 'exit'); F('KUXEM', P(-18, -12), 'exit'); F('SANBA', ll(53.139, -2.335), 'exit');
    F('LISTO', ll(53.1433, -2.19917), 'exit'); F('SONEX', ll(53.54, -1.95), 'exit'); F('DESIG', ll(53.5272, -1.89278), 'exit');
    F('ASMIM', P(-19, 4.9), 'exit');

    // ---- Pre-made approach transitions (see approachSet in data.js) ----
    // 23R: IF TICZU 13 nm / 3500 ft (intermediate altitude 3500 ft, high ground east), FAF C23RF 7 nm / 2500 ft.
    // 05L / 05R: IF 12 nm / 3000 ft, FAF 8.6 nm. 23L (RNP only): IF NODUC 13 nm, straight-in DOMIG 5 nm behind it, FAF C23LF.
    // Downwind joined at 6000 ft (above departures stopped at 5000 ft), base IAFs 5000 ft. Coded names: side N(W) / S(E);
    // DN/DS = downwind join, NW/SE = base IAF, EN/ES = downwind end, TN/TS = base turn onto the final arc.
    const side = (rwy, l) => ({ base: `${l === 'N' ? 'NW' : 'SE'}${rwy}`, dw: `D${l}${rwy}`, de: `E${l}${rwy}`, bt: `T${l}${rwy}` });
    // Right of the final approach course is north-west for 23R/23L and south-east for 05L/05R.
    approachSet('23R', { faf: 'C23RF', if: 'TICZU', straightIn: 'IA23R', sides: { 1: side('23R', 'N'), [-1]: side('23R', 'S') } },
      { ifAlong: 13, ifAlt: 3500, iafAlt: 5000, dwAlt: 6000, fafAlong: 7, fafAlt: 2500, primary: 1 });
    approachSet('23L', { faf: 'C23LF', if: 'NODUC', straightIn: 'DOMIG', sides: { 1: side('23L', 'N'), [-1]: side('23L', 'S') } },
      { ifAlong: 13, ifAlt: 3500, iafAlt: 5000, dwAlt: 6000, fafAlong: 7, fafAlt: 2500, straightIn: 5, straightInAlt: 3500, primary: -1, wide: 5 });
    approachSet('05L', { faf: 'C05LF', if: 'C05LI', straightIn: 'IA05L', sides: { [-1]: side('05L', 'N'), 1: side('05L', 'S') } },
      { ifAlong: 12, ifAlt: 3000, iafAlt: 5000, dwAlt: 6000, fafAlong: 8.6, fafAlt: 2500, primary: -1 });
    approachSet('05R', { faf: 'C05RF', if: 'C05RI', straightIn: 'IA05R', sides: { [-1]: side('05R', 'N'), 1: side('05R', 'S') } },
      { ifAlong: 12, ifAlt: 3000, iafAlt: 5000, dwAlt: 6000, fafAlong: 8.7, fafAlt: 2500, primary: 1 });

    // First SID fixes: 2 nm beyond the departure end on the runway track (about MCT D3 for runway 1).
    Object.assign(SID_FIRST, { '23R': 'MC232', '23L': 'MC231', '05L': 'MC052', '05R': 'MC051' });
    for (const [rwy, name] of Object.entries(SID_FIRST)) addFix(name, Geo.offset(RUNWAYS[rwy].opp, RUNWAYS[rwy].heading, 2), 'sid');

    // ---- Runway configurations ----
    Object.assign(CONFIGS, {
      23: { label: this.configs[23], arr: ['23R'], dep: ['23L'], wind: 245 },
      '05': { label: this.configs['05'], arr: ['05R'], dep: ['05L'], wind: 65 },
      '23S': { label: this.configs['23S'], arr: ['23R'], dep: ['23R'], wind: 245 },
      '05S': { label: this.configs['05S'], arr: ['05L'], dep: ['05L'], wind: 65 },
    });

    // STARs end at the hold, then join the transition that suits where the hold is: for 23R, ROSUN on base from the
    // north-west, MIRSI downwind north-west, DAYNE downwind south-east ("leave DAYNE heading 030"); for the 05s, downwind
    // on the side of the hold.
    const STARS = [
      { name: 'LAKEY1M', fixes: ['LAKEY', 'DIZZE', 'ROSUN'], hold: 'ROSUN' },
      { name: 'SETEL1M', fixes: ['SETEL', 'ROSUN'], hold: 'ROSUN' },
      { name: 'LIBSO1M', fixes: ['LIBSO', 'POL', 'ROSUN'], hold: 'ROSUN' },
      { name: 'OTBED1M', fixes: ['OTBED', 'POL', 'ROSUN'], hold: 'ROSUN' },
      { name: 'ELVOS1M', fixes: ['ELVOS', 'QUSHI', 'DAYNE'], hold: 'DAYNE' },
      { name: 'LESTA1M', fixes: ['LESTA', 'TNT', 'DAYNE'], hold: 'DAYNE' },
      { name: 'AXCIS1M', fixes: ['AXCIS', 'WAL', 'MIRSI'], hold: 'MIRSI' },
      { name: 'MALUD1M', fixes: ['MALUD', 'WAL', 'MIRSI'], hold: 'MIRSI' },
      { name: 'PENIL1M', fixes: ['PENIL', 'WAL', 'MIRSI'], hold: 'MIRSI' },
    ];
    const JOIN = {
      '23R': { ROSUN: 'NW23R', MIRSI: 'DN23R', DAYNE: 'DS23R' },
      '05R': { ROSUN: 'DN05R', MIRSI: 'DN05R', DAYNE: 'DS05R' },
      '05L': { ROSUN: 'DN05L', MIRSI: 'DN05L', DAYNE: 'DS05L' },
    };
    // SIDs: [end, route after the first fix, number, restriction]. SANBA is for jets only; on the 23s LISTO is for props.
    const SIDS = {
      23: [['EKLAD', [], 1], ['KUXEM', [], 1], ['SANBA', ['TABLY'], 1, 'jet'], ['LISTO', [], 2, 'prop'], ['POL', ['XUMAT'], 1], ['SONEX', ['XUMAT'], 1]],
      '05': [['ASMIM', ['XOBRO'], 1, null, true], ['LISTO', [], 2, null, true], ['POL', [], 4], ['DESIG', [], 1]],
    };
    const LETTER = { '23R': 'R', '23L': 'Y', '05L': 'S', '05R': 'Z' };
    const NUM = { POL: { '23R': 5, '23L': 1, '05L': 4, '05R': 1 } };
    for (const [cfg, c] of Object.entries(CONFIGS)) {
      const arr = c.arr[0], dep = c.dep[0], dir = cfg.startsWith('23') ? '23' : '05';
      PROCS[cfg] = {
        stars: STARS.map((s) => ({ ...s, rwy: arr, fixes: [...s.fixes, JOIN[arr][s.hold]], alts: { [s.hold]: 7000, POL: 9000 } })),
        // Early-turning SIDs (ASMIM, LISTO off the 05s) turn straight after take-off instead of flying to the first fix.
        sids: SIDS[dir].map(([end, via, num, only, early]) => ({
          name: `${end}${NUM[end]?.[dep] ?? num}${LETTER[dep]}`, rwy: dep, only,
          fixes: [...(early ? [] : [SID_FIRST[dep]]), ...via, end],
        })),
      };
    }

    // Holds: ROSUN axis 171°, MIRSI inbound about 062°, DAYNE 312°, minimum FL70 (turn directions are not published
    // in what the research found; right turns assumed except where the racetrack would lie towards the airport).
    Object.assign(HOLDS, {
      ROSUN: { inbound: 171, turn: 'R', minAlt: 7000 },
      MIRSI: { inbound: 62, turn: 'R', minAlt: 7000 },
      DAYNE: { inbound: 312, turn: 'R', minAlt: 7000 },
      POL: { inbound: 216, turn: 'R', minAlt: 8000 },
      WAL: { inbound: 61, turn: 'R', minAlt: 8000 },
      TNT: { inbound: 312, turn: 'R', minAlt: 8000 },
    });
    iafHolds();

    Object.assign(OUTSTATIONS, {
      N: ['EGPH', 'EGPF', 'EGAA', 'BIKF', 'ENGM'],
      E: ['EHAM', 'EDDF', 'EDDM', 'LOWW', 'EKCH', 'OMDB', 'OTHH', 'OMAA', 'WSSS'],
      S: ['LEPA', 'LEMD', 'LPFR', 'LGAV', 'LIRF', 'LFPG', 'LEBL', 'GCTS', 'LTAI'],
      W: ['EIDW', 'KJFK', 'KATL', 'CYYZ', 'KORD', 'EICK'],
    });
    Object.assign(FIX_DIRECTION, {
      LAKEY: 'N', SETEL: 'N', LIBSO: 'E', OTBED: 'E', ELVOS: 'S', LESTA: 'S', AXCIS: 'W', MALUD: 'W', PENIL: 'W',
      EKLAD: 'W', KUXEM: 'W', SANBA: 'S', LISTO: 'S', POL: 'N', SONEX: 'E', ASMIM: 'W', DESIG: 'E',
    });

    VIDEO_MAP = this.videoMap(ll);
  },

  // Video map: coastline and estuaries, rivers, towns, nearby airfields, Manchester and Liverpool CTRs, the North West
  // Transit Corridor (EGR323, which replaced the Low Level Route in 2025), VFR reporting points and a simplified TMA
  // (all approximate).
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
    // North West Transit Corridor (EGR323, class G, SFC-1500 ft) through the CTR west of the airport.
    const lines = [
      { pts: [P(-10, 10), P(-7, -10)], label: 'EGR323 NW TRANSIT CORRIDOR SFC-1500' },
      { pts: [P(-7, 10), P(-4, -10)] },
    ];
    const vrps = [['SWINTON', 53.515, -2.360], ['THELWALL', 53.392, -2.503], ['ROSTHERNE', 53.348, -2.385], ['ALDERLEY EDGE', 53.297, -2.213]]
      .map(([name, lat, lon]) => ({ name, p: ll(lat, lon) }));
    function P(x, y) { return { x, y }; }
    return { seas: [sea], coasts: [coast], rivers, towns, airfields, areas, ctr, tma, extraCtrs, lines, vrps, sector: null };
  },

  // ---- Ground layout, in the runway-aligned frame (metres): u along 051 (north-east), v towards 321 (north-west) ----
  // Runway 1 at v = 0 with the terminals to the north-west and taxiway A between them; runway 2 at v = -390 (u -3373 to
  // -324) with taxiway V on its north side, continuing north-east past its end to the South Side (GA ramp, hangars).
  // Crossings F, G and H (north-east of the 23R rapid exit, so a queue for them never blocks it) and D (south-west)
  // link A and V across runway 1. Holding point names follow the AIP where known (A1, AG1, J1, M1, D1, F1, G1, H1);
  // VA1 / VB1 are as used by VATSIM UK; the rest are illustrative.
  chart: { box: { u0: -3500, u1: 1900, v0: -620, v1: 760 } },
  ground(G) {
    const { node, edge, chain, hold, holdingPoints, depHolds, exits, stands, signs } = G;
    const N_HOLD = 100, N_EXIT = 140, A_V = 190, LANE_V = 300, STAND_V = 400;
    const S_HOLD = -100, V_V = -195, R2 = -390, R2_HOLD = R2 + 100, R2_EXIT = R2 + 140, S_LANE = -290, GA_V = -360;
    const r1 = [], r2 = [], a = [], v = [], laneP = [], laneR = [], laneS = [];
    for (const rw of ['05L', '23R', '05R', '23L']) exits[rw] = [];

    // Runway 1, terminal side: departure holding points, the crossings and plain exits.
    const conns = [['A1', -1524, null, true], ['AG1', -1250], ['D1', -900, 'D2'], ['F1', 0, 'F2'], ['G1', 300, 'G2'],
      ['H1', 600, 'H2'], ['M1', 1250], ['J1', 1524, null, true]];
    for (const [name, u, south, ils] of conns) {
      const link = south ? name[0] : name;
      const r = node(`R1@${u}`, u, 0, 'rwy');
      const h = hold(name, u, N_HOLD, r, { ils });
      const x = node(`${name}x`, u, N_EXIT, 'exit');
      const t = node(`A@${u}`, u, A_V);
      edge(r, h, link, 'conn'); edge(h, x, link, 'conn'); edge(x, t, link, 'conn');
      r1.push(r); a.push(t);
      // Crossings are not used as exits, so vacating traffic never meets departures holding short.
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
    holdingPoints['05L'] = 'A1'; holdingPoints['23R'] = 'J1';
    depHolds['05L'] = ['A1', 'AG1']; depHolds['23R'] = ['J1', 'M1'];
    // Rapid exits (angled ~28°): C for 23R landings (about 1700 m from the threshold), K for 05L landings.
    for (const [name, ur, ut, rw] of [['C', -350, -710, '23R'], ['K', 750, 1110, '05L']]) {
      const r = node(`R1@${ur}`, ur, 0, 'rwy');
      const x = node(`${name}x`, ur + (ut - ur) * (N_EXIT / A_V), N_EXIT, 'exit');
      const t = node(`A@${ut}`, ut, A_V);
      edge(r, x, name, 'rapid'); edge(x, t, name, 'rapid');
      r1.push(r); a.push(t);
      exits[rw].push({ name, rwyNode: r, exitNode: x, u: ur, rapid: true });
      signs.push({ text: name, u: (ur + ut) / 2, v: 85 });
    }

    // Runway 2, north side from taxiway V: VA1 (23L full length) and VB1, VE1 at the 05R end, a rapid exit for 05R landings.
    [['VA1', -324, true], ['VB1', -700], ['VC1', -1000], ['VD1', -2000], ['VE1', -3373, true]].forEach(([name, u, ils]) => {
      const r = node(`R2@${u}`, u, R2, 'rwy');
      const h = hold(name, u, R2_HOLD, r, { ils });
      const x = node(`${name}x`, u, R2_EXIT, 'exit');
      const t = node(`V@${u}`, u, V_V);
      const link = name.replace(/1$/, '');
      edge(r, h, link, 'conn'); edge(h, x, link, 'conn'); edge(x, t, link, 'conn');
      r2.push(r); v.push(t);
      for (const rw of ['05R', '23L']) exits[rw].push({ name: link, rwyNode: r, exitNode: x, u });
      signs.push({ text: link, u: u + 22, v: R2_HOLD + 45 });
    });
    {
      const [ur, ut] = [-1500, -1140];
      const r = node(`R2@${ur}`, ur, R2, 'rwy');
      const x = node('VRx', ur + (ut - ur) * ((R2_EXIT - R2) / (V_V - R2)), R2_EXIT, 'exit');
      const t = node(`V@${ut}`, ut, V_V);
      edge(r, x, 'VR', 'rapid'); edge(x, t, 'VR', 'rapid');
      r2.push(r); v.push(t);
      exits['05R'].push({ name: 'VR', rwyNode: r, exitNode: x, u: ur, rapid: true });
      signs.push({ text: 'VR', u: (ur + ut) / 2, v: R2 + 95 });
    }
    holdingPoints['23L'] = 'VA1'; holdingPoints['05R'] = 'VE1';
    depHolds['23L'] = ['VA1', 'VB1']; depHolds['05R'] = ['VE1'];

    // Terminal apron: taxilane P with links L, M and N from taxiway A; stands 1-12 nose-in to T1, T2 and T3.
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
    // West apron (remote stands 21-25 by the World Freight Terminal): taxilane R, links from AG1's junction and Y.
    edge(node('A@-1250', -1250, A_V), node('R@-1250', -1250, LANE_V), 'W');
    edge(node('A@-560', -560, A_V), node('R@-560', -560, LANE_V), 'Y');
    a.push('A@-1250', 'A@-560'); laneR.push('R@-1250', 'R@-560', node('R@-1450', -1450, LANE_V));
    signs.push({ text: 'W', u: -1232, v: 245 }, { text: 'Y', u: -542, v: 245 });
    [-1360, -1140, -1030, -920, -810].forEach((u, i) => {
      const num = 21 + i;
      const l = node(`R@${u}`, u, LANE_V), st = node(`ST${num}`, u, STAND_V, 'stand');
      edge(l, st, `stand ${num}`, 'stand');
      laneR.push(l);
      stands[num] = { num, node: st, lane: l, u, v: STAND_V, bridge: 0 };
    });
    // South Side: taxiway V continues past runway 2 to the GA ramp (taxilane S, stands 91-96, power in / power out).
    for (const u of [150, 900, 1100]) v.push(node(`V@${u}`, u, V_V));
    edge('V@150', node('S@150', 150, S_LANE), 'S');
    edge('V@900', node('S@900', 900, S_LANE), 'S');
    laneS.push('S@150', 'S@900');
    [300, 380, 460, 540, 620, 700].forEach((u, i) => {
      const num = 91 + i;
      const l = node(`S@${u}`, u, S_LANE), st = node(`ST${num}`, u, GA_V, 'stand');
      edge(l, st, `stand ${num}`, 'stand');
      laneS.push(l);
      stands[num] = { num, node: st, lane: l, u, v: GA_V, bridge: 0, ga: true };
    });

    chain(a, 'A', 'main');
    chain(v, 'V', 'main');
    chain(laneP, 'P', 'lane');
    chain(laneR, 'R', 'lane');
    chain(laneS, 'S', 'lane');
    chain(r1, '05L/23R', 'rwy');
    chain(r2, '05R/23L', 'rwy');
    signs.push({ text: 'A', u: -1400, v: A_V + 14 }, { text: 'A', u: 1000, v: A_V + 14 });
    signs.push({ text: 'V', u: -2600, v: V_V + 14 }, { text: 'V', u: -1500, v: V_V + 14 }, { text: 'V', u: 450, v: V_V + 14 });
    signs.push({ text: 'P', u: 400, v: LANE_V + 14 }, { text: 'R', u: -980, v: LANE_V + 14 }, { text: 'S', u: 800, v: S_LANE - 14 });
    return { TWY_W: 23 };
  },

  // ---- Chart decoration ----
  decor: {
    base({ rect, line, P, C, px, ctx }) {
      rect(-3600, -760, 1950, 980, C.grass2);
      line([P(-3600, -760), P(1950, -760), P(1950, 980), P(-3600, 980), P(-3600, -760)], '#4f6255', Math.max(px, 2), [14, 8]);
      line([P(-3480, -660), P(1830, -660), P(1830, 860), P(-3480, 860), P(-3480, -660)], C.road, 7);
      rect(-300, 230, 1420, 510, C.apron); // terminal apron
      rect(-1500, 230, -620, 470, C.apron); // west apron
      rect(120, -470, 960, -250, C.apron); // South Side GA ramp
      rect(980, -520, 1600, -250, C.apron); // maintenance apron
      rect(-200, 700, 1300, 830, '#2f363c'); // car parks
      ctx.strokeStyle = '#4b555c'; ctx.lineWidth = Math.max(px * 0.8, 0.6);
      for (let u = -190; u < 1300; u += 12) for (const [v0, v1] of [[705, 760], [770, 825]]) { ctx.beginPath(); ctx.moveTo(u, v0); ctx.lineTo(u, v1); ctx.stroke(); }
      line([P(-300, 505), P(1420, 505)], 'rgba(230,235,238,0.55)', 1.2, [8, 6]); // apron service road
      line([P(-1500, 920), P(1900, 920)], C.road, 9); // landside road
      line([P(-300, 690), P(1420, 690)], C.road, 5);
      line([P(-2600, -560), P(-2600, -760)], C.road, 6); // A538, in a tunnel under the runways
      line([P(-2600, -560), P(-2600, 860)], 'rgba(86,95,102,0.45)', 6, [10, 8]);
    },
    buildings({ rect, C, ctx }) {
      rect(-300, 510, 120, 640, C.building); rect(-280, 530, 100, 620, C.building2); // T3
      rect(140, 510, 640, 660, C.building); rect(160, 530, 620, 640, C.building2); // T1
      rect(700, 510, 1420, 680, C.building); rect(720, 530, 1400, 660, C.building2); // T2
      for (let u = 200; u <= 600; u += 100) rect(u - 1, 530, u + 1, 640, C.building);
      for (let u = 800; u <= 1300; u += 125) rect(u - 1, 530, u + 1, 660, C.building);
      ctx.fillStyle = '#4b5d6e'; ctx.beginPath(); ctx.arc(-470, 600, 13, 0, Math.PI * 2); ctx.fill(); // tower
      rect(1600, 200, 1690, 270, '#4b5560'); // fire station
      rect(1040, -620, 1560, -530, '#46525c'); // South Side maintenance hangars
      rect(300, -560, 760, -500, '#3f4950'); // GA terminal / FBO
      rect(-1500, 490, -980, 600, '#3f4950'); // World Freight Terminal
    },
    labels({ name, big }) {
      name('T1', 390, 585); name('T2', 1060, 595); name('T3', -90, 575);
      if (!big) return;
      name('TWR', -470, 635, '#9fb3c3'); name('RFFS', 1645, 300, '#9fb3c3'); name('SOUTH SIDE HANGARS', 1300, -575, '#9fb3c3');
      name('GA / FBO', 530, -530, '#9fb3c3'); name('WORLD FREIGHT', -1240, 545, '#9fb3c3'); name('CAR PARKS', 550, 765, '#9fb3c3');
      name('A538 TUNNEL', -2600, -610, '#7f8f9b');
    },
  },
};
