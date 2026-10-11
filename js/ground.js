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

  // Shortest taxi route; with `via`, taxiways not in the list cost much more.
  function route(from, to, via = null) {
    const dist = { [from]: 0 }, prev = {}, done = new Set();
    const viaSet = via && via.length ? new Set(via) : null;
    const open = [from];
    while (open.length) {
      open.sort((a, b) => dist[a] - dist[b]);
      const n = open.shift();
      if (n === to) break;
      if (done.has(n)) continue;
      done.add(n);
      for (const { to: m, e } of adj[n] || []) {
        if (e.kind === 'rwy') continue;
        if (e.kind === 'stand' && m !== to && n !== from) continue; // never route through a stand
        const k = viaSet && !viaSet.has(e.name) && !['stand', 'conn', 'rapid'].includes(e.kind) ? 8 : 1;
        const d = dist[n] + e.len * k;
        if (d < (dist[m] ?? Infinity)) { dist[m] = d; prev[m] = { n, e }; open.push(m); }
      }
    }
    if (dist[to] === undefined) return null;
    const path = [], names = [];
    for (let n = to; n !== from; n = prev[n].n) {
      path.unshift(n);
      const nm = prev[n].e.name;
      if (prev[n].e.kind !== 'stand' && names[0] !== nm) names.unshift(nm);
    }
    return { path, names };
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
    M_PER_NM, U, V, toWorld, nodes, edges, route, nearestNode, holdingPoints, exits, stands, signs, taxiwayNames,
    dims: { RWY_HALF, RWY_V, RWY_W, TWY_V, HOLD_V, LANE_V, STAND_V, TWY_W },
  };
})();

const GROUND_STATES = ['stand', 'pushback', 'taxi', 'ground', 'lineup', 'parked'];
const TAXI_KT = 15;

// ---------- ground movement on Aircraft ----------
Object.assign(Aircraft.prototype, {
  onGround() { return GROUND_STATES.includes(this.state) || this.state === 'landed'; },

  // Start taxiing to a node (holding point or stand). Returns the route or null.
  startTaxi(target, via = null) {
    let from = this.gnode;
    if (this.state === 'taxi' && this.taxiPath?.length) from = this.taxiPath[0];
    if (this.state === 'stand') from = GROUND.stands[this.stand].lane; // pushback first
    if (this.state === 'pushback') from = this.pushTo;
    const r = GROUND.route(from, target, via);
    if (!r) return null;
    if (this.state === 'stand' || this.state === 'pushback') {
      this.state = 'pushback';
      this.pushTo = from;
      this.taxiPath = r.path;
    } else {
      if (this.state === 'taxi' && this.taxiPath?.length) r.path.unshift(from);
      this.state = 'taxi';
      this.taxiPath = r.path;
    }
    this.taxiTarget = target;
    this.holdPos = false;
    this._pred = null;
    return r;
  },

  // Push back off the stand onto the taxilane, then wait for taxi (or continue if already cleared).
  pushback() {
    if (this.state !== 'stand') return false;
    this.state = 'pushback';
    this.pushTo = GROUND.stands[this.stand].lane;
    this.taxiPath = [];
    return true;
  },

  groundUpdate(dt, game) {
    if (this.state === 'parked') { if (game.time - this.parkTime > 90) this.state = 'gone'; return; }
    if (this.state === 'pushback') {
      const n = GROUND.nodes[this.pushTo];
      this.spd = 3;
      if (this.moveToward(n, dt, true)) {
        this.gnode = this.pushTo;
        this.state = 'taxi';
        this.spd = 0;
        if (this.taxiPath.length) this.hdg = Geo.bearing(this, GROUND.nodes[this.taxiPath[0]]);
        else {
          // Pushed back facing along the taxilane towards the departure runway end.
          const hp = GROUND.nodes[GROUND.holdingPoints[this.rwy]];
          this.hdg = hp.u > n.u ? 80 : 260;
          game.pilotSay(this, 'pushback complete, ready to taxi');
        }
      }
      return;
    }
    if (this.state !== 'taxi') return;
    if (!this.taxiPath.length || this.holdPos) { this.spd = 0; return; }
    const blocker = game.groundBlocker(this);
    const target = blocker ? 0 : TAXI_KT;
    this.spd += Geo.clamp(target - this.spd, -6 * dt, 1.5 * dt);
    if (this.spd <= 0.1) return;
    const n = GROUND.nodes[this.taxiPath[0]];
    if (this.moveToward(n, dt)) {
      this.gnode = this.taxiPath.shift();
      if (!this.taxiPath.length) this.arriveAt(game);
    }
  },

  // Move towards a node at the current speed; returns true when reached.
  moveToward(n, dt, backwards = false) {
    const step = (this.spd / 3600) * dt;
    const d = Geo.dist(this, n);
    if (d <= step) { this.x = n.x; this.y = n.y; return true; }
    const b = Geo.bearing(this, n);
    if (!backwards) this.hdg = b;
    const v = Geo.vec(b);
    this.x += v.x * step; this.y += v.y * step;
    return false;
  },

  arriveAt(game) {
    this.spd = 0;
    const n = GROUND.nodes[this.gnode];
    if (!this.isArr && this.gnode === GROUND.holdingPoints[this.rwy]) {
      this.state = 'ground';
      this.hdg = Geo.bearing(n, GROUND.nodes[`R${this.runway.phys}${n.u}`]);
      game.pilotSay(this, `holding point ${this.gnode}, runway ${this.rwy}, ready for departure`);
    } else if (this.isArr && n.kind === 'stand') {
      this.state = 'parked';
      this.parkTime = game.time;
      game.log(`${this.cs} on stand ${this.stand}`, 'sys');
    } else if (n.kind === 'exit' && this.isArr) {
      game.pilotSay(this, `runway ${this.rwy} vacated via ${n.name.replace(/x$/, '')}, request taxi to stand ${this.stand}`);
    }
  },

  // Landing roll: pick the first exit we can make, then turn off there.
  chooseExit() {
    const r = this.runway;
    const dirSign = r.heading === 80 ? 1 : -1; // +u for 08, -u for 26
    const here = { u: (this.x * GROUND.M_PER_NM) * GROUND.U.x + (this.y * GROUND.M_PER_NM) * GROUND.U.y };
    const ktToMs = 0.5144;
    const v = this.spd * ktToMs, vExit = 25 * ktToMs, a = 3 * ktToMs;
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
    this.spd = Math.max(ahead < 150 ? 18 : 25, this.spd - 3 * dt);
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
      if (ac.state !== 'taxi' || !ac.taxiPath?.length) continue;
      const sel = ac === g.selected;
      const pts = [ac, ...ac.taxiPath.map((n) => GROUND.nodes[n])];
      ctx.strokeStyle = sel ? 'rgba(95,240,255,0.9)' : 'rgba(110,230,140,0.45)';
      ctx.lineWidth = sel ? 3 : 2;
      ctx.setLineDash(sel ? [] : [6, 4]);
      ctx.beginPath();
      pts.forEach((q, i) => { const p = this.toScreen(q); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      ctx.stroke();
      ctx.setLineDash([]);
    }
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
    ctx.fillText(`${AIRPORT.icao} GROUND CHART · wind ${g.windText()} · right-click a holding point or stand to taxi the selected aircraft`, 12, r.h - 14);
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
