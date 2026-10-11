// Aerodrome ground layout (taxiways, holding points, stands), taxi routing and ground movement.
//
// The layout is defined in a runway-aligned local frame in metres:
//   u = along the runways (positive towards 080, i.e. east), v = across (positive towards 350, i.e. north).
// Runway 08L/26R is at v = +694.5 (north), 08R/26L at v = -694.5 (south); the terminal sits between them.
const GROUND = (() => {
  const M_PER_NM = 1852;
  const U = Geo.vec(80), V = Geo.vec(350);
  const toWorld = (u, v) => ({ x: (U.x * u + V.x * v) / M_PER_NM, y: (U.y * u + V.y * v) / M_PER_NM });

  const RWY_HALF = 1852, RWY_V = 694.5, RWY_W = 60;
  const TWY_V = 494.5; // parallel taxiways A (north) and B (south)
  const HOLD_V = 604.5; // runway holding positions, 90 m from the centreline
  const EXIT_V = 545; // where vacating aircraft stop, clear of the runway
  const LANE_V = 380; // apron taxilanes P (north) and Q (south)
  const STAND_V = 262;
  const TWY_W = 23;

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
    list.sort((p, q) => nodes[p].u - nodes[q].u);
    for (let i = 1; i < list.length; i++) edge(list[i - 1], list[i], name, kind);
  };

  const sides = [
    { s: 1, twy: 'A', lane: 'P', link: 'J', exitPre: 'K', rwyW: '08L', rwyE: '26R', stand0: 1 },
    { s: -1, twy: 'B', lane: 'Q', link: 'H', exitPre: 'M', rwyW: '08R', rwyE: '26L', stand0: 21 },
  ];
  const CONNECTORS = [-1852, -1250, -600, 0, 600, 1250, 1852];
  // Rapid exits: [runway u, taxiway u, landing direction]
  const RAPID = [[250, -110, 260], [-450, -810, 260], [-250, 110, 80], [450, 810, 80]];
  const STAND_U = Array.from({ length: 12 }, (_, i) => -825 + i * 150);
  const LINKS = [-600, 0, 600];

  const holdingPoints = {}; // runway id -> holding point node name
  const exits = {}; // runway id -> [{ name, rwyNode, u }]
  const stands = {}; // number -> { name, node, lane, u, v }
  const signs = []; // taxiway labels { text, u, v }

  for (const sd of sides) {
    const { s } = sd;
    const rwyNodes = [], twyNodes = [], laneNodes = [];
    const phys = s > 0 ? 'N' : 'S';
    exits[sd.rwyW] = []; exits[sd.rwyE] = [];
    // Connectors with holding points
    CONNECTORS.forEach((u, i) => {
      const name = `${sd.twy}${i + 1}`;
      const r = node(`R${phys}${u}`, u, s * RWY_V, 'rwy');
      const h = node(`${name}`, u, s * HOLD_V, 'hold');
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
      stands[num] = { num, node: st, lane: l, u, v: s * STAND_V };
    });
    // Taxilane ends join the cross taxiways E (west) and F (east)
    const lw = node(`${sd.lane}@-1100`, -1100, s * LANE_V), le = node(`${sd.lane}@1100`, 1100, s * LANE_V);
    laneNodes.push(lw, le);
    edge(lw, node(`E@${s * LANE_V}`, -1250, s * LANE_V), sd.lane);
    edge(le, node(`F@${s * LANE_V}`, 1250, s * LANE_V), sd.lane);
    chain(twyNodes, sd.twy);
    chain(laneNodes, sd.lane);
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

  // Adjacency for routing (runway edges are excluded from taxi routes).
  const adj = {};
  for (const e of edges) {
    (adj[e.a] = adj[e.a] || []).push({ to: e.b, e });
    (adj[e.b] = adj[e.b] || []).push({ to: e.a, e });
  }

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

  return {
    M_PER_NM, U, V, toWorld, nodes, edges, route, nearestNode, nearestEdge, holdingPoints, exits, stands, signs, taxiwayNames,
    dims: { RWY_HALF, RWY_V, RWY_W, TWY_V, HOLD_V, LANE_V, STAND_V, TWY_W },
  };
})();

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
    if (!this.taxiPath.length || this.holdPos) { this.spd = Math.max(0, this.spd - 4 * dt); this.coast(dt); return; }
    this.taxiStep(dt, game);
  },

  pushUpdate(dt, game) {
    const P = this.push;
    this.spd = Math.min(5, this.spd + 1 * dt);
    P.s = Math.min(1, P.s + (this.spd / 3600) * dt / P.len);
    const a = bezier(P.p0, P.p1, P.p2, P.s), b = bezier(P.p0, P.p1, P.p2, Math.min(1, P.s + 0.01));
    this.x = a.x; this.y = a.y;
    if (P.s < 0.99) this.hdg = Geo.norm(Geo.bearing(a, b) + 180); // nose opposite to the direction of travel
    if (P.s >= 1) {
      this.hdg = P.face === 'E' ? 80 : 260;
      this.state = 'taxi';
      this.spd = 0;
      this.gnode = null;
      this.taxiPath = P.next.length ? P.next : [];
      if (!this.taxiPath.length) { this.gnode = P.lane; this.parkedAt = { x: this.x, y: this.y }; game.pilotSay(this, 'pushback complete, ready to taxi'); }
    }
  },

  // Roll to a stop when there is nowhere to go.
  coast(dt) { if (this.spd > 0) this.move(dt); },

  // Follow the taxi path with smooth turns: steer towards a look-ahead point along the path,
  // with the turn rate limited by a minimum turn radius, and slow down for sharp turns.
  taxiStep(dt, game) {
    const LOOK = nmOf(26), MIN_R = 18; // metres
    const n0 = GROUND.nodes[this.taxiPath[0]], n1 = this.taxiPath[1] && GROUND.nodes[this.taxiPath[1]];
    const d0 = Geo.dist(this, n0);
    // Speed: 15 kt on taxiways, 10 kt on the apron, slower for sharp turns and the final stop.
    let target = n0.kind === 'stand' || /^[PQ]@/.test(n0.name) ? 10 : TAXI_KT;
    if (n1) {
      const turn = Math.abs(Geo.diff(Geo.bearing(this, n0), Geo.bearing(n0, n1)));
      if (turn > 35 && d0 < nmOf(70)) target = Math.min(target, turn > 120 ? 4 : turn > 75 ? 7 : 10);
    } else if (d0 < nmOf(60)) target = Math.min(target, 5);
    if (game.groundBlocker(this)) target = 0;
    this.spd += Geo.clamp(target - this.spd, -4 * dt, 1.5 * dt);
    // Look-ahead point
    let aim = n0;
    if (n1 && d0 < LOOK) {
      const k = (LOOK - d0) / Geo.dist(n0, n1);
      aim = { x: n0.x + (n1.x - n0.x) * Math.min(1, k), y: n0.y + (n1.y - n0.y) * Math.min(1, k) };
    }
    const want = Geo.bearing(this, aim);
    const ms = this.spd * 0.5144;
    const rate = Geo.deg(ms / MIN_R) + 1.5; // deg/s
    const d = Geo.diff(this.hdg, want);
    this.hdg = Geo.norm(this.hdg + Geo.clamp(d, -rate * dt, rate * dt));
    if (this.spd > 0.05) this.move(dt);
    // Node passing
    const ahead = Math.cos(Geo.rad(Geo.diff(this.hdg, Geo.bearing(this, n0))));
    if (n1 && (d0 < LOOK * 0.6 || (d0 < LOOK && ahead < 0))) {
      this.gnode = this.taxiPath.shift();
    } else if (!n1 && (d0 < nmOf(3) || (d0 < nmOf(12) && ahead < 0))) {
      this.gnode = this.taxiPath.shift();
      this.x = n0.x; this.y = n0.y;
      this.arriveAt(game);
    }
  },

  // On the ground, aircraft move along their heading (no wind).
  arriveAt(game) {
    this.spd = 0;
    const n = GROUND.nodes[this.gnode];
    if (!this.isArr && this.gnode === GROUND.holdingPoints[this.rwy]) {
      this.state = 'ground';
      this.hdg = Geo.bearing(n, GROUND.nodes[`R${this.runway.phys}${n.u}`]);
      game.onReachedHoldingPoint(this);
    } else if (this.isArr && n.kind === 'stand') {
      this.state = 'parked';
      this.parkTime = game.time;
      game.onParked(this);
    } else if (n.kind === 'exit' && this.isArr) {
      this.vacatedVia = n.name.replace(/x$/, '');
      game.onVacated(this);
    } else {
      game.pilotSay(this, `holding at ${n.name.replace(/@.*/, '')}, request further taxi`);
    }
  },

  // Landing roll: pick the first exit we can make, then turn off there.
  chooseExit() {
    const r = this.runway;
    const dirSign = r.heading === 80 ? 1 : -1; // +u for 08, -u for 26
    const here = { u: (this.x * GROUND.M_PER_NM) * GROUND.U.x + (this.y * GROUND.M_PER_NM) * GROUND.U.y };
    const ktToMs = 0.5144;
    const v = this.spd * ktToMs, vExit = 25 * ktToMs, a = 4 * ktToMs;
    const need = (v * v - vExit * vExit) / (2 * a);
    const options = GROUND.exits[this.rwy]
      .map((e) => ({ ...e, ahead: (e.u - here.u) * dirSign }))
      .filter((e) => e.ahead >= need * 0.9)
      .sort((p, q) => p.ahead - q.ahead);
    const end = GROUND.exits[this.rwy].map((e) => ({ ...e, ahead: (e.u - here.u) * dirSign })).sort((p, q) => q.ahead - p.ahead)[0];
    this.exit = options[0] || end;
  },

  rollOut(dt, game) {
    if (!this.exit) this.chooseExit();
    const n = GROUND.nodes[this.exit.rwyNode];
    const dirSign = this.runway.heading === 80 ? 1 : -1;
    const ahead = ((n.x - this.x) * GROUND.U.x + (n.y - this.y) * GROUND.U.y) * GROUND.M_PER_NM * dirSign;
    // Brake to 25 kt for the exit, 18 kt over the last 150 m.
    this.spd = Math.max(ahead < 150 ? 18 : 25, this.spd - 4 * dt);
    if (ahead <= 15) {
      this.state = 'taxi';
      this.gnode = this.exit.rwyNode;
      this.taxiPath = [this.exit.exitNode];
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
    const r = this.radar;
    this.view.scale = Math.min(r.w / 4200, r.h / 1900);
    this.view.cx = 0; this.view.cy = 0;
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
  setLocalTransform() {
    const r = this.radar, v = this.view, s = v.scale, dpr = window.devicePixelRatio || 1;
    const { U, V } = GROUND;
    r.ctx.setTransform(dpr * s * U.x, -dpr * s * U.y, dpr * s * V.x, -dpr * s * V.y,
      dpr * (r.w / 2 - s * v.cx), dpr * (r.h / 2 + s * v.cy));
  }
  resetTransform() { const dpr = window.devicePixelRatio || 1; this.radar.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }

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

  draw() {
    const r = this.radar, ctx = r.ctx, g = r.game, D = GROUND.dims;
    if (!this.fitted) this.fit();
    ctx.fillStyle = '#18231d';
    ctx.fillRect(0, 0, r.w, r.h);
    const s = this.view.scale;

    this.setLocalTransform();
    // Aprons and terminal
    ctx.fillStyle = '#39424a';
    for (const sg of [1, -1]) ctx.fillRect(-1150, sg > 0 ? 150 : -440, 2300, 290);
    ctx.fillStyle = '#2a3f52';
    ctx.fillRect(-950, -150, 1900, 300);
    ctx.fillStyle = '#4b5560';
    ctx.fillRect(-1170, -20, 40, 40); // tower
    ctx.fillRect(1130, -30, 60, 60); // fire station
    // Taxiways (pavement)
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#4a535c';
    ctx.lineWidth = D.TWY_W;
    for (const e of GROUND.edges) {
      if (e.kind === 'rwy') continue;
      const a = GROUND.nodes[e.a], b = GROUND.nodes[e.b];
      ctx.beginPath(); ctx.moveTo(a.u, a.v); ctx.lineTo(b.u, b.v); ctx.stroke();
    }
    // Runways
    for (const sg of [1, -1]) {
      ctx.fillStyle = '#2c3135';
      ctx.fillRect(-D.RWY_HALF, sg * D.RWY_V - D.RWY_W / 2, 2 * D.RWY_HALF, D.RWY_W);
      ctx.fillStyle = '#e8edf0';
      // threshold piano keys
      for (const end of [-1, 1]) {
        for (let i = -3; i <= 3; i++) {
          if (i === 0) continue;
          ctx.fillRect(end * D.RWY_HALF - (end > 0 ? 40 : -6), sg * D.RWY_V + i * 7 - 2, 34, 3.5);
        }
        // touchdown zone bars
        for (const d of [150, 300, 450]) for (const off of [-12, 12]) ctx.fillRect(end * (D.RWY_HALF - d) - 15, sg * D.RWY_V + off - 1.5, 30, 3);
      }
      // centreline dashes
      for (let u = -D.RWY_HALF + 120; u < D.RWY_HALF - 120; u += 60) ctx.fillRect(u, sg * D.RWY_V - 0.6, 30, 1.2);
    }
    // Taxiway centrelines (yellow)
    ctx.strokeStyle = '#d8b53a';
    ctx.lineWidth = Math.max(1 / s, 0.8);
    for (const e of GROUND.edges) {
      if (e.kind === 'rwy') continue;
      const a = GROUND.nodes[e.a], b = GROUND.nodes[e.b];
      ctx.beginPath(); ctx.moveTo(a.u, a.v); ctx.lineTo(b.u, b.v); ctx.stroke();
    }
    // Runway holding positions: solid + dashed bars and a red stop bar
    for (const n of Object.values(GROUND.nodes)) {
      if (n.kind !== 'hold') continue;
      const sg = Math.sign(n.v);
      ctx.fillStyle = '#d8b53a';
      ctx.fillRect(n.u - 14, n.v + sg * 2, 28, 1.6);
      ctx.fillRect(n.u - 14, n.v + sg * 5, 28, 1.6);
      ctx.fillStyle = '#ff3b3b';
      ctx.fillRect(n.u - 13, n.v - sg * 3, 26, 2.4);
    }
    this.resetTransform();

    // Labels (screen space so they stay upright)
    ctx.textAlign = 'center';
    ctx.font = `${Math.round(Geo.clamp(11 * s / 0.3, 9, 14))}px "JetBrains Mono", monospace`;
    const big = s > 0.22;
    for (const sg of [1, -1]) {
      for (const [end, id] of sg > 0 ? [[-1, '08L'], [1, '26R']] : [[-1, '08R'], [1, '26L']]) {
        const p = this.local(end * (D.RWY_HALF - 90), sg * D.RWY_V);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(id, p.x, p.y + 4);
      }
    }
    const label = (text, u, v, bg, fg) => {
      const p = this.local(u, v);
      const w = ctx.measureText(text).width + 6;
      ctx.fillStyle = bg; ctx.fillRect(p.x - w / 2, p.y - 7, w, 13);
      ctx.fillStyle = fg; ctx.fillText(text, p.x, p.y + 4);
    };
    if (big) for (const sg of GROUND.signs) label(sg.text, sg.u, sg.v, '#e2c033', '#111');
    for (const n of Object.values(GROUND.nodes)) {
      if (n.kind !== 'hold') continue;
      const rwys = Object.entries(GROUND.holdingPoints).filter(([, hp]) => hp === n.name).map(([r]) => r);
      if (rwys.length || big) label(`${n.name}${rwys.length ? ' ' + rwys.join('/') : ''}`, n.u, n.v + Math.sign(n.v) * 26, '#9a1f1f', '#fff');
    }
    ctx.fillStyle = '#8ea3b5';
    for (const st of Object.values(GROUND.stands)) {
      const p = this.local(st.u, st.v - Math.sign(st.v) * 40);
      ctx.fillText(String(st.num), p.x, p.y + 4);
    }
    const t = this.local(0, 0);
    ctx.fillStyle = '#7f9db5'; ctx.fillText('TERMINAL', t.x, t.y + 4);
    const tw = this.local(-1150, -45); ctx.fillStyle = '#9fb3c3'; ctx.fillText('TWR', tw.x, tw.y + 4);
    const fs = this.local(1160, -55); ctx.fillText('RFFS', fs.x, fs.y + 4);
    ctx.textAlign = 'left';

    // Taxi routes and aircraft
    for (const ac of g.aircraft) {
      const path = ac.state === 'taxi' ? ac.taxiPath : ac.state === 'pushback' ? ac.push?.next : null;
      if (!path?.length) continue;
      const sel = ac === g.selected;
      const pts = [ac, ...path.map((n) => GROUND.nodes[n])];
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

  drawAircraft(ac, p) {
    const r = this.radar, ctx = r.ctx, g = r.game;
    const sel = ac === g.selected;
    const mine = g.userOwns(ac);
    const col = sel ? '#5ff0ff' : !mine ? '#7a8a96' : ac.isArr ? '#ff7be6' : '#7fb2ff';
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
      case 'taxi': status = !ac.taxiPath.length ? (ac.isArr ? 'REQ TAXI' : 'REQ TAXI') : ac.holdPos ? 'HOLD POSN' : `TAXI ${ac.taxiTarget?.startsWith('ST') ? 'STAND ' + ac.stand : ac.taxiTarget}`; break;
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
