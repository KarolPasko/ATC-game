// Aerodrome ground layout (taxiways, holding points, stands), taxi routing and ground movement.
//
// Each airport (js/airports/*.js) builds its layout in a runway-aligned local frame in metres:
//   u = along the runways (towards AIRPORT.axis), v = across (to the left of that direction).
// Node kinds: twy, rwy (on a runway centreline), hold (runway holding point), exit (clear of the runway), stand.
// Edge kinds: twy, main (parallel taxiway), lane (apron taxilane), conn (runway connector), rapid, stand, rwy.
const GROUND = (() => {
  const M_PER_NM = 1852;
  const U = Geo.vec(AIRPORT.axis), V = Geo.vec(AIRPORT.axis - 90);
  const toWorld = (u, v) => ({ x: (U.x * u + V.x * v) / M_PER_NM, y: (U.y * u + V.y * v) / M_PER_NM });

  const nodes = {}; // name -> { name, u, v, x, y, kind }
  const edges = []; // { a, b, name, kind, len }
  const node = (name, u, v, kind = 'twy') => {
    if (!nodes[name]) nodes[name] = { name, u, v, kind, ...toWorld(u, v) };
    return name;
  };
  const edge = (a, b, name, kind = 'twy') => {
    const A = nodes[a], B = nodes[b];
    edges.push({ a, b, name, kind, len: Math.hypot(A.u - B.u, A.v - B.v) });
  };
  // Chain nodes on a straight line (sorted by u) into one named taxiway.
  const chain = (list, name, kind) => {
    list = [...new Set(list)].sort((p, q) => nodes[p].u - nodes[q].u);
    for (let i = 1; i < list.length; i++) edge(list[i - 1], list[i], name, kind);
  };
  // Runway holding point protecting the runway node `rwyNode`.
  const hold = (name, u, v, rwyNode, { ils = false } = {}) => {
    node(name, u, v, 'hold');
    Object.assign(nodes[name], { rwyNode, ils });
    return name;
  };

  const holdingPoints = {}; // departure runway id -> holding point node name
  const exits = {}; // runway id -> [{ name, rwyNode, exitNode, u, rapid }]
  const stands = {}; // number -> { num, node, lane, u, v, bridge, hdg }
  const signs = []; // taxiway labels { text, u, v }
  const dims = AIRPORT_DEF.ground({ node, edge, chain, hold, nodes, holdingPoints, exits, stands, signs, toWorld });

  // Runway nodes know their physical runway; stands face from the taxilane into the stand (nose-in).
  for (const p of RUNWAY_PHYS) for (const n of Object.values(nodes)) if (n.kind === 'rwy' && Math.abs(n.v - p.v) < 1) n.phys = p.phys;
  for (const n of Object.values(nodes)) if (n.kind === 'hold') n.phys = nodes[n.rwyNode].phys;
  for (const st of Object.values(stands)) st.hdg = Geo.bearing(nodes[st.lane], nodes[st.node]);

  // Adjacency for routing (runway edges are excluded from taxi routes).
  const adj = {};
  for (const e of edges) {
    (adj[e.a] = adj[e.a] || []).push({ to: e.b, e });
    (adj[e.b] = adj[e.b] || []).push({ to: e.a, e });
  }

  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const edgeMap = {};
  for (const e of edges) edgeMap[edgeKey(e.a, e.b)] = e;
  const edgeBetween = (a, b) => edgeMap[edgeKey(a, b)] || null;

  const taxiwayNames = new Set(edges.filter((e) => e.kind !== 'rwy' && e.kind !== 'stand').map((e) => e.name));

  // Taxi route from one node to another. With `via`, the taxiways are followed in that order:
  // the search state is (node, index of the current via taxiway). Short connecting pieces
  // (stand lead-ins, runway connectors, rapid exits) may be used anywhere; other taxiways
  // only before joining the first via taxiway, at a heavy cost.
  function route(from, to, via = []) {
    via = via || [];
    const key = (n, k) => `${n}|${k}`;
    const dist = { [key(from, -1)]: 0 }, prev = {}, done = new Set();
    const open = [[from, -1]];
    let goal = null;
    const last = via.length - 1;
    while (open.length) {
      open.sort((p, q) => dist[key(...p)] - dist[key(...q)]);
      const [n, k] = open.shift();
      const nk = key(n, k);
      if (done.has(nk)) continue;
      done.add(nk);
      if (n === to && k === last) { goal = nk; break; }
      for (const { to: m, e } of adj[n] || []) {
        if (e.kind === 'rwy') continue;
        if (e.kind === 'stand' && m !== to && n !== from) continue; // never route through a stand
        let k2 = k, cost = e.len;
        if (nodes[m].kind === 'rwy') cost += 400; // crossing a runway: only when it saves a real detour
        if (via.length) {
          if (e.name === via[k]) k2 = k;
          else if (e.name === via[k + 1]) k2 = k + 1;
          else if (['stand', 'conn', 'rapid'].includes(e.kind)) cost *= 1.5;
          else if (k === -1) cost *= 6; // before joining the first via taxiway
          else if (k === last) cost *= 3; // after the last one: finish on the shortest connection
          else continue;
        }
        const mk = key(m, k2), d = dist[nk] + cost;
        if (d < (dist[mk] ?? Infinity)) { dist[mk] = d; prev[mk] = { nk, n, e }; open.push([m, k2]); }
      }
    }
    if (!goal) return null;
    const path = [], names = [];
    for (let c = goal; c !== key(from, -1); c = prev[c].nk) {
      path.unshift(c.split('|')[0]);
      const nm = prev[c].e.name;
      if (prev[c].e.kind !== 'stand' && names[0] !== nm) names.unshift(nm);
    }
    return { path, names };
  }

  // Nearest taxiway edge to a world point (nm), for clicking routes on the chart.
  function nearestEdge(p, maxNm) {
    let best = null, bd = maxNm;
    for (const e of edges) {
      if (e.kind === 'rwy' || e.kind === 'stand') continue;
      const A = nodes[e.a], B = nodes[e.b];
      const dx = B.x - A.x, dy = B.y - A.y, l2 = dx * dx + dy * dy;
      const t = Geo.clamp(((p.x - A.x) * dx + (p.y - A.y) * dy) / l2, 0, 1);
      const d = Math.hypot(p.x - (A.x + t * dx), p.y - (A.y + t * dy));
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // Nearest node to a world position (used when re-routing).
  function nearestNode(p, filter = () => true) {
    let best = null, bd = Infinity;
    for (const n of Object.values(nodes)) {
      if (n.kind === 'rwy' || !filter(n)) continue;
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < bd) { bd = d; best = n.name; }
    }
    return best;
  }

  // Name of a physical runway as used now (e.g. "23R"), for crossings and signs.
  function runwayName(phys, game) {
    const inUse = game ? game.activeRunways().find((id) => RUNWAYS[id].phys === phys) : null;
    return inUse || RUNWAY_PHYS.find((p) => p.phys === phys).ids[0];
  }

  return {
    M_PER_NM, U, V, toWorld, nodes, edges, adj, edgeBetween, route, nearestNode, nearestEdge, holdingPoints, exits, stands, signs,
    taxiwayNames, runwayName, dims: { TWY_W: 23, ...dims },
  };
})();

// ---------- taxi geometry: fillets at junctions and planned paths ----------
const KT = 0.5144; // m/s per knot
const A_LAT = 1.0, A_DEC = 0.8, A_ACC = 0.5; // m/s²: cornering, braking, accelerating
const toLocal = (p) => {
  const x = p.x * GROUND.M_PER_NM, y = p.y * GROUND.M_PER_NM;
  return { u: x * GROUND.U.x + y * GROUND.U.y, v: x * GROUND.V.x + y * GROUND.V.y };
};
const dirLocal = (h) => { const w = Geo.vec(h); return { u: w.x * GROUND.U.x + w.y * GROUND.U.y, v: w.x * GROUND.V.x + w.y * GROUND.V.y }; };
const unit = (a, b) => { const l = Math.hypot(b.u - a.u, b.v - a.v) || 1; return { u: (b.u - a.u) / l, v: (b.v - a.v) / l }; };

// Junction radius by what meets there: stand lead-ins are tight, high-speed exits wide.
function filletRadius(e1, e2) {
  const k = [e1?.kind, e2?.kind];
  if (k.includes('stand')) return 30;
  if (k.includes('rapid')) return k.includes('rwy') ? 150 : 60;
  return 45;
}

// Arc joining a straight arriving along d1 to one leaving along d2 at vertex P (u,v metres).
function fillet(P, d1, d2, R, tMax) {
  const th = Math.acos(Geo.clamp(d1.u * d2.u + d1.v * d2.v, -1, 1));
  if (th < Geo.rad(4)) return null;
  const t = Math.min(R * Math.tan(th / 2), tMax);
  const r = t / Math.tan(th / 2);
  const sgn = Math.sign(d1.u * d2.v - d1.v * d2.u) || 1; // +1 = left turn
  const A = { u: P.u - d1.u * t, v: P.v - d1.v * t }, B = { u: P.u + d2.u * t, v: P.v + d2.v * t };
  const C = { u: A.u - d1.v * sgn * r, v: A.v + d1.u * sgn * r };
  return { A, B, C, r, th, sgn };
}
function arcPoints(f, step = 2) {
  const a0 = Math.atan2(f.A.v - f.C.v, f.A.u - f.C.u);
  const n = Math.max(2, Math.ceil((f.r * f.th) / step));
  const pts = [];
  for (let i = 1; i < n; i++) { const a = a0 + f.sgn * f.th * (i / n); pts.push({ u: f.C.u + Math.cos(a) * f.r, v: f.C.v + Math.sin(a) * f.r }); }
  return pts;
}

// Every junction curve on the airfield (both directions are the same arc), for drawing.
let JUNCTION_FILLETS = null;
function junctionFillets() {
  if (JUNCTION_FILLETS) return JUNCTION_FILLETS;
  JUNCTION_FILLETS = [];
  for (const [name, list] of Object.entries(GROUND.adj)) {
    const n = GROUND.nodes[name];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const e1 = list[i].e, e2 = list[j].e;
        if (e1.kind === 'rwy' && e2.kind === 'rwy') continue;
        const m1 = GROUND.nodes[list[i].to], m2 = GROUND.nodes[list[j].to];
        const d1 = unit(m1, n), d2 = unit(n, m2);
        if (Math.acos(Geo.clamp(d1.u * d2.u + d1.v * d2.v, -1, 1)) > Geo.rad(150)) continue;
        const f = fillet(n, d1, d2, filletRadius(e1, e2), 0.45 * Math.min(e1.len, e2.len));
        if (f) JUNCTION_FILLETS.push({ f, pts: [f.A, ...arcPoints(f, 3), f.B], onRunway: e1.kind === 'rwy' || e2.kind === 'rwy' });
      }
    }
  }
  return JUNCTION_FILLETS;
}

