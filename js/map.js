// Video map for the radar scope (fictional but plausible): coastline, river, towns, nearby airfields,
// danger/restricted areas, the CTR and TMA, and the approach sector split. Coordinates in nm (x east, y north).
const VIDEO_MAP = (() => {
  // Runway-aligned helper for the CTR: u along 080, v towards 350 (nm).
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
  return { coast, sea, river, towns, airfields, areas, ctr, tma, sector };
})();
