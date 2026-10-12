// Rare, realistic emergencies: MAYDAY / PAN calls, squawk 7700 / 7600, the aircraft's behaviour, and what happens
// after landing (emergency services, aircraft stopped on the runway for inspection or towing).
const EMERGENCIES = {
  ENGINE: { level: 'MAYDAY', phase: 'dep', label: 'ENGINE FAILURE' },
  BIRD: { level: 'PAN', phase: 'dep', label: 'BIRD STRIKE' },
  MEDICAL: { level: 'PAN', phase: 'arr', label: 'MEDICAL' },
  FUEL: { level: 'MAYDAY', phase: 'arr', label: 'MINIMUM FUEL' },
  PRESSURE: { level: 'MAYDAY', phase: 'high', label: 'DEPRESSURISATION' },
  HYDRAULIC: { level: 'PAN', phase: 'arr', label: 'HYDRAULIC FAILURE' },
  RADIO: { level: 'RADIO', phase: 'arr', label: 'RADIO FAILURE' },
};
const EMERGENCY_RATES = { off: null, rare: [1500, 2700], normal: [700, 1300] }; // seconds between emergencies

class EmergencyManager {
  constructor(game) {
    this.game = game;
    this.rate = 'rare';
    this.reset();
  }

  reset() { this.next = this.schedule(); }

  schedule() {
    const r = EMERGENCY_RATES[this.rate];
    return r ? this.game.time + r[0] + Math.random() * (r[1] - r[0]) : Infinity;
  }

  setRate(rate) { this.rate = rate; this.next = this.schedule(); }

  active() { return this.game.aircraft.filter((a) => a.emg && !a.emg.done && a.state !== 'gone'); }

  update() {
    const g = this.game;
    for (const ac of this.active()) this.tick(ac);
    if (g.time < this.next) return;
    this.next = this.schedule();
    if (this.active().length) return; // one at a time is enough
    this.trigger();
  }

  // Pick a suitable aircraft (preferably on the player's frequency) and give it an emergency.
  trigger(type = null, ac = null) {
    const g = this.game;
    const candidates = (t) => g.aircraft.filter((a) => {
      if (a.emg || a.state !== 'air' || a.handedOff || a.vfr) return false;
      const d = Math.hypot(a.x, a.y);
      const ph = EMERGENCIES[t].phase;
      if (ph === 'dep') return !a.isArr && a.alt > 1200 && a.alt < 7000 && d < 15;
      if (ph === 'high') return a.alt > 14000;
      return a.isArr && !a.est && d > 15 && d < 45;
    });
    const types = type ? [type] : Object.keys(EMERGENCIES).sort(() => Math.random() - 0.5);
    for (const t of types) {
      let list = ac ? [ac].filter((a) => candidates(t).includes(a)) : candidates(t);
      if (!list.length) continue;
      const mine = list.filter((a) => g.userOwns(a));
      if (mine.length) list = mine;
      this.declare(list[Math.floor(Math.random() * list.length)], t);
      return true;
    }
    return false;
  }

  souls(ac) {
    const seats = { A320: 180, A321: 220, B738: 189, E190: 100, DH8D: 78, A359: 300, B77W: 360, B744: 400, A20N: 186, A21N: 220, B38M: 189, B789: 290, A333: 300, AT76: 70, E195: 120 };
    return Math.round((seats[ac.type] || 150) * (0.7 + Math.random() * 0.28)) + 6;
  }

