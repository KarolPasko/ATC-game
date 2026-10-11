// Game state, simulation loop, traffic generation, separation and scoring.
const TRAFFIC = {
  low: { arr: 170, dep: 200 },
  med: { arr: 110, dep: 130 },
  high: { arr: 70, dep: 85 },
};
const STEP = 0.2; // simulation step, seconds
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

class Game {
  constructor(canvas) {
    this.commands = new CommandProcessor(this);
    this.radar = new Radar(canvas, this);
    this.ui = new UI(this);
    this.voice = false;
    this.restart();
    this.lastFrame = performance.now();
    this.uiTimer = 0;
    requestAnimationFrame((t) => this.frame(t));
  }

  restart() {
    this.aircraft = [];
    this.selected = null;
    this.time = 0;
    this.paused = false;
    this.rate = 1;
    this.config = this.config || '26';
    this.traffic = this.traffic || 'med';
    this.score = 0;
    this.stats = { landed: 0, departed: 0, losses: 0, goArounds: 0 };
    this.conflictPairs = new Set();
    this.nextArr = 5;
    this.nextDep = 15;
    this.ui.clearLog();
    this.log(`Welcome to ${AIRPORT.name} (${AIRPORT.icao}). Runways ${this.activeRunways().join(' & ')} in use.`, 'sys');
    this.log('Click an aircraft (or type its callsign) and enter commands below. Type .help for the command list.', 'sys');
    this.spawnArrival();
    this.spawnArrival();
    this.spawnDeparture();
  }

  activeRunways() { return this.config === '26' ? ['26L', '26R'] : ['08L', '08R']; }

  // ---------- main loop ----------
  frame(now) {
    const realDt = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (!this.paused) {
      this.acc = (this.acc || 0) + realDt * this.rate;
      while (this.acc >= STEP) { this.step(STEP); this.acc -= STEP; }
    }
    this.radar.draw();
    this.uiTimer += realDt;
    if (this.uiTimer > 0.25) { this.uiTimer = 0; this.ui.update(); }
    requestAnimationFrame((t) => this.frame(t));
  }

  step(dt) {
    this.time += dt;
    for (const ac of this.aircraft) ac.update(dt, this);
    this.layoutGround();
    this.checkBoundaries();
    this.sepTimer = (this.sepTimer || 0) + dt;
    if (this.sepTimer >= 1) { this.sepTimer = 0; this.checkSeparation(); }
    if (this.selected && this.selected.state === 'gone') this.select(null);
    this.aircraft = this.aircraft.filter((a) => a.state !== 'gone');

    const t = TRAFFIC[this.traffic];
    const airborne = this.aircraft.filter((a) => a.state === 'air').length;
    if (this.time >= this.nextArr) {
      if (airborne < 16) this.spawnArrival();
      this.nextArr = this.time + t.arr * (0.7 + Math.random() * 0.6);
    }
    if (this.time >= this.nextDep) {
      this.spawnDeparture();
      this.nextDep = this.time + t.dep * (0.7 + Math.random() * 0.6);
    }
  }

  // ---------- traffic generation ----------
  newCallsign() {
    for (;;) {
      const al = rnd(AIRLINES);
      const cs = al.icao + (Math.random() < 0.5 ? Math.floor(Math.random() * 900 + 100) : Math.floor(Math.random() * 90 + 10)) +
        (Math.random() < 0.25 ? rnd(['A', 'K', 'W', 'X', 'G']) : '');
      if (!this.aircraft.some((a) => a.cs === cs)) return cs;
    }
  }

  newSquawk() {
    for (;;) {
      const s = String(Math.floor(Math.random() * 8)) + Array.from({ length: 3 }, () => Math.floor(Math.random() * 8)).join('');
      if (!this.aircraft.some((a) => a.squawk === s) && !['7500', '7600', '7700', '7000', '2000'].includes(s)) return s;
    }
  }

  spawnArrival() {
    const stars = PROCS[this.config].stars.filter((s) => {
      const e = FIXES[s.fixes[0]];
      return !this.aircraft.some((a) => a.state === 'air' && Geo.dist(a, e) < 12);
    });
    if (!stars.length) return;
    const star = rnd(stars);
    const entry = FIXES[star.fixes[0]];
    const [iaf, ifx, faf] = APPROACHES[star.rwy];
    const route = star.fixes.slice(1);
    if (route[route.length - 1] === iaf) route.push(ifx, faf);
    const alt = 11000 + Math.floor(Math.random() * 6) * 1000;
    const type = rnd(TYPE_WEIGHTS);
    const ac = new Aircraft({
      cs: this.newCallsign(), type, kind: 'arr',
      x: entry.x, y: entry.y, alt, tgtAlt: alt, spd: 280,
      rwy: star.rwy, star: star.name, route,
      orig: rnd(OUTSTATIONS[FIX_DIRECTION[star.fixes[0]]]), dest: AIRPORT.icao,
      squawk: this.newSquawk(), cleared: true,
    });
    ac.hdg = ac.tgtHdg = Geo.bearing(entry, FIXES[route[0]]);
    this.aircraft.push(ac);
    ac.say(this, `Ravenwood Approach, good day, ${ac.altText().startsWith('F') ? 'flight level ' + Math.round(alt / 100) : alt + ' ft'}, ${star.name} arrival, expecting runway ${star.rwy}`);
  }

