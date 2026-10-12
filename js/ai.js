// AI controllers for the positions the player is not working.
// Ground (GND): delivery and ground — clearances, pushback, taxi out to the holding point, taxi in after vacating.
// Tower (TWR): the runways — line-up, take-off, landing clearances, until departures are airborne / arrivals vacate.
// Approach (APP): arrivals from entry to the localizer, departures from tower until the next sector.
const POSITIONS = {
  ALL: { name: 'Combined GND + TWR + APP', short: 'ALL' },
  GND: { name: 'Ground (DEL/GND)', short: 'GND', freq: AIRPORT.freqs.GND, call: `${AIRPORT.city} Ground` },
  TWR: { name: 'Tower', short: 'TWR', freq: AIRPORT.freqs.TWR, call: `${AIRPORT.city} Tower` },
  APP: { name: 'Approach / Departure', short: 'APP', freq: AIRPORT.freqs.APP, call: `${AIRPORT.city} Approach` },
  CTR: { name: AIRPORT.control || `${AIRPORT.city} Control`, short: 'CTR', freq: AIRPORT.freqs.CTR, call: AIRPORT.control || `${AIRPORT.city} Control` },
};

class AIController {
  constructor(game) {
    this.game = game;
    this.timer = 0;
    this.lastTakeoff = {}; // physical runway -> { t: sim time, heavy }
  }

  // Issue a command as the AI controller (readbacks are shown dimmed).
  cmd(ac, line) { this.game.commands.execute(`${ac.cs} ${line}`, { ai: true }); }

  update(dt) {
    this.timer += dt;
    if (this.timer < 1) return;
    this.timer = 0;
    const g = this.game;
    const pos = g.position;
    const ai = (p) => pos !== p && pos !== 'ALL';
    for (const ac of g.aircraft) {
      if (ac.state === 'gone' || ac.owner === 'CTR') continue;
      if (pos === 'ALL') this.combinedTransfers(ac);
      if (pos === 'ALL' && ac.circuit && ac.airborne) this.circuitControl(ac);
      if (g.autoTaxi && ac.owner === 'GND' && g.userOwns(ac)) this.groundMovement(ac);
      if (ai('GND') && ac.owner === 'GND') this.ground(ac);
      if (ai('TWR') && ac.owner === 'TWR') this.tower(ac);
      if (ai('APP') && ac.owner === 'APP') this.approach(ac);
    }
    if (ai('APP')) this.sequenceArrivals();
    if (pos === 'APP') this.warnUnhandedArrivals();
  }

  // ---------- AI ground ----------
  ground(ac) {
    const g = this.game;
    if (ac.state === 'stand' && !ac.isArr && !ac.cleared) {
      if (g.time - ac.spawnTime > 20) this.cmd(ac, 'caf');
      return;
    }
    this.groundMovement(ac);
  }

  // Combined position: the player is both, so frequency changes happen silently.
  combinedTransfers(ac) {
    const g = this.game;
    if (!ac.isArr && ac.airborne && ac.owner === 'TWR' && ac.alt >= (AIRPORT.twrHandoffAlt || 1500)) g.transfer(ac, 'APP', { silent: true });
    if (ac.isArr && ac.est && ac.owner === 'APP') g.transfer(ac, 'TWR', { silent: true });
    if (ac.isArr && ac.est && !ac.landClr && ac.finalGeometry().along < 6) {
      ac.landClr = true;
      g.log(`${ac.cs} cleared to land runway ${ac.rwy} (combined position)`, 'sys');
    }
  }

  // Taxi instructions: departures to their holding point once cleared, arrivals to their stand once vacated.
  groundMovement(ac) {
    if (ac.state === 'stand' && ac.cleared && !ac.isArr) this.cmd(ac, 'taxi');
    else if (ac.state === 'taxi' && !ac.taxiPath.length && !ac.holdPos) {
      if (ac.isArr && ac.stand) this.cmd(ac, 'taxi');
      else if (!ac.isArr) this.cmd(ac, 'taxi');
    }
  }

