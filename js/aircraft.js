// Aircraft model: flight dynamics, navigation, ILS, holding and path prediction.
const GS_FT_PER_NM = Math.tan(Geo.rad(3)) * 6076.12; // ~318 ft/nm
const MAX_BANK = 25; // deg

// Used when simulating a "ghost" copy of an aircraft for path prediction.
const SILENT_GAME = { log() {}, pilotSay() {}, onLanded() {}, onGoAround() {}, groundBlocker() { return null; }, onVacated() {}, onParked() {}, onReachedHoldingPoint() {}, circuitCall() {}, onTouchAndGo() {} };

class Aircraft {
  constructor(o) {
    Object.assign(this, {
      x: 0, y: 0, alt: 0, hdg: 0, spd: 0,
      tgtHdg: 0, turnDir: null, tgtAlt: 0, tgtSpd: null,
      mode: 'route', // route | heading | hold | loc
      route: [], hold: null,
      ils: false, app: false, est: false, gs: false,
      state: 'air', // ground | lineup | takeoff | air | landed | gone
      cleared: false, handedOff: false,
      trail: [], trailTimer: 0, conflict: 0, prevLateral: null,
      age: 0, endOfRouteWarned: false, calledDeparture: false,
      owner: 'APP', // controlling position: TWR | APP | CTR (handed to the next sector)
      landClr: false, // cleared to land
    }, o);
    this.perf = TYPES[this.type];
    this.wake = this.perf.wake;
  }

  get isArr() { return this.kind === 'arr'; }
  get airborne() { return this.state === 'air'; }
  get runway() { return RUNWAYS[this.rwy]; }

  say(game, text) { game.pilotSay(this, text); }

  // ---------- speeds, wind and turn performance ----------
  tas() { return this.spd * (1 + (this.alt / 1000) * 0.018); }

  // Ground velocity in nm/s (air mass movement + wind when airborne).
  vel() {
    const v = Geo.vec(this.hdg);
    const tas = this.tas();
    let vx = v.x * tas, vy = v.y * tas;
    if (this.state === 'air') {
      const w = windAt(this.alt);
      const wv = Geo.vec(w.dir + 180);
      vx += wv.x * w.spd; vy += wv.y * w.spd;
    }
    return { x: vx / 3600, y: vy / 3600 };
  }
  gs_kt() { const v = this.vel(); return Math.hypot(v.x, v.y) * 3600; }
  track() { const v = this.vel(); return Geo.norm(Geo.deg(Math.atan2(v.x, v.y))); }

  // Heading needed to make good a course in the current wind.
  wca(course) {
    const w = windAt(this.alt);
    const xw = w.spd * Math.sin(Geo.rad(w.dir - course));
    return Geo.deg(Math.asin(Geo.clamp(xw / Math.max(this.tas(), 60), -0.6, 0.6)));
  }
  headingFor(course) { return Geo.norm(course + this.wca(course)); }

  // Standard rate (3°/s) limited by 25° of bank at high true airspeed.
  turnRate() { return Math.min(this.perf.turn, (1091 * Math.tan(Geo.rad(MAX_BANK))) / Math.max(this.tas(), 100)); }
  turnRadius() { return Geo.turnRadius(this.gs_kt(), this.turnRate()); }

  // Position relative to a runway's final approach: along (nm before threshold) and lateral (nm right of course).
  finalGeometry(rwy = this.runway) {
    const dx = this.x - rwy.thr.x, dy = this.y - rwy.thr.y;
    const v = Geo.vec(rwy.heading);
    return { along: -(dx * v.x + dy * v.y), lateral: dx * v.y - dy * v.x };
  }

  autoSpeed() {
    const p = this.perf;
    if (this.isArr) {
      if (this.est) {
        const { along } = this.finalGeometry();
        return along < 5 ? p.vapp : Math.max(p.vapp, 170);
      }
      const d = Math.hypot(this.x, this.y);
      if (this.alt < 8000 && d < 20) return 210;
      return this.alt < 10000 ? 250 : 290;
    }
    if (this.alt < 3000) return Math.min(220, p.max);
    if (this.alt < 10000) return 250;
    return Math.min(300, p.max);
  }

