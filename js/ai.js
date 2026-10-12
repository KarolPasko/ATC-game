// AI controllers for the positions the player is not working.
// Ground (GND): delivery and ground — clearances, pushback, taxi out to the holding point, taxi in after vacating.
// Tower (TWR): the runways — line-up, take-off, landing clearances, until departures are airborne / arrivals vacate.
// Approach (APP): arrivals from entry to the localizer, departures from tower until the next sector.
const POSITIONS = {
  ALL: { name: 'Combined GND + TWR + APP', short: 'ALL' },
  GND: { name: 'Ground (DEL/GND)', short: 'GND', freq: '121.800', call: 'Ravenwood Ground' },
  TWR: { name: 'Tower', short: 'TWR', freq: '118.500', call: 'Ravenwood Tower' },
  APP: { name: 'Approach / Departure', short: 'APP', freq: '119.725', call: 'Ravenwood Approach' },
  CTR: { name: 'Ravenwood Control', short: 'CTR', freq: '128.400', call: 'Ravenwood Control' },
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
    if (!ac.isArr && ac.airborne && ac.owner === 'TWR' && ac.alt >= 1500) g.transfer(ac, 'APP', { silent: true });
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
    if (ac.isArr && ac.state === 'taxi') return; // vacating: handed to Ground automatically once clear
    if (ac.state === 'ground') {
      if (ac.cleared && this.runwayFree(ac)) {
        this.cmd(ac, 'cto');
        this.lastTakeoff[ac.runway.phys] = { t: g.time, heavy: ac.wake === 'H' };
      }
      return;
    }
    if (ac.state === 'lineup' && !ac.ctoPending && this.runwayFree(ac, true)) {
      this.cmd(ac, 'cto');
      this.lastTakeoff[ac.runway.phys] = { t: g.time, heavy: ac.wake === 'H' };
      return;
    }
    if (!ac.isArr && ac.airborne && ac.alt >= 1500) { this.cmd(ac, 'ho'); return; }
    if (ac.isArr && ac.est && !ac.landClr && ac.finalGeometry().along < 8) this.cmd(ac, 'cl');
  }

  // Departure may go if it is first in the queue, the runway is empty, nothing is within
  // 4 nm of landing on the same runway, and departure spacing has passed.
  runwayFree(ac, linedUp = false) {
    const g = this.game;
    const phys = ac.runway.phys;
    if (!linedUp) {
      const queue = g.aircraft.filter((o) => o.state === 'ground' && o.runway.phys === phys && o.cleared);
      if (queue[0] !== ac) return false;
    }
    // 1 minute between departures, 2 minutes behind a heavy (wake turbulence).
    const last = this.lastTakeoff[phys];
    if (last && g.time - last.t < (last.heavy ? 120 : 60)) return false;
    return !g.aircraft.some((o) => o !== ac && o.runway?.phys === phys && (
      ['lineup', 'takeoff', 'landed'].includes(o.state) || (o.state === 'taxi' && o.vacating) ||
      (o.isArr && o.airborne && o.ils && o.finalGeometry().along < 4 && o.finalGeometry().along > -1) ||
      (!o.isArr && o.airborne && o.alt < 1000)));
  }

  // ---------- AI approach ----------
  approach(ac) {
    if (!ac.airborne) return;
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
    const need = (lead, ac) => (lead.wake === 'H' ? (ac.wake === 'H' ? 4 : 5) : 3) + 4;
    for (const list of Object.values(byRwy)) {
      const flowing = list.filter((e) => e.ac.mode !== 'hold').sort((a, b) => a.rem - b.rem);
      const holding = list.filter((e) => e.ac.mode === 'hold').sort((a, b) => a.ac.holdSince - b.ac.holdSince);

      for (let i = 1; i < flowing.length; i++) {
        const lead = flowing[i - 1], { ac, rem } = flowing[i];
        if (ac.owner !== 'APP') continue;
        const n = need(lead.ac, ac);
        const gap = rem - lead.rem;
        // Close in: slow to final approach speed early to stop the gap shrinking.
        if (rem < 16) { if (gap < n && ac.tgtSpd !== ac.perf.vapp + 10) this.cmd(ac, `s ${ac.perf.vapp + 10}`); continue; }
        if (ac.est) continue;
        if (gap < n - 2 && rem > 20 && ac.route.length) {
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

      // Release the first aircraft in the hold when there is a gap in the flow for it.
      const first = holding[0];
      if (first && first.ac.owner === 'APP' && first.ac.hold.phase === 'inbound') {
        const clear = flowing.every((f) => Math.abs(f.rem - first.rem) > need(f.ac, first.ac) + 2);
        if (clear) this.cmd(first.ac, `app ${first.ac.rwy}`);
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
        g.log(`Ravenwood Tower: ${ac.cs} is on a ${ac.finalGeometry().along.toFixed(0)} nm final, still on your frequency — transfer it (ho) or it will go around`, 'err');
      }
    }
  }
}