  // ---------- AI tower ----------
  tower(ac) {
    const g = this.game;
    if (ac.state === 'taxi') { if (ac.holdShort && this.canCross(ac)) this.crossGroup(ac); return; } // arrivals vacating: to Ground once clear
    if (ac.circuit && ac.airborne) return this.circuitControl(ac);
    const go = () => { this.cmd(ac, 'cto'); this.lastTakeoff[ac.runway.phys] = { t: g.time, heavy: ac.wake === 'H', wake: ac.wake }; };
    if (ac.state === 'ground' && ac.cleared) {
      if (this.canTakeoff(ac) && this.canLineUp(ac)) go();
      else if (this.canLineUp(ac)) this.cmd(ac, 'lu'); // line up and wait behind the landing traffic
      return;
    }
    if (ac.state === 'lineup' && !ac.ctoPending && this.canTakeoff(ac)) { go(); return; }
    if (!ac.isArr && ac.airborne && ac.alt >= (AIRPORT.twrHandoffAlt || 1500)) { this.cmd(ac, 'ho'); return; }
    if (ac.isArr && ac.est && !ac.landClr && ac.finalGeometry().along < 8) this.cmd(ac, 'cl');
  }

  // Next arrival's distance to touchdown on this physical runway (nm), or Infinity.
  // Established aircraft count by their distance along the final; others cleared for the approach by the distance
  // still to fly (an arrival passing abeam the airport on its way round is not "close").
  nextArrival(ac, phys = ac.runway.phys) {
    let best = Infinity;
    for (const o of this.game.aircraft) {
      if (!o.airborne || o.runway?.phys !== phys) continue;
      let d;
      if (o.circuit) { if (!['base', 'final'].includes(o.circuit.phase)) continue; d = o.finalGeometry().along; } // circuit traffic turning in
      else { if (!o.isArr || !o.ils) continue; d = o.est ? o.finalGeometry().along : this.remaining(o); }
      if (d > -0.5 && d < best) best = d;
    }
    return best;
  }

  // Line up and wait: first in the queue, nobody else lining up or rolling, any landing aircraft already
  // well past the threshold, and the next arrival at least 5 nm out.
  canLineUp(ac) {
    const g = this.game, phys = ac.runway.phys;
    if (ac.state === 'ground') {
      const queue = g.aircraft.filter((o) => o.state === 'ground' && o.runway.phys === phys && o.cleared);
      if (queue[0] !== ac) return false;
    }
    if (this.nextArrival(ac) < 5) return false;
    return !g.aircraft.some((o) => o !== ac && (o.crossing === phys || (o.runway?.phys === phys && (
      o.state === 'lineup' || o.state === 'takeoff' || o.state === 'touchgo' || (!o.isArr && o.airborne && o.alt < 300) ||
      (o.state === 'landed' && o.finalGeometry(ac.runway).along > -0.35)))));
  }

  // Take-off: runway clear of landing/vacating traffic, next arrival at least 3 nm out, and 1 minute
  // since the previous departure (2 minutes behind a heavy, for wake turbulence).
  canTakeoff(ac) {
    const g = this.game, phys = ac.runway.phys;
    // 1 minute between departures; 2 behind a heavy, and 2 for a light aircraft behind anything bigger.
    const last = this.lastTakeoff[phys];
    const wait = last && (last.heavy || (ac.wake === 'L' && last.wake && last.wake !== 'L') ? 120 : 60);
    if (last && g.time - last.t < wait) return false;
    if (this.nextArrival(ac) < 3) return false;
    return !g.aircraft.some((o) => o !== ac && (o.crossing === phys || (o.runway?.phys === phys && (
      o.state === 'takeoff' || o.state === 'touchgo' || (o.state === 'lineup' && o !== ac) || o.state === 'landed' || (o.state === 'taxi' && o.vacating) ||
      (!o.isArr && o.airborne && o.alt < 1000)))));
  }

  // Cross the aircraft holding short, and the ones queued right behind it for the same crossing when there is time
  // (next arrival 4 nm or more), as one group: "cross runway 23R behind the preceding".
  crossGroup(ac) {
    const g = this.game, rn = ac.taxiPath[0];
    this.cmd(ac, 'cross');
    if (this.nextArrival(ac, GROUND.nodes[rn].phys) < 4) return;
    const queue = g.aircraft.filter((o) => o !== ac && o.state === 'taxi' && !o.crossClr && o.taxiPath?.includes(rn) &&
      Geo.dist(o, GROUND.nodes[ac.holdShort || ac.gnode]) * GROUND.M_PER_NM < 260);
    for (const o of queue.slice(0, 2)) {
      if (o.owner === 'GND') { // Ground passes the ones behind straight to Tower
        if (g.position !== 'ALL') g.log(`${AIRPORT.city} Ground: ${o.cs}, contact Tower ${POSITIONS.TWR.freq}`, g.userOwns(o) ? 'sys' : 'ai');
        g.transfer(o, 'TWR', { ai: true, silent: true });
      }
      if (o.owner === 'TWR') this.cmd(o, 'cross');
    }
  }