// Speed limit for a stretch of pavement (m/s).
function edgeSpeed(e) {
  if (!e) return 15 * KT;
  if (e.kind === 'stand' || e.kind === 'lane') return 10 * KT;
  if (e.kind === 'rapid' || e.kind === 'rwy') return 30 * KT;
  if (e.kind === 'main') return 20 * KT;
  return 15 * KT;
}

// Plan a path from the aircraft through taxi-graph nodes (optionally ending at a free point), with the same
// junction arcs as the chart, samples every few metres and an allowed-speed profile (corners and braking).
function buildTaxiPath(start, hdg, names, { firstKind = null, tail = null } = {}) {
  const pts = [toLocal(start)], seg = [], labels = [null];
  const firstE = firstKind ? { kind: firstKind } : null;
  const target0 = names.length ? GROUND.nodes[names[0]] : tail;
  const d0 = Math.hypot(target0.u - pts[0].u, target0.v - pts[0].v);
  // If the first leg needs a turn, roll forward along the current heading first so the turn is a curve.
  const h = dirLocal(hdg), dir0 = unit(pts[0], target0);
  if (d0 > 15 && h.u * dir0.u + h.v * dir0.v < Math.cos(Geo.rad(8))) {
    const L = Math.min(25, d0 / 3);
    pts.push({ u: pts[0].u + h.u * L, v: pts[0].v + h.v * L }); seg.push(firstE); labels.push(null);
  }
  names.forEach((n, i) => {
    const N = GROUND.nodes[n];
    const e = i === 0 ? firstE : GROUND.edgeBetween(names[i - 1], n);
    const last = pts[pts.length - 1];
    if (Math.hypot(N.u - last.u, N.v - last.v) < 0.5) { labels[labels.length - 1] = n; return; } // already here
    pts.push({ u: N.u, v: N.v }); seg.push(e); labels.push(n);
  });
  if (tail) { pts.push({ u: tail.u, v: tail.v }); seg.push(tail.kind ? { kind: tail.kind } : null); labels.push(null); }

  const F = [];
  for (let j = 1; j < pts.length - 1; j++) {
    const l1 = Math.hypot(pts[j].u - pts[j - 1].u, pts[j].v - pts[j - 1].v);
    const l2 = Math.hypot(pts[j + 1].u - pts[j].u, pts[j + 1].v - pts[j].v);
    const tMax = Math.min(seg[j - 1] && j > 1 ? 0.45 * l1 : 0.9 * l1, 0.45 * l2);
    F[j] = fillet(pts[j], unit(pts[j - 1], pts[j]), unit(pts[j], pts[j + 1]), filletRadius(seg[j - 1], seg[j]), tMax);
  }
  const out = [], marks = [];
  let s = 0;
  const add = (p, vmax) => {
    const last = out[out.length - 1];
    if (last) {
      const d = Math.hypot(p.u - last.u, p.v - last.v);
      if (d < 0.01) { last.vmax = Math.min(last.vmax, vmax); return; }
      // Subdivide straights so the braking profile is accurate.
      const n = Math.floor(d / 10);
      for (let k = 1; k <= n; k++) {
        const f = k / (n + 1);
        out.push({ u: last.u + (p.u - last.u) * f, v: last.v + (p.v - last.v) * f, s: s + d * f, vmax: Math.max(last.vmax, vmax) });
      }
      s += d;
    }
    out.push({ u: p.u, v: p.v, s, vmax });
  };
  add(pts[0], edgeSpeed(seg[0]));
  for (let j = 1; j < pts.length; j++) {
    const f = F[j], vIn = edgeSpeed(seg[j - 1]);
    if (f) {
      add(f.A, vIn);
      const vArc = Math.min(vIn, edgeSpeed(seg[j]), Math.sqrt(A_LAT * f.r));
      const arc = arcPoints(f);
      arc.forEach((q, i) => { add(q, vArc); if (labels[j] && i === Math.floor(arc.length / 2)) marks.push({ name: labels[j], s }); });
      add(f.B, vArc);
    } else {
      add(pts[j], vIn);
      if (labels[j]) marks.push({ name: labels[j], s });
    }
  }
  // Allowed speed: never faster than can be braked for what comes next, stopping at the end.
  out[out.length - 1].va = 0;
  for (let i = out.length - 2; i >= 0; i--) out[i].va = Math.min(out[i].vmax, Math.sqrt(out[i + 1].va ** 2 + 2 * A_DEC * (out[i + 1].s - out[i].s)));
  for (const q of out) Object.assign(q, GROUND.toWorld(q.u, q.v));
  return { pts: out, total: s, marks, s: 0, i: 0 };
}

const GROUND_STATES = ['stand', 'pushback', 'taxi', 'ground', 'lineup', 'parked'];
const TAXI_KT = 15;

