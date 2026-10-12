// EuroScope-style scope features added to the Radar: video map, interactive data tags with
// pop-up lists, incoming/outgoing handoff states, and range-and-bearing lines.
const MAP_COLORS = {
  sea: 'rgba(22, 48, 70, 0.45)', coast: '#2f5670', river: '#2a5068', town: 'rgba(130, 125, 95, 0.10)', townLine: '#4d4b3d',
  townLabel: '#6c7466', field: '#7d8c99', area: '#8a4040', ctr: '#3f7398', tma: '#4c7c9e', sector: '#56677a',
};

Object.assign(Radar.prototype, {
  initScope() {
    this.vectorMin = 1; // speed vector length, minutes
    this.historyDots = 6;
    this.layers = { map: true, areas: true, airspace: true };
    this.rbls = []; // range/bearing lines: { a, b } with ends { ac } or { x, y }
    this.rblDraft = null;
    this.tagFields = [];
    try {
      const saved = JSON.parse(localStorage.getItem('atc.scope') || '{}');
      if (saved.vectorMin !== undefined) this.vectorMin = saved.vectorMin;
      if (saved.historyDots !== undefined) this.historyDots = saved.historyDots;
      if (saved.layers) Object.assign(this.layers, saved.layers);
    } catch (e) { /* storage unavailable */ }
    this.pop = document.getElementById('tagpop');
    this.pop.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cmd]');
      if (!b) return;
      if (b.dataset.turn) { this.popTurn = b.dataset.turn; this.pop.querySelectorAll('[data-turn]').forEach((x) => x.classList.toggle('on', x === b)); return; }
      const cmd = b.dataset.cmd;
      if (cmd) {
        // Heading lists honour the chosen turn direction.
        this.game.commands.execute(cmd.replace(/^(\S+) h /, (m, cs) => `${cs} ${this.popTurn === 'L' ? 'tl' : this.popTurn === 'R' ? 'tr' : 'h'} `));
      }
      this.closePop();
    });
    document.addEventListener('pointerdown', (e) => { if (!this.pop.hidden && !this.pop.contains(e.target)) this.closePop(); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closePop(); });
  },

  saveScope() {
    try { localStorage.setItem('atc.scope', JSON.stringify({ vectorMin: this.vectorMin, historyDots: this.historyDots, layers: this.layers })); } catch (e) { /* storage unavailable */ }
  },

  // ---------- video map ----------
  path(pts, close = false) {
    const ctx = this.ctx;
    ctx.beginPath();
    pts.forEach((p, i) => { const s = this.toScreen(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
    if (close) ctx.closePath();
  },

  drawVideoMap() {
    const ctx = this.ctx, M = VIDEO_MAP, s = this.view.scale;
    ctx.font = '10px "JetBrains Mono", monospace';
    if (this.layers.map) {
      for (const sea of M.seas || []) { this.path(sea, true); ctx.fillStyle = MAP_COLORS.sea; ctx.fill(); }
      for (const c of M.coasts || []) { this.path(c); ctx.strokeStyle = MAP_COLORS.coast; ctx.lineWidth = 1.2; ctx.stroke(); }
      for (const r of M.rivers || []) { this.path(r); ctx.strokeStyle = MAP_COLORS.river; ctx.lineWidth = 1; ctx.stroke(); }
      for (const t of M.towns) {
        this.path(t.poly, true); ctx.fillStyle = MAP_COLORS.town; ctx.fill();
        ctx.strokeStyle = MAP_COLORS.townLine; ctx.lineWidth = 1; ctx.stroke();
        if (s >= 5) { const p = this.toScreen(t.label); ctx.fillStyle = MAP_COLORS.townLabel; ctx.textAlign = 'center'; ctx.fillText(t.name, p.x, p.y + 3); ctx.textAlign = 'left'; }
      }
      for (const r of M.vrps || []) { // VFR reporting points: small filled triangles
        const p = this.toScreen(r.p);
        ctx.fillStyle = MAP_COLORS.field;
        ctx.beginPath(); ctx.moveTo(p.x, p.y - 4); ctx.lineTo(p.x + 3.5, p.y + 2.5); ctx.lineTo(p.x - 3.5, p.y + 2.5); ctx.closePath(); ctx.fill();
        if (s >= 7) ctx.fillText(r.name, p.x + 6, p.y + 3);
      }
      for (const a of M.airfields) {
        const p = this.toScreen(a.p), v = Geo.vec(a.hdg);
        ctx.strokeStyle = MAP_COLORS.field; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p.x - v.x * 7, p.y + v.y * 7); ctx.lineTo(p.x + v.x * 7, p.y - v.y * 7); ctx.stroke();
        if (s >= 4) { ctx.fillStyle = MAP_COLORS.field; ctx.fillText(a.icao, p.x + 8, p.y - 6); }
      }
    }
    if (this.layers.areas) {
      for (const a of M.areas) {
        this.path(a.poly, true);
        ctx.save(); ctx.clip();
        ctx.strokeStyle = 'rgba(138,64,64,0.35)'; ctx.lineWidth = 1;
        const c = this.toScreen(a.poly[0]);
        for (let k = -400; k < 400; k += 9) { ctx.beginPath(); ctx.moveTo(c.x + k - 200, c.y - 200); ctx.lineTo(c.x + k + 200, c.y + 200); ctx.stroke(); }
        ctx.restore();
        this.path(a.poly, true); ctx.strokeStyle = MAP_COLORS.area; ctx.lineWidth = 1.2; ctx.stroke();
        if (s >= 4) {
          const cx = a.poly.reduce((q, p) => q + p.x, 0) / a.poly.length, cy = a.poly.reduce((q, p) => q + p.y, 0) / a.poly.length;
          const p = this.toScreen({ x: cx, y: cy });
          ctx.fillStyle = '#b06060'; ctx.textAlign = 'center';
          ctx.fillText(a.name, p.x, p.y - 2); ctx.fillText(a.limits, p.x, p.y + 10);
          ctx.textAlign = 'left';
        }
      }
    }
    if (this.layers.airspace) {
      this.path(M.tma, true); ctx.strokeStyle = MAP_COLORS.tma; ctx.lineWidth = 1.2; ctx.setLineDash([10, 4]); ctx.stroke();
      this.path(M.ctr, true); ctx.strokeStyle = MAP_COLORS.ctr; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.stroke();
      for (const x of M.extraCtrs || []) { this.path(x.poly, true); ctx.stroke(); }
      if (M.sector) { this.path(M.sector); ctx.strokeStyle = MAP_COLORS.sector; ctx.setLineDash([2, 6]); ctx.stroke(); }
      for (const l of M.lines || []) { this.path(l.pts); ctx.strokeStyle = MAP_COLORS.sector; ctx.setLineDash([6, 3]); ctx.stroke(); }
      ctx.setLineDash([]);
      const t = this.toScreen(M.tma[0]), c = this.toScreen(M.ctr[1]);
      ctx.fillStyle = MAP_COLORS.tma; ctx.fillText(AIRPORT.tmaLabel, t.x + 6, t.y + 14);
      if (s >= 6) {
        ctx.fillStyle = MAP_COLORS.ctr; ctx.fillText(AIRPORT.ctrLabel, c.x + 4, c.y - 4);
        for (const x of M.extraCtrs || []) { const p = this.toScreen(x.poly[0]); ctx.fillText(x.name, p.x + 4, p.y - 4); }
      }
      if (s >= 5) {
        ctx.fillStyle = MAP_COLORS.sector;
        if (M.sector && M.sectorLabels) { const a = this.toScreen(M.sector[0]); ctx.fillText(M.sectorLabels[0], a.x + 8, a.y - 6); ctx.fillText(M.sectorLabels[1], a.x + 8, a.y + 14); }
        for (const l of M.lines || []) if (l.label) { const a = this.toScreen(l.pts[0]); ctx.fillText(l.label, a.x + 4, a.y - 4); }
      }
    }
  },

  // ---------- data tags (EuroScope-style, clickable fields) ----------
  tagState(ac) {
    const g = this.game, now = g.time;
    if (ac.incoming !== undefined && ac.incoming !== null && now - ac.incoming < 20 && g.userOwns(ac)) return 'concerned';
    if (ac.handedOff || !g.userOwns(ac)) return 'unconcerned';
    return 'assumed';
  },

  drawTag(ac, p, col, blink) {
    const ctx = this.ctx, g = this.game;
    const state = this.tagState(ac);
    const flash = state === 'concerned' && Math.floor(performance.now() / 350) % 2;
    const fg = ac.emg && !ac.emg.done ? col : flash ? '#ffffff' : state === 'concerned' ? '#f4f0a0' : col;
    const trend = ac.tgtAlt > ac.alt + 50 && !ac.gs ? '↑' : (ac.tgtAlt < ac.alt - 50 || ac.gs) ? '↓' : ' ';
    const alt = String(Math.round(ac.alt / 100)).padStart(3, '0');
    const cfl = ac.gs ? 'GS ' : ac.est ? 'LOC' : String(Math.round(ac.tgtAlt / 100)).padStart(3, '0');
    let nav;
    if (ac.state === 'landed') nav = 'LDG';
    else if (ac.est) nav = `I${ac.rwy}`;
    else if (ac.mode === 'hold') nav = `H${ac.hold.fix}`;
    else if (ac.mode === 'heading') nav = `H${Geo.fmtHdg(ac.tgtHdg)}`;
    else nav = ac.route[0] || '---';
    const spd = ac.tgtSpd ? `S${ac.tgtSpd}` : 'S--';
    const gsTxt = String(Math.round(ac.gs_kt() / 10)).padStart(2, '0');
    let extra = '';
    if (ac.emg && !ac.emg.done) extra = ` ${ac.emg.type === 'RADIO' ? 'RDOF' : 'EMG'} ${ac.squawk}`;
    else if (ac.outgoing && g.time - ac.outgoing.t < 10) extra = ` →${ac.outgoing.to}`;
    else if (!g.userOwns(ac)) extra = ` ${ac.owner}`;
    else if (ac.isArr && ac.owner === 'TWR' && !ac.landClr && g.position === 'TWR') extra = ' CL?';
    const line1 = [{ t: ac.cs, f: 'cs' }, { t: (ac.wake === 'H' ? ' H' : '') + extra, f: null }];
    const line2 = [{ t: `${alt}${trend}`, f: null }, { t: cfl, f: 'cfl' }, { t: ` ${ac.type}`, f: null }];
    const line3 = [{ t: `${gsTxt} `, f: null }, { t: nav, f: 'nav' }, { t: ' ', f: null }, { t: spd, f: 'spd' }];
    const off = ac.tagOffset || { x: 16, y: -30 };
    const tx = p.x + off.x, ty = p.y + off.y;
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p.x + Math.sign(off.x) * 5, p.y + Math.sign(off.y) * 5); ctx.lineTo(tx - 2, ty + 10); ctx.stroke();
    ctx.font = '11px "JetBrains Mono", monospace';
    const widths = [line1, line2, line3].map((l) => l.reduce((w, s) => w + ctx.measureText(s.t).width, 0));
    const w = Math.max(...widths);
    if (ac === g.selected || state === 'concerned') {
      ctx.fillStyle = 'rgba(10,30,40,0.75)';
      ctx.fillRect(tx - 3, ty - 2, w + 6, 3 * 13 + 4);
    }
    const mine = g.userOwns(ac);
    [line1, line2, line3].forEach((segs, i) => {
      let x = tx;
      const y = ty + 10 + i * 13;
      for (const seg of segs) {
        const sw = ctx.measureText(seg.t).width;
        if (!blink) {
          ctx.fillStyle = seg.f && seg.f !== 'cs' && seg.t.includes('--') ? 'rgba(160,180,190,0.55)' : fg;
          ctx.fillText(seg.t, x, y);
        }
        if (seg.f && mine) this.tagFields.push({ ac, field: seg.f, x0: x - 1, y0: y - 10, x1: x + sw + 1, y1: y + 3 });
        if (seg.f === 'cs' && !mine) this.tagFields.push({ ac, field: 'cs', x0: x - 1, y0: y - 10, x1: x + sw + 1, y1: y + 3 });
        x += sw;
      }
    });
    this.hitBoxes.push({ ac, x0: Math.min(p.x - 8, tx - 3), y0: Math.min(ty - 2, p.y - 8), x1: Math.max(tx + w + 3, p.x + 8), y1: Math.max(p.y + 8, ty + 42) });
    this.hitBoxes.push({ ac, x0: p.x - 9, y0: p.y - 9, x1: p.x + 9, y1: p.y + 9 });
  },

  hitTagField(sx, sy) {
    for (let i = this.tagFields.length - 1; i >= 0; i--) {
      const f = this.tagFields[i];
      if (sx >= f.x0 && sx <= f.x1 && sy >= f.y0 && sy <= f.y1) return f;
    }
    return null;
  },

  // ---------- pop-up lists ----------
  closePop() { if (this.pop) this.pop.hidden = true; },

  openPop(title, items, sx, sy, { current = null, turn = false } = {}) {
    const g = this.game;
    this.popTurn = 'auto';
    const rect = this.c.getBoundingClientRect();
    let html = `<div class="ph">${esc(title)}</div>`;
    if (turn) html += '<div class="pturn"><button data-cmd="" data-turn="auto" class="on">Auto</button><button data-cmd="" data-turn="L">Left</button><button data-cmd="" data-turn="R">Right</button></div>';
    html += '<div class="plist">' + items.map(([label, cmd, cls]) =>
      `<button data-cmd="${esc(cmd)}" class="${cls || ''}${label === current ? ' cur' : ''}">${esc(label)}</button>`).join('') + '</div>';
    this.pop.innerHTML = html;
    this.pop.hidden = false;
    const w = this.pop.offsetWidth, h = this.pop.offsetHeight;
    this.pop.style.left = Math.max(4, Math.min(sx + 6, this.w - w - 6)) + 'px';
    this.pop.style.top = Math.max(4, Math.min(sy - 10, this.h - h - 6)) + 'px';
    const cur = this.pop.querySelector('.cur');
    if (cur) cur.scrollIntoView({ block: 'center' });
    void g; void rect;
  },

  openTagField(f, sx, sy) {
    const ac = f.ac, g = this.game, cs = ac.cs;
    g.select(ac);
    if (!g.userOwns(ac)) {
      return this.openPop(`${cs} — with ${POSITIONS[ac.owner].name}${ac.owner !== 'CTR' ? ' (AI)' : ''}`, [['Not on your frequency', '']], sx, sy);
    }
    if (f.field === 'cfl') {
      const items = [];
      const lvl = (a) => (a >= AIRPORT.transAlt + 500 ? `FL${Math.round(a / 100)}` : `${a}`);
      for (let fl = 380; fl >= 70; fl -= 10) items.push([lvl(fl * 100), `${cs} a FL${fl}`]);
      for (let a = 6000; a >= 2000; a -= 1000) items.push([lvl(a), `${cs} a ${a}`]);
      const cur = lvl(Math.round(ac.tgtAlt / 1000) * 1000 >= AIRPORT.transAlt + 500 ? Math.round(ac.tgtAlt / 1000) * 1000 : Math.round(ac.tgtAlt / 1000) * 1000);
      return this.openPop(`${cs} cleared level`, items, sx, sy, { current: cur });
    }
    if (f.field === 'nav') {
      // Heading list plus own navigation; the next-fix part of the tag opens directs too.
      const items = [];
      if (ac.route.length && ac.mode !== 'route') items.push(['Own navigation (resume)', `${cs} res`, 'opt']);
      const near = Object.values(FIXES).filter((x) => !ac.route.includes(x.name) && Geo.dist(ac, x) < 35)
        .sort((a, b) => Geo.dist(ac, a) - Geo.dist(ac, b)).slice(0, 12);
      if (ac.mode === 'route' || ac.mode === 'hold') {
        for (const n of ac.route) items.push([`→ ${n}`, `${cs} dct ${n}`, 'fix']);
        for (const x of near) items.push([`→ ${x.name}  ${Geo.dist(ac, x).toFixed(0)}nm`, `${cs} dct ${x.name}`, 'fix']);
        items.push(['— headings —', '', 'sep']);
      }
      for (let h = 5; h <= 360; h += 5) items.push([Geo.fmtHdg(h), `${cs} h ${Geo.fmtHdg(h)}`]);
      if (ac.mode === 'heading') for (const n of ac.route) items.push([`→ ${n}`, `${cs} dct ${n}`, 'fix']);
      const cur = ac.mode === 'heading' ? Geo.fmtHdg(Math.round(ac.tgtHdg / 5) * 5) : null;
      return this.openPop(`${cs} heading / direct`, items, sx, sy, { current: cur, turn: true });
    }
    if (f.field === 'spd') {
      const items = [['No speed restriction', `${cs} s rs`, 'opt']];
      for (let v = 300; v >= 160; v -= 10) items.push([String(v), `${cs} s ${v}`]);
      return this.openPop(`${cs} speed`, items, sx, sy, { current: ac.tgtSpd ? String(ac.tgtSpd) : null });
    }
    // Callsign: clicking it assumes an incoming handoff (as in EuroScope), then shows the aircraft menu.
    if (ac.incoming !== null && ac.incoming !== undefined) g.commands.execute(`${cs} asm`);
    const items = [];
    if (ac.airborne) {
      const next = ac.owner === 'APP' ? (ac.isArr ? 'TWR' : 'CTR') : ac.owner === 'TWR' && !ac.isArr ? 'APP' : null;
      if (next && g.position !== 'ALL') items.push([`Transfer to ${POSITIONS[next].short}`, `${cs} ho`]);
      if (g.position === 'ALL' && !ac.isArr && !ac.handedOff) items.push(['Transfer to Control', `${cs} ho`]);
      if (ac.isArr) {
        for (const rwy of g.arrivalRunways()) {
          const a = APPROACHES[rwy];
          items.push([`Approach ${rwy} · best entry`, `${cs} app ${rwy}`]);
          // Pre-made transitions: each one joins the final at the IF, lined up with the runway.
          for (const fix of a.iafs) items.push([`  ${rwy} via ${fix} · ${describeEntry(rwy, fix)}`, `${cs} app ${rwy} via ${fix}`, 'fix']);
          items.push([`Cleared ILS ${rwy} (vectors)`, `${cs} i ${rwy}`]);
        }
        if (ac.owner === 'TWR' && ac.ils && !ac.landClr) items.push([`Cleared to land ${ac.rwy}`, `${cs} cl`]);
        items.push(['Go around', `${cs} ga`]);
      }
      if (ac.route.length) items.push([`Hold at ${ac.route[0]}`, `${cs} hold ${ac.route[0]}`]);
      if (ac.route.length && ac.mode !== 'route') items.push(['Resume own navigation', `${cs} res`]);
    }
    if (!items.length) items.push(['No instructions', '']);
    this.openPop(`${cs} ${ac.type}/${ac.wake} ${ac.isArr ? ac.orig + '→' + ac.dest : ac.orig + '→' + ac.dest}`, items, sx, sy);
  },

  // ---------- range and bearing lines ----------
  rblEnd(sx, sy) {
    const ac = this.hitAircraft(sx, sy);
    return ac ? { ac } : this.toWorld(sx, sy);
  },
  rblPos(end) { return end.ac ? (end.ac.state === 'gone' ? null : { x: end.ac.x, y: end.ac.y }) : end; },

  drawRbls() {
    const ctx = this.ctx;
    this.rbls = this.rbls.filter((l) => this.rblPos(l.a) && this.rblPos(l.b));
    const all = this.rblDraft ? [...this.rbls, this.rblDraft] : this.rbls;
    ctx.font = '10px "JetBrains Mono", monospace';
    for (const l of all) {
      const A = this.rblPos(l.a), B = this.rblPos(l.b);
      if (!A || !B) continue;
      const a = this.toScreen(A), b = this.toScreen(B);
      ctx.strokeStyle = '#e7d36a'; ctx.lineWidth = 1; ctx.setLineDash([6, 3]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
      let text = `${Geo.fmtHdg(Geo.bearing(A, B))}° ${Geo.dist(A, B).toFixed(1)}nm`;
      if (l.a.ac && l.b.ac) {
        const c = this.closestApproach(l.a.ac, l.b.ac);
        if (c) text += `  min ${c.d.toFixed(1)}nm in ${Math.round(c.t / 60)}:${String(Math.round(c.t % 60)).padStart(2, '0')}`;
      }
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const w = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(20,28,36,0.8)'; ctx.fillRect(m.x + 4, m.y - 11, w + 6, 14);
      ctx.fillStyle = '#e7d36a'; ctx.fillText(text, m.x + 7, m.y);
    }
  },

  // Time and distance of closest approach for two aircraft on their present tracks.
  closestApproach(a, b) {
    const va = a.vel(), vb = b.vel();
    const dx = b.x - a.x, dy = b.y - a.y, dvx = vb.x - va.x, dvy = vb.y - va.y;
    const v2 = dvx * dvx + dvy * dvy;
    const t = v2 > 1e-12 ? Math.max(0, -(dx * dvx + dy * dvy) / v2) : 0;
    if (t > 1800) return null;
    return { t, d: Math.hypot(dx + dvx * t, dy + dvy * t) };
  },

  hitRbl(sx, sy) {
    for (let i = this.rbls.length - 1; i >= 0; i--) {
      const A = this.rblPos(this.rbls[i].a), B = this.rblPos(this.rbls[i].b);
      if (!A || !B) continue;
      const a = this.toScreen(A), b = this.toScreen(B);
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
      const t = Geo.clamp(((sx - a.x) * dx + (sy - a.y) * dy) / l2, 0, 1);
      if (Math.hypot(sx - a.x - t * dx, sy - a.y - t * dy) < 6) return i;
    }
    return -1;
  },
});
