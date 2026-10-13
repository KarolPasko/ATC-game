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
    this.emergency = new EmergencyManager(this);
    this.position = 'ALL';
    this.viewMode = 'radar'; // radar | ground
    this.autoTaxi = true; // AI ground handles taxiing for the player's aircraft
    this.radar = new Radar(canvas, this);
    this.ui = new UI(this);
    this.voice = false;
    this.restart();
    this.ui.initSetup?.();
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
    if (!CONFIGS[this.config]) this.config = AIRPORT.defaultConfig;
    this.traffic = this.traffic || 'med';
    this.score = 0;
    this.stats = { landed: 0, departed: 0, losses: 0, goArounds: 0 };
    this.conflictPairs = new Set();
    this.ai.lastTakeoff = {};
    this.emergency.reset();
    this.nextArr = 5;
    this.nextDep = 15;
    this.nextGA = 60 + Math.random() * 240;
    this.lastLanding = {}; // physical runway -> { t, wake } of the last medium / heavy landing (wake for light aircraft)
    this.atis = 'K';
    AIRPORT.qnh = 1003 + Math.floor(Math.random() * 25);
    const temp = 8 + Math.floor(Math.random() * 13);
    this.wx = { cloud: rnd(['FEW030', 'SCT025', 'BKN035', 'FEW040 SCT120', 'SCT018 BKN045']), t: temp, td: temp - 3 - Math.floor(Math.random() * 6) };
    WIND.dir = Geo.norm(CONFIGS[this.config].wind - 15 + Math.floor(Math.random() * 30));
    WIND.spd = 6 + Math.floor(Math.random() * 12);
    this.windBase = { ...WIND };
    this.ui.clearLog();
    this.log(`Welcome to ${AIRPORT.name} (${AIRPORT.icao}). Runways ${this.activeRunways().join(' & ')} in use.`, 'sys');
    this.log(`Information ${this.atis}: wind ${this.windText()}, QNH ${AIRPORT.qnh}, transition altitude ${AIRPORT.transAlt} ft.`, 'sys');
    this.log('Click an aircraft (or type its callsign) and enter commands below. Type .help for the command list.', 'sys');
    // Start with traffic already in the sky: a few arrivals part-way in, one at the boundary, departures on stands.
    for (const f of [0.25, 0.45, 0.65].slice(0, this.traffic === 'low' ? 2 : 3)) this.spawnArrival(f + Math.random() * 0.1);
    this.spawnArrival();
    this.spawnDeparture();
    if (this.traffic !== 'low') this.spawnDeparture();
  }

  activeRunways() { const c = CONFIGS[this.config]; return [...new Set([...c.arr, ...c.dep])]; }
  arrivalRunways() { return CONFIGS[this.config].arr; }
  departureRunways() { return CONFIGS[this.config].dep; }

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
    this.emergency.update();
    this.checkBoundaries();
    this.checkLandingRunways();
    this.sepTimer = (this.sepTimer || 0) + dt;
    if (this.sepTimer >= 1) { this.sepTimer = 0; this.checkSeparation(); }
    if (this.selected && this.selected.state === 'gone') this.select(null);
    this.aircraft = this.aircraft.filter((a) => a.state !== 'gone');

    const t = TRAFFIC[this.traffic];
    const airborne = this.aircraft.filter((a) => a.state === 'air').length;
    if (this.time >= this.nextArr) {
      if (airborne < 18) this.spawnArrival();
      // Arrivals come in random gaps, sometimes as a bunch from different directions (an inbound wave).
      // A single arrival runway takes fewer arrivals than a pair of parallels.
      const mean = t.arr * (this.arrivalRunways().length > 1 ? 1 : 1.7);
      this.nextArr = this.time + (Math.random() < 0.1 ? 40 + Math.random() * 30 : this.randomGap(mean));
    }
    if (this.time >= this.nextGA) {
      this.spawnGA();
      this.nextGA = this.time + this.randomGap(900);
    }
    if (this.time >= this.nextDep) {
      this.spawnDeparture();
      this.nextDep = this.time + this.randomGap(t.dep);
    }
  }

  // ---------- traffic generation ----------
  // A random flight: operator (weighted by how common it is), callsign and a type from its fleet.
  newFlight() {
    for (;;) {
      const al = rnd(AIRLINE_POOL);
      const n = Math.random() < 0.55 ? Math.floor(Math.random() * 900 + 100) : Math.floor(Math.random() * 90 + 10);
      const cs = al.icao + n + (Math.random() < 0.3 ? rnd(['A', 'B', 'C', 'G', 'K', 'W', 'X', 'Y']) : '');
      if (!this.aircraft.some((a) => a.cs === cs)) return { cs, type: rnd(al.fleet) };
    }
  }

  // Exponential gaps between spawns (a Poisson process), kept within sensible bounds.
  randomGap(mean) { return Geo.clamp(-Math.log(1 - Math.random()) * mean, 0.25 * mean, 3 * mean); }

  newSquawk() {
    for (;;) {
      const s = String(Math.floor(Math.random() * 8)) + Array.from({ length: 3 }, () => Math.floor(Math.random() * 8)).join('');
      if (!this.aircraft.some((a) => a.squawk === s) && !['7500', '7600', '7700', '7000', '2000'].includes(s)) return s;
    }
  }

  // A new arrival on a random STAR. With `along` (0-1) it starts part-way along its route (used at the start of a
  // session so the airspace is already busy), at a level that fits how far in it is.
  spawnArrival(along = 0) {
    let stars = PROCS[this.config].stars.filter((s) => {
      const e = FIXES[s.fixes[0]];
      return !this.aircraft.some((a) => a.state === 'air' && Geo.dist(a, e) < 12);
    });
    if (!stars.length) return null;
    // While light aircraft are in the circuit, new IFR arrivals go to the other runway when there is one.
    const cct = new Set(this.aircraft.filter((a) => a.vfr && !['gone', 'parked'].includes(a.state)).map((a) => a.runway?.phys));
    const clear = stars.filter((s) => !cct.has(RUNWAYS[s.rwy]?.phys));
    if (clear.length) stars = clear;
    const star = rnd(stars);
    const route = starRoute(star);
    const path = [FIXES[star.fixes[0]], ...route.map((n) => FIXES[n])];
    // Position along the STAR (before the approach fixes).
    let pos = path[0], hdgTo = path[1], rest = route.slice();
    if (along > 0) {
      const legs = Math.max(1, star.fixes.length - 1);
      let target = along * path.slice(0, legs + 1).reduce((d, p, i, arr) => d + (i ? Geo.dist(arr[i - 1], p) : 0), 0);
      for (let i = 1; i <= legs; i++) {
        const L = Geo.dist(path[i - 1], path[i]);
        if (target <= L) { pos = Geo.offset(path[i - 1], Geo.bearing(path[i - 1], path[i]), target); hdgTo = path[i]; rest = route.slice(i - 1); break; }
        target -= L;
      }
    }
    const d = Math.hypot(pos.x, pos.y);
    // Entry level depends on how far out the entry is (the further, the higher), from 7000 ft up to FL190.
    const top = Geo.clamp(Math.round(d * 0.38) * 1000, 9000, 19000);
    let alt = along > 0 ? Geo.clamp(Math.round((d * 300 + 1000) / 1000) * 1000, 7000, 16000) : top - Math.floor(Math.random() * Math.min(7, top / 1000 - 7)) * 1000;
    // Don't appear on top of someone: pick a free level or give up this time.
    const clash = (h) => this.aircraft.some((a) => a.state === 'air' && Geo.dist(a, pos) < 8 && Math.abs(a.alt - h) < 1500);
    if (clash(alt)) alt += 2000;
    if (clash(alt)) return null;
    const { cs, type } = this.newFlight();
    const ac = new Aircraft({
      cs, type, kind: 'arr',
      x: pos.x, y: pos.y, alt, tgtAlt: alt, spd: Math.min(TYPES[type].max - 20, (alt < 10000 ? 240 : 260) + Math.floor(Math.random() * 5) * 10),
      rwy: star.rwy, star: star.name, route: rest, altCons: star.alts || {},
      orig: rnd(OUTSTATIONS[FIX_DIRECTION[star.fixes[0]]]), dest: AIRPORT.icao,
      squawk: this.newSquawk(), cleared: true, owner: 'APP',
    });
    ac.hdg = ac.tgtHdg = Geo.bearing(pos, hdgTo);
    this.aircraft.push(ac);
    ac.say(this, `${AIRPORT.city} Approach, good day, ${ac.altWords(alt)}, ${star.name} arrival, expecting runway ${star.rwy}`);
    return ac;
  }

  // Departures start at a free stand and call Delivery for their clearance.
  spawnDeparture() {
    const onGround = this.aircraft.filter((a) => !a.isArr && ['stand', 'pushback', 'taxi', 'ground', 'lineup'].includes(a.state));
    if (onGround.length >= 7) return;
    const stand = this.freeStand();
    if (!stand) return;
    const flight = this.newFlight();
    const sid = rnd(PROCS[this.config].sids.filter((s) => sidAllowed(s, flight.type)));
    const st = GROUND.stands[stand];
    const n = GROUND.nodes[st.node];
    const ac = new Aircraft({
      ...flight, kind: 'dep',
      x: n.x, y: n.y, alt: 0, tgtAlt: 0, spd: 0,
      state: 'stand', stand, gnode: st.node, rwy: sid.rwy, sid: sid.name, route: sid.fixes.slice(),
      orig: AIRPORT.icao, dest: rnd(OUTSTATIONS[FIX_DIRECTION[sid.fixes[sid.fixes.length - 1]]]),
      squawk: this.newSquawk(), cleared: false, spawnTime: this.time, owner: 'GND',
      cruise: rnd([240, 280, 320, 360]),
    });
    ac.hdg = ac.tgtHdg = st.hdg; // nose-in
    this.aircraft.push(ac);
    ac.say(this, `${AIRPORT.city} Delivery, stand ${stand}, information ${this.atis}, IFR to ${ac.dest}, request clearance`);
  }

  // A free stand: airline stands, or the GA ramp for light aircraft.
  freeStand(ga = false) {
    const used = new Set(this.aircraft.filter((a) => a.stand && a.state !== 'gone' &&
      (a.isArr || a.state === 'stand' || a.state === 'pushback')).map((a) => a.stand));
    const free = Object.keys(GROUND.stands).map(Number).filter((n) => !used.has(n) && !!GROUND.stands[n].ga === ga);
    return free.length ? rnd(free) : null;
  }

  // ---------- general aviation ----------
  // A light aircraft on the GA ramp wanting circuits. Few at a time (the airport's cap for the traffic level), and only
  // when a GA stand is free.
  spawnGA() {
    const ga = AIRPORT.ga;
    if (!ga) return null;
    const cap = ga.cap?.[this.traffic] ?? 1;
    if (this.aircraft.filter((a) => a.vfr && a.state !== 'gone').length >= cap) return null;
    const rwy = ga.runway[this.config];
    const stand = rwy && this.freeStand(true);
    if (!stand) return null;
    const pool = Object.entries(GA_FLEET).flatMap(([t, w]) => Array(w).fill(t));
    const type = rnd(pool);
    let cs;
    do cs = `G-${rnd(['B', 'C', 'D', 'E', 'O', 'S', 'U', 'Z'])}${Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('')}`;
    while (this.aircraft.some((a) => a.cs === cs));
    const st = GROUND.stands[stand], n = GROUND.nodes[st.node];
    const circuits = 2 + Math.floor(Math.random() * 4);
    const ac = new Aircraft({
      cs, type, kind: 'dep', vfr: true, circuits,
      x: n.x, y: n.y, alt: 0, tgtAlt: 0, spd: 0,
      state: 'stand', stand, gnode: st.node, rwy, sid: 'VFR', route: [],
      orig: AIRPORT.icao, dest: AIRPORT.icao, squawk: '7010', cleared: false, spawnTime: this.time, owner: 'GND',
    });
    ac.hdg = ac.tgtHdg = Geo.bearing(n, GROUND.nodes[st.lane]); // parked facing out, ready to taxi
    this.aircraft.push(ac);
    ac.say(this, `${AIRPORT.city} Ground, ${cs}, ${GA_NAMES[type]} on the GA ramp, stand ${stand}, information ${this.atis}, request taxi for ${circuits} circuits`);
    return ac;
  }

  // Circuit radio calls ("downwind, touch and go" / "final, full stop").
  circuitCall(ac, leg) {
    const c = ac.circuit;
    if (!c) return;
    if (leg === 'downwind') this.pilotSay(ac, `downwind, ${ac.circuitIntent()}`);
    else if (leg === 'final' && !c.clr) this.pilotSay(ac, `final, ${ac.circuitIntent()}`);
  }

  onTouchAndGo(ac) {
    this.checkLightWake(ac);
    this.log(`${ac.cs} touch and go runway ${ac.rwy}`, 'sys');
    if (this.userOwns(ac) && this.position !== 'ALL') this.addScore(10, `${ac.cs} circuit flown`);
  }

  // Light aircraft landing too soon behind a medium or heavy: 2 minutes behind a medium, 3 behind a heavy.
  checkLightWake(ac) {
    const last = this.lastLanding[ac.runway.phys];
    if (!last) return;
    const need = last.wake === 'H' ? 180 : 120, gap = this.time - last.t;
    if (gap < need && this.userOwns(ac)) {
      this.stats.losses++;
      this.addScore(-30, `Wake turbulence: ${ac.cs} touched down ${Math.round(gap)} s behind ${last.type} ${last.cs} (need ${need / 60} min)`);
    }
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
    ac.stand = this.freeStand(!!ac.vfr);
    this.stats.landed++;
    if (ac.vfr) {
      this.checkLightWake(ac);
      if (this.userOwns(ac)) this.addScore(30, `${ac.cs} circuits complete, full stop runway ${ac.rwy}`);
      return;
    }
    if (ac.wake !== 'L') this.lastLanding[ac.runway.phys] = { t: this.time, wake: ac.wake, cs: ac.cs, type: ac.type };
    this.addScore(100, `${ac.cs} landed runway ${ac.rwy}`);
  }

  onGoAround(ac) {
    if (this.userOwns(ac)) {
      this.stats.goArounds++;
      this.addScore(-10, `${ac.cs} go-around`);
    }
    if (ac.vfr) return; // circuit traffic stays with Tower
    // Tower hands a missed approach straight back to Approach for re-sequencing.
    if (ac.owner === 'TWR') {
      ac.owner = 'APP';
      if (this.position !== 'ALL') this.log(`${AIRPORT.city} Tower: ${ac.cs} going around, transferred back to Approach`, 'sys');
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
      this.pilotSay(ac, `${AIRPORT.city} Departure, passing ${Math.round(ac.alt / 100) * 100} ft climbing ${ac.altWords(ac.tgtAlt)}, ${ac.sid}`);
    }
    if (from === 'APP' && to === 'TWR' && ac.isArr) {
      if (scored) this.addScore(ac.est ? 20 : 10, `${ac.cs} transferred to Tower${ac.est ? '' : ' (not yet established)'}`);
      if (!silent) this.pilotSay(ac, `${AIRPORT.city} Tower, ILS ${ac.rwy}${ac.est ? ' established' : ''}, ${ac.finalGeometry().along.toFixed(0)} miles`);
    }
    // Ground -> Tower at the holding point; Tower -> Ground after vacating.
    if (from === 'GND' && to === 'TWR' && !ac.isArr) {
      if (scored) this.stats.departed++;
      if (scored) this.addScore(ac.state === 'ground' ? 10 : 5, `${ac.cs} transferred to Tower`);
      if (!silent) this.pilotSay(ac, ac.state === 'ground'
        ? `${AIRPORT.city} Tower, holding point ${ac.gnode}, runway ${ac.rwy}, ready for departure`
        : `${AIRPORT.city} Tower, taxiing to holding point ${ac.taxiTarget}, runway ${ac.rwy}`);
      ac.waitSince = this.time;
    }
    if (from === 'TWR' && to === 'GND' && ac.isArr) {
      if (scored) this.addScore(10, `${ac.cs} transferred to Ground`);
      if (!silent) this.pilotSay(ac, `${AIRPORT.city} Ground, vacated via ${ac.vacatedVia || 'the runway'}, request taxi to stand ${ac.stand}`);
      ac.waitSince = this.time;
    }
    ac.transferWarned = false;
  }

  // ---------- ground events ----------
  // At the runway holding point Ground hands the departure to Tower automatically.
  onReachedHoldingPoint(ac) {
    ac.waitSince = this.time;
    const ready = `holding point ${ac.gnode}, runway ${ac.rwy}, ready for departure${ac.vfr ? ', for circuits' : ''}`;
    if (ac.owner !== 'GND') {
      this.pilotSay(ac, ready);
      return;
    }
    if (this.userOwns(ac) && this.position !== 'ALL') {
      if (this.position === 'GND') this.stats.departed++;
      this.addScore(10, `${ac.cs} taxied to holding point ${ac.gnode}`);
    }
    if (this.position !== 'ALL') this.log(`${AIRPORT.city} Ground: ${ac.cs}, holding point ${ac.gnode}, contact Tower ${POSITIONS.TWR.freq}`, this.userOwns(ac) ? 'sys' : 'ai');
    this.transfer(ac, 'TWR', { ai: true, silent: this.position === 'ALL' });
    if (this.position === 'ALL') this.pilotSay(ac, ready);
  }

  // A departure stopped at a holding point before a runway it has to cross: Ground hands it to Tower, who owns
  // the runway, and the pilot asks for the crossing.
  onHoldingShort(ac) {
    ac.waitSince = this.time;
    const rwy = GROUND.runwayName(GROUND.nodes[ac.holdShort].phys, this);
    if (ac.owner === 'GND') {
      if (this.userOwns(ac) && this.position !== 'ALL') {
        if (this.position === 'GND' && !ac.isArr) this.stats.departed++;
        this.addScore(10, `${ac.cs} taxied to holding point ${ac.gnode}`);
      }
      if (this.position !== 'ALL') this.log(`${AIRPORT.city} Ground: ${ac.cs}, hold short runway ${rwy} at ${ac.gnode}, contact Tower ${POSITIONS.TWR.freq}`, this.userOwns(ac) ? 'sys' : 'ai');
      this.transfer(ac, 'TWR', { ai: true, silent: true });
      if (this.position === 'TWR') ac.incoming = this.time;
      this.pilotSay(ac, `${this.position === 'ALL' ? '' : `${AIRPORT.city} Tower, `}holding short runway ${rwy} at ${ac.gnode}, request crossing`);
    } else {
      this.pilotSay(ac, `holding short runway ${rwy} at ${ac.gnode}, request crossing`);
    }
  }

  // Traffic that makes a runway crossing at node n unsafe now: taking off or lining up to go, just airborne, landing
  // within `finalNm` (established), still rolling towards the crossing (unless it turns off before it), or vacating
  // right at it.
  crossingTraffic(ac, n, finalNm = 0) {
    const before = (o, u) => (n.u - u) * o.runway.dirU > -80;
    return this.aircraft.find((o) => o !== ac && o.runway?.phys === n.phys && (
      o.state === 'takeoff' || o.state === 'touchgo' || (o.state === 'lineup' && (o.lining || o.ctoPending)) || (!o.isArr && o.airborne && o.alt < 300) ||
      ((o.est || ['base', 'final'].includes(o.circuit?.phase)) && finalNm > 0 && o.finalGeometry().along < finalNm) ||
      (o.state === 'landed' && before(o, toLocal(o).u) && (!o.exit || !before(o, o.exit.u + o.runway.dirU * 100))) ||
      (o.state === 'taxi' && o.vacating && Geo.dist(o, n) * GROUND.M_PER_NM < 150))) || null;
  }

  // Crossing clearance given by the player: penalised if traffic is landing, departing or rolling through the crossing.
  checkCrossing(ac, phys) {
    const n = GROUND.nodes[ac.holdShort || ac.taxiPath[ac.crossStop() - 1]] || GROUND.nodes[ac.gnode];
    const busy = this.crossingTraffic(ac, { ...n, phys }, 1.5);
    if (busy) this.addScore(-50, `Runway ${GROUND.runwayName(phys, this)} crossing — ${busy.cs} is landing or departing`);
  }

  onCrossed(ac, rwy) {
    this.pilotSay(ac, `runway ${rwy} vacated`, !this.userOwns(ac));
    // An arrival crossing on its way to the stand goes back to Ground once across.
    if (ac.isArr && ac.owner === 'TWR') {
      if (this.position !== 'ALL') this.log(`${AIRPORT.city} Tower: ${ac.cs}, contact Ground ${POSITIONS.GND.freq}`, this.userOwns(ac) ? 'sys' : 'ai');
      this.transfer(ac, 'GND', { ai: true, silent: true });
    }
  }

  // Once an arrival is clear of the runway, Tower hands it to Ground automatically.
  onVacated(ac) {
    ac.waitSince = this.time;
    if (ac.emg && !ac.emg.done) { ac.emg.done = true; ac.squawk = ac.emg.oldSquawk; }
    if (ac.owner !== 'TWR') {
      this.pilotSay(ac, `vacated via ${ac.vacatedVia}, request taxi to stand ${ac.stand}`);
      return;
    }
    if (this.position !== 'ALL') this.log(`${AIRPORT.city} Tower: ${ac.cs}, vacated via ${ac.vacatedVia}, contact Ground ${POSITIONS.GND.freq}`, this.userOwns(ac) ? 'sys' : 'ai');
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
    else if (ac.alt >= AIRPORT.sidTop) this.addScore(50, `${ac.cs} handed off (low/early — climb them higher first)`);
    else this.addScore(20, `${ac.cs} handed off very early`);
  }

  // Landing clearance with the runway occupied is only a warning: the controller expects it to clear in time.
  warnRunwayOccupied(ac) {
    const busy = this.runwayOccupant(ac);
    if (busy) this.log(`Note: runway ${ac.rwy} is occupied by ${busy.cs} — make sure it is clear before ${ac.cs} arrives`, 'sys');
  }

  runwayOccupant(ac) {
    const phys = ac.runway.phys;
    return this.aircraft.find((o) => o !== ac && ((o.crossing === phys) || (o.runway?.phys === phys &&
      (['lineup', 'takeoff', 'landed', 'touchgo'].includes(o.state) || (o.state === 'taxi' && o.vacating) || (o.airborne && !o.isArr && o.alt < 300)))));
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

  // Line-up or take-off clearance with the runway not clear. Lining up behind landing traffic that is already well down
  // the runway is allowed (as the AI tower does); only traffic still near the threshold counts then.
  checkRunwayClear(ac, lineUp = false) {
    const behind = (o) => lineUp && o.finalGeometry(ac.runway).along < -0.35;
    const busy = this.aircraft.find((o) => o !== ac && (o.crossing === ac.runway.phys || (o.runway?.phys === ac.runway.phys && (
      ['lineup', 'takeoff', 'touchgo'].includes(o.state) || ((o.state === 'landed' || (o.state === 'taxi' && o.vacating)) && !behind(o)) ||
      (o.est && o.finalGeometry().along < 2.5) || (o.circuit?.phase === 'final' && o.finalGeometry().along < 1) ||
      (o.state === 'air' && !o.isArr && o.alt < 300)))));
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
        if (a.vfr || b.vfr) { this.checkAirprox(a, b, now); continue; }
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

  // VFR circuit traffic is not separated like IFR traffic (class D: traffic information), but an airprox counts.
  checkAirprox(a, b, now) {
    // Aircraft lined up on finals to different (parallel) runways are not in conflict.
    const onFinal = (x) => x.est || ['base', 'final'].includes(x.circuit?.phase);
    if (onFinal(a) && onFinal(b) && a.rwy !== b.rwy) return;
    const h = Geo.dist(a, b), v = Math.abs(a.alt - b.alt);
    if (h < 1 && v < 600) { a.conflict = Math.max(a.conflict, 1); b.conflict = Math.max(b.conflict, 1); }
    if (h >= 0.3 || v >= 300) return;
    a.conflict = b.conflict = 2;
    const key = `airprox|${[a.cs, b.cs].sort().join('|')}`;
    now.add(key);
    if (!this.conflictPairs.has(key) && this.blame(a, b)) {
      this.stats.losses++;
      this.addScore(-50, `Airprox: ${a.cs} / ${b.cs} (${(h * 1852).toFixed(0)} m, ${Math.round(v)} ft)`);
    }
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
    // Independent parallel approaches: established, or on the published arc / IF onto the final.
    const joining = (x) => {
      if (x.est) return true;
      const ap = APPROACHES[x.rwy], from = x.leg?.fromName;
      if (!ap || !x.app || x.mode !== 'route' || !from) return false;
      return (x.route[0] === ap.if && !!ARCS[`${from}>${ap.if}`]) || (x.route[0] === ap.faf && from === ap.if);
    };
    if (joining(a) && joining(b) && a.rwy !== b.rwy) return true;
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
    const bare = (cs) => cs.replace(/-/g, ''); // G-BXYZ also answers to GBXYZ
    const exact = this.aircraft.find((a) => a.cs === tok || bare(a.cs) === tok);
    if (exact) return exact;
    if (tok.length < 2) return null;
    const m = this.aircraft.filter((a) => a.cs.endsWith(tok) || a.cs.startsWith(tok) || bare(a.cs).startsWith(tok));
    return m.length === 1 ? m[0] : null;
  }

  select(ac) {
    this.selected = ac;
    this.ui.update();
  }

  log(text, cls = 'sys') { this.ui.log(text, cls, this.clock()); }

  // Calls on a frequency the player isn't working (AI-controlled) are shown dimmed and not spoken.
  pilotSay(ac, text, ai = !this.userOwns(ac)) {
    const emg = /^(MAYDAY|PAN PAN)/.test(text);
    this.log(`${ac.cs}: ${text}`, emg ? 'emg' : ai ? 'ai' : 'pilot');
    if ((!ai || emg) && this.voice && window.speechSynthesis) {
      const al = AIRLINES.find((a) => ac.cs.startsWith(a.icao));
      // Spoken like a pilot: telephony callsign then the digits/letters individually.
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
    const turned = Math.abs(Geo.diff(CONFIGS[c].wind, CONFIGS[this.config].wind)) > 90;
    this.config = c;
    this.atis = String.fromCharCode(((this.atis.charCodeAt(0) - 65 + 1) % 26) + 65);
    if (turned) this.windBase.dir = Geo.norm(this.windBase.dir + 180);
    // Departures still on the ground switch to the new runway direction and a matching SID;
    // those taxiing or at a holding point are re-routed to the new holding point.
    for (const a of this.aircraft) {
      if (a.isArr || !['stand', 'pushback', 'taxi', 'ground', 'lineup'].includes(a.state)) continue;
      if (a.vfr) {
        // Circuit traffic moves to the new circuit runway.
        const rwy = AIRPORT.ga?.runway[c];
        if (!rwy) continue;
        a.rwy = rwy;
      } else {
        // Same SID in the new direction if there is one, else the one ending nearest the old exit.
        const exit = a.route[a.route.length - 1];
        const ok = PROCS[c].sids.filter((s) => sidAllowed(s, a.type));
        const end = (s) => FIXES[s.fixes[s.fixes.length - 1]];
        const sid = ok.find((s) => end(s).name === exit) || ok.slice().sort((p, q) => Geo.dist(end(p), FIXES[exit]) - Geo.dist(end(q), FIXES[exit]))[0];
        if (!sid) continue;
        Object.assign(a, { rwy: sid.rwy, sid: sid.name, route: sid.fixes.slice() });
      }
      if (a.state === 'ground' || a.state === 'lineup') {
        if (a.state === 'lineup') a.gnode = a.hpNode;
        a.state = 'taxi'; a.taxiPath = []; a.lining = false; a.ctoPending = false; a.gp = null; a.gnode = a.gnode || GROUND.nearestNode(a);
      }
      if (a.state === 'taxi' && (a.taxiPath.length || a.taxiTarget)) a.startTaxi(GROUND.departureHold(a));
    }
    this.log(`Runway configuration changed: ${this.activeRunways().join(' & ')} in use, information ${this.atis}, wind ${this.windText()}. New arrivals will use the new STARs; vector existing traffic as needed.`, 'sys');
    this.ui.update();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.game = new Game(document.getElementById('radar'));
});