// ---------- ground movement on Aircraft ----------
const nmOf = (m) => m / GROUND.M_PER_NM;
const bezier = (a, b, c, t) => ({
  x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * b.x + t * t * c.x,
  y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * b.y + t * t * c.y,
});

Object.assign(Aircraft.prototype, {
  onGround() { return GROUND_STATES.includes(this.state) || this.state === 'landed'; },
  canTaxi() { return ['stand', 'pushback', 'taxi', 'ground'].includes(this.state); },

  // Node a new taxi route starts from.
  taxiStartNode() {
    if (this.state === 'stand') return GROUND.stands[this.stand].lane;
    if (this.state === 'pushback') return this.push.lane;
    if (this.state === 'taxi' && this.holdShort) return this.gnode;
    if (this.state === 'taxi' && this.taxiPath?.length) return this.taxiPath[0];
    return this.gnode;
  },

  // Start taxiing to a node (holding point or stand). From a stand this includes the pushback.
  startTaxi(target, via = []) {
    const from = this.taxiStartNode();
    const r = GROUND.route(from, target, via);
    if (!r) return null;
    if (this.state === 'stand') {
      this.beginPushback(this.faceFromPath(from, r.path), [from, ...r.path]);
    } else if (this.state === 'pushback') {
      this.push.next = [from, ...r.path];
    } else {
      this.state = 'taxi';
      this.taxiPath = this.taxiPath?.length || this.gnode !== from ? [from, ...r.path] : r.path;
    }
    this.taxiTarget = target;
    this.taxiNames = r.names;
    this.holdPos = false;
    this.holdShort = null;
    this.gp = null; // re-plan from where the aircraft is now
    this._pred = null;
    return r;
  },

  // Is a taxi route currently cleared and being followed (or waiting for pushback to finish)?
  hasTaxiRoute() {
    return (this.state === 'pushback' && this.push?.next?.length) || (this.state === 'taxi' && this.taxiPath?.length > 0);
  },

  // Which way the nose should end up after pushback so the first taxi leg is straight ahead.
  faceFromPath(lane, path) {
    const L = GROUND.nodes[lane];
    const next = path.map((n) => GROUND.nodes[n]).find((n) => Math.abs(n.u - L.u) > 1);
    return next && next.u < L.u ? 'W' : 'E';
  },

  // Push back in an arc: tail swings onto the taxilane, nose ends up facing `face` (E/W).
  beginPushback(face, next = []) {
    const st = GROUND.stands[this.stand];
    const lane = GROUND.nodes[st.lane];
    const dirU = face === 'E' ? -1 : 1; // the tail moves opposite to the final facing
    const p0 = { x: this.x, y: this.y };
    const p2 = GROUND.toWorld(lane.u + dirU * 70, lane.v);
    const len = Geo.dist(p0, lane) + Geo.dist(lane, p2);
    this.state = 'pushback';
    this.push = { p0, p1: { x: lane.x, y: lane.y }, p2, lane: st.lane, len, s: 0, face, next };
    this.spd = 0;
  },

  pushback(face = null) {
    if (this.state !== 'stand') return false;
    if (!face) {
      const hp = GROUND.nodes[GROUND.holdingPoints[this.rwy]];
      face = hp.u > GROUND.stands[this.stand].u ? 'E' : 'W';
    }
    this.beginPushback(face, []);
    this.taxiTarget = null;
    return face;
  },

  groundUpdate(dt, game) {
    if (this.state === 'parked') { if (game.time - this.parkTime > 90) this.state = 'gone'; return; }
    if (this.state === 'pushback') return this.pushUpdate(dt, game);
    if (this.state !== 'taxi') return;
    if (!this.taxiPath.length) {
      if (!this.isArr && this.gnode === GROUND.holdingPoints[this.rwy]) return this.arriveAt(game); // already there
      this.spd = Math.max(0, this.spd - 4 * dt); this.coast(dt); return;
    }
    this.taxiStep(dt, game);
  },

  pushUpdate(dt, game) {
    const P = this.push;
    const remaining = (1 - P.s) * P.len * GROUND.M_PER_NM;
    this.spd = Math.min(5, this.spd + 1 * dt, Math.max(0.8, Math.sqrt(2 * 0.3 * remaining) / KT)); // ease to a stop
    P.s = Math.min(1, P.s + (this.spd / 3600) * dt / P.len);
    const a = bezier(P.p0, P.p1, P.p2, P.s), b = bezier(P.p0, P.p1, P.p2, Math.min(1, P.s + 0.01));
    this.x = a.x; this.y = a.y;
    if (P.s < 0.99) this.hdg = Geo.norm(Geo.bearing(a, b) + 180); // nose opposite to the direction of travel
    if (P.s >= 1) {
      this.hdg = Geo.norm(AIRPORT.axis + (P.face === 'E' ? 0 : 180));
      this.state = 'taxi';
      this.spd = 0;
      this.gnode = null;
      this.gp = null;
      this.taxiPath = P.next.length ? P.next : [];
      if (!this.taxiPath.length) { this.gnode = P.lane; game.pilotSay(this, 'pushback complete, ready to taxi'); }
    }
  },

  // Roll to a stop when there is nowhere to go.
  coast(dt) { if (this.spd > 0) this.move(dt); },

  // Advance along the planned path at the allowed speed (or brake to a stop). True at the end.
  followPath(dt, blocked) {
    const P = this.gp;
    const seek = () => { while (P.i < P.pts.length - 2 && P.pts[P.i + 1].s <= P.s) P.i++; };
    seek();
    const a = P.pts[P.i], b = P.pts[P.i + 1] || a;
    const f = b.s > a.s ? (P.s - a.s) / (b.s - a.s) : 1;
    let vT = a.va + (b.va - a.va) * f;
    if (blocked) vT = 0;
    else if (P.total - P.s > 0.05) vT = Math.max(vT, 0.5); // always creep the last metres
    let v = this.spd * KT;
    v = v < vT ? Math.min(vT, v + A_ACC * dt) : Math.max(vT, v - (blocked ? 2 : 1.2) * dt);
    P.s = Math.min(P.total, P.s + v * dt);
    seek();
    const c = P.pts[P.i], d = P.pts[P.i + 1] || c;
    const g = d.s > c.s ? Geo.clamp((P.s - c.s) / (d.s - c.s), 0, 1) : 1;
    this.x = c.x + (d.x - c.x) * g;
    this.y = c.y + (d.y - c.y) * g;
    if (d !== c) {
      // Blend towards the next segment's direction so the heading turns continuously.
      const h1 = Geo.bearing(c, d), e = P.pts[P.i + 2];
      this.hdg = e ? Geo.norm(h1 + Geo.diff(h1, Geo.bearing(d, e)) * g * 0.5) : h1;
    }
    this.spd = v / KT;
    return P.s >= P.total - 0.05;
  },

  // Taxi along the planned path, stopping behind traffic or when told to hold position. Without a crossing
  // clearance the plan ends at the holding point before a runway on the route.
  taxiStep(dt, game) {
    if (!this.gp) {
      const k = this.crossStop();
      if (k === 0) { // holding short of a runway, waiting for the crossing clearance
        this.spd = 0;
        if (!this.holdShort) { this.holdShort = this.gnode; game.onHoldingShort(this); }
        return;
      }
      const plan = k > 0 ? this.taxiPath.slice(0, k) : this.taxiPath;
      this.gp = buildTaxiPath(this, this.hdg, plan, { firstKind: this.vacating ? 'rwy' : null });
      this.gp.left = plan.length;
    }
    const blocked = this.holdPos || !!game.groundBlocker(this);
    const done = this.followPath(dt, blocked);
    const P = this.gp;
    // The final node only counts once actually reached (an aircraft can be stopped just short of it).
    while (P.marks.length && P.marks[0].s <= P.s + 0.1 && (P.marks.length > 1 || done)) {
      const m = P.marks.shift();
      if (this.taxiPath[0] === m.name) { this.gnode = this.taxiPath.shift(); P.left--; this.passNode(game); }
    }
    if (done) {
      if (P.left > 0) { this.gnode = this.taxiPath[P.left - 1]; this.taxiPath.splice(0, P.left); this.passNode(game); }
      this.gp = null;
      this.spd = 0;
      if (this.taxiPath.length) return; // at a holding point before a runway crossing
      this.arriveAt(game);
    }
  },

  // Index in the taxi path of the first runway this aircraft is not cleared to cross (-1 if none).
  crossStop() {
    if (this.vacating || !this.taxiPath) return -1;
    return this.taxiPath.findIndex((n) => GROUND.nodes[n].kind === 'rwy' && GROUND.nodes[n].phys !== this.crossClr);
  },

  // Crossing bookkeeping as each node is passed: on the runway from the near holding point to the far one.
  passNode(game) {
    const n = GROUND.nodes[this.gnode];
    if (!this.crossClr) return;
    const next = GROUND.nodes[this.taxiPath[0]];
    if (n.kind === 'hold' && !this.crossing && next?.kind === 'rwy' && next.phys === this.crossClr) { this.crossing = this.crossClr; this.crossFrom = n.name; }
    else if (n.kind === 'rwy' && this.crossing) this.crossPast = true;
    else if (n.kind === 'hold' && this.crossing && this.crossPast) {
      const rwy = GROUND.runwayName(this.crossing, game);
      this.crossing = this.crossClr = null;
      this.crossPast = false;
      game.onCrossed(this, rwy);
    }
  },

  // Crossing clearance for the runway ahead on the taxi route. Returns that runway's physical id, or null.
  clearCross() {
    const k = this.crossStop();
    if (k < 0) return null;
    const phys = GROUND.nodes[this.taxiPath[k]].phys;
    this.crossClr = phys;
    this.crossPast = false;
    if (this.holdShort) { this.crossing = phys; this.crossFrom = this.holdShort; this.holdShort = null; }
    this.gp = null;
    return phys;
  },

  // Short status for taxiing aircraft (chart labels and strips).
  groundStatus(game) {
    if (this.holdShort) return `HOLD SHORT ${GROUND.runwayName(GROUND.nodes[this.holdShort].phys, game)}`;
    if (this.crossing) return `CROSSING ${GROUND.runwayName(this.crossing, game)}`;
    if (!this.taxiPath.length) return 'REQ TAXI';
    if (this.holdPos) return 'HOLD POSN';
    return `TAXI ${this.taxiTarget?.startsWith('ST') ? 'STAND ' + this.stand : this.taxiTarget}`;
  },

  // Line up: from the holding point along the connector, curving onto the runway centreline.
  beginLineup(cto = false) {
    const hp = GROUND.nodes[this.gnode];
    const rn = hp.rwyNode;
    const R = GROUND.nodes[rn];
    const dirU = this.runway.dirU;
    this.state = 'lineup';
    this.lining = true;
    this.ctoPending = cto;
    this.hpNode = this.gnode;
    this.gp = buildTaxiPath(this, this.hdg, [rn], { tail: { u: R.u + dirU * 70, v: R.v, kind: 'rwy' } });
  },

  lineupStep(dt) {
    if (!this.followPath(dt, false)) return;
    this.lining = false;
    this.gp = null;
    this.spd = 0;
    this.hdg = this.runway.heading;
    if (this.ctoPending) { this.ctoPending = false; this.state = 'takeoff'; }
  },

  // On the ground, aircraft move along their heading (no wind).
  arriveAt(game) {
    this.spd = 0;
    const n = GROUND.nodes[this.gnode];
    if (!this.isArr && this.gnode === GROUND.holdingPoints[this.rwy]) {
      this.state = 'ground';
      this.hdg = Geo.bearing(n, GROUND.nodes[n.rwyNode]);
      game.onReachedHoldingPoint(this);
    } else if (this.isArr && n.kind === 'stand') {
      this.state = 'parked';
      this.parkTime = game.time;
      game.onParked(this);
    } else if (n.kind === 'exit' && this.isArr) {
      this.vacating = false;
      this.vacatedVia = n.name.replace(/x$/, '');
      game.onVacated(this);
    } else {
      game.pilotSay(this, `holding at ${n.name.replace(/@.*/, '')}, request further taxi`);
    }
  },

  // Landing roll: pick the first exit we can make, then turn off there.
  chooseExit() {
    const r = this.runway;
    const dirSign = r.dirU; // +1 when landing towards +u
    const here = { u: (this.x * GROUND.M_PER_NM) * GROUND.U.x + (this.y * GROUND.M_PER_NM) * GROUND.U.y };
    const ktToMs = 0.5144;
    const v = this.spd * ktToMs, vExit = 25 * ktToMs, a = 1.8;
    const need = (v * v - vExit * vExit) / (2 * a);
    const options = GROUND.exits[this.rwy]
      .map((e) => ({ ...e, ahead: (e.u - here.u) * dirSign }))
      .filter((e) => e.ahead >= need * 0.9)
      .sort((p, q) => p.ahead - q.ahead);
    const end = GROUND.exits[this.rwy].map((e) => ({ ...e, ahead: (e.u - here.u) * dirSign })).sort((p, q) => q.ahead - p.ahead)[0];
    this.exit = options[0] || end;
  },

  rollOut(dt, game) {
    // An emergency aircraft that stops on the runway: brake to a halt, wait for inspection, then get towed.
    if (this.emg?.stop && !this.emg.done) {
      if (this.spd > 0) {
        this.spd = Math.max(0, this.spd - 3 * dt);
        this.move(dt);
        if (this.spd === 0) game.emergency?.onStopped(this);
      } else if (this.emg.stoppedAt !== undefined && game.time - this.emg.stoppedAt > 300) game.emergency?.towed(this);
      return;
    }
    if (!this.exit) this.chooseExit();
    const n = GROUND.nodes[this.exit.rwyNode];
    const dirSign = this.runway.dirU;
    const ahead = ((n.x - this.x) * GROUND.U.x + (n.y - this.y) * GROUND.U.y) * GROUND.M_PER_NM * dirSign;
    // Brake so as to reach exit speed just as the exit starts (≈1.8 m/s²), then follow the curved exit.
    const vExit = this.exit.rapid ? 30 : 18;
    const vMax = Math.sqrt((vExit * KT) ** 2 + 2 * 1.8 * Math.max(0, ahead - 160)) / KT;
    this.spd = Math.max(vExit, Math.min(this.spd - 0.5 * dt, vMax));
    if (ahead <= 160) {
      this.state = 'taxi';
      this.vacating = true; // still on the runway until clear of the holding position
      this.gnode = null;
      this.gp = null;
      this.taxiPath = [this.exit.rwyNode, this.exit.exitNode];
      this.alt = 0;
      return;
    }
    this.move(dt);
  },
});