  // ---------- main update ----------
  update(dt, game) {
    this.age += dt;
    switch (this.state) {
      case 'ground':
      case 'gone':
        return;
      case 'lineup':
        if (this.lining) this.lineupStep(dt);
        return;
      case 'stand':
      case 'pushback':
      case 'taxi':
      case 'parked':
        this.groundUpdate(dt, game);
        return;
      case 'takeoff':
        this.spd += (this.perf.accel || 4) * dt;
        this.move(dt);
        if (this.spd >= this.perf.vr) {
          this.state = 'air';
          this.tgtHdg = this.hdg;
          if (this.vfr && !this.circuit) this.startCircuit();
        }
        return;
      case 'touchgo':
        this.touchGoStep(dt, game);
        return;
      case 'landed':
        this.rollOut(dt, game);
        return;
    }

    this.navigate(dt, game);
    if (this.state !== 'air') return; // landed inside navigate
    this.turn(dt);
    this.adjustSpeed(dt);
    this.adjustAltitude(dt, game);
    this.move(dt);

    this.trailTimer += dt;
    if (this.trailTimer >= 4) {
      this.trailTimer = 0;
      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > 10) this.trail.shift();
    }
  }

  navigate(dt, game) {
    if (this.circuit) return this.flyCircuit(dt, game);
    // Departures fly runway heading until 800 ft before turning on course.
    if (!this.isArr && this.alt < 800) { this.tgtHdg = this.runway.heading; return; }

    if (this.ils && !this.est) this.checkLocCapture(game);

    if (this.est) {
      const r = this.runway;
      const { along, lateral } = this.finalGeometry();
      this.tgtHdg = Geo.norm(this.headingFor(r.heading) - Geo.clamp(lateral * 55, -35, 35));
      this.turnDir = null;
      // No landing clearance by 1 nm: the crew must go around.
      if (along <= 1 && !this.landClr) return this.goAround(game, 'no landing clearance, going around');
      if (along <= 0.05) {
        if (this.alt <= 400) this.land(game);
        else this.goAround(game, 'too high, going around');
      }
      return;
    }

    // A leg flown after a hold or vectors starts from wherever the aircraft rejoins its route.
    if (this.mode !== 'route') this.leg = null;
    if (this.mode === 'hold') return this.flyHold(dt, game);

    if (this.mode === 'route') {
      if (!this.route.length) { this.mode = 'heading'; this.tgtHdg = this.hdg; return; }
      this.followRoute(game);
      // Cleared for a procedure: descend via the STAR and approach fix altitudes.
      if (this.app) {
        const next = this.route.find((n) => this.fixAlt(n));
        if (next && this.fixAlt(next) < this.tgtAlt) this.tgtAlt = this.fixAlt(next);
      }
    }
  }

  // Altitude constraint at a route fix: the aircraft's STAR constraint, else the published approach altitude.
  fixAlt(name) { return this.altCons?.[name] ?? FIXES[name]?.alt; }

  // Lateral navigation along the route: track each leg, start fly-by turns early so the aircraft rolls out on
  // the next leg, and sequence a waypoint once it is passed abeam so a fix is never orbited. Legs published as arcs
  // (RF legs on the approach transitions) are flown round their centre.
  followRoute(game) {
    const wp = FIXES[this.route[0]];
    // The leg starts at the fix just sequenced, or where the aircraft was when it got a new waypoint.
    if (!this.leg || this.leg.to !== this.route[0]) this.leg = { to: this.route[0], from: { x: this.x, y: this.y } };
    const arc = this.leg.fromName && ARCS[`${this.leg.fromName}>${this.route[0]}`];
    if (arc) return this.flyArc(arc, wp, game);
    const from = this.leg.from;
    const len = Geo.dist(from, wp);
    const d = Geo.dist(this, wp);
    const course = len > 0.1 ? Geo.bearing(from, wp) : Geo.bearing(this, wp);
    const u = Geo.vec(course);
    const prog = (this.x - from.x) * u.x + (this.y - from.y) * u.y; // distance flown along the leg
    const r = this.turnRadius();

    // Fly-by: lead = r·tan(Δ/2), at most 3 nm and 40% of the next leg; turns over 120° fly over the fix.
    // An arc that follows starts tangent to this leg, so there is nothing to anticipate.
    let lead = 0.2;
    const next = this.route[1] && FIXES[this.route[1]];
    if (next && !ARCS[`${this.route[0]}>${this.route[1]}`]) {
      const turn = Math.abs(Geo.diff(course, Geo.bearing(wp, next)));
      if (turn <= 120) lead = Geo.clamp(r * Math.tan(Geo.rad(turn / 2)), 0.2, Math.min(3, 0.4 * Geo.dist(wp, next)));
    }
    if (d <= lead || (len > 0.1 && prog >= len)) return this.sequence(wp, game);

    // Steer for a point ahead on the leg, so the aircraft converges on the track rather than chasing the fix.
    const look = Math.max(1.5, 1.5 * r);
    const aim = len > 0.1 && len - prog > look ? Geo.offset(from, course, Math.max(0, prog) + look) : wp;
    const brg = Geo.bearing(this, aim);
    // A point inside the turning circle can't be reached by turning towards it: hold the heading until it can.
    const side = Geo.diff(this.hdg, brg) >= 0 ? 1 : -1;
    if (Math.abs(Geo.diff(this.hdg, brg)) > 20 && Geo.dist(Geo.offset(this, this.hdg + side * 90, r), aim) < r * 0.95) {
      this.tgtHdg = this.hdg;
      return;
    }
    this.tgtHdg = this.headingFor(brg);
  }

  // RF leg: fly round the arc's centre, steering back onto the radius, until abeam the end point.
  flyArc(arc, wp, game) {
    const sgn = arc.dir === 'R' ? 1 : -1;
    const radial = Geo.bearing(arc.c, this);
    const togo = sgn * Geo.diff(radial, Geo.bearing(arc.c, wp)); // degrees of arc still to fly
    if (togo <= 0.5) return this.sequence(wp, game);
    const err = Geo.dist(arc.c, this) - arc.r; // > 0 outside the arc
    this.tgtHdg = this.headingFor(radial + sgn * 90 + sgn * Geo.clamp(err * 40, -40, 40));
    this.turnDir = null;
  }

  // Waypoint passed: on to the next leg, or the end of the route.
  sequence(wp, game) {
    this.route.shift();
    if (this.route.length) {
      this.leg = { to: this.route[0], from: { x: wp.x, y: wp.y }, fromName: wp.name };
      return this.followRoute(game);
    }
    this.leg = null;
    this.mode = 'heading';
    this.tgtHdg = this.hdg;
    if (this.isArr && !this.ils && !this.endOfRouteWarned) {
      this.endOfRouteWarned = true;
      this.say(game, `end of route at ${wp.name}, maintaining heading ${Geo.fmtHdg(this.hdg)}, request approach clearance`);
    }
  }

  checkLocCapture(game) {
    const r = this.runway;
    const { along, lateral } = this.finalGeometry();
    const theta = Geo.diff(r.heading, this.track());
    const crossed = this.prevLateral !== null && Math.sign(lateral) !== Math.sign(this.prevLateral);
    this.prevLateral = lateral;
    if (along < 3 || along > 30 || Math.abs(theta) > 110) return; // no intercepts inside 3 nm
    if (this.mode === 'hold') return; // straight-in IAF holds sit on the extended centreline
    // Flying the published approach: the localizer is joined from the IF on, not on the way to the IAF.
    const a = APPROACHES[this.rwy];
    if (this.app && this.mode === 'route' && this.route.length && this.route[0] !== a.if && this.route[0] !== a.faf) return;
    // On the arc onto final the aircraft rolls out on the centreline by itself: join the localizer at the IF.
    if (this.mode === 'route' && this.leg?.fromName && ARCS[`${this.leg.fromName}>${this.route[0]}`]) return;
    const toward = (lateral > 0 && theta < 0) || (lateral < 0 && theta > 0);
    const lead = this.turnRadius() * (1 - Math.cos(Geo.rad(theta))) + 0.15;
    if ((Math.abs(lateral) <= lead && (toward || Math.abs(lateral) < 0.15)) || crossed) {
      this.est = true;
      this.mode = 'loc';
      this.hold = null;
      this.route = [];
      game.log(`${this.cs} established on the localizer ${this.rwy}`, 'sys');
    }
  }

  // ---------- holding ----------
  // Start (or re-plan) a hold. Missing values come from the published hold, else inbound = present track to the fix, right turns.
  enterHold(fixName, inbound = null, turn = null, legTime = null) {
    const pub = HOLDS[fixName];
    const fix = FIXES[fixName];
    this.est = this.gs = false;
    this.mode = 'hold';
    this.hold = {
      fix: fixName,
      inbound: inbound ?? pub?.inbound ?? Math.round(Geo.bearing(this, fix) / 5) * 5,
      turn: turn ?? pub?.turn ?? 'R',
      legTime,
      phase: 'toFix', entry: null, timer: 0, laps: 0,
    };
    return this.hold;
  }

  holdLegTime() { return this.hold.legTime ?? HOLD_LEG(this.alt); }

  // Racetrack hold with direct / parallel / teardrop entries.
  flyHold(dt, game) {
    const h = this.hold;
    const fix = FIXES[h.fix];
    const c = h.inbound;
    const sgn = h.turn === 'R' ? 1 : -1;
    const aligned = (tgt) => Math.abs(Geo.diff(this.hdg, tgt)) < 3;
    // Position relative to the inbound course line through the fix.
    const v = Geo.vec(c);
    const dx = this.x - fix.x, dy = this.y - fix.y;
    const before = -(dx * v.x + dy * v.y);
    const lateral = dx * v.y - dy * v.x;

    switch (h.phase) {
      case 'toFix': {
        this.tgtHdg = this.headingFor(Geo.bearing(this, fix));
        if (Geo.dist(this, fix) < 0.4) {
          // Entry sectors relative to the inbound course: 110° parallel, 70° teardrop, 180° direct.
          const d = Geo.diff(c, this.track()) * sgn;
          h.entry = d <= -70 ? 'parallel' : d >= 110 ? 'teardrop' : 'direct';
          if (!h.announced) {
            h.announced = true;
            this.say(game, `entering the hold at ${h.fix}, ${h.entry} entry, inbound ${Geo.fmtHdg(c)}, ${h.turn === 'R' ? 'right' : 'left'} turns`);
          }
          if (h.entry === 'direct') { h.phase = 'outTurn'; }
          else if (h.entry === 'parallel') { h.phase = 'parOut'; h.timer = this.holdLegTime(); this.turnDir = null; }
          else { h.phase = 'tearOut'; h.timer = this.holdLegTime(); this.turnDir = null; }
        }
        break;
      }
      case 'outTurn': // turn in the hold direction onto the outbound heading
        this.tgtHdg = this.headingFor(c + 180);
        this.turnDir = h.turn;
        if (aligned(this.tgtHdg)) { h.phase = 'outbound'; h.timer = this.holdLegTime(); this.turnDir = null; }
        break;
      case 'outbound':
        this.tgtHdg = this.headingFor(c + 180);
        h.timer -= dt;
        if (h.timer <= 0) { h.phase = 'inTurn'; this.turnDir = h.turn; }
        break;
      case 'inTurn': // turn in the hold direction back towards the inbound course
        this.tgtHdg = Geo.norm(c);
        this.turnDir = h.turn;
        if (Math.abs(Geo.diff(this.hdg, c)) < 30) { h.phase = 'inbound'; this.turnDir = null; }
        break;
      case 'inbound':
        this.tgtHdg = Geo.norm(this.headingFor(c) - Geo.clamp(lateral * 45, -45, 45));
        if (before <= 0.1) { h.phase = 'outTurn'; h.laps++; }
        break;
      case 'parOut': // parallel entry: outbound on the non-holding side
        this.tgtHdg = this.headingFor(c + 180);
        if (aligned(this.tgtHdg)) h.timer -= dt;
        if (h.timer <= 0) { h.phase = 'parBack'; this.turnDir = h.turn === 'R' ? 'L' : 'R'; }
        break;
      case 'parBack': { // turn back through the holding side, direct to the fix
        const brg = this.headingFor(Geo.bearing(this, fix));
        this.tgtHdg = brg;
        if (this.turnDir && Math.abs(Geo.diff(this.hdg, brg)) < 20) this.turnDir = null;
        if (Geo.dist(this, fix) < 0.4) { h.phase = 'outTurn'; h.laps++; }
        break;
      }
      case 'tearOut': // teardrop entry: 30° offset onto the holding side
        this.tgtHdg = this.headingFor(c + 180 - sgn * 30);
        if (aligned(this.tgtHdg)) h.timer -= dt;
        if (h.timer <= 0) { h.phase = 'inTurn'; this.turnDir = h.turn; }
        break;
    }
  }

  // Published-style racetrack shape for drawing.
  static racetrack(fixName, inbound, turn, alt = 8000) {
    const fix = FIXES[fixName];
    const sgn = turn === 'R' ? 1 : -1;
    const tas = HOLD_SPEED(alt) * (1 + (alt / 1000) * 0.018);
    const rate = Math.min(3, (1091 * Math.tan(Geo.rad(MAX_BANK))) / tas);
    const r = Geo.turnRadius(tas, rate);
    const leg = (tas / 3600) * HOLD_LEG(alt);
    const pts = [];
    const arc = (centre, from) => {
      for (let a = 0; a <= 180; a += 15) pts.push(Geo.offset(centre, from + sgn * a, r));
    };
    const c1 = Geo.offset(fix, inbound + sgn * 90, r);
    arc(c1, Geo.bearing(c1, fix));
    const outEnd = Geo.offset(Geo.offset(fix, inbound + sgn * 90, 2 * r), inbound + 180, leg);
    const c2 = Geo.offset(c1, inbound + 180, leg);
    pts.push(outEnd);
    arc(c2, Geo.bearing(c2, outEnd));
    pts.push({ x: fix.x, y: fix.y });
    return pts;
  }

  // ---------- control laws ----------
  turn(dt) {
    let d = Geo.diff(this.hdg, this.tgtHdg);
    if (this.turnDir === 'R' && d < 0 && Math.abs(d) > 2) d += 360;
    if (this.turnDir === 'L' && d > 0 && Math.abs(d) > 2) d -= 360;
    const step = this.turnRate() * dt;
    if (Math.abs(d) <= step) {
      this.hdg = this.tgtHdg;
      if (this.mode !== 'hold') this.turnDir = null;
    } else {
      this.hdg = Geo.norm(this.hdg + Math.sign(d) * step);
    }
  }

  adjustSpeed(dt) {
    let target = this.tgtSpd ?? this.autoSpeed();
    const e = this.emg && !this.emg.done ? this.emg : null;
    const vapp = this.perf.vapp + (e?.vappAdd || 0); // e.g. a flapless approach after a hydraulic failure
    // Pilots slow to approach speed inside 5 nm regardless of assigned speed.
    if (this.est && this.finalGeometry().along < 5) target = vapp;
    if (this.mode === 'hold') target = Math.min(target, HOLD_SPEED(this.alt));
    if (this.alt < 10000 && !this.handedOff) target = Math.min(target, 250);
    if (e?.maxSpd) target = Math.min(target, e.maxSpd);
    target = Geo.clamp(target, vapp, this.perf.max);
    const d = target - this.spd;
    const step = (d > 0 ? 2 : 1.5) * dt;
    this.spd = Math.abs(d) <= step ? target : this.spd + Math.sign(d) * step;
  }

  gsAlt() { return Math.max(0, this.finalGeometry().along * GS_FT_PER_NM); }

  adjustAltitude(dt, game) {
    const p = this.perf;
    if (this.est && !this.gs && this.alt >= this.gsAlt() - 30) {
      this.gs = true;
      game.log(`${this.cs} glideslope captured`, 'sys');
    }
    if (this.gs) {
      const target = this.gsAlt();
      const { along } = this.finalGeometry();
      if (this.alt > target) this.alt = Math.max(target, this.alt - ((p.desc * 1.6) / 60) * dt);
      else this.alt = target;
      if (along < 3 && this.alt - target > 600) this.goAround(game, 'unstable, too high on the glidepath, going around');
      return;
    }
    const d = this.tgtAlt - this.alt;
    const e = this.emg && !this.emg.done ? this.emg : null;
    const factor = d > 0 ? (e?.climb || 1) : (e?.desc || 1); // engine out climbs slowly, emergency descents are steep
    const rate = ((d > 0 ? p.climb : p.desc) / 60) * dt * (this.alt > 20000 && d > 0 ? 0.7 : 1) * factor;
    this.alt = Math.abs(d) <= rate ? this.tgtAlt : this.alt + Math.sign(d) * rate;
  }

  move(dt) {
    const v = this.vel();
    this.x += v.x * dt;
    this.y += v.y * dt;
  }

  land(game) {
    this.state = 'landed';
    this.alt = 0;
    this.hdg = this.runway.heading;
    this.est = this.gs = false;
    game.onLanded(this);
    if (this.emg && !this.emg.done) game.emergency?.onLanded(this);
  }

  goAround(game, reason = 'going around') {
    this.est = this.gs = this.ils = this.app = this.landClr = this.rwyChecked = false;
    this.mode = 'heading';
    this.route = [];
    this.hold = null;
    this.tgtHdg = this.runway.heading;
    this.turnDir = null;
    const gaAlt = AIRPORT.goAroundAlt || 3000;
    this.tgtAlt = Math.max(this.alt, gaAlt);
    this.tgtSpd = null;
    this.prevLateral = null;
    this.gaTime = game.time;
    this.say(game, `${reason}, runway heading, climbing ${gaAlt}`);
    game.onGoAround(this);
  }

  // ---------- path prediction ----------
  // Simulate a silent copy of this aircraft forward and record where it goes.
  // Returns { pts, vectored }: pts follow the real curved flight path; when vectored
  // (flying a heading with no clearance to rejoin) only ~2 minutes are predicted.
  predictPath() {
    const g = Object.assign(Object.create(Aircraft.prototype), this, {
      route: this.route.slice(),
      hold: this.hold ? { ...this.hold, announced: true } : null,
      circuit: this.circuit ? { ...this.circuit, called: { downwind: true, final: true }, orbit: this.circuit.orbit && { ...this.circuit.orbit } } : null,
      trail: [], endOfRouteWarned: true, calledDeparture: true, landClr: true,
    });
    if (!g.isArr && ['stand', 'pushback', 'taxi', 'ground', 'lineup'].includes(g.state)) {
      Object.assign(g, { state: 'takeoff', spd: 0, x: g.runway.start.x, y: g.runway.start.y, hdg: g.runway.heading });
      if (g.tgtAlt < AIRPORT.sidTop) g.tgtAlt = AIRPORT.sidTop;
    }
    const vectored = g.state === 'air' && g.mode === 'heading' && !g.ils;
    const limit = vectored ? 120 : 1200;
    const dt = 2;
    const pts = [{ x: g.x, y: g.y }];
    const startLaps = g.hold ? g.hold.laps : 0;
    const startCct = g.circuit ? g.circuit.laps : 0;
    let t = 0, straight = 0;
    while (t < limit && g.state !== 'gone') {
      g.update(dt, SILENT_GAME);
      t += dt;
      pts.push({ x: g.x, y: g.y });
      if (g.state === 'landed') break;
      if (g.circuit && (g.circuit.laps > startCct || g.state === 'touchgo')) break; // one circuit is enough
      if (g.mode === 'hold' && ((g.hold.laps > startLaps && t >= 200) || g.hold.laps > startLaps + 1)) break; // one full racetrack is enough
      // Once a non-vectored aircraft runs out of route and is just flying straight, stop after a short stub.
      if (!vectored && g.state === 'air' && g.mode === 'heading' && !g.ils && Math.abs(Geo.diff(g.hdg, g.tgtHdg)) < 1) {
        if ((straight += dt) > 40) break;
      }
      if (Math.hypot(g.x, g.y) > AIRPORT.radarRange + 5) break;
    }
    // Arrivals whose route ends before the runway: show the remaining way in.
    const tail = [];
    if (this.isArr && g.state === 'air' && !vectored && !g.ils) tail.push(this.runway.thr);
    return { pts, vectored, tail };
  }

  // ---------- text helpers ----------
  altText(alt = this.alt) {
    if (alt >= AIRPORT.transAlt + 500) return 'F' + String(Math.round(alt / 100)).padStart(3, '0');
    return 'A' + String(Math.round(alt / 100)).padStart(3, '0');
  }
  altWords(alt) {
    return alt >= AIRPORT.transAlt + 500 ? `flight level ${Math.round(alt / 100)}` : `${alt} ft`;
  }
}