  // Runway crossing: next arrival at least 3 nm out, nobody taking off, lining up to go or rolling out towards
  // the crossing point.
  canCross(ac) {
    const g = this.game, n = GROUND.nodes[ac.holdShort];
    const phys = n.phys;
    if (this.nextArrival(ac, phys) < 3) return false;
    // Room on the far side, so the aircraft won't stop on the runway behind traffic.
    const k = ac.taxiPath.findIndex((m, i) => i > 0 && GROUND.nodes[m].kind !== 'rwy');
    const beyond = ac.taxiPath.slice(k, k + 2).map((m) => GROUND.nodes[m]).filter(Boolean);
    const near = (o) => beyond.some((b) => Geo.dist(o, b) * GROUND.M_PER_NM < 90);
    if (g.aircraft.some((o) => o !== ac && o.onGround() && o.state !== 'landed' && near(o))) return false;
    return !g.crossingTraffic(ac, n);
  }

  // ---------- circuit traffic ----------
  // Tower's handling of a light aircraft in the circuit: extend its downwind until there is room to turn in (no IFR
  // arrival within 7 nm, nothing else turning in ahead, wake time behind the last medium / heavy landing), then let it
  // turn base, and clear it for the touch-and-go or landing once the runway will be free.
  circuitControl(ac) {
    const g = this.game, c = ac.circuit, phys = ac.runway.phys;
    if (c.phase === 'downwind' && !c.orbit) {
      const room = this.circuitRoom(ac);
      const along = ac.finalGeometry().along;
      if (!room && !c.extend && along > -1) this.cmd(ac, 'ext');
      else if (room && c.extend) this.cmd(ac, 'base');
    }
    if ((c.phase === 'base' || c.phase === 'final') && !c.clr && ac.finalGeometry().along < 2.5) {
      const busy = g.aircraft.some((o) => o !== ac && o.runway?.phys === phys && (
        ['lineup', 'takeoff', 'touchgo'].includes(o.state) || (o.state === 'landed' && o.spd > 30) || (!o.isArr && o.airborne && o.alt < 300 && !o.circuit)));
      if (!busy) this.cmd(ac, 'cl');
    }
  }

  circuitRoom(ac) {
    const g = this.game, phys = ac.runway.phys;
    for (const o of g.aircraft) {
      if (o === ac || !o.airborne || o.runway?.phys !== phys) continue;
      if (o.isArr && o.ils && !o.circuit && (o.est ? o.finalGeometry().along : this.remaining(o)) < 9) return false;
      if (o.circuit && ['base', 'final'].includes(o.circuit.phase)) return false; // number two to it
    }
    if (g.aircraft.some((o) => o !== ac && o.state === 'touchgo' && o.runway?.phys === phys)) return false;
    // Let a departure that has been waiting a while go first.
    if (g.aircraft.some((o) => !o.vfr && o.state === 'ground' && o.cleared && o.runway?.phys === phys && g.time - (o.waitSince ?? g.time) > 45)) return false;
    const last = g.lastLanding[phys];
    if (last && g.time - last.t < (last.wake === 'H' ? 180 : 120) - 80) return false; // ~80 s from base to touchdown
    return true;
  }

  // Kept for callers that only want to know whether a departure could go now.
  runwayFree(ac) { return this.canLineUp(ac) && this.canTakeoff(ac); }

  // ---------- AI approach ----------
  approach(ac) {
    if (!ac.airborne) return;
    // Emergency descent: let it get down first.
    if (ac.emg && !ac.emg.done && ac.emg.type === 'PRESSURE' && !ac.emg.levelled) return;
    if (ac.isArr) {
      if (ac.est) { this.cmd(ac, 'ho'); return; }
      // After a go-around, let it climb away for a minute before re-clearing the approach.
      if (ac.gaTime !== undefined && this.game.time - ac.gaTime < 60) return;
      if (!ac.app && !ac.ils && ac.mode !== 'hold') this.cmd(ac, `app ${ac.rwy}`);
      return;
    }
    // Departures: climb to cruise and hand to Control once clear of the terminal area.
    if (ac.alt >= 5000 && ac.tgtAlt < 24000) this.cmd(ac, `c ${ac.cruise || 240}`);
    if (ac.alt >= 10000 && Math.hypot(ac.x, ac.y) > 20) this.cmd(ac, 'ho');
  }