// ---------- ground chart view ----------
class GroundView {
  constructor(radar) {
    this.radar = radar;
    this.view = { cx: 0, cy: 0, scale: 0.3 }; // world metres centre, px per metre
    this.fitted = false;
    this.build = null; // taxi route being built by clicking: { cs, via: [], target }
    this.panel = document.getElementById('taxibuild');
    this.panel.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act || !this.build) return;
      const g = this.radar.game;
      if (act === 'send') { g.commands.execute(this.build.cmd); this.build = null; g.ui.input.value = ''; }
      else if (act === 'undo') { if (this.build.target) this.build.target = null; else this.build.via.pop(); this.updateBuild(); }
      else if (act === 'clear') { this.build.via = []; this.build.target = null; this.updateBuild(); }
      this.renderPanel();
    });
  }

  // ---------- taxi route builder ----------
  canBuild(ac) {
    const g = this.radar.game;
    return ac && g.userOwns(ac) && ac.canTaxi() && (ac.isArr || ac.cleared);
  }

  ensureBuild(ac) {
    if (!this.build || this.build.cs !== ac.cs) { this.build = { cs: ac.cs, via: [], target: null }; this.updateBuild(); }
    return this.build;
  }

  updateBuild() {
    const b = this.build, g = this.radar.game;
    const ac = g.findAircraft(b.cs);
    if (!ac) { this.build = null; return; }
    const target = b.target || (ac.isArr ? (ac.stand ? `ST${ac.stand}` : null) : GROUND.holdingPoints[ac.rwy]);
    const r = target && GROUND.route(ac.taxiStartNode(), target, b.via);
    b.preview = r ? r.path : null;
    b.names = r ? r.names : [];
    b.targetName = target;
    const tgtText = !target ? '' : target.startsWith('ST') ? target.slice(2) : target;
    b.cmd = `${ac.cs} taxi ${tgtText}${b.via.length ? ' via ' + b.via.join(' ') : ''}`;
    b.dirty = true;
  }

  renderPanel() {
    const g = this.radar.game, sel = g.selected;
    const show = g.viewMode === 'ground' && this.canBuild(sel);
    if (!show) { this.panel.hidden = true; return; }
    const b = this.ensureBuild(sel);
    const sig = `${sel.state}|${sel.taxiTarget}|${(sel.taxiNames || []).join(',')}`;
    if (sig !== b.sig) { b.sig = sig; b.dirty = true; }
    if (!b.dirty && !this.panel.hidden) return;
    b.dirty = false;
    const tgtLabel = (t) => (!t ? '—' : t.startsWith('ST') ? `stand ${t.slice(2)}` : t);
    const routeText = (names, t) => names.filter((n, i) => !(i === names.length - 1 && n === t)).join(' › ');
    const edited = b.via.length || b.target;
    // Already cleared and nothing changed: show the cleared route instead of a suggestion.
    if (!edited && sel.hasTaxiRoute()) {
      const r = routeText(sel.taxiNames || [], sel.taxiTarget);
      this.panel.innerHTML = `
        <div class="tb-head"><b>${esc(sel.cs)}</b> taxi route <span>cleared</span></div>
        <div class="tb-route">${esc(r)}${r ? ' › ' : ''}<b>${esc(tgtLabel(sel.taxiTarget))}</b></div>
        <div class="tb-hint">Click taxiways or a holding point / stand to give a new route.</div>`;
      this.panel.hidden = false;
      return;
    }
    const tgt = tgtLabel(b.targetName);
    const route = b.preview ? routeText(b.names, b.targetName) : '';
    this.panel.innerHTML = `
      <div class="tb-head"><b>${esc(sel.cs)}</b> taxi route <span>${edited ? (sel.hasTaxiRoute() ? 'new route' : 'your route') : 'suggested'}</span></div>
      <div class="tb-route">${b.preview ? `${esc(route)}${route ? ' › ' : ''}<b>${esc(tgt)}</b>` : `<span class="warn">No route via ${esc(b.via.join(' › '))} to ${esc(tgt)}</span>`}</div>
      <div class="tb-hint">Click taxiways in order, then a holding point or stand.</div>
      <div class="tb-btns"><button data-act="send" ${b.preview ? '' : 'disabled'}>Send taxi</button><button data-act="undo">Undo</button><button data-act="clear">Clear</button></div>`;
    this.panel.hidden = false;
  }

  // Click on the chart: select an aircraft, or add a taxiway / target to the route being built.
  click(sx, sy) {
    const r = this.radar, g = r.game;
    const ac = r.hitAircraft(sx, sy);
    if (ac) { g.select(ac); this.build = null; this.renderPanel(); return; }
    const sel = g.selected;
    if (!this.canBuild(sel)) { g.select(null); this.build = null; this.renderPanel(); return; }
    const b = this.ensureBuild(sel);
    const node = this.hitNode(sx, sy);
    const w = this.toWorldM(sx, sy);
    const e = !node && GROUND.nearestEdge({ x: w.x / GROUND.M_PER_NM, y: w.y / GROUND.M_PER_NM }, 10 / this.view.scale / GROUND.M_PER_NM);
    if (node) b.target = node.name;
    else if (e) { if (b.via[b.via.length - 1] !== e.name) b.via.push(e.name); }
    else { g.select(null); this.build = null; this.renderPanel(); return; }
    this.updateBuild();
    g.ui.input.value = b.cmd;
    this.renderPanel();
  }

  hitEdge(sx, sy) {
    const w = this.toWorldM(sx, sy);
    return GROUND.nearestEdge({ x: w.x / GROUND.M_PER_NM, y: w.y / GROUND.M_PER_NM }, 10 / this.view.scale / GROUND.M_PER_NM);
  }

  fit() {
    const r = this.radar, c = AIRPORT_DEF.chart || {};
    let f = c.fit;
    if (!f) {
      // Bounding box (world metres) of the airport's chart area given in the local frame.
      const b = c.box, pts = [[b.u0, b.v0], [b.u1, b.v0], [b.u0, b.v1], [b.u1, b.v1]].map(([u, v]) => GROUND.toWorld(u, v));
      const xs = pts.map((p) => p.x * GROUND.M_PER_NM), ys = pts.map((p) => p.y * GROUND.M_PER_NM);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      f = { w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    }
    this.view.scale = Math.min(r.w / f.w, r.h / f.h);
    this.view.cx = f.cx; this.view.cy = f.cy;
    this.fitted = true;
  }

  toScreen(p) { // p in world nm
    const v = this.view, r = this.radar;
    return { x: r.w / 2 + (p.x * GROUND.M_PER_NM - v.cx) * v.scale, y: r.h / 2 - (p.y * GROUND.M_PER_NM - v.cy) * v.scale };
  }
  toWorldM(sx, sy) {
    const v = this.view, r = this.radar;
    return { x: v.cx + (sx - r.w / 2) / v.scale, y: v.cy - (sy - r.h / 2) / v.scale };
  }
  local(u, v) { return this.toScreen(GROUND.toWorld(u, v)); }

  // Canvas transform so drawing happens in the local (u, v) metre frame.
  setLocalTransform(ctx = this.radar.ctx) {
    const r = this.radar, v = this.view, s = v.scale, dpr = window.devicePixelRatio || 1;
    const { U, V } = GROUND;
    ctx.setTransform(dpr * s * U.x, -dpr * s * U.y, dpr * s * V.x, -dpr * s * V.y,
      dpr * (r.w / 2 - s * v.cx), dpr * (r.h / 2 + s * v.cy));
  }
  resetTransform(ctx = this.radar.ctx) { const dpr = window.devicePixelRatio || 1; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }

  pan(dx, dy) { this.view.cx -= dx / this.view.scale; this.view.cy += dy / this.view.scale; }
  zoom(sx, sy, k) {
    const before = this.toWorldM(sx, sy);
    this.view.scale = Geo.clamp(this.view.scale * k, 0.08, 6);
    const after = this.toWorldM(sx, sy);
    this.view.cx += before.x - after.x; this.view.cy += before.y - after.y;
  }

  hitNode(sx, sy) {
    let best = null, bd = 14;
    for (const n of Object.values(GROUND.nodes)) {
      if (n.kind !== 'hold' && n.kind !== 'stand') continue;
      const p = this.toScreen(n);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  // The airfield itself only changes when the view does: render it once into an offscreen layer.
  staticLayer() {
    const r = this.radar, v = this.view, dpr = window.devicePixelRatio || 1;
    const key = `${r.w}x${r.h}@${dpr}:${v.scale.toFixed(5)},${v.cx.toFixed(2)},${v.cy.toFixed(2)}`;
    if (this.layer && this.layer.key === key) return this.layer.canvas;
    const canvas = this.layer?.canvas || document.createElement('canvas');
    canvas.width = Math.round(r.w * dpr); canvas.height = Math.round(r.h * dpr);
    this.drawAirfield(canvas.getContext('2d'));
    this.layer = { key, canvas };
    return canvas;
  }

  // Detailed aerodrome chart in the local (u along runway, v across) metre frame, labels upright on screen.
  // Runways, taxiways, holding points and stands are drawn from the layout; aprons, buildings and their names
  // come from the airport's own decoration.
  drawAirfield(ctx) {
    const s = this.view.scale, N = GROUND.nodes;
    const C = {
      grass: '#17221b', grass2: '#1b2820', shoulder: '#2b3530', twy: '#454e56', apron: '#3b444c', rwy: '#2b3034',
      rwyShoulder: '#323a37', paint: '#e6ebee', yellow: '#d9b63a', road: '#565f66', building: '#2a3e52', building2: '#33475a',
    };
    this.resetTransform(ctx);
    ctx.fillStyle = C.grass;
    ctx.fillRect(0, 0, this.radar.w, this.radar.h);
    this.setLocalTransform(ctx);
    const px = 1 / s; // one screen pixel in metres
    const rect = (u0, v0, u1, v1, col) => { ctx.fillStyle = col; ctx.fillRect(Math.min(u0, u1), Math.min(v0, v1), Math.abs(u1 - u0), Math.abs(v1 - v0)); };
    const line = (pts, col, w, dash = []) => {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash);
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.u, p.v) : ctx.moveTo(p.u, p.v))); ctx.stroke(); ctx.setLineDash([]);
    };
    const P = (u, v) => ({ u, v });
    // Band from t0 to t1 along direction d and w0 to w1 across it, around point c (for markings at any angle).
    const band = (c, d, t0, t1, w0, w1, col) => {
      const q = { u: -d.v, v: d.u };
      const pt = (t, w) => [c.u + d.u * t + q.u * w, c.v + d.v * t + q.v * w];
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(...pt(t0, w0)); ctx.lineTo(...pt(t1, w0)); ctx.lineTo(...pt(t1, w1)); ctx.lineTo(...pt(t0, w1));
      ctx.closePath(); ctx.fill();
    };
    const deco = AIRPORT_DEF.decor || {};
    deco.base?.({ ctx, rect, line, P, C, px, s });

    // Runways: shoulders, pavement, blast pads, markings
    for (const R of RUNWAY_PHYS) {
      const v0 = R.v, half = R.width / 2;
      rect(R.u0 - 60, v0 - half - 7.5, R.u1 + 60, v0 + half + 7.5, C.rwyShoulder);
      rect(R.u0, v0 - half, R.u1, v0 + half, C.rwy);
      for (const [e, inward] of [[R.u0, 1], [R.u1, -1]]) { // inward: u direction pointing into the runway
        // Blast pad with yellow chevrons beyond the end
        rect(e, v0 - half, e - inward * 60, v0 + half, '#30363a');
        for (let k = 0; k < 3; k++) {
          const tip = e - inward * (12 + k * 16);
          line([P(tip - inward * 14, v0 - half * 0.8), P(tip, v0), P(tip - inward * 14, v0 + half * 0.8)], C.yellow, 1.6);
        }
        // Threshold bar and piano keys (16 on a 60 m runway, 12 on 45 m)
        rect(e, v0 - half + 1, e + inward * 1.8, v0 + half - 1, C.paint);
        const nk = R.width >= 60 ? 8 : R.width >= 45 ? 6 : 4, gap = (half - 3) / nk;
        for (let i = 0; i < nk; i++) for (const side of [-1, 1]) {
          const off = side * gap * (i + 1);
          rect(e + inward * 6, v0 + off - 0.9, e + inward * 36, v0 + off + 0.9, C.paint);
        }
        // Aiming point (400 m) and touchdown zone markings
        for (const side of [-1, 1]) rect(e + inward * 400, v0 + side * 9, e + inward * 445, v0 + side * 15, C.paint);
        for (const [d, n] of [[150, 3], [300, 3], [600, 2], [750, 2], [900, 1]]) {
          for (const side of [-1, 1]) for (let k = 0; k < n; k++) {
            const off = side * (9 + k * 3);
            rect(e + inward * d, v0 + off - 0.9, e + inward * (d + 22.5), v0 + off + 0.9, C.paint);
          }
        }
      }
      // Side stripes and centreline (30 m dashes, 20 m gaps)
      for (const side of [-1, 1]) rect(R.u0, v0 + side * (half - 1.4), R.u1, v0 + side * (half - 0.5), C.paint);
      for (let u = R.u0 + 80; u < R.u1 - 110; u += 50) rect(u, v0 - 0.5, u + 30, v0 + 0.5, C.paint);
    }

    // Approach lights, PAPIs, ILS antennas and windsocks for each runway end
    for (const r of Object.values(RUNWAYS)) {
      const v0 = r.v, e = r.thrU, out = -r.dirU; // out: u direction away from the runway on the approach side
      const outer = RUNWAY_PHYS.find((p) => p.phys === r.phys).outer || 1; // side for the glide path antenna
      const half = r.width / 2, left = r.dirU; // the pilot's left, in v
      ctx.fillStyle = '#d8d2a8';
      for (let d = 30; d <= 900; d += 30) ctx.fillRect(e + out * d - 1.5, v0 - 1.5, 3, 3);
      for (const d of [150, 300, 450, 600, 750]) ctx.fillRect(e + out * d - 1, v0 - (d === 300 ? 15 : 6), 2, d === 300 ? 30 : 12);
      for (let k = 0; k < 4; k++) rect(e - out * 300 - 2, v0 + left * (half + 15 + k * 9) - 2, e - out * 300 + 2, v0 + left * (half + 15 + k * 9) + 2, k < 2 ? '#f2f2f2' : '#e04848');
      rect(e - out * 330 - 4, v0 + outer * 140 - 4, e - out * 330 + 4, v0 + outer * 140 + 4, '#8fa0ae');
      rect(r.endU - out * 300 - 2, v0 - 30, r.endU - out * 300 + 2, v0 + 30, '#8fa0ae'); // localizer beyond the far end
      ctx.fillStyle = '#f08a2c';
      ctx.beginPath(); ctx.moveTo(e - out * 250, v0 + outer * 120); ctx.lineTo(e - out * 250 + 14, v0 + outer * 124); ctx.lineTo(e - out * 250 + 14, v0 + outer * 116); ctx.closePath(); ctx.fill();
    }

    // Taxiways: shoulders, pavement (straights + junction fillets), centrelines
    const fillets = junctionFillets();
    const TW = GROUND.dims.TWY_W;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [w, col] of [[TW + 15, C.shoulder], [TW, C.twy]]) {
      ctx.strokeStyle = col; ctx.lineWidth = w;
      for (const e of GROUND.edges) {
        if (e.kind === 'rwy') continue;
        const A = N[e.a], B = N[e.b];
        ctx.beginPath(); ctx.moveTo(A.u, A.v); ctx.lineTo(B.u, B.v); ctx.stroke();
      }
      for (const f of fillets) {
        if (f.onRunway) continue;
        ctx.beginPath(); f.pts.forEach((p, i) => (i ? ctx.lineTo(p.u, p.v) : ctx.moveTo(p.u, p.v))); ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';
    const cl = Math.max(px * 1.1, 0.6);
    for (const e of GROUND.edges) {
      if (e.kind === 'rwy') continue;
      line([N[e.a], N[e.b]], C.yellow, cl);
    }
    for (const f of fillets) line(f.pts, f.onRunway ? 'rgba(217,182,58,0.85)' : C.yellow, cl);
    // Taxiway edge markings along the parallel taxiways
    for (const e of GROUND.edges) {
      if (e.kind !== 'main') continue;
      const A = N[e.a], B = N[e.b], d = unit(A, B);
      for (const side of [-1, 1]) {
        const o = { u: -d.v * side * 11, v: d.u * side * 11 };
        line([P(A.u + o.u, A.v + o.v), P(B.u + o.u, B.v + o.v)], 'rgba(217,182,58,0.35)', Math.max(px * 0.7, 0.4), [6, 4]);
      }
    }

    // Runway holding positions: pattern A at every holding point, pattern B (ILS critical area) where published
    for (const n of Object.values(N)) {
      if (n.kind !== 'hold') continue;
      const d = unit(n, N[n.rwyNode]); // towards the runway
      band(n, d, 1, 1.8, -12, 12, C.yellow);
      band(n, d, 3.2, 4, -12, 12, C.yellow);
      for (let w = -12; w < 12; w += 3) { band(n, d, 5.6, 6.4, w, w + 1.6, C.yellow); band(n, d, 7.8, 8.6, w, w + 1.6, C.yellow); }
      if (n.ils) {
        band(n, d, -32.4, -31.6, -12, 12, C.yellow);
        band(n, d, -36, -35.2, -12, 12, C.yellow);
        for (let w = -11; w <= 11; w += 2.5) band(n, d, -35.6, -32, w - 0.4, w + 0.4, C.yellow);
      }
    }

    // Stands: lead-in lines come from the junction fillets; stop bars, parking boxes, jet bridges
    for (const st of Object.values(GROUND.stands)) {
      const S = N[st.node], d = unit(N[st.lane], S); // nose direction
      band(S, d, 12, 13, -6, 6, C.paint);
      const q = { u: -d.v, v: d.u };
      const corner = (t, w) => P(S.u + d.u * t + q.u * w, S.v + d.v * t + q.v * w);
      line([corner(-30, -32), corner(92, -32), corner(92, 32), corner(-30, 32), corner(-30, -32)], 'rgba(230,235,238,0.25)', Math.max(px * 0.8, 0.5));
      if (st.bridge) {
        band(S, d, 18, 18 + st.bridge, -22, -18, '#5d6872');
        const c = corner(18 + st.bridge, -20);
        ctx.fillStyle = '#5d6872'; ctx.beginPath(); ctx.arc(c.u, c.v, 4, 0, Math.PI * 2); ctx.fill();
      }
    }
    deco.buildings?.({ ctx, rect, line, P, C, px, s });

    // ---- screen-space labels ----
    this.resetTransform(ctx);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const fs = Math.round(Geo.clamp(11 * s / 0.3, 9, 14));
    const labelAt = (text, p, bg, fg, size = fs) => {
      ctx.font = `600 ${size}px "JetBrains Mono", monospace`;
      const w = ctx.measureText(text).width + 6;
      ctx.fillStyle = bg; ctx.fillRect(p.x - w / 2, p.y - size * 0.65, w, size * 1.3);
      ctx.fillStyle = fg; ctx.fillText(text, p.x, p.y + 0.5);
      return w;
    };
    const label = (text, u, v, bg, fg, size = fs) => labelAt(text, this.local(u, v), bg, fg, size);
    // Runway designators painted on the runway, reading from the approach
    for (const r of Object.values(RUNWAYS)) {
      const p = this.local(r.thrU + r.dirU * 60, r.v), q = this.local(r.thrU + r.dirU * 70, r.v);
      const size = 18 * s * Math.min(1, r.width / 60 + 0.15);
      if (size < 5) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(q.x - p.x, -(q.y - p.y)));
      ctx.font = `700 ${size}px "JetBrains Mono", monospace`;
      ctx.fillStyle = C.paint;
      ctx.fillText(r.id, 0, 0);
      ctx.restore();
    }
    const big = s > 0.22, close = s > 0.55;
    if (big) for (const sg of GROUND.signs) label(sg.text, sg.u, sg.v, '#111', '#e2c033');
    // Mandatory instruction signs at the runway holding points (white on red) beside location signs
    for (const n of Object.values(N)) {
      if (n.kind !== 'hold') continue;
      const rwys = Object.entries(GROUND.holdingPoints).filter(([, hp]) => hp === n.name).map(([rw]) => rw);
      const ids = RUNWAY_PHYS.find((p) => p.phys === n.phys).ids;
      const text = rwys.length ? `${n.name} ${rwys[0]}` : n.name;
      if (rwys.length || big) {
        const d = unit(n, N[n.rwyNode]);
        const p = this.local(n.u + d.u * 30, n.v + d.v * 30);
        const w1 = labelAt(close ? `${ids[1]}-${ids[0]}` : text, p, '#b0201e', '#fff');
        if (close) { ctx.font = `600 ${fs}px "JetBrains Mono", monospace`; const w2 = ctx.measureText(n.name).width + 6; labelAt(n.name, { x: p.x - (w1 + w2) / 2 - 2, y: p.y }, '#111', '#e2c033'); }
      }
    }
    // Direction signs at the parallel-taxiway junctions when zoomed in
    if (close) {
      for (const n of Object.values(N)) {
        const list = GROUND.adj[n.name] || [];
        if (!n.name.includes('@') || !list.some(({ e }) => e.kind === 'main')) continue;
        const names = [...new Set(list.filter(({ e }) => e.kind !== 'main').map(({ e }) => e.name))];
        if (!names.length) continue;
        const rv = RUNWAY_PHYS.reduce((b, p) => (Math.abs(p.v - n.v) < Math.abs(b - n.v) ? p.v : b), Infinity);
        label(names.join(' '), n.u + 30, n.v - Math.sign(rv - n.v) * 22, '#e2c033', '#111', fs - 1);
      }
    }
    ctx.font = `${fs}px "JetBrains Mono", monospace`;
    ctx.fillStyle = '#9fb3c3';
    for (const st of Object.values(GROUND.stands)) {
      const S = N[st.node], d = unit(N[st.lane], S);
      const p = this.local(S.u + d.u * 55, S.v + d.v * 55);
      ctx.fillText(String(st.num), p.x, p.y);
    }
    const name = (text, u, v, col = '#7f9db5') => { const p = this.local(u, v); ctx.fillStyle = col; ctx.fillText(text, p.x, p.y); };
    deco.labels?.({ name, label, big, close, s });
    if (close) {
      for (const r of Object.values(RUNWAYS)) {
        const outer = RUNWAY_PHYS.find((p) => p.phys === r.phys).outer || 1;
        name('PAPI', r.thrU + r.dirU * 300, r.v + r.dirU * (r.width / 2 + 55), '#8a98a5');
        name('GP', r.thrU + r.dirU * 330, r.v + outer * 160, '#8a98a5');
      }
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  draw() {
    const r = this.radar, ctx = r.ctx, g = r.game;
    if (!this.fitted) this.fit();
    this.resetTransform();
    ctx.drawImage(this.staticLayer(), 0, 0, r.w, r.h);
    this.drawStopBars(ctx);

    // Taxi routes and aircraft
    for (const ac of g.aircraft) {
      const path = ac.state === 'taxi' ? ac.taxiPath : ac.state === 'pushback' ? ac.push?.next : null;
      if (!path?.length) continue;
      const sel = ac === g.selected;
      const pts = ac.gp && ac.state === 'taxi' ? [ac, ...ac.gp.pts.filter((q) => q.s > ac.gp.s)] : [ac, ...path.map((n) => GROUND.nodes[n])];
      ctx.strokeStyle = sel ? 'rgba(95,240,255,0.9)' : 'rgba(110,230,140,0.45)';
      ctx.lineWidth = sel ? 3 : 2;
      ctx.setLineDash(sel ? [] : [6, 4]);
      ctx.beginPath();
      pts.forEach((q, i) => { const p = this.toScreen(q); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Route being built: highlight chosen taxiways and the resulting path.
    const b = this.build;
    if (b && g.selected && b.cs === g.selected.cs && this.canBuild(g.selected) && (b.via.length || b.target || !g.selected.hasTaxiRoute())) {
      this.setLocalTransform();
      ctx.strokeStyle = 'rgba(95,240,255,0.25)';
      ctx.lineWidth = GROUND.dims.TWY_W * 1.6;
      for (const e of GROUND.edges) {
        if (!b.via.includes(e.name)) continue;
        const A = GROUND.nodes[e.a], B = GROUND.nodes[e.b];
        ctx.beginPath(); ctx.moveTo(A.u, A.v); ctx.lineTo(B.u, B.v); ctx.stroke();
      }
      this.resetTransform();
      if (b.preview) {
        ctx.strokeStyle = '#5ff0ff'; ctx.lineWidth = 2.5; ctx.setLineDash([8, 5]);
        ctx.beginPath();
        [g.selected, ...b.preview.map((n) => GROUND.nodes[n])].forEach((q, i) => { const p = this.toScreen(q); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
        ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // Taxiway under the mouse while building
    if (this.canBuild(g.selected) && r.mouse.x >= 0 && !this.hitNode(r.mouse.x, r.mouse.y)) {
      const e = this.hitEdge(r.mouse.x, r.mouse.y);
      if (e) {
        const A = this.toScreen(GROUND.nodes[e.a]), B = this.toScreen(GROUND.nodes[e.b]);
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
        ctx.font = '11px "JetBrains Mono", monospace'; ctx.fillStyle = '#fff';
        ctx.fillText(e.name, r.mouse.x + 12, r.mouse.y - 8);
      }
    }
    this.renderPanel();
    r.hitBoxes = [];
    for (const ac of g.aircraft) {
      if (ac.state === 'gone') continue;
      const p = this.toScreen(ac);
      if (p.x < -60 || p.y < -60 || p.x > r.w + 60 || p.y > r.h + 60) continue;
      this.drawAircraft(ac, p);
    }
    // Mouse-over holding point / stand when an aircraft is selected
    if (g.selected && r.mouse.x >= 0) {
      const n = this.hitNode(r.mouse.x, r.mouse.y);
      if (n) {
        const p = this.toScreen(n);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#8ea3b5';
    ctx.fillText(`${AIRPORT.icao} GROUND CHART · wind ${g.windText()} · select an aircraft, click taxiways in order, then a holding point or stand`, 12, r.h - 14);
  }

  // Red stop bars at every runway holding point; off with green lead-on lights while an aircraft lines up from it.
  drawStopBars(ctx) {
    const g = this.radar.game, s = this.view.scale;
    const clearedFrom = new Set(g.aircraft.filter((a) => a.state === 'lineup' && a.lining).map((a) => a.hpNode));
    for (const a of g.aircraft) if (a.crossing && !a.crossPast && a.crossFrom) clearedFrom.add(a.crossFrom);
    for (const n of Object.values(GROUND.nodes)) {
      if (n.kind !== 'hold') continue;
      const d = unit(n, GROUND.nodes[n.rwyNode]), q = { u: -d.v, v: d.u };
      const a = this.local(n.u - d.u * 2 - q.u * 12, n.v - d.v * 2 - q.v * 12), b = this.local(n.u - d.u * 2 + q.u * 12, n.v - d.v * 2 + q.v * 12);
      if (clearedFrom.has(n.name)) {
        ctx.fillStyle = '#3df07a';
        for (let k = 0; k <= 4; k++) {
          const p = this.local(n.u + d.u * k * 20, n.v + d.v * k * 20);
          ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.5, 1.6 * s), 0, Math.PI * 2); ctx.fill();
        }
        continue;
      }
      ctx.strokeStyle = '#ff2d2d'; ctx.lineWidth = Math.max(2, 2.4 * s); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.lineCap = 'butt';
    }
    // North arrow and scale bar
    const r = this.radar;
    ctx.fillStyle = '#9fb3c3'; ctx.strokeStyle = '#9fb3c3'; ctx.lineWidth = 1.5;
    const nx = r.w - 30, ny = 60;
    ctx.beginPath(); ctx.moveTo(nx, ny - 16); ctx.lineTo(nx + 7, ny + 6); ctx.lineTo(nx, ny); ctx.lineTo(nx - 7, ny + 6); ctx.closePath(); ctx.fill();
    ctx.font = '11px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText('N', nx, ny + 20);
    const m = [100, 200, 500, 1000].find((x) => x * s > 70) || 1000;
    const len = m * s, x0 = r.w - 20 - len, y0 = r.h - 40;
    ctx.beginPath(); ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0); ctx.lineTo(x0 + len, y0); ctx.lineTo(x0 + len, y0 - 4); ctx.stroke();
    ctx.fillText(`${m} m`, x0 + len / 2, y0 - 7);
    ctx.textAlign = 'left';
  }

  drawAircraft(ac, p) {
    const r = this.radar, ctx = r.ctx, g = r.game;
    const sel = ac === g.selected;
    const mine = g.userOwns(ac);
    const col = sel ? '#5ff0ff' : !mine ? '#7a8a96' : ac.isArr ? '#ff7be6' : '#7fb2ff';
    if (ac.emg && !ac.emg.done) {
      // Emergency: pulsing ring (fire service in attendance once on the ground)
      const k = (performance.now() / 600) % 1;
      ctx.strokeStyle = `rgba(255,79,154,${1 - k})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 10 + k * 18, 0, Math.PI * 2); ctx.stroke();
    }
    const airborne = ac.state === 'air' || ac.state === 'takeoff';
    // Silhouette scaled to wingspan
    const span = (ac.wake === 'H' ? 64 : ac.type === 'DH8D' ? 28 : 35) * this.view.scale;
    const k = Math.max(span, 10) / 2;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Geo.rad(ac.hdg));
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, -k); ctx.lineTo(k * 0.12, -k * 0.55); ctx.lineTo(k, k * 0.05); ctx.lineTo(k, k * 0.2);
    ctx.lineTo(k * 0.12, -k * 0.05); ctx.lineTo(k * 0.1, k * 0.6); ctx.lineTo(k * 0.4, k * 0.85); ctx.lineTo(k * 0.4, k * 0.95);
    ctx.lineTo(0, k * 0.85); ctx.lineTo(-k * 0.4, k * 0.95); ctx.lineTo(-k * 0.4, k * 0.85); ctx.lineTo(-k * 0.1, k * 0.6);
    ctx.lineTo(-k * 0.12, -k * 0.05); ctx.lineTo(-k, k * 0.2); ctx.lineTo(-k, k * 0.05); ctx.lineTo(-k * 0.12, -k * 0.55);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    let status;
    switch (ac.state) {
      case 'stand': status = `STAND ${ac.stand}${ac.cleared ? ' CLRD' : ''}`; break;
      case 'pushback': status = 'PUSHBACK'; break;
      case 'taxi': status = ac.groundStatus(g); break;
      case 'ground': status = `HP ${ac.gnode} RDY`; break;
      case 'lineup': status = `LINED UP ${ac.rwy}`; break;
      case 'takeoff': status = 'T/O ROLL'; break;
      case 'landed': status = 'ROLLOUT'; break;
      case 'parked': status = `ON STAND ${ac.stand}`; break;
      default: status = `${ac.altText()} ${ac.isArr ? 'ARR ' + ac.rwy : 'DEP'}`;
    }
    ctx.font = '10px "JetBrains Mono", monospace';
    const lines = [`${ac.cs} ${ac.type}`, status];
    const lx = p.x + 12, ly = p.y - 12;
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (sel) { ctx.fillStyle = 'rgba(10,30,40,0.8)'; ctx.fillRect(lx - 3, ly - 10, w + 6, 26); }
    ctx.fillStyle = col;
    lines.forEach((l, i) => ctx.fillText(l, lx, ly + i * 12));
    r.hitBoxes.push({ ac, x0: p.x - Math.max(k, 9), y0: Math.min(p.y - k, ly - 10), x1: lx + w + 3, y1: Math.max(p.y + k, ly + 16) });
    if (airborne) { ctx.strokeStyle = col; ctx.strokeRect(p.x - 5, p.y - 5, 10, 10); }
  }
}