  spawnDeparture() {
    const sids = PROCS[this.config].sids.filter(
      (s) => this.aircraft.filter((a) => a.state === 'ground' && a.rwy === s.rwy).length < 3,
    );
    if (!sids.length) return;
    const sid = rnd(sids);
    const r = RUNWAYS[sid.rwy];
    const ac = new Aircraft({
      cs: this.newCallsign(), type: rnd(TYPE_WEIGHTS), kind: 'dep',
      x: r.thr.x, y: r.thr.y, alt: 0, tgtAlt: 0, spd: 0, hdg: r.heading, tgtHdg: r.heading,
      state: 'ground', rwy: sid.rwy, sid: sid.name, route: sid.fixes.slice(),
      orig: AIRPORT.icao, dest: rnd(OUTSTATIONS[FIX_DIRECTION[sid.fixes[sid.fixes.length - 1]]]),
      squawk: this.newSquawk(), cleared: false, spawnTime: this.time,
    });
    this.aircraft.push(ac);
    ac.say(this, `Ravenwood Tower, holding point runway ${sid.rwy}, IFR to ${ac.dest}, request clearance`);
    this.layoutGround();
  }

  // Queue waiting departures beside their runway's threshold.
  layoutGround() {
    const counts = {};
    for (const a of this.aircraft) {
      if (a.state !== 'ground') continue;
      const r = a.runway;
      const n = (counts[a.rwy] = (counts[a.rwy] || 0) + 1);
      const side = r.phys === 'N' ? -90 : 90; // outer side of the runway
      const p = Geo.offset(r.thr, r.heading + side, 0.25);
      const q = Geo.offset(p, r.heading + 180, 0.18 * (n - 1));
      a.x = q.x; a.y = q.y;
    }
  }

  // ---------- events & scoring ----------
  addScore(n, why) {
    this.score += n;
    this.log(`${n > 0 ? '+' : ''}${n}  ${why}`, n > 0 ? 'good' : 'err');
  }

  onLanded(ac) {
    this.stats.landed++;
    this.addScore(100, `${ac.cs} landed runway ${ac.rwy}`);
  }

  onGoAround(ac) {
    this.stats.goArounds++;
    this.addScore(-10, `${ac.cs} go-around`);
  }

  handOff(ac) {
    ac.handedOff = true;
    if (ac.isArr) return;
    const d = Math.hypot(ac.x, ac.y);
    this.stats.departed++;
    if (d >= 20 && ac.alt >= 10000) this.addScore(100, `${ac.cs} handed off`);
    else if (ac.alt >= SID_TOP) this.addScore(50, `${ac.cs} handed off (low/early — climb them higher first)`);
    else this.addScore(20, `${ac.cs} handed off very early`);
    ac.tgtAlt = Math.max(ac.tgtAlt, 30000);
    ac.tgtSpd = null;
    if (ac.mode !== 'route' && ac.route.length) { ac.mode = 'route'; ac.hold = null; }
  }

  checkRunwayClear(ac) {
    const busy = this.aircraft.find((o) => o !== ac && o.runway?.phys === ac.runway.phys && (
      ['lineup', 'takeoff', 'landed'].includes(o.state) ||
      (o.est && o.finalGeometry().along < 2.5) ||
      (o.state === 'air' && !o.isArr && o.alt < 300)));
    if (busy) this.addScore(-50, `Runway ${ac.rwy} not clear — ${busy.cs} is on the runway / short final`);
  }

  checkBoundaries() {
    for (const ac of this.aircraft) {
      if (ac.state !== 'air') continue;
      if (Math.hypot(ac.x, ac.y) > AIRPORT.radarRange) {
        ac.state = 'gone';
        if (!ac.isArr && ac.handedOff) continue;
        if (ac.isArr) this.addScore(-100, `${ac.cs} left your airspace — arrival lost`);
        else { this.stats.departed++; this.addScore(-50, `${ac.cs} left your airspace without a handoff`); }
      }
    }
  }

  checkSeparation() {
    const air = this.aircraft.filter((a) => a.state === 'air');
    for (const a of air) a.conflict = 0;
    const now = new Set();
    for (let i = 0; i < air.length; i++) {
      for (let j = i + 1; j < air.length; j++) {
        const a = air[i], b = air[j];
        if (this.exempt(a, b)) continue;
        const h = Geo.dist(a, b), v = Math.abs(a.alt - b.alt);
        if (h < 3 && v < 950) {
          a.conflict = b.conflict = 2;
          const key = [a.cs, b.cs].sort().join('|');
          now.add(key);
          if (!this.conflictPairs.has(key)) {
            this.stats.losses++;
            this.addScore(-50, `Separation lost: ${a.cs} / ${b.cs} (${h.toFixed(1)} nm, ${Math.round(v)} ft)`);
          }
        } else if (this.predictConflict(a, b)) {
          a.conflict = Math.max(a.conflict, 1);
          b.conflict = Math.max(b.conflict, 1);
        }
      }
    }
    this.conflictPairs = now;
  }