  // Remaining flight distance to the threshold along the cleared route.
  remaining(ac) {
    if (ac.est) return ac.finalGeometry().along;
    let d = 0, p = ac;
    if (ac.mode === 'hold') { const f = FIXES[ac.hold.fix]; d += Geo.dist(p, f); p = f; }
    for (const n of ac.route) { const f = FIXES[n]; d += Geo.dist(p, f); p = f; }
    return d + Geo.dist(p, ac.runway.thr);
  }

  // Speed control and holding to keep arrivals spaced (only when the AI works approach).
  sequenceArrivals() {
    const g = this.game;
    const byRwy = {};
    for (const ac of g.aircraft) {
      if (!ac.isArr || !ac.airborne) continue;
      (byRwy[ac.rwy] = byRwy[ac.rwy] || []).push({ ac, rem: this.remaining(ac) });
    }
    const buffer = AIRPORT.seqBuffer ?? 4; // extra miles for compression on final
    const need = (lead, ac) => (lead.wake === 'H' ? (ac.wake === 'H' ? 4 : 5) : 3) + buffer;
    for (const list of Object.values(byRwy)) {
      const flowing = list.filter((e) => e.ac.mode !== 'hold').sort((a, b) => a.rem - b.rem);
      const holding = list.filter((e) => e.ac.mode === 'hold').sort((a, b) => a.ac.holdSince - b.ac.holdSince);

      for (let i = 1; i < flowing.length; i++) {
        const lead = flowing[i - 1], { ac, rem } = flowing[i];
        if (ac.owner !== 'APP' || (ac.emg && !ac.emg.done)) continue; // emergencies get priority, never delayed
        const n = need(lead.ac, ac);
        const gap = rem - lead.rem;
        // Close in: slow to final approach speed early to stop the gap shrinking.
        if (rem < 16) { if (gap < n && ac.tgtSpd !== ac.perf.vapp + 10) this.cmd(ac, `s ${ac.perf.vapp + 10}`); continue; }
        if (ac.est) continue;
        // Once there is a stack, newcomers join it rather than taking the gaps meant for the holding traffic.
        const queue = holding.length && !ac.releasedAt && rem > holding[0].rem - 2;
        if ((gap < n - 2 || queue) && rem > 20 && ac.route.length) {
          const fix = ac.route.find((f) => HOLDS[f]) || APPROACHES[ac.rwy].outer;
          const stack = g.aircraft.filter((o) => o.mode === 'hold' && o.hold?.fix === fix).length;
          this.cmd(ac, `hold ${fix}`);
          ac.app = false;
          ac.holdSince = g.time;
          // Stack starts 1000 ft above the minimum so traffic flowing through the fix passes below.
          this.cmd(ac, `a ${(HOLDS[fix]?.minAlt || 5000) + (stack + 1) * 1000}`);
          flowing.splice(i--, 1); // no longer in the flow
        } else if (gap < n) {
          if (ac.tgtSpd !== 180 && rem < 25) this.cmd(ac, 's 180');
          else if (!ac.tgtSpd && rem >= 25) this.cmd(ac, 's 220');
        } else if (gap > n + 2 && ac.tgtSpd) {
          this.cmd(ac, 's rs');
        }
      }

      // Release the first aircraft in the hold (first come, first served) when there is a gap in the flow for it.
      const first = holding[0];
      if (first && first.ac.owner === 'APP') {
        const clear = flowing.every((f) => Math.abs(f.rem - first.rem) > need(f.ac, first.ac) + 0.5);
        if (clear) { this.cmd(first.ac, `app ${first.ac.rwy}`); first.ac.releasedAt = g.time; }
      }
    }
  }

  // When the player works approach, the AI tower reminds them to transfer arrivals.
  warnUnhandedArrivals() {
    const g = this.game;
    for (const ac of g.aircraft) {
      if (!ac.isArr || !ac.est || ac.owner !== 'APP' || ac.towerWarned) continue;
      if (ac.finalGeometry().along < 5) {
        ac.towerWarned = true;
        g.log(`${AIRPORT.city} Tower: ${ac.cs} is on a ${ac.finalGeometry().along.toFixed(0)} nm final, still on your frequency — transfer it (ho) or it will go around`, 'err');
      }
    }
  }
}
