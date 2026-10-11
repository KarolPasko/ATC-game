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
    this.bindMouse();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setRoutes(mode) {
    this.routes = mode;
    try { localStorage.setItem('atc.routes', mode); } catch (e) { /* storage unavailable */ }
  }

  // Tower works a close-in view; approach the whole terminal area.
  zoomFor(pos) {
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
      if (e.button !== 0) return;
      this.closeMenu();
      c.setPointerCapture(e.pointerId);
      Object.assign(this.mouse, { down: true, dragged: false, sx: e.offsetX, sy: e.offsetY, x: e.offsetX, y: e.offsetY });
      // Press-and-hold a waypoint to send the selected aircraft there.
      const ac = this.hitAircraft(e.offsetX, e.offsetY);
      const fix = !ac && g.selected && this.hitFix(e.offsetX, e.offsetY);
      this.press = fix ? { fix, ac: g.selected, t0: performance.now(), done: false } : null;
    });
    c.addEventListener('pointerup', (e) => {
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
      if (this.mouse.down) {
        const dx = e.offsetX - this.mouse.sx, dy = e.offsetY - this.mouse.sy;
        if (this.mouse.dragged || Math.hypot(dx, dy) > 5) {
          this.mouse.dragged = true;
          this.press = null;
          this.view.cx -= dx / this.view.scale;
          this.view.cy += dy / this.view.scale;
          this.mouse.sx = e.offsetX; this.mouse.sy = e.offsetY;
        }
      }
      c.style.cursor = this.hitAircraft(e.offsetX, e.offsetY) || (g.selected && this.hitFix(e.offsetX, e.offsetY)) ? 'pointer' : 'crosshair';
    });
    c.addEventListener('pointerleave', () => { if (!this.mouse.down) this.mouse.x = -1; });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
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
      const ac = g.selected;
      if (!ac || ac.state === 'gone') return;
      const fix = this.hitFix(e.offsetX, e.offsetY);
      if (fix) return this.openMenu(fix, ac, e.offsetX, e.offsetY);
      if (!ac.airborne) return;
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
    const air = ac.airborne;
    items.push([`Direct ${fix.name}`, `${cs} dct ${fix.name}`]);
    if (air) {
      const pub = HOLDS[fix.name];
      const inb = Math.round(Geo.bearing(ac, fix) / 5) * 5 || 360;
      if (pub) items.push([`Hold as published · ${Geo.fmtHdg(pub.inbound)}° ${pub.turn === 'R' ? 'right' : 'left'}`, `${cs} hold ${fix.name}`]);
      items.push([`Hold · inbound ${Geo.fmtHdg(inb)}° · right turns`, `${cs} hold ${fix.name} ${Geo.fmtHdg(inb)} R`]);
      items.push([`Hold · inbound ${Geo.fmtHdg(inb)}° · left turns`, `${cs} hold ${fix.name} ${Geo.fmtHdg(inb)} L`]);
      if (ac.isArr) {
        for (const [rwy, fixes] of Object.entries(APPROACHES)) {
          if (fixes.slice(0, 2).includes(fix.name)) items.push([`Cleared approach ${rwy} via ${fix.name}`, `${cs} dct ${fix.name} app ${rwy}`]);
        }
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

  closeMenu() { if (this.menu) this.menu.hidden = true; }

  click(sx, sy) {
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

  hitFix(sx, sy) {
    let best = null, bd = 9;
    for (const f of Object.values(FIXES)) {
      const p = this.toScreen(f);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  // ---------- drawing ----------
  draw() {
    const ctx = this.ctx, g = this.game;
    if (!this.w) this.resize();
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.w, this.h);
    this.hitBoxes = [];

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
      if (ac.state === 'ground' || ac.state === 'lineup') this.drawGround(ac);
      else if (ac.state !== 'gone') this.drawAircraft(ac);
    }
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
    ctx.strokeStyle = COLORS.boundary;
    ctx.beginPath(); ctx.arc(o.x, o.y, AIRPORT.ctrRadius * this.view.scale, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = COLORS.boundary;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillText('EGRV APP / TMA', o.x + 6, o.y - AIRPORT.ctrRadius * this.view.scale + 14);
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
      const fixes = s.fixes.concat(APPROACHES[s.rwy].slice(1)).map((n) => FIXES[n]);
      this.polyline(fixes.concat([RUNWAYS[s.rwy].thr]), COLORS.arr, 1, [6, 4], 0.25);
    }
    for (const s of pr.sids) {
      const r = RUNWAYS[s.rwy];
      this.polyline([r.opp].concat(s.fixes.map((n) => FIXES[n])), COLORS.dep, 1, [6, 4], 0.3);
    }
  }

  drawCentrelines() {
    const ctx = this.ctx;
    for (const id of this.game.activeRunways()) {
      const r = RUNWAYS[id];
      const far = approachPoint(id, 15);
      this.polyline([r.thr, far], COLORS.centreline, 1, [4, 4]);
      // nm ticks, longer every 5 nm
      for (let d = 1; d <= 15; d++) {
        const p = approachPoint(id, d);
        const len = d % 5 === 0 ? 0.6 : 0.25;
        this.polyline([Geo.offset(p, r.heading + 90, len), Geo.offset(p, r.heading - 90, len)], COLORS.centreline, 1);
      }
      // approach path IAF -> IF -> FAF
      const app = APPROACHES[id].map((n) => FIXES[n]);
      this.polyline(app, 'rgba(200,170,255,0.22)', 1, [2, 4]);
    }
    ctx.setLineDash([]);
  }

  drawRunways() {
    const ctx = this.ctx;
    const done = new Set();
    for (const r of Object.values(RUNWAYS)) {
      if (!done.has(r.phys)) {
        done.add(r.phys);
        const a = this.toScreen(r.thr), b = this.toScreen(r.opp);
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

  drawFixes() {
    const ctx = this.ctx, s = this.view.scale;
    const hover = this.game.selected && this.mouse.x >= 0 ? this.hitFix(this.mouse.x, this.mouse.y) : null;
    ctx.font = '10px "JetBrains Mono", monospace';
    // IF/FAF/SID fixes are only shown for runways in use.
    const active = new Set();
    for (const id of this.game.activeRunways()) { APPROACHES[id].forEach((n) => active.add(n)); active.add(SID_FIRST[id]); }
    for (const f of Object.values(FIXES)) {
      const p = this.toScreen(f);
      if (p.x < -40 || p.y < -40 || p.x > this.w + 40 || p.y > this.h + 40) continue;
      const minor = f.type === 'if' || f.type === 'faf' || f.type === 'sid';
      if (minor && (s < 12 || !active.has(f.name))) continue;
      const col = f.type === 'entry' ? COLORS.entry : f.type === 'exit' ? COLORS.exit : f.type === 'iaf' ? COLORS.iaf : f.type === 'vor' ? COLORS.vor : COLORS.fix;
      const sz = minor ? 3 : 4.5;
      ctx.strokeStyle = f === hover ? '#ffffff' : col;
      ctx.lineWidth = f === hover ? 2 : 1;
      ctx.beginPath();
      if (f.type === 'vor') {
        // VOR/DME: hexagon in a square with a centre dot
        for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i; const q = [p.x + Math.cos(a) * 6, p.y + Math.sin(a) * 6]; i ? ctx.lineTo(...q) : ctx.moveTo(...q); }
        ctx.closePath(); ctx.rect(p.x - 6, p.y - 5.2, 12, 10.4);
        ctx.fillStyle = col; ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
      } else {
        ctx.moveTo(p.x, p.y - sz); ctx.lineTo(p.x + sz, p.y + sz * 0.8); ctx.lineTo(p.x - sz, p.y + sz * 0.8); ctx.closePath();
      }
      ctx.stroke();
      if (HOLDS[f.name] && s >= 5) { ctx.fillStyle = col; ctx.fillRect(p.x - 1, p.y + sz + 2, 2, 2); }
      ctx.fillStyle = f === hover ? '#ffffff' : COLORS.fixLabel;
      let label = f.name;
      if (f.alt && s >= 7) label += ` A${String(f.alt / 100).padStart(3, '0')}`;
      ctx.fillText(label, p.x + 6, p.y + 10);
    }
  }

  drawRoute(ac, selected) {
    if (ac.state === 'gone' || ac.state === 'landed' || ac.handedOff) return;
    const now = performance.now();
    if (!ac._pred || now - ac._predT > 400) { ac._pred = ac.predictPath(); ac._predT = now; }
    const { pts, vectored, tail } = ac._pred;
    const col = ac.isArr ? COLORS.arr : COLORS.dep;
    const w = selected ? 2.2 : 1.2;
    const alpha = selected ? 1 : 0.55;
    if (ac.state === 'ground' || ac.state === 'lineup') this.polyline([ac.runway.thr, ac.runway.opp], col, w, [], alpha);
    if (vectored) {
      // Curved prediction of the turn onto the assigned heading, then the route it will rejoin.
      this.polyline(pts, col, w, [6, 4], alpha);
      if (ac.route.length) {
        const rest = ac.route.map((n) => FIXES[n]);
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
    ac.trail.forEach((t, i) => {
      const s = this.toScreen(t);
      ctx.globalAlpha = 0.15 + (i / ac.trail.length) * 0.5;
      ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
    });
    ctx.globalAlpha = 1;

    // 1-minute speed vector
    const v = this.toScreen(Geo.offset(ac, ac.track(), ac.gs_kt() / 60));
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(v.x, v.y); ctx.stroke();

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

    // data tag
    const trend = ac.tgtAlt > ac.alt + 50 && !ac.gs ? '↑' : (ac.tgtAlt < ac.alt - 50 || ac.gs) ? '↓' : ' ';
    let l2 = `${ac.altText()}${trend}`;
    if (ac.gs) l2 += ' GS';
    else if (Math.abs(ac.tgtAlt - ac.alt) > 50) l2 += ` ${ac.altText(ac.tgtAlt).slice(1)}`;
    let info;
    if (ac.state === 'landed') info = 'LANDED';
    else if (ac.est) info = `LOC${ac.rwy}`;
    else if (ac.mode === 'hold') info = `HLD ${ac.hold.fix} ${ac.hold.turn}`;
    else if (ac.mode === 'heading') info = `H${Geo.fmtHdg(ac.tgtHdg)}${ac.ils ? ' I' + ac.rwy : ''}`;
    else info = (ac.route[0] || '') + (ac.app ? ' A' + ac.rwy : ac.ils ? ' I' + ac.rwy : '');
    const spd = String(Math.round(ac.gs_kt())).padStart(3, '0');
    const lines = [
      ac.cs + (ac.wake === 'H' ? ' H' : '') + (ac.tgtSpd ? `  S${ac.tgtSpd}` : '') +
        (this.game.userOwns(ac) ? (ac.isArr && ac.owner === 'TWR' && !ac.landClr && this.game.position === 'TWR' ? '  CL?' : '') : `  ${ac.owner}`),
      l2,
      `${spd} ${info}`,
    ];
    const tx = p.x + 16, ty = p.y - 30;
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p.x + 5, p.y - 5); ctx.lineTo(tx - 2, ty + 10); ctx.stroke();
    ctx.font = '11px "JetBrains Mono", monospace';
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (ac === this.game.selected) {
      ctx.fillStyle = 'rgba(10,30,40,0.75)';
      ctx.fillRect(tx - 3, ty - 2, w + 6, lines.length * 13 + 4);
    }
    if (!blink) {
      ctx.fillStyle = col;
      lines.forEach((l, i) => ctx.fillText(l, tx, ty + 10 + i * 13));
    }
    this.hitBoxes.push({ ac, x0: Math.min(p.x - 8, tx - 3), y0: ty - 2, x1: tx + w + 3, y1: Math.max(p.y + 8, ty + 42) });
    this.hitBoxes.push({ ac, x0: p.x - 9, y0: p.y - 9, x1: p.x + 9, y1: p.y + 9 });
  }

  drawGround(ac) {
    if (this.view.scale < 5) return;
    const ctx = this.ctx;
    const p = this.toScreen(ac);
    const sel = ac === this.game.selected;
    const col = sel ? COLORS.tagSel : ac.cleared ? '#9fe29f' : COLORS.ground;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.font = '10px "JetBrains Mono", monospace';
    const label = ac.cs + (ac.state === 'lineup' ? ' LU' : '');
    const r = ac.runway;
    const left = r.heading === 80; // keep labels away from the runway
    const w = ctx.measureText(label).width;
    const lx = left ? p.x - w - 6 : p.x + 6;
    const ly = p.y + (r.phys === 'N' ? -4 : 10);
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