  exempt(a, b) {
    if (a.est && b.est && a.rwy !== b.rwy) return true; // independent parallel approaches
    const near = (x) => Math.hypot(x.x, x.y) < 6 && x.alt < 2500;
    return near(a) && near(b) && (a.isArr !== b.isArr || a.rwy !== b.rwy);
  }

  // Simple short-term conflict alert: straight-line projection up to 90 s.
  predictConflict(a, b) {
    // Skip pairs that cannot close to 3 nm / 1000 ft within the look-ahead.
    if (Geo.dist(a, b) > 3 + ((a.gs_kt() + b.gs_kt()) / 3600) * 90) return false;
    if (Math.abs(a.alt - b.alt) > 950 + ((a.perf.climb + b.perf.desc) / 60) * 90 * 1.6) return false;
    const proj = (ac, t) => {
      const p = Geo.offset(ac, ac.hdg, (ac.gs_kt() / 3600) * t);
      const rate = ac.tgtAlt > ac.alt ? ac.perf.climb : -ac.perf.desc;
      const alt = ac.gs ? ac.alt - (ac.gs_kt() / 3600) * t * GS_FT_PER_NM
        : rate > 0 ? Math.min(ac.tgtAlt, ac.alt + (rate / 60) * t) : Math.max(ac.tgtAlt, ac.alt + (rate / 60) * t);
      return { x: p.x, y: p.y, alt };
    };
    for (let t = 10; t <= 90; t += 10) {
      const pa = proj(a, t), pb = proj(b, t);
      if (Geo.dist(pa, pb) < 3 && Math.abs(pa.alt - pb.alt) < 950) return true;
    }
    return false;
  }

  // ---------- helpers used by UI / commands ----------
  findAircraft(tok) {
    if (!tok) return null;
    tok = tok.toUpperCase();
    const exact = this.aircraft.find((a) => a.cs === tok);
    if (exact) return exact;
    if (tok.length < 2) return null;
    const m = this.aircraft.filter((a) => a.cs.endsWith(tok) || a.cs.startsWith(tok));
    return m.length === 1 ? m[0] : null;
  }

  select(ac) {
    this.selected = ac;
    this.ui.update();
  }

  log(text, cls = 'sys') { this.ui.log(text, cls, this.clock()); }

  pilotSay(ac, text) {
    this.log(`${ac.cs}: ${text}`, 'pilot');
    if (this.voice && window.speechSynthesis) {
      const al = AIRLINES.find((a) => ac.cs.startsWith(a.icao));
      const spoken = (al ? al.name + ' ' + ac.cs.slice(3).split('').join(' ') : ac.cs) + ', ' + text.replace(/\b(\d{3,4})\b/g, (m) => m.split('').join(' '));
      const u = new SpeechSynthesisUtterance(spoken);
      u.rate = 1.15;
      speechSynthesis.speak(u);
    }
  }

  clock() {
    const base = 14 * 3600; // sim starts at 14:00Z
    const s = Math.floor(base + this.time);
    const hh = String(Math.floor(s / 3600) % 24).padStart(2, '0');
    const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}Z`;
  }

  togglePause() { this.paused = !this.paused; this.log(this.paused ? 'Simulation paused' : 'Simulation resumed', 'sys'); this.ui.update(); }
  setRate(r) { this.rate = r; this.log(`Simulation rate x${r}`, 'sys'); this.ui.update(); }
  setTraffic(t) { this.traffic = t; this.log(`Traffic density: ${t}`, 'sys'); this.nextArr = Math.min(this.nextArr, this.time + 10); this.ui.update(); }
  setConfig(c) {
    if (c === this.config) return;
    this.config = c;
    // Waiting departures move to the new runway direction and pick a matching SID.
    for (const a of this.aircraft) {
      if (a.state !== 'ground' && a.state !== 'lineup') continue;
      const exit = a.route[a.route.length - 1];
      const sid = PROCS[c].sids.find((s) => s.fixes[s.fixes.length - 1] === exit);
      Object.assign(a, { state: 'ground', rwy: sid.rwy, sid: sid.name, route: sid.fixes.slice(), hdg: RUNWAYS[sid.rwy].heading });
      a.tgtHdg = a.hdg;
    }
    this.log(`Runway configuration changed: ${this.activeRunways().join(' & ')} in use. New arrivals will use the new STARs; vector existing traffic as needed.`, 'sys');
    this.ui.update();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.game = new Game(document.getElementById('radar'));
});
