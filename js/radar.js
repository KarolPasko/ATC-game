// Radar scope: rendering, pan/zoom and mouse interaction.
const COLORS = {
  bg: '#1c2630',
  ring: 'rgba(120,150,170,0.13)',
  boundary: 'rgba(130,170,200,0.35)',
  runway: '#e6edf2',
  centreline: 'rgba(200,215,225,0.45)',
  fix: '#7d93a6',
  fixLabel: '#8ea3b5',
  iaf: '#b5a6d9',
  entry: '#c9a3e8',
  exit: '#7fb2ff',
  dep: '#3d8bff', // departure route
  arr: '#ff2bd6', // arrival route (magenta)
  tag: '#d4f5d4',
  tagOff: '#7a8a96',
  tagSel: '#5ff0ff',
  stca: '#ffd84a',
  conflict: '#ff4a4a',
  ground: '#b9c7d2',
  emg: '#ff4f9a',
  vor: '#8fd3c4',
};

const LONG_PRESS_MS = 550;

class Radar {
  constructor(canvas, game) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.view = { cx: 0, cy: 0, scale: 9 }; // px per nm
    // Route lines: 'sel' (selected aircraft only, default), 'all' (every aircraft on your frequency) or 'off'.
    this.routes = 'sel';
    try { this.routes = localStorage.getItem('atc.routes') || 'sel'; } catch (e) { /* storage unavailable */ }
    this.showProcs = false;
    this.mouse = { x: 0, y: 0, down: false, dragged: false };
    this.hitBoxes = [];
    this.groundView = new GroundView(this);
    this.initScope();
    this.bindMouse();
    window.addEventListener('resize', () => this.resize());
    // The scope's size also changes when the top bar wraps or panels resize, not just the window.
    if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  setRoutes(mode) {
    this.routes = mode;
    try { localStorage.setItem('atc.routes', mode); } catch (e) { /* storage unavailable */ }
  }