  declare(ac, type) {
    const g = this.game, E = EMERGENCIES[type];
    const souls = this.souls(ac);
    ac.emg = { type, level: E.level, label: E.label, t0: g.time, ack: false, souls, oldSquawk: ac.squawk };
    ac.squawk = type === 'RADIO' ? '7600' : '7700';
    const rwy = this.landingRunway(ac);
    const runway = `runway ${rwy}`;
    const call = (txt) => g.pilotSay(ac, txt, false);
    const mayday = 'MAYDAY MAYDAY MAYDAY';
    const pan = 'PAN PAN, PAN PAN, PAN PAN';
    switch (type) {
      case 'ENGINE':
        this.makeReturn(ac, rwy);
        ac.emg.climb = 0.45; ac.emg.maxSpd = 210; ac.emg.stop = Math.random() < 0.5;
        ac.tgtAlt = Math.max(Math.min(ac.tgtAlt, 4000), Math.ceil(ac.alt / 1000) * 1000 > 4000 ? Math.ceil(ac.alt / 1000) * 1000 : 3000);
        call(`${mayday}, ${ac.cs}, engine failure, stopping climb at ${ac.tgtAlt} feet, request radar vectors to return for ${runway}, ${souls} persons on board`);
        break;
      case 'BIRD':
        this.makeReturn(ac, rwy);
        ac.emg.climb = 0.8; ac.emg.maxSpd = 230;
        ac.tgtAlt = Math.max(3000, Math.min(ac.tgtAlt, 5000));
        call(`${pan}, ${ac.cs}, bird strike on departure, engine vibrations, request vectors to return for ${runway}, ${souls} persons on board`);
        break;
      case 'MEDICAL':
        ac.emg.bonusBy = g.time + 15 * 60;
        call(`${pan}, ${ac.cs}, medical emergency, passenger with suspected heart attack, request priority approach and an ambulance on arrival`);
        break;
      case 'FUEL':
        ac.emg.endurance = g.time + (18 + Math.random() * 10) * 60;
        ac.emg.noHold = true;
        call(`${mayday}, ${ac.cs}, MAYDAY fuel, fuel endurance ${Math.round((ac.emg.endurance - g.time) / 60)} minutes, request immediate approach ${runway}, unable to hold`);
        break;
      case 'PRESSURE':
        if (!ac.isArr) this.makeReturn(ac, rwy);
        ac.emg.desc = 2.2; ac.emg.maxSpd = 300;
        ac.mode = 'heading'; ac.hold = null; ac.tgtHdg = Geo.norm(ac.hdg + 30); ac.turnDir = 'R';
        ac.tgtAlt = 10000; ac.tgtSpd = null;
        call(`${mayday}, ${ac.cs}, rapid depressurisation, emergency descent to flight level 100, turning right heading ${Geo.fmtHdg(ac.tgtHdg)}, ${souls} persons on board`);
        break;
      case 'HYDRAULIC':
        ac.emg.vappAdd = 25; ac.emg.stop = true;
        call(`${pan}, ${ac.cs}, hydraulic failure, we will need a long final for ${runway}, we will stop on the runway, request emergency services standing by`);
        break;
      case 'RADIO':
        // Lost communications: squawk 7600 and follow the cleared route and approach, then land.
        if (!ac.app) { ac.rwy = rwy; ac.ils = true; ac.app = true; ac.mode = 'route'; if (!ac.route.length) ac.route = starRoute({ fixes: ['', APPROACHES[rwy].outer], rwy }); }
        ac.landClr = true;
        g.log(`${ac.cs} squawking 7600 — radio failure. Aircraft will continue on its route, fly the approach to ${ac.rwy} and land. Keep other traffic clear.`, 'emg');
        break;
    }
    g.log(`${E.level === 'RADIO' ? 'RADIO FAILURE' : E.level} — ${ac.cs} (${ac.type}) ${E.label}. Squawk ${ac.squawk}.${type !== 'RADIO' ? ' Acknowledge with "ack".' : ''}`, 'emg');
    ac._pred = null;
    g.ui.update();
  }

  // Departures with a problem become arrivals returning to land.
  makeReturn(ac, rwy) {
    ac.kind = 'arr';
    ac.rwy = rwy;
    ac.star = 'RETURN';
    ac.dest = AIRPORT.icao;
    ac.route = [];
    ac.mode = 'heading';
    ac.hold = null;
    ac.tgtHdg = ac.hdg;
    ac.turnDir = null;
    ac.handedOff = false;
    ac.app = ac.ils = false;
    if (ac.owner === 'CTR') ac.owner = 'APP';
  }

  // The arrival runway in use nearest to the aircraft's current runway direction.
  landingRunway(ac) {
    const rwys = this.game.arrivalRunways();
    if (rwys.includes(ac.rwy)) return ac.rwy;
    return rwys.slice().sort((a, b) => Geo.dist(ac, RUNWAYS[a].thr) - Geo.dist(ac, RUNWAYS[b].thr))[0];
  }

  tick(ac) {
    const g = this.game, e = ac.emg;
    if (e.type === 'FUEL' && ac.state === 'air' && g.time > e.endurance) {
      e.done = true;
      g.pilotSay(ac, 'MAYDAY fuel, we cannot accept any further delay, diverting immediately to the nearest suitable airfield', false);
      if (g.userOwns(ac) || g.position === 'ALL') g.addScore(-150, `${ac.cs} had to divert on minimum fuel`);
      ac.state = 'gone';
    }
    if (e.type === 'PRESSURE' && !e.levelled && ac.alt <= 10100) {
      e.levelled = true;
      ac.emg.desc = 1;
      g.pilotSay(ac, `level flight level 100, passengers on oxygen, request vectors for ${ac.rwy}`, false);
    }
  }

  acknowledge(ac) {
    const g = this.game, e = ac.emg;
    if (!e || e.ack) return false;
    e.ack = true;
    const quick = g.time - e.t0 < 45;
    if (quick && (g.userOwns(ac) || g.position === 'ALL')) g.addScore(20, `${ac.cs} ${e.level} acknowledged`);
    return true;
  }

  // Called when an emergency aircraft touches down.
  onLanded(ac) {
    const g = this.game, e = ac.emg;
    g.log(`${ac.cs} landed — emergency services in attendance${e.stop ? ', aircraft stopping on the runway' : ''}`, 'emg');
    if (g.userOwns(ac) || g.position === 'ALL') {
      let pts = 100;
      if (e.type === 'MEDICAL' && g.time < e.bonusBy) pts += 50;
      if (e.type === 'FUEL') pts += 50;
      g.addScore(pts, `${ac.cs} ${e.label.toLowerCase()} handled`);
    }
  }

  // Aircraft stopped on the runway: inspected, then towed clear and the runway reopened.
  onStopped(ac) {
    const g = this.game;
    ac.emg.stoppedAt = g.time;
    g.log(`Runway ${ac.rwy} blocked — ${ac.cs} stopped on the runway, fire service inspecting. Expect the runway closed for about 5 minutes.`, 'emg');
  }

  towed(ac) {
    const g = this.game;
    ac.emg.done = true;
    g.log(`${ac.cs} towed clear, runway ${ac.rwy} inspected and open`, 'emg');
    ac.state = 'gone';
  }
}
