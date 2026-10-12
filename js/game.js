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
    this.ai = new AIController(this);
    this.position = 'ALL';
    this.viewMode = 'radar'; // radar | ground
    this.autoTaxi = true; // AI ground handles taxiing for the player's aircraft
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
    this.ai.lastTakeoff = {};
    this.nextArr = 5;
    this.nextDep = 15;
    this.atis = 'K';
    AIRPORT.qnh = 1003 + Math.floor(Math.random() * 25);
    const temp = 8 + Math.floor(Math.random() * 13);
    this.wx = { cloud: rnd(['FEW030', 'SCT025', 'BKN035', 'FEW040 SCT120', 'SCT018 BKN045']), t: temp, td: temp - 3 - Math.floor(Math.random() * 6) };
    WIND.dir = this.config === '26' ? 240 + Math.floor(Math.random() * 30) : 60 + Math.floor(Math.random() * 30);
    WIND.spd = 6 + Math.floor(Math.random() * 12);
    this.windBase = { ...WIND };
    this.ui.clearLog();
    this.log(`Welcome to ${AIRPORT.name} (${AIRPORT.icao}). Runways ${this.activeRunways().join(' & ')} in use.`, 'sys');
    this.log(`Information ${this.atis}: wind ${this.windText()}, QNH ${AIRPORT.qnh}, transition altitude ${AIRPORT.transAlt} ft.`, 'sys');
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

  // METAR for the top bar, built from the simulated weather.
  metar() {
    const t = Math.floor(14 * 3600 + this.time);
    const hh = String(Math.floor(t / 3600) % 24).padStart(2, '0'), mm = String(Math.floor(t / 60) % 60).padStart(2, '0');
    const dir = Geo.fmtHdg(Math.round(WIND.dir / 10) * 10);
    const w = this.wx || { cloud: 'FEW030', t: 15, td: 8 };
    return `${AIRPORT.icao} 14${hh}${mm}Z ${dir}${String(Math.round(WIND.spd)).padStart(2, '0')}KT 9999 ${w.cloud} ${w.t}/${String(w.td).padStart(2, '0')} Q${AIRPORT.qnh} NOSIG`;
  }

  windText() { return `${Geo.fmtHdg(Math.round(WIND.dir / 10) * 10)}/${String(Math.round(WIND.spd)).padStart(2, '0')}KT`; }

  step(dt) {
    this.time += dt;
    // Wind wanders slowly around its base value.
    WIND.dir = this.windBase.dir + Math.sin(this.time / 300) * 10;
    WIND.spd = Math.max(0, this.windBase.spd + Math.sin(this.time / 170) * 3);
    for (const ac of this.aircraft) ac.update(dt, this);
    this.ai.update(dt);
    this.checkBoundaries();
    this.checkLandingRunways();
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
    const route = starRoute(star);
    const alt = 11000 + Math.floor(Math.random() * 6) * 1000;
    const type = rnd(TYPE_WEIGHTS);
    const ac = new Aircraft({
      cs: this.newCallsign(), type, kind: 'arr',
      x: entry.x, y: entry.y, alt, tgtAlt: alt, spd: 280,
      rwy: star.rwy, star: star.name, route, altCons: star.alts || {},
      orig: rnd(OUTSTATIONS[FIX_DIRECTION[star.fixes[0]]]), dest: AIRPORT.icao,
      squawk: this.newSquawk(), cleared: true, owner: 'APP',
    });
    ac.hdg = ac.tgtHdg = Geo.bearing(entry, FIXES[route[0]]);
    this.aircraft.push(ac);
    ac.say(this, `Ravenwood Approach, good day, ${ac.altText().startsWith('F') ? 'flight level ' + Math.round(alt / 100) : alt + ' ft'}, ${star.name} arrival, expecting runway ${star.rwy}`);
  }

  // Departures start at a free stand and call Delivery for their clearance.
  spawnDeparture() {
    const onGround = this.aircraft.filter((a) => !a.isArr && ['stand', 'pushback', 'taxi', 'ground', 'lineup'].includes(a.state));
    if (onGround.length >= 7) return;
    const stand = this.freeStand();
    if (!stand) return;
    const sid = rnd(PROCS[this.config].sids);
    const st = GROUND.stands[stand];
    const n = GROUND.nodes[st.node];
    const ac = new Aircraft({
      cs: this.newCallsign(), type: rnd(TYPE_WEIGHTS), kind: 'dep',
      x: n.x, y: n.y, alt: 0, tgtAlt: 0, spd: 0,
      state: 'stand', stand, gnode: st.node, rwy: sid.rwy, sid: sid.name, route: sid.fixes.slice(),
      orig: AIRPORT.icao, dest: rnd(OUTSTATIONS[FIX_DIRECTION[sid.fixes[sid.fixes.length - 1]]]),
      squawk: this.newSquawk(), cleared: false, spawnTime: this.time, owner: 'GND',
      cruise: rnd([240, 280, 320, 360]),
    });
    ac.hdg = ac.tgtHdg = Geo.bearing(n, GROUND.toWorld(st.u, 0)); // nose-in to the terminal
    this.aircraft.push(ac);
    ac.say(this, `Ravenwood Delivery, stand ${stand}, information ${this.atis}, IFR to ${ac.dest}, request clearance`);
  }

  freeStand() {
    const used = new Set(this.aircraft.filter((a) => a.stand && a.state !== 'gone' &&
      (a.isArr || a.state === 'stand' || a.state === 'pushback')).map((a) => a.stand));
    const free = Object.keys(GROUND.stands).map(Number).filter((n) => !used.has(n));
    return free.length ? rnd(free) : null;
  }

  // Another ground aircraft close ahead that this one must stop behind (in-trail, or at a holding point).
  groundBlocker(ac) {
    const v = Geo.vec(ac.hdg);
    let best = null, bd = 75 / GROUND.M_PER_NM;
    for (const o of this.aircraft) {
      if (o === ac || !['taxi', 'pushback', 'ground', 'lineup'].includes(o.state)) continue;
      const dx = o.x - ac.x, dy = o.y - ac.y, d = Math.hypot(dx, dy);
      if (d > bd || d < 1e-7) continue;
      if ((dx * v.x + dy * v.y) / d < Math.cos(Geo.rad(35))) continue;
      // Opposite-direction traffic on a taxiway squeezes past rather than gridlocking.
      if (o.state === 'taxi' && o.spd > 1 && Math.abs(Geo.diff(ac.hdg, o.hdg)) > 110) continue;
      best = o; bd = d;
    }
    if (best && best.state === 'taxi') {
      // Both waiting for each other at a junction: the earlier aircraft has priority.
      const w = Geo.vec(best.hdg), dx = ac.x - best.x, dy = ac.y - best.y, d = Math.hypot(dx, dy);
      if ((dx * w.x + dy * w.y) / d >= Math.cos(Geo.rad(35)) && ac.age > best.age) return null;
    }
    return best;
  }

  // ---------- events & scoring ----------
  addScore(n, why) {
    this.score += n;
    this.log(`${n > 0 ? '+' : ''}${n}  ${why}`, n > 0 ? 'good' : 'err');
  }

  onLanded(ac) {
    ac.stand = this.freeStand();
    this.stats.landed++;
    this.addScore(100, `${ac.cs} landed runway ${ac.rwy}`);
  }

  onGoAround(ac) {
    if (this.userOwns(ac)) {
      this.stats.goArounds++;
      this.addScore(-10, `${ac.cs} go-around`);
    }
    // Tower hands a missed approach straight back to Approach for re-sequencing.
    if (ac.owner === 'TWR') {
      ac.owner = 'APP';
      if (this.position !== 'ALL') this.log(`Ravenwood Tower: ${ac.cs} going around, transferred back to Approach`, 'sys');
    }
  }

  // ---------- controller positions ----------
  userOwns(ac) {
    if (this.position === 'ALL') return ac.owner !== 'CTR';
    return ac.owner === this.position;
  }

  // Move an aircraft to another controller's frequency, with scoring and the pilot's first call.
  transfer(ac, to, { ai = false, silent = false } = {}) {
    const from = ac.owner;
    ac.owner = to;
    // EuroScope-style states: an aircraft handed to the player flashes until assumed; one handed away shows →POS.
    if (!silent && this.position !== 'ALL') {
      if (to === this.position && from !== to) ac.incoming = this.time;
      if (from === this.position && to !== from) { ac.outgoing = { to: POSITIONS[to].short, t: this.time }; ac.incoming = null; }
    }
    ac._pred = null;
    if (to === 'CTR') return this.handOff(ac, ai || silent);
    const scored = !ai && !silent;
    const d = Math.hypot(ac.x, ac.y);
    if (from === 'TWR' && to === 'APP' && !ac.isArr) {
      if (scored) {
        this.stats.departed++;
        if (ac.alt <= 5000 && d < 12) this.addScore(30, `${ac.cs} transferred to Departure`);
        else this.addScore(10, `${ac.cs} transferred to Departure late`);
      }
      this.pilotSay(ac, `Ravenwood Departure, passing ${Math.round(ac.alt / 100) * 100} ft climbing ${ac.altWords(ac.tgtAlt)}, ${ac.sid}`);
    }
    if (from === 'APP' && to === 'TWR' && ac.isArr) {
      if (scored) this.addScore(ac.est ? 20 : 10, `${ac.cs} transferred to Tower${ac.est ? '' : ' (not yet established)'}`);
      if (!silent) this.pilotSay(ac, `Ravenwood Tower, ILS ${ac.rwy}${ac.est ? ' established' : ''}, ${ac.finalGeometry().along.toFixed(0)} miles`);
    }
    // Ground -> Tower at the holding point; Tower -> Ground after vacating.
    if (from === 'GND' && to === 'TWR' && !ac.isArr) {
      if (scored) this.stats.departed++;
      if (scored) this.addScore(ac.state === 'ground' ? 10 : 5, `${ac.cs} transferred to Tower`);
      if (!silent) this.pilotSay(ac, ac.state === 'ground'
        ? `Ravenwood Tower, holding point ${ac.gnode}, runway ${ac.rwy}, ready for departure`
        : `Ravenwood Tower, taxiing to holding point ${ac.taxiTarget}, runway ${ac.rwy}`);
      ac.waitSince = this.time;
    }
    if (from === 'TWR' && to === 'GND' && ac.isArr) {
      if (scored) this.addScore(10, `${ac.cs} transferred to Ground`);
      if (!silent) this.pilotSay(ac, `Ravenwood Ground, vacated via ${ac.vacatedVia || 'the runway'}, request taxi to stand ${ac.stand}`);
      ac.waitSince = this.time;
    }
    ac.transferWarned = false;
  }

  // ---------- ground events ----------
  // At the runway holding point Ground hands the departure to Tower automatically.
  onReachedHoldingPoint(ac) {
    ac.waitSince = this.time;
    if (ac.owner !== 'GND') {
      this.pilotSay(ac, `holding point ${ac.gnode}, runway ${ac.rwy}, ready for departure`);
      return;
    }
    if (this.userOwns(ac) && this.position !== 'ALL') {
      if (this.position === 'GND') this.stats.departed++;
      this.addScore(10, `${ac.cs} taxied to holding point ${ac.gnode}`);
    }
    if (this.position !== 'ALL') this.log(`Ravenwood Ground: ${ac.cs}, holding point ${ac.gnode}, contact Tower ${POSITIONS.TWR.freq}`, this.userOwns(ac) ? 'sys' : 'ai');
    this.transfer(ac, 'TWR', { ai: true, silent: this.position === 'ALL' });
    if (this.position === 'ALL') this.pilotSay(ac, `holding point ${ac.gnode}, runway ${ac.rwy}, ready for departure`);
  }

  // Once an arrival is clear of the runway, Tower hands it to Ground automatically.
  onVacated(ac) {
    ac.waitSince = this.time;
    if (ac.owner !== 'TWR') {
      this.pilotSay(ac, `vacated via ${ac.vacatedVia}, request taxi to stand ${ac.stand}`);
      return;
    }
    if (this.position !== 'ALL') this.log(`Ravenwood Tower: ${ac.cs}, vacated via ${ac.vacatedVia}, contact Ground ${POSITIONS.GND.freq}`, this.userOwns(ac) ? 'sys' : 'ai');
    this.transfer(ac, 'GND', { ai: true, silent: this.position === 'ALL' });
    if (this.position === 'ALL') this.pilotSay(ac, `vacated via ${ac.vacatedVia}, request taxi to stand ${ac.stand}`);
  }

  onParked(ac) {
    this.log(`${ac.cs} on stand ${ac.stand}`, 'sys');
    if (this.userOwns(ac) && this.position !== 'ALL') this.addScore(10, `${ac.cs} taxied to stand ${ac.stand}`);
  }

  setPosition(p) {
    if (p === this.position) return;
    this.position = p;
    const desc = {
      ALL: 'You control everything: ground, tower and approach.',
      GND: 'You are Ground: clearances (caf), pushback (pb) and taxi to the holding point, then transfer to Tower (ho); arrivals call you after vacating — taxi them to their stand. AI works Tower and Approach.',
      TWR: 'You are Tower: line-up and take-off, transfer departures to Departure (ho); landing clearances (cl) and transfer vacated arrivals to Ground (ho). AI works Ground and Approach.',
      APP: 'You are Approach/Departure: arrivals to the ILS then transfer to Tower (ho), departures after take-off up to Control (ho). AI works Ground and Tower.',
    }[p];
    this.log(`Position: ${POSITIONS[p].name}. ${desc}`, 'sys');
    this.radar.zoomFor(p);
    this.viewMode = p === 'GND' ? 'ground' : 'radar';
    this.autoTaxi = p === 'ALL'; // Ground players taxi their own traffic
    if (this.selected && !this.userOwns(this.selected)) this.select(null);
    this.ui.update();
  }

  handOff(ac, ai = false) {
    ac.handedOff = true;
    ac.owner = 'CTR';
    if (ac.isArr) return;
    ac.tgtAlt = Math.max(ac.tgtAlt, 30000);
    ac.tgtSpd = null;
    if (ac.mode !== 'route' && ac.route.length) { ac.mode = 'route'; ac.hold = null; }
    if (ai) return;
    const d = Math.hypot(ac.x, ac.y);
    this.stats.departed++;
    if (d >= 20 && ac.alt >= 10000) this.addScore(100, `${ac.cs} handed off`);
    else if (ac.alt >= SID_TOP) this.addScore(50, `${ac.cs} handed off (low/early — climb them higher first)`);
    else this.addScore(20, `${ac.cs} handed off very early`);
  }

  // Landing clearance with the runway occupied is only a warning: the controller expects it to clear in time.
  warnRunwayOccupied(ac) {
    const busy = this.runwayOccupant(ac);
    if (busy) this.log(`Note: runway ${ac.rwy} is occupied by ${busy.cs} — make sure it is clear before ${ac.cs} arrives`, 'sys');
  }

  runwayOccupant(ac) {
    return this.aircraft.find((o) => o !== ac && o.runway?.phys === ac.runway.phys &&
      (['lineup', 'takeoff', 'landed'].includes(o.state) || (o.state === 'taxi' && o.vacating) || (o.airborne && !o.isArr && o.alt < 300)));
  }

  // An arrival reaching the threshold with the runway still occupied must go around.
  checkLandingRunways() {
    for (const ac of this.aircraft) {
      if (!ac.isArr || !ac.est || ac.rwyChecked || ac.finalGeometry().along > 0.6) continue;
      ac.rwyChecked = true;
      const busy = this.runwayOccupant(ac);
      if (!busy) continue;
      if (this.userOwns(ac) || this.userOwns(busy)) this.addScore(-50, `Runway ${ac.rwy} occupied by ${busy.cs} with ${ac.cs} on short final`);
      ac.goAround(this, `runway occupied by ${busy.cs}, going around`);
    }
  }

  checkRunwayClear(ac) {
    const busy = this.aircraft.find((o) => o !== ac && o.runway?.phys === ac.runway.phys && (
      ['lineup', 'takeoff', 'landed'].includes(o.state) || (o.state === 'taxi' && o.vacating) ||
      (o.est && o.finalGeometry().along < 2.5) ||
      (o.state === 'air' && !o.isArr && o.alt < 300)));
    if (busy) this.addScore(-50, `Runway ${ac.rwy} not clear — ${busy.cs} is on the runway / short final`);
  }

  checkBoundaries() {
    for (const ac of this.aircraft) {
      if (ac.state !== 'air') continue;
      if (Math.hypot(ac.x, ac.y) > AIRPORT.radarRange) {
        ac.state = 'gone';
        if ((!ac.isArr && ac.handedOff) || !this.userOwns(ac)) continue;
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
          if (!this.conflictPairs.has(key) && this.blame(a, b)) {
            this.stats.losses++;
            this.addScore(-50, `Separation lost: ${a.cs} / ${b.cs} (${h.toFixed(1)} nm, ${Math.round(v)} ft)`);
          }
        } else if (this.predictConflict(a, b)) {
          a.conflict = Math.max(a.conflict, 1);
          b.conflict = Math.max(b.conflict, 1);
        }
      }
    }
    this.checkWake(air, now);
    this.conflictPairs = now;
  }

  // Wake turbulence spacing on final: 4 nm behind a heavy for a heavy, 5 nm for a medium.
  checkWake(air, now) {
    const finals = air.filter((a) => a.est);
    for (const a of finals) {
      for (const b of finals) {
        if (a === b || a.rwy !== b.rwy || a.wake !== 'H') continue;
        const la = a.finalGeometry().along, lb = b.finalGeometry().along;
        if (lb <= la) continue; // b must be behind a
        const need = b.wake === 'H' ? 4 : 5;
        const d = Geo.dist(a, b);
        if (d >= need) continue;
        b.conflict = Math.max(b.conflict, 1);
        const key = `wake|${a.cs}|${b.cs}`;
        now.add(key);
        if (!this.conflictPairs.has(key) && this.userOwns(b)) {
          this.stats.losses++;
          this.addScore(-30, `Wake turbulence: ${b.cs} is ${d.toFixed(1)} nm behind heavy ${a.cs} (need ${need} nm)`);
        }
      }
    }
  }

  // Does a separation loss count against the player? Only if one aircraft is theirs, and not
  // when it is an in-trail arrival pair whose trailing aircraft is still with the AI.
  blame(a, b) {
    if (!this.userOwns(a) && !this.userOwns(b)) return false;
    if (a.isArr && b.isArr && a.rwy === b.rwy) {
      const trail = this.ai.remaining(a) > this.ai.remaining(b) ? a : b;
      if (!this.userOwns(trail)) return false;
    }
    return true;
  }

  exempt(a, b) {
    if (a.est && b.est && a.rwy !== b.rwy) return true; // independent parallel approaches
    // Departures from the parallel runways on tracks diverging by 15° or more.
    if (!a.isArr && !b.isArr && a.rwy !== b.rwy && a.alt < 6000 && b.alt < 6000 &&
        Math.hypot(a.x, a.y) < 10 && Math.abs(Geo.diff(a.track(), b.track())) >= 15) return true;
    const near = (x) => Math.hypot(x.x, x.y) < 6 && x.alt < 2500;
    return near(a) && near(b) && (a.isArr !== b.isArr || a.rwy !== b.rwy);
  }

  // Simple short-term conflict alert: straight-line projection up to 90 s.
  predictConflict(a, b) {
    // Skip pairs that cannot close to 3 nm / 1000 ft within the look-ahead.
    if (Geo.dist(a, b) > 3 + ((a.gs_kt() + b.gs_kt()) / 3600) * 90) return false;
    if (Math.abs(a.alt - b.alt) > 950 + ((a.perf.climb + b.perf.desc) / 60) * 90 * 1.6) return false;
    const proj = (ac, t) => {
      const p = Geo.offset(ac, ac.track(), (ac.gs_kt() / 3600) * t);
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

  // Calls on a frequency the player isn't working (AI-controlled) are shown dimmed and not spoken.
  pilotSay(ac, text, ai = !this.userOwns(ac)) {
    this.log(`${ac.cs}: ${text}`, ai ? 'ai' : 'pilot');
    if (!ai && this.voice && window.speechSynthesis) {
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

  setView(mode) {
    this.viewMode = mode;
    this.ui.update();
  }

  togglePause() { this.paused = !this.paused; this.log(this.paused ? 'Simulation paused' : 'Simulation resumed', 'sys'); this.ui.update(); }
  setRate(r) { this.rate = r; this.log(`Simulation rate x${r}`, 'sys'); this.ui.update(); }
  setTraffic(t) { this.traffic = t; this.log(`Traffic density: ${t}`, 'sys'); this.nextArr = Math.min(this.nextArr, this.time + 10); this.ui.update(); }
  setConfig(c) {
    if (c === this.config) return;
    this.config = c;
    this.atis = String.fromCharCode(((this.atis.charCodeAt(0) - 65 + 1) % 26) + 65);
    this.windBase.dir = Geo.norm(this.windBase.dir + 180);
    // Departures still on the ground switch to the new runway direction and a matching SID;
    // those taxiing or at a holding point are re-routed to the new holding point.
    for (const a of this.aircraft) {
      if (a.isArr || !['stand', 'pushback', 'taxi', 'ground', 'lineup'].includes(a.state)) continue;
      const exit = a.route[a.route.length - 1];
      const sid = PROCS[c].sids.find((s) => s.fixes[s.fixes.length - 1] === exit);
      Object.assign(a, { rwy: sid.rwy, sid: sid.name, route: sid.fixes.slice() });
      if (a.state === 'ground' || a.state === 'lineup') { a.state = 'taxi'; a.taxiPath = []; a.gnode = a.gnode || GROUND.nearestNode(a); }
      if (a.state === 'taxi' && (a.taxiPath.length || a.taxiTarget)) a.startTaxi(GROUND.holdingPoints[a.rwy]);
    }
    this.log(`Runway configuration changed: ${this.activeRunways().join(' & ')} in use, information ${this.atis}, wind ${this.windText()}. New arrivals will use the new STARs; vector existing traffic as needed.`, 'sys');
    this.ui.update();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.game = new Game(document.getElementById('radar'));
});