  // Tower works a close-in view; approach the whole terminal area.
  zoomFor(pos) {
    if (pos === 'GND') { this.groundView.fit(); return; }
    const range = pos === 'TWR' ? 14 : 48;
    this.view.cx = pos === 'TWR' ? 1 : 0;
    this.view.cy = 0;
    this.view.scale = Math.min(this.w, this.h) / (2 * range);
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width; this.h = r.height;
    this.c.width = r.width * dpr; this.c.height = r.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!this.fitted && r.width > 0) {
      this.view.scale = Math.min(r.width, r.height) / (2 * 48);
      this.fitted = true;
    }
  }

  toScreen(p) {
    const v = this.view;
    return { x: this.w / 2 + (p.x - v.cx) * v.scale, y: this.h / 2 - (p.y - v.cy) * v.scale };
  }

  toWorld(sx, sy) {
    const v = this.view;
    return { x: v.cx + (sx - this.w / 2) / v.scale, y: v.cy - (sy - this.h / 2) / v.scale };
  }

  // ---------- input ----------
  bindMouse() {
    const c = this.c, g = this.game;
    c.addEventListener('pointerdown', (e) => {
      // Shift+drag or middle-drag: range and bearing line.
      if (g.viewMode === 'radar' && (e.button === 1 || (e.button === 0 && e.shiftKey))) {
        e.preventDefault();
        c.setPointerCapture(e.pointerId);
        const a = this.rblEnd(e.offsetX, e.offsetY);
        this.rblDraft = { a, b: this.toWorld(e.offsetX, e.offsetY), sx: e.offsetX, sy: e.offsetY };
        return;
      }
      if (e.button !== 0) return;
      this.closeMenu();
      c.setPointerCapture(e.pointerId);
      Object.assign(this.mouse, { down: true, dragged: false, sx: e.offsetX, sy: e.offsetY, x: e.offsetX, y: e.offsetY });
      // Press-and-hold a waypoint to send the selected aircraft there.
      const ac = this.hitAircraft(e.offsetX, e.offsetY);
      const fix = g.viewMode === 'radar' && !ac && g.selected && this.hitFix(e.offsetX, e.offsetY);
      this.press = fix ? { fix, ac: g.selected, t0: performance.now(), done: false } : null;
    });
    c.addEventListener('pointerup', (e) => {
      if (this.rblDraft) {
        const d = this.rblDraft;
        this.rblDraft = null;
        if (Math.hypot(e.offsetX - d.sx, e.offsetY - d.sy) > 8) this.rbls.push({ a: d.a, b: this.rblEnd(e.offsetX, e.offsetY) });
        return;
      }
      if (e.button !== 0 || !this.mouse.down) return;
      this.mouse.down = false;
      if (!this.mouse.dragged) {
        if (this.press && !this.press.done) {
          if (!this.hinted) { this.hinted = true; g.log(`Press and hold ${this.press.fix.name} to send ${this.press.ac.cs} there (right-click it for hold options).`, 'sys'); }
        } else if (!this.press) this.click(e.offsetX, e.offsetY);
      }
      this.press = null;
    });
    c.addEventListener('pointermove', (e) => {
      this.mouse.x = e.offsetX; this.mouse.y = e.offsetY;
      if (this.rblDraft) { this.rblDraft.b = this.toWorld(e.offsetX, e.offsetY); return; }
      if (this.mouse.down) {
        const dx = e.offsetX - this.mouse.sx, dy = e.offsetY - this.mouse.sy;
        if (this.mouse.dragged || Math.hypot(dx, dy) > 5) {
          this.mouse.dragged = true;
          this.press = null;
          if (g.viewMode === 'ground') this.groundView.pan(dx, dy);
          else { this.view.cx -= dx / this.view.scale; this.view.cy += dy / this.view.scale; }
          this.mouse.sx = e.offsetX; this.mouse.sy = e.offsetY;
        }
      }
      const gv = this.groundView;
      const overTarget = g.viewMode === 'ground'
        ? gv.canBuild(g.selected) && (gv.hitNode(e.offsetX, e.offsetY) || gv.hitEdge(e.offsetX, e.offsetY))
        : g.selected && this.hitFix(e.offsetX, e.offsetY);
      c.style.cursor = this.hitAircraft(e.offsetX, e.offsetY) || overTarget || (g.viewMode === 'radar' && this.hitTagField(e.offsetX, e.offsetY)) ? 'pointer' : 'crosshair';
    });
    c.addEventListener('pointerleave', () => { if (!this.mouse.down) this.mouse.x = -1; });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.mouse.x = e.offsetX; this.mouse.y = e.offsetY; // keep hover in step with the zoom
      if (g.viewMode === 'ground') return this.groundView.zoom(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
      const before = this.toWorld(e.offsetX, e.offsetY);
      this.view.scale = Geo.clamp(this.view.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 2, 120);
      const after = this.toWorld(e.offsetX, e.offsetY);
      this.view.cx += before.x - after.x;
      this.view.cy += before.y - after.y;
    }, { passive: false });
    // Right-click: waypoint menu (direct / hold / approach), or a heading towards the clicked point.
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.press = null;
      if (g.viewMode === 'ground') {
        // Right-click an aircraft on the chart for its runway/ground instructions.
        const hit = this.hitAircraft(e.offsetX, e.offsetY);
        if (hit) { g.select(hit); return this.openAircraftGroundMenu(hit, e.offsetX, e.offsetY); }
      }
      if (g.viewMode === 'radar') {
        const rbl = this.hitRbl(e.offsetX, e.offsetY);
        if (rbl >= 0) { this.rbls.splice(rbl, 1); return; }
      }
      const ac = g.selected;
      if (!ac || ac.state === 'gone') return;
      if (g.viewMode === 'ground') {
        const n = this.groundView.hitNode(e.offsetX, e.offsetY);
        if (n) this.openGroundMenu(n, ac, e.offsetX, e.offsetY);
        return;
      }
      const fix = this.hitFix(e.offsetX, e.offsetY);
      if (fix) return this.openMenu(fix, ac, e.offsetX, e.offsetY);
      const rbl = this.hitRbl(e.offsetX, e.offsetY);
      if (rbl >= 0) { this.rbls.splice(rbl, 1); return; }
      if (!ac.airborne || ac.circuit) return; // circuit traffic flies its own pattern
      const p = this.toWorld(e.offsetX, e.offsetY);
      g.commands.execute(`${ac.cs} h ${Geo.fmtHdg(Geo.bearing(ac, p))}`);
    });
    this.menu = document.getElementById('ctxmenu');
    this.menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cmd]');
      if (b && b.dataset.cmd) g.commands.execute(b.dataset.cmd);
      this.closeMenu();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closeMenu(); });
  }

  openMenu(fix, ac, sx, sy) {
    const items = [];
    const cs = ac.cs;
    if (ac.airborne && ac.circuit) {
      this.showMenu(cs, 'VFR circuit', [['In the circuit: no directs or holds (click its tag for ext, base, orbit, fs, ga)', '']], sx, sy);
      return;
    }
    const air = ac.airborne;
    items.push([`Direct ${fix.name}`, `${cs} dct ${fix.name}`]);
    if (air) {
      const pub = HOLDS[fix.name];
      const inb = Math.round(Geo.bearing(ac, fix) / 5) * 5 || 360;
      if (pub) items.push([`Hold as published · ${Geo.fmtHdg(pub.inbound)}° ${pub.turn === 'R' ? 'right' : 'left'}`, `${cs} hold ${fix.name}`]);
      items.push([`Hold · inbound ${Geo.fmtHdg(inb)}° · right turns`, `${cs} hold ${fix.name} ${Geo.fmtHdg(inb)} R`]);
      items.push([`Hold · inbound ${Geo.fmtHdg(inb)}° · left turns`, `${cs} hold ${fix.name} ${Geo.fmtHdg(inb)} L`]);
      if (ac.isArr) {
        const a = approachOf(fix.name);
        if (a && fix.name !== a.faf) items.push([`Cleared approach ${a.rwy} via ${fix.name}`, `${cs} app ${a.rwy} via ${fix.name}`]);
      }
    }
    const info = HOLDS[fix.name] ? `min hold ${ac.altText(HOLDS[fix.name].minAlt)}` : fix.alt ? `at ${ac.altText(fix.alt)}` : fix.type.toUpperCase();
    this.menu.innerHTML = `<div class="mh">${esc(cs)} → ${esc(fix.name)} <span>${esc(info)}</span></div>` +
      items.map(([l, c]) => `<button data-cmd="${esc(c)}">${esc(l)}</button>`).join('') +
      '<button data-cmd="" class="cancel">Cancel</button>';
    this.menu.hidden = false;
    const w = this.menu.offsetWidth, h = this.menu.offsetHeight;
    this.menu.style.left = Math.min(sx + 8, this.w - w - 8) + 'px';
    this.menu.style.top = Math.min(sy + 8, this.h - h - 8) + 'px';
  }

  showMenu(title, info, items, sx, sy) {
    this.menu.innerHTML = `<div class="mh">${esc(title)} <span>${esc(info)}</span></div>` +
      items.map(([l, c]) => `<button data-cmd="${esc(c)}">${esc(l)}</button>`).join('') +
      '<button data-cmd="" class="cancel">Cancel</button>';
    this.menu.hidden = false;
    const w = this.menu.offsetWidth, h = this.menu.offsetHeight;
    this.menu.style.left = Math.min(sx + 8, this.w - w - 8) + 'px';
    this.menu.style.top = Math.min(sy + 8, this.h - h - 8) + 'px';
  }

  // Ground chart: right-click an aircraft.
  openAircraftGroundMenu(ac, sx, sy) {
    const g = this.game, cs = ac.cs, items = [];
    if (!g.userOwns(ac)) {
      this.showMenu(cs, `with ${POSITIONS[ac.owner].name}`, [['Not on your frequency', '']], sx, sy);
      return;
    }
    if (ac.state === 'stand' && !ac.isArr) {
      if (!ac.cleared) items.push(['Cleared as filed', `${cs} caf`]);
      else {
        if (!GROUND.stands[ac.stand]?.ga) items.push([`Push back, face ${AIRPORT.pushDirs.E}`, `${cs} pb e`], [`Push back, face ${AIRPORT.pushDirs.W}`, `${cs} pb w`]);
        items.push([`Taxi to ${GROUND.departureHold(ac)}`, `${cs} taxi`]);
      }
    }
    if (ac.state === 'ground') items.push([`Line up runway ${ac.rwy}`, `${cs} lu`], [`Cleared for take-off ${ac.rwy}`, `${cs} cto`]);
    if (ac.state === 'lineup') items.push(ac.ctoPending ? ['Already cleared for take-off', ''] : [`Cleared for take-off ${ac.rwy}`, `${cs} cto`]);
    if (ac.state === 'taxi') {
      if (ac.crossStop() >= 0) items.push([`Cross runway ${GROUND.runwayName(GROUND.nodes[ac.taxiPath[ac.crossStop()]].phys, g)}`, `${cs} cross`]);
      if (ac.taxiPath.length) items.push(ac.holdPos ? ['Continue taxi', `${cs} cont`] : ['Hold position', `${cs} hpos`]);
      else items.push([ac.isArr ? `Taxi to stand ${ac.stand}` : `Taxi to ${GROUND.departureHold(ac)}`, `${cs} taxi`]);
    }
    if (ac.isArr && ac.airborne && ac.ils && !ac.landClr) items.push([`Cleared to land ${ac.rwy}`, `${cs} cl`]);
    if (ac.isArr && ac.airborne) items.push(['Go around', `${cs} ga`]);
    if (ac.airborne && ac.circuit) {
      if (!ac.circuit.clr) items.push([ac.circuit.left > 0 ? 'Cleared touch and go' : 'Cleared to land', `${cs} cl`]);
      if (['base', 'final'].includes(ac.circuit.phase)) items.push(['Go around', `${cs} ga`]);
    } else if (ac.airborne && !ac.isArr && ac.owner === 'TWR') items.push(['Contact Departure', `${cs} ho`]);
    if (!items.length) items.push(['No instructions available', '']);
    this.showMenu(`${cs} ${ac.type}`, ac.state.toUpperCase(), items, sx, sy);
  }

  // Ground chart: right-click a holding point or stand.
  openGroundMenu(n, ac, sx, sy) {
    const cs = ac.cs, items = [];
    const canTaxi = ['stand', 'pushback', 'taxi', 'ground'].includes(ac.state);
    if (n.kind === 'hold' && !ac.isArr && canTaxi) {
      const rwys = GROUND.holdRunways(n.name);
      if (rwys.includes(ac.rwy)) {
        items.push([`Taxi to holding point ${n.name} (runway ${ac.rwy})`, `${cs} taxi ${n.name}`]);
      } else if (rwys.length && RUNWAYS[rwys[0]].heading === ac.runway.heading) {
        items.push([`Taxi to ${n.name}, change to runway ${rwys[0]}`, `${cs} taxi ${n.name}`]);
      } else if (!rwys.length) {
        items.push([`Taxi to ${n.name} and hold`, `${cs} taxi ${n.name}`]);
      } else items.push([`${n.name} is not a holding point for runway ${ac.rwy}`, '']);
    }
    if (n.kind === 'stand' && ac.isArr && canTaxi) {
      const num = +n.name.slice(2);
      items.push([`Taxi to stand ${num}`, `${cs} taxi ${num}`]);
    }
    if (ac.state === 'stand' && !ac.isArr) items.push(['Pushback', `${cs} pb`]);
    if (ac.state === 'taxi' && ac.taxiPath.length) items.push(ac.holdPos ? ['Continue taxi', `${cs} cont`] : ['Hold position', `${cs} hpos`]);
    if (!items.length) items.push(['No ground instructions for this aircraft here', '']);
    const what = n.kind === 'stand' ? `stand ${n.name.slice(2)}` : `holding point ${n.name}`;
    this.showMenu(`${cs} → ${what}`, ac.state.toUpperCase(), items, sx, sy);
  }

  closeMenu() { if (this.menu) this.menu.hidden = true; }

  click(sx, sy) {
    if (this.game.viewMode === 'ground') return this.groundView.click(sx, sy);
    const field = this.hitTagField(sx, sy);
    if (field) return this.openTagField(field, sx, sy);
    const ac = this.hitAircraft(sx, sy);
    this.game.select(ac || null);
  }

  hitAircraft(sx, sy) {
    for (let i = this.hitBoxes.length - 1; i >= 0; i--) {
      const b = this.hitBoxes[i];
      if (sx >= b.x0 && sx <= b.x1 && sy >= b.y0 && sy <= b.y1) return b.ac;
    }
    return null;
  }

  // Hit-test only the waypoints actually drawn last frame, on the symbol or its label.
  hitFix(sx, sy) {
    let best = null, bd = 12;
    for (const v of this.visibleFixes || []) {
      const d = Math.hypot(v.x - sx, v.y - sy);
      const onLabel = sx >= v.lx - 2 && sx <= v.lx + v.lw + 2 && sy >= v.ly - 11 && sy <= v.ly + 3;
      const score = onLabel ? Math.min(d, 6) : d;
      if (score < bd) { bd = score; best = v.f; }
    }
    return best;
  }

  // ---------- drawing ----------
  draw() {
    const ctx = this.ctx, g = this.game;
    if (!this.w) this.resize();
    if (g.viewMode === 'ground') {
      this.groundView.draw();
      if (g.paused) {
        ctx.fillStyle = 'rgba(255,216,74,0.9)';
        ctx.font = 'bold 16px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('SIMULATION PAUSED', this.w / 2, 28);
        ctx.textAlign = 'left';
      }
      return;
    }
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.w, this.h);
    this.hitBoxes = [];
    this.tagFields = [];

    this.drawVideoMap();
    this.drawRings();
    if (this.showProcs) this.drawProcedures();
    this.drawCentrelines();
    this.drawRunways();
    this.drawFixes();
    this.drawHolds();

    const sel = g.selected;
    if (this.routes !== 'off') {
      if (this.routes === 'all') for (const ac of g.aircraft) if (ac !== sel && g.userOwns(ac)) this.drawRoute(ac, false);
      if (sel) this.drawRoute(sel, true);
    }
    for (const ac of g.aircraft) {
      if (ac.onGround() && ac.state !== 'landed') this.drawGround(ac);
      else if (ac.state !== 'gone') this.drawAircraft(ac);
    }
    this.drawRbls();
    this.drawPress();
    this.drawCursorInfo();
    this.drawScaleBar();
    if (g.paused) {
      ctx.fillStyle = 'rgba(255,216,74,0.9)';
      ctx.font = 'bold 16px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SIMULATION PAUSED', this.w / 2, 28);
      ctx.textAlign = 'left';
    }
  }

  drawRings() {
    const ctx = this.ctx;
    const o = this.toScreen({ x: 0, y: 0 });
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 6]);
    ctx.strokeStyle = COLORS.ring;
    for (let r = 10; r <= 40; r += 10) {
      ctx.beginPath(); ctx.arc(o.x, o.y, r * this.view.scale, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.setLineDash([]);
    if (this.layers.airspace) return; // the TMA boundary comes from the video map
    ctx.strokeStyle = COLORS.boundary;
    ctx.beginPath(); ctx.arc(o.x, o.y, AIRPORT.ctrRadius * this.view.scale, 0, Math.PI * 2); ctx.stroke();
  }

  polyline(pts, color, width, dash = [], alpha = 1) {
    if (pts.length < 2) return;
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
    ctx.beginPath();
    pts.forEach((p, i) => { const s = this.toScreen(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
    ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  drawProcedures() {
    const pr = PROCS[this.game.config];
    for (const s of pr.stars) {
      this.polyline(routePoints([s.fixes[0], ...starRoute(s)]).concat([RUNWAYS[s.rwy].thr]), COLORS.arr, 1, [6, 4], 0.25);
    }
    for (const s of pr.sids) {
      const r = RUNWAYS[s.rwy];
      this.polyline([r.opp].concat(s.fixes.map((n) => FIXES[n])), COLORS.dep, 1, [6, 4], 0.3);
    }
  }

  drawCentrelines() {
    const ctx = this.ctx;
    for (const id of this.game.arrivalRunways()) {
      const r = RUNWAYS[id];
      const a = APPROACHES[id];
      const far = approachPoint(id, Geo.dist(FIXES[a.straightIn], r.thr));
      this.polyline([r.thr, far], COLORS.centreline, 1, [4, 4]);
      // nm ticks, longer every 5 nm
      for (let d = 1; d <= Math.floor(a.ifAlong); d++) {
        const p = approachPoint(id, d);
        const len = d % 5 === 0 ? 0.6 : 0.25;
        this.polyline([Geo.offset(p, r.heading + 90, len), Geo.offset(p, r.heading - 90, len)], COLORS.centreline, 1);
      }
      // Approach transitions: straight-in, and per side the downwind and base legs with their arcs onto final.
      const col = 'rgba(200,170,255,0.3)';
      this.polyline([FIXES[a.straightIn], FIXES[a.if], FIXES[a.faf]], col, 1, [2, 4]);
      for (const n of Object.values(a.sides)) {
        this.polyline(routePoints(a.paths[n.dw].slice(0, -1)), col, 1, [2, 4]);
        this.polyline([FIXES[n.base], FIXES[n.bt]], col, 1, [2, 4]);
      }
    }
    ctx.setLineDash([]);
  }

  drawRunways() {
    const ctx = this.ctx;
    const done = new Set();
    for (const r of Object.values(RUNWAYS)) {
      if (!done.has(r.phys)) {
        done.add(r.phys);
        const a = this.toScreen(r.start), b = this.toScreen(r.opp);
        ctx.strokeStyle = COLORS.runway;
        ctx.lineWidth = Math.max(2, 0.03 * this.view.scale);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      if (this.view.scale > 6) {
        const lp = this.toScreen(Geo.offset(r.thr, r.heading + 180, 0.35 + 30 / this.view.scale / 10));
        ctx.fillStyle = this.game.activeRunways().includes(r.id) ? '#ffffff' : '#7d8b96';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(r.id, lp.x, lp.y + 3);
        ctx.textAlign = 'left';
      }
    }
  }

  // Waypoints, EuroScope style: small crisp symbols, labels placed around the symbol so they don't overlap
  // (higher-priority labels win), and approach altitudes on a second, smaller line when zoomed in.
  drawFixes() {
    const ctx = this.ctx, s = this.view.scale, g = this.game;
    const hover = g.selected && this.mouse.x >= 0 ? this.hitFix(this.mouse.x, this.mouse.y) : null;
    const sel = g.selected;
    const onRoute = new Set(sel && sel.state !== 'gone' ? [...sel.route, sel.hold?.fix].filter(Boolean) : []);
    // IAF/IF/FAF/SID fixes only for the runways in use, unless they are on the selected aircraft's route.
    const active = new Set();
    for (const id of g.arrivalRunways()) { const a = APPROACHES[id]; [...a.iafs, a.if, a.faf].forEach((n) => active.add(n)); }
    for (const id of g.departureRunways()) if (SID_FIRST[id]) active.add(SID_FIRST[id]);
    const items = [];
    for (const f of Object.values(FIXES)) {
      const p = this.toScreen(f);
      if (p.x < -40 || p.y < -40 || p.x > this.w + 40 || p.y > this.h + 40) continue;
      if (f.type === 'tp' && !(onRoute.has(f.name) && s >= 8)) continue; // arc points of the approach transitions
      const procFix = ['iaf', 'if', 'faf', 'sid', 'tp'].includes(f.type);
      if (procFix && !active.has(f.name) && !onRoute.has(f.name)) continue;
      if ((f.type === 'faf' || f.type === 'sid') && s < 10 && !onRoute.has(f.name)) continue;
      const prio = onRoute.has(f.name) ? 5 : procFix ? 4 : f.type === 'entry' || f.type === 'exit' ? 3 : f.type === 'vor' ? 2 : 1;
      items.push({ f, p, prio });
    }
    // Symbols
    for (const { f, p } of items) {
      const col = f === hover ? '#ffffff' : f.type === 'entry' ? COLORS.entry : f.type === 'exit' ? COLORS.exit
        : ['iaf', 'if', 'faf'].includes(f.type) ? COLORS.iaf : f.type === 'vor' ? COLORS.vor : COLORS.fix;
      ctx.strokeStyle = col; ctx.fillStyle = col;
      ctx.lineWidth = f === hover ? 2 : 1;
      ctx.beginPath();
      if (f.type === 'vor') {
        // VOR/DME: hexagon in a square with a centre dot
        for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i; const q = [p.x + Math.cos(a) * 6, p.y + Math.sin(a) * 6]; i ? ctx.lineTo(...q) : ctx.moveTo(...q); }
        ctx.closePath(); ctx.rect(p.x - 6, p.y - 5.2, 12, 10.4);
        ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
        ctx.stroke();
      } else {
        const sz = f.type === 'sid' ? 2.5 : f.type === 'faf' || f.type === 'if' ? 3.5 : 4;
        ctx.moveTo(p.x, p.y - sz); ctx.lineTo(p.x + sz, p.y + sz * 0.8); ctx.lineTo(p.x - sz, p.y + sz * 0.8); ctx.closePath();
        if (f.type === 'faf') ctx.fill(); else ctx.stroke(); // FAF filled
      }
      if (HOLDS[f.name] && s >= 5) ctx.fillRect(p.x - 1, p.y + 7, 2, 2);
    }
    // Labels, highest priority first, each at the first free spot around its symbol.
    const placed = [];
    const overlaps = (r) => placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0);
    const visible = [];
    items.sort((a, b) => b.prio - a.prio);
    for (const { f, p, prio } of items) {
      ctx.font = '10px "JetBrains Mono", monospace';
      const name = f.name;
      const w = ctx.measureText(name).width;
      const alt = sel && onRoute.has(f.name) ? (sel.altCons?.[f.name] ?? f.alt) : f.alt;
      const altText = alt && (s >= 9 || onRoute.has(f.name)) ? (alt >= AIRPORT.transAlt + 500 ? `FL${Math.round(alt / 100)}` : String(alt)) : '';
      const h = altText ? 21 : 11;
      const cands = [[7, 3], [7, -h + 3], [-w - 7, 3], [-w - 7, -h + 3], [-w / 2, 9], [-w / 2, -h - 6], [9, -h / 2 + 3], [-w - 9, -h / 2 + 3]];
      let spot = null;
      for (const [dx, dy] of cands) {
        const r = { x0: p.x + dx - 1, y0: p.y + dy - 1, x1: p.x + dx + w + 1, y1: p.y + dy + h };
        if (!overlaps(r)) { spot = [dx, dy, r]; break; }
      }
      if (!spot && prio < 4 && f !== hover) { visible.push({ f, x: p.x, y: p.y, lx: p.x, ly: p.y, lw: 0 }); continue; }
      const [dx, dy, r] = spot || [cands[0][0], cands[0][1], { x0: p.x + 6, y0: p.y + 2, x1: p.x + 7 + w, y1: p.y + 2 + h }];
      placed.push(r);
      ctx.fillStyle = f === hover ? '#ffffff' : onRoute.has(f.name) ? '#c9d8e4' : COLORS.fixLabel;
      ctx.fillText(name, p.x + dx, p.y + dy + 9);
      if (altText) {
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.fillStyle = f === hover ? '#ffffff' : '#7f8fa0';
        ctx.fillText(altText, p.x + dx, p.y + dy + 19);
      }
      visible.push({ f, x: p.x, y: p.y, lx: p.x + dx, ly: p.y + dy + 9, lw: w });
    }
    this.visibleFixes = visible;
  }

  drawRoute(ac, selected) {
    if (ac.state === 'gone' || ac.handedOff || (ac.isArr && ac.onGround())) return;
    const now = performance.now();
    if (!ac._pred || now - ac._predT > 400) { ac._pred = ac.predictPath(); ac._predT = now; }
    const { pts, vectored, tail } = ac._pred;
    const col = ac.isArr ? COLORS.arr : COLORS.dep;
    const w = selected ? 2.2 : 1.2;
    const alpha = selected ? 1 : 0.55;
    if (ac.state === 'ground' || ac.state === 'lineup') this.polyline([ac.runway.start, ac.runway.opp], col, w, [], alpha);
    if (vectored) {
      // Curved prediction of the turn onto the assigned heading, then the route it will rejoin.
      this.polyline(pts, col, w, [6, 4], alpha);
      if (ac.route.length) {
        const rest = routePoints(ac.route);
        if (ac.isArr) rest.push(ac.runway.thr);
        this.polyline(rest, col, w * 0.8, [], alpha * 0.45);
      }
    } else {
      this.polyline(pts.concat(tail), col, w, [], alpha);
    }
    if (ac.mode === 'hold' && ac.hold) {
      const h = ac.hold;
      this.polyline(Aircraft.racetrack(h.fix, h.inbound, h.turn, ac.alt), col, 1, [3, 4], alpha * 0.7);
    }
    if (selected) {
      const ctx = this.ctx;
      ctx.fillStyle = col;
      for (const n of ac.route) { const s = this.toScreen(FIXES[n]); ctx.beginPath(); ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  drawHolds() {
    const g = this.game;
    const hover = g.selected && this.mouse.x >= 0 ? this.hitFix(this.mouse.x, this.mouse.y) : null;
    for (const [name, h] of Object.entries(HOLDS)) {
      if (!this.showProcs && (!hover || hover.name !== name)) continue;
      this.polyline(Aircraft.racetrack(name, h.inbound, h.turn, h.minAlt), '#9fb0c0', 1, [2, 3], 0.45);
    }
  }

  // Ring that fills while a waypoint is pressed; completes the direct-to.
  drawPress() {
    const pr = this.press;
    if (!pr || pr.done) {
      if (this.flash && performance.now() - this.flash.t < 600) {
        const p = this.toScreen(this.flash.fix);
        const k = (performance.now() - this.flash.t) / 600;
        this.ctx.strokeStyle = `rgba(95,240,255,${1 - k})`;
        this.ctx.lineWidth = 2;
        this.ctx.beginPath(); this.ctx.arc(p.x, p.y, 12 + k * 14, 0, Math.PI * 2); this.ctx.stroke();
      }
      return;
    }
    const frac = (performance.now() - pr.t0) / LONG_PRESS_MS;
    const p = this.toScreen(pr.fix);
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(95,240,255,0.25)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(p.x, p.y, 13, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = COLORS.tagSel;
    ctx.beginPath(); ctx.arc(p.x, p.y, 13, -Math.PI / 2, -Math.PI / 2 + Math.min(1, frac) * Math.PI * 2); ctx.stroke();
    if (frac >= 1) {
      pr.done = true;
      this.flash = { fix: pr.fix, t: performance.now() };
      if (pr.ac.state !== 'gone') this.game.commands.execute(`${pr.ac.cs} dct ${pr.fix.name}`);
    }
  }

  tagColor(ac) {
    if (ac.emg && !ac.emg.done) return !ac.emg.ack && Math.floor(performance.now() / 300) % 2 ? '#ffffff' : COLORS.emg;
    if (ac.conflict === 2) return COLORS.conflict;
    if (ac.conflict === 1) return COLORS.stca;
    if (ac === this.game.selected) return COLORS.tagSel;
    if (ac.handedOff || !this.game.userOwns(ac)) return COLORS.tagOff;
    return COLORS.tag;
  }

  drawAircraft(ac) {
    const ctx = this.ctx;
    const p = this.toScreen(ac);
    const col = this.tagColor(ac);
    const blink = ac.conflict === 2 && Math.floor(performance.now() / 400) % 2;

    // history trail
    ctx.fillStyle = 'rgba(160,200,220,0.5)';
    const trail = ac.trail.slice(-this.historyDots);
    trail.forEach((t, i) => {
      const s = this.toScreen(t);
      ctx.globalAlpha = 0.15 + (i / trail.length) * 0.5;
      ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
    });
    ctx.globalAlpha = 1;

    // Speed vector (length set in the toolbar, in minutes)
    if (this.vectorMin > 0) {
      const v = this.toScreen(Geo.offset(ac, ac.track(), (ac.gs_kt() / 60) * this.vectorMin));
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(v.x, v.y); ctx.stroke();
    }

    // target symbol
    ctx.strokeStyle = col;
    ctx.lineWidth = ac === this.game.selected ? 2 : 1.4;
    ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
    if (ac.isArr) { ctx.fillStyle = col; ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); }

    // conflict ring (half of 3 nm separation)
    if (ac.conflict) {
      ctx.strokeStyle = ac.conflict === 2 ? COLORS.conflict : COLORS.stca;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.5 * this.view.scale, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (ac === this.game.selected) {
      ctx.strokeStyle = COLORS.tagSel; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); ctx.stroke();
    }

    this.drawTag(ac, p, col, blink);
  }

  drawGround(ac) {
    if (this.view.scale < 14 && ac !== this.game.selected) return;
    const ctx = this.ctx;
    const p = this.toScreen(ac);
    const sel = ac === this.game.selected;
    const col = sel ? COLORS.tagSel : ac.cleared ? '#9fe29f' : COLORS.ground;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    // Ground traffic is labelled on the radar only when selected; the ground chart has the detail.
    if (!sel && this.view.scale < 90) { this.hitBoxes.push({ ac, x0: p.x - 6, y0: p.y - 6, x1: p.x + 6, y1: p.y + 6 }); return; }
    ctx.font = '10px "JetBrains Mono", monospace';
    const label = ac.cs + (ac.state === 'lineup' ? ' LU' : ac.state === 'ground' ? ' HP' : '');
    const r = ac.runway;
    const left = r.dirU > 0; // keep labels away from the runway
    const w = ctx.measureText(label).width;
    const lx = left ? p.x - w - 6 : p.x + 6;
    const ly = p.y + (r.v > 0 ? -4 : 10);
    ctx.fillText(label, lx, ly);
    this.hitBoxes.push({ ac, x0: Math.min(lx, p.x) - 4, y0: ly - 11, x1: Math.max(lx + w, p.x) + 4, y1: ly + 4 });
  }

  drawCursorInfo() {
    const ac = this.game.selected;
    if (!ac || !ac.airborne || this.mouse.x < 0) return;
    const ctx = this.ctx;
    const w = this.toWorld(this.mouse.x, this.mouse.y);
    const txt = `${ac.cs} → BRG ${Geo.fmtHdg(Geo.bearing(ac, w))}  ${Geo.dist(ac, w).toFixed(1)} NM`;
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(95,240,255,0.85)';
    ctx.fillText(txt, 12, this.h - 14);
  }

  drawScaleBar() {
    const ctx = this.ctx;
    const nm = this.view.scale > 30 ? 2 : this.view.scale > 12 ? 5 : 10;
    const len = nm * this.view.scale;
    const x = this.w - len - 16, y = this.h - 16;
    ctx.strokeStyle = '#8ea3b5'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + len, y); ctx.lineTo(x + len, y - 4); ctx.stroke();
    ctx.fillStyle = '#8ea3b5';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${nm} NM`, x + len / 2, y - 6);
    ctx.textAlign = 'left';
  }
}
