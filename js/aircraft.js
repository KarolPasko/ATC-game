// Aircraft model: flight dynamics, navigation, ILS and procedure logic.
const GS_FT_PER_NM = Math.tan(Geo.rad(3)) * 6076.12; // ~318 ft/nm

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
      age: 0, endOfRouteWarned: false,
    }, o);
    this.perf = TYPES[this.type];
    this.wake = this.perf.wake;
  }

  get isArr() { return this.kind === 'arr'; }
  get airborne() { return this.state === 'air'; }
  get runway() { return RUNWAYS[this.rwy]; }

  say(game, text) { game.pilotSay(this, text); }

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

  update(dt, game) {
    this.age += dt;
    switch (this.state) {
      case 'ground':
      case 'lineup':
      case 'gone':
        return;
      case 'takeoff':
        this.spd += 4 * dt;
        this.move(dt);
        if (this.spd >= this.perf.vr) {
          this.state = 'air';
          this.tgtHdg = this.hdg;
        }
        return;
      case 'landed':
        this.spd = Math.max(0, this.spd - 4 * dt);
        this.move(dt);
        if (this.spd < 30) this.state = 'gone';
        return;
    }

    this.navigate(dt, game);
    if (this.state !== 'air') return; // landed or went around inside navigate
    this.turn(dt);
    this.adjustSpeed(dt);
    this.adjustAltitude(dt, game);
    this.move(dt);

    this.trailTimer += dt;
    if (this.trailTimer >= 4) {
      this.trailTimer = 0;
      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > 8) this.trail.shift();
    }
  }

  navigate(dt, game) {
    // Departures fly runway heading until 800 ft before turning on course.
    if (!this.isArr && this.alt < 800) { this.tgtHdg = this.runway.heading; return; }

    if (this.ils && !this.est) this.checkLocCapture(game);

    if (this.est) {
      const r = this.runway;
      const { along, lateral } = this.finalGeometry();
      this.tgtHdg = Geo.norm(r.heading - Geo.clamp(lateral * 55, -35, 35));
      this.turnDir = null;
      if (along <= 0.05) {
        if (this.alt <= 400) this.land(game);
        else this.goAround(game, 'too high, going around');
      }
      return;
    }

    if (this.mode === 'hold') return this.flyHold(dt, game);

    if (this.mode === 'route') {
      if (!this.route.length) { this.mode = 'heading'; this.tgtHdg = this.hdg; return; }
      const wp = FIXES[this.route[0]];
      const d = Geo.dist(this, wp);
      const brg = Geo.bearing(this, wp);
      this.tgtHdg = brg;
      let lead = 0.5;
      if (this.route[1]) {
        const next = FIXES[this.route[1]];
        const turn = Math.abs(Geo.diff(brg, Geo.bearing(wp, next)));
        lead = Geo.clamp(Geo.turnRadius(this.gs_kt(), this.perf.turn) * Math.tan(Geo.rad(Math.min(turn, 120) / 2)), 0.3, 3);
      }
      if (d < lead) {
        this.route.shift();
        if (!this.route.length) {
          this.mode = 'heading';
          this.tgtHdg = this.hdg;
          if (this.isArr && !this.ils && !this.endOfRouteWarned) {
            this.endOfRouteWarned = true;
            this.say(game, `end of route at ${wp.name}, maintaining heading ${Geo.fmtHdg(this.hdg)}, request approach clearance`);
          }
        }
      }
      // Cleared for a procedure: descend via the published fix altitudes.
      if (this.app) {
        const next = this.route.find((n) => FIXES[n].alt);
        if (next && FIXES[next].alt < this.tgtAlt) this.tgtAlt = FIXES[next].alt;
      }
    }
  }

  checkLocCapture(game) {
    const r = this.runway;
    const { along, lateral } = this.finalGeometry();
    const theta = Geo.diff(r.heading, this.hdg);
    const crossed = this.prevLateral !== null && Math.sign(lateral) !== Math.sign(this.prevLateral);
    this.prevLateral = lateral;
    if (along < 0.5 || along > 30 || Math.abs(theta) > 110) return;
    const toward = (lateral > 0 && theta < 0) || (lateral < 0 && theta > 0);
    const lead = Geo.turnRadius(this.gs_kt(), this.perf.turn) * (1 - Math.cos(Geo.rad(theta))) + 0.15;
    if ((Math.abs(lateral) <= lead && (toward || Math.abs(lateral) < 0.15)) || crossed) {
      this.est = true;
      this.mode = 'loc';
      this.hold = null;
      this.route = [];
      game.log(`${this.cs} established on the localizer ${this.rwy}`, 'sys');
    }
  }

  flyHold(dt, game) {
    const h = this.hold;
    const fix = FIXES[h.fix];
    if (h.phase === 'to') {
      const brg = Geo.bearing(this, fix);
      this.tgtHdg = brg;
      if (this.turnDir && Math.abs(Geo.diff(this.hdg, brg)) < 20) this.turnDir = null;
      if (Geo.dist(this, fix) < 0.5) {
        if (h.inbound === null) h.inbound = this.hdg;
        h.phase = 'out';
        h.timer = 60;
        this.tgtHdg = Geo.norm(h.inbound + 180);
        this.turnDir = 'R';
      }
    } else {
      // The 1-minute outbound leg is timed once the turn outbound is complete.
      if (Math.abs(Geo.diff(this.hdg, this.tgtHdg)) < 5) h.timer -= dt;
      if (h.timer <= 0) { h.phase = 'to'; this.turnDir = 'R'; }
    }
  }

  turn(dt) {
    let d = Geo.diff(this.hdg, this.tgtHdg);
    if (this.turnDir === 'R' && d < 0 && Math.abs(d) > 2) d += 360;
    if (this.turnDir === 'L' && d > 0 && Math.abs(d) > 2) d -= 360;
    const step = this.perf.turn * dt;
    if (Math.abs(d) <= step) {
      this.hdg = this.tgtHdg;
      if (this.mode !== 'hold') this.turnDir = null;
    } else {
      this.hdg = Geo.norm(this.hdg + Math.sign(d) * step);
    }
  }

  adjustSpeed(dt) {
    let target = this.tgtSpd ?? this.autoSpeed();
    // Pilots slow to approach speed inside 5 nm regardless of assigned speed.
    if (this.est && this.finalGeometry().along < 5) target = this.perf.vapp;
    if (this.alt < 10000 && !this.handedOff) target = Math.min(target, 250);
    target = Geo.clamp(target, this.perf.vapp, this.perf.max);
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
    const rate = ((d > 0 ? p.climb : p.desc) / 60) * dt * (this.alt > 20000 && d > 0 ? 0.7 : 1);
    this.alt = Math.abs(d) <= rate ? this.tgtAlt : this.alt + Math.sign(d) * rate;
  }

  // Ground speed: IAS corrected roughly for altitude (no wind).
  gs_kt() { return this.spd * (1 + (this.alt / 1000) * 0.018); }

  move(dt) {
    const nm = (this.gs_kt() / 3600) * dt;
    const v = Geo.vec(this.hdg);
    this.x += v.x * nm;
    this.y += v.y * nm;
  }

  land(game) {
    this.state = 'landed';
    this.alt = 0;
    this.hdg = this.runway.heading;
    this.est = this.gs = false;
    game.onLanded(this);
  }

  goAround(game, reason = 'going around') {
    this.est = this.gs = this.ils = this.app = false;
    this.mode = 'heading';
    this.route = [];
    this.hold = null;
    this.tgtHdg = this.runway.heading;
    this.turnDir = null;
    this.tgtAlt = Math.max(this.alt, 3000);
    this.tgtSpd = null;
    this.prevLateral = null;
    this.say(game, `${reason}, runway heading, climbing 3000`);
    game.onGoAround(this);
  }

  // Path drawn on the scope: remaining waypoints and, for arrivals, the runway.
  displayPath() {
    const pts = [];
    if (this.state === 'ground' || this.state === 'lineup') {
      pts.push(this.runway.thr, this.runway.opp);
      for (const n of this.route) pts.push(FIXES[n]);
      return pts;
    }
    pts.push({ x: this.x, y: this.y });
    if (this.est) { pts.push(this.runway.thr); return pts; }
    if (this.mode === 'hold') { pts.push(FIXES[this.hold.fix]); return pts; }
    // When vectored off the route, the remaining route is still shown (first leg dashed by the scope).
    for (const n of this.route) pts.push(FIXES[n]);
    if (this.isArr && this.ils && !this.route.length) {
      const [, , faf] = APPROACHES[this.rwy];
      pts.push(FIXES[faf]);
    }
    if (this.isArr && (this.route.length || this.ils)) pts.push(this.runway.thr);
    return pts;
  }

  altText(alt = this.alt) {
    if (alt >= AIRPORT.transAlt + 500) return 'F' + String(Math.round(alt / 100)).padStart(3, '0');
    return 'A' + String(Math.round(alt / 100)).padStart(3, '0');
  }
}
