// General aviation circuit traffic: light aircraft from the GA ramp flying VFR circuits with touch-and-goes, then a
// full stop. In runway terms (along = nm before the landing threshold, lateral = nm right of the take-off direction,
// side s = +1 for a right-hand circuit, -1 left-hand): climb out on the runway heading past the upwind end, turn
// crosswind, fly downwind about 1 nm from the runway at 1000 ft, turn base when the threshold is well behind, and
// join a short final. UK practice: circuit height 1000 ft above the aerodrome, squawk 7010.
const GA_FLEET = { C172: 4, PA28: 4, C152: 2, DA40: 2, SR22: 1 };
const GA_NAMES = { C152: 'Cessna 152', C172: 'Cessna 172', PA28: 'Piper Warrior', DA40: 'Diamond Star', SR22: 'Cirrus SR22' };
const CIRCUIT = { width: 1.0, baseAlong: 1.3, height: 1000, extendMin: 2.5, extendMax: 4 };
const CIRCUIT_LEG = { upwind: 'UPW', crosswind: 'XWD', downwind: 'DWN', base: 'BASE', final: 'FIN' };

Object.assign(Aircraft.prototype, {
  // After take-off a VFR aircraft starts its circuits; `circuits` is the total including the final full stop.
  startCircuit() {
    this.circuit = {
      side: AIRPORT.ga?.side?.[this.rwy] ?? -1, phase: 'upwind', left: Math.max(0, (this.circuits ?? 3) - 1),
      laps: 0, clr: false, extend: false, orbit: null, called: {},
    };
  },

  circuitIntent() { return this.circuit.left > 0 ? 'touch and go' : 'full stop'; },
  // On downwind the runway is on the circuit side's opposite hand: orbit the other way, out over open ground.
  awayFromRunway() { return this.circuit.side > 0 ? 'L' : 'R'; },
  circuitLeg() { const c = this.circuit; return c ? (c.orbit ? 'ORB' : c.extend && c.phase === 'downwind' ? 'EXT' : CIRCUIT_LEG[c.phase]) : ''; },

  flyCircuit(dt, game) {
    const c = this.circuit, r = this.runway, H = r.heading, s = c.side, p = this.perf;
    const { along, lateral } = this.finalGeometry();
    const len = Geo.dist(r.thr, r.opp);
    const height = (AIRPORT.elevation || 0) + CIRCUIT.height;
    // Orbit: a full 360° in the circuit direction, then carry on with the same leg.
    if (c.orbit) {
      const o = c.orbit;
      o.turned += Math.abs(Geo.diff(o.last ?? this.hdg, this.hdg));
      o.last = this.hdg;
      this.turnDir = o.dir;
      this.tgtHdg = Geo.norm(this.hdg + (o.dir === 'R' ? 30 : -30));
      if (o.turned >= 355) { c.orbit = null; this.turnDir = null; }
      return;
    }
    this.turnDir = null;
    switch (c.phase) {
      case 'upwind':
        this.tgtHdg = this.headingFor(H); this.tgtAlt = height; this.tgtSpd = p.cct;
        if (along <= -len - 0.2 && this.alt >= 500) c.phase = 'crosswind';
        break;
      case 'crosswind':
        this.tgtHdg = this.headingFor(H + 90 * s); this.tgtAlt = height; this.tgtSpd = p.cct;
        if (lateral * s >= CIRCUIT.width - this.turnRadius()) c.phase = 'downwind';
        break;
      case 'downwind': {
        this.tgtAlt = height; this.tgtSpd = p.cct;
        if (!c.called.downwind && along > -len * 0.6) { c.called.downwind = true; game.circuitCall?.(this, 'downwind'); }
        // Told to extend: keep going, but no further than about 4 nm out, then hold there until cleared to turn base.
        if (c.extend && (c.hold || along > CIRCUIT.extendMax)) { this.extendedHold(along, lateral, H, s); break; }
        c.hold = null;
        // Track parallel to the runway at the circuit width (steer back towards it from either side).
        const corr = Geo.clamp((s * CIRCUIT.width - lateral) * 40, -30, 30);
        this.tgtHdg = Geo.norm(this.headingFor(H + 180) - corr);
        if (!c.extend && along >= CIRCUIT.baseAlong - this.turnRadius() * 0.5) c.phase = 'base';
        break;
      }
      case 'base':
        this.tgtHdg = this.headingFor(H - 90 * s); this.tgtAlt = Math.max(500, height - 300); this.tgtSpd = p.vapp + 10;
        if (lateral * s <= this.turnRadius() + 0.05) { c.phase = 'final'; if (!c.called.final) { c.called.final = true; game.circuitCall?.(this, 'final'); } }
        break;
      case 'final': {
        this.tgtHdg = Geo.norm(this.headingFor(H) - Geo.clamp(lateral * 60, -30, 30));
        this.tgtSpd = p.vapp;
        this.tgtAlt = Math.max(0, Math.min(this.alt, along * 300)); // about a 3° approach path
        const busy = game.runwayOccupant?.(this);
        if (along <= 0.25 && (!c.clr || busy)) return this.circuitGoAround(game, !c.clr ? 'no clearance, going around' : `runway occupied by ${busy.cs}, going around`);
        if (along <= -0.05) return c.left > 0 ? this.touchAndGo(game) : this.fullStop(game);
        break;
      }
    }
  },

  // Extended downwind with no gap yet: a racetrack between 2.5 and 4 nm out, back towards the airfield on the outside
  // of the downwind and out again along it, turning the same way at both ends (away from the runway at the far end).
  // However long the wait, and whatever the wind, the aircraft stays close to the circuit instead of drifting off.
  extendedHold(along, lateral, H, s) {
    const c = this.circuit;
    if (!c.hold) c.hold = 'in';
    if (c.hold === 'in' && along < CIRCUIT.extendMin) c.hold = 'out';
    else if (c.hold === 'out' && along > CIRCUIT.extendMax) c.hold = 'in';
    const inbound = c.hold === 'in', track = inbound ? H : H + 180;
    const want = s * (inbound ? CIRCUIT.width + 2 * this.turnRadius() : CIRCUIT.width);
    const corr = Geo.clamp((want - lateral) * 40, -30, 30);
    this.tgtHdg = Geo.norm(this.headingFor(track) + (inbound ? corr : -corr));
    this.turnDir = Math.abs(Geo.diff(this.hdg, this.headingFor(track))) > 30 ? this.awayFromRunway() : null;
  },

  circuitGoAround(game, reason) {
    const c = this.circuit;
    Object.assign(c, { phase: 'upwind', clr: false, extend: false, hold: null, extSince: null, called: {} });
    this.tgtAlt = (AIRPORT.elevation || 0) + CIRCUIT.height;
    this.tgtSpd = this.perf.cct;
    this.say(game, reason);
    game.onGoAround(this);
  },

  touchAndGo(game) {
    const c = this.circuit;
    c.left--; c.laps++;
    Object.assign(c, { phase: 'upwind', clr: false, extend: false, hold: null, extSince: null, called: {} });
    this.state = 'touchgo';
    this.tg = 0;
    this.alt = 0;
    this.hdg = this.tgtHdg = this.runway.heading;
    game.onTouchAndGo?.(this);
  },

  // Rolling on the runway: settle, then full power and away again.
  touchGoStep(dt, game) {
    this.tg += dt;
    this.spd = this.tg < 4 ? Math.max(this.perf.vapp - 15, this.spd - 2 * dt) : this.spd + (this.perf.accel || 4) * dt;
    this.move(dt);
    if (this.tg > 4 && this.spd >= this.perf.vr) { this.state = 'air'; this.tgtHdg = this.hdg; }
  },

  // Last circuit: land and taxi back to the GA ramp, from here on handled like an arrival.
  fullStop(game) {
    this.circuit = null;
    this.kind = 'arr';
    this.star = 'VFR';
    this.landClr = true;
    this.tgtSpd = null;
    this.land(game);
  },
});
