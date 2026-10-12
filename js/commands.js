// Command line parser. Syntax:  [CALLSIGN] cmd [arg] [cmd [arg] ...]
// e.g.  BAW123 h 270 a 5000 s 210     |    i 26L    |    EZY45 caf    |    dct NORAX
const COMMAND_HELP = [
  ['CAF', 'Cleared as filed (IFR clearance, SID, squawk, climb ' + SID_TOP + ')'],
  ['PB [E|W]', 'Pushback, ending up facing east or west'],
  ['TAXI [A7|26R|12] [VIA P J3 A]', 'Taxi to a holding point / runway / stand, via the taxiways in that order (or click them on the ground chart)'],
  ['HPOS / CONT', 'Hold position / continue taxi'],
  ['LU [rwy]', 'Line up and wait'],
  ['CTO [rwy]', 'Cleared for take-off'],
  ['H 270 / FH 270', 'Fly heading (shortest turn)'],
  ['TL 180 / TR 090', 'Turn left / right heading'],
  ['A 5000 / C FL120 / D 30', 'Climb/descend (values ≤ 600 are flight levels)'],
  ['S 210 / S RS', 'Speed / resume normal speed'],
  ['DCT NORAX', 'Proceed direct to waypoint (then continue route)'],
  ['I 26L / ILS 26L', 'Cleared ILS approach (intercept from vectors)'],
  ['APP 26R', 'Cleared full approach: fly IAF→IF→FAF, descend via, then ILS'],
  ['HOLD [fix] [inbound] [L|R] [1.5M]', 'Hold: as published, or with your own inbound course / turns / leg time'],
  ['RES', 'Resume own navigation on the route'],
  ['GA', 'Go around'],
  ['CL', 'Cleared to land (tower) — without it arrivals go around at 1 nm'],
  ['ASM', 'Assume an aircraft handed to you (its tag flashes until you do)'],
  ['ACK', 'Acknowledge a MAYDAY / PAN call (alerts the emergency services)'],
  ['HO', 'Transfer: Ground→Tower (departures), Tower→Ground (vacated arrivals), Tower→Departure, Approach→Tower, Departure→Control'],
  ['SQ 4521', 'Squawk code'],
  ['DEL', 'Delete aircraft'],
  ['.pause  .speed 2', 'Pause / simulation rate (1, 2, 4)'],
  ['.pos gnd|twr|app|all', 'Switch controller position (the other one is flown by AI)'],
  ['.gnd / .radar', 'Show the ground (taxi) chart / the radar scope'],
  ['.emg [type] / .emg off|rare|normal', 'Trigger an emergency now (engine, bird, medical, fuel, pressure, hydraulic, radio) or set how often they happen'],
  ['.rbl clear', 'Remove all range/bearing lines (Shift+drag or middle-drag draws one)'],
  ['.autotaxi', 'Toggle automatic taxiing of your aircraft'],
  ['.config 26 / 08', 'Change runway configuration'],
  ['.traffic low|med|high', 'Traffic density'],
  ['.routes all|sel|off', 'Route line display'],
  ['.procs', 'Toggle SID/STAR/approach overlay'],
  ['.voice', 'Toggle pilot voice readbacks'],
  ['.help', 'Show help'],
];

const CMD_ALIASES = {
  H: 'H', FH: 'H', HDG: 'H', TL: 'TL', TR: 'TR',
  A: 'A', C: 'A', D: 'A', ALT: 'A', CM: 'A', DM: 'A', FL: 'FL',
  S: 'S', SPD: 'S',
  DCT: 'DCT', DIR: 'DCT', PD: 'DCT', DT: 'DCT',
  I: 'I', ILS: 'I', APP: 'APP',
  CL: 'CL', CTL: 'CL', CLAND: 'CL', ASM: 'ASM', ASSUME: 'ASM', ACK: 'ACK', ROGER: 'ACK',
  PB: 'PB', PUSH: 'PB', TAXI: 'TAXI', TX: 'TAXI', HPOS: 'HPOS', HOLDPOS: 'HPOS', CONT: 'CONT',
  CAF: 'CAF', CLR: 'CAF', LU: 'LU', LUAW: 'LU', CTO: 'CTO', CT: 'CTO', TO: 'CTO',
  HOLD: 'HOLD', RES: 'RES', RON: 'RES', GA: 'GA', HO: 'HO', CTR: 'HO', SQ: 'SQ', DEL: 'DEL',
};

function parseAltitude(tok) {
  if (!tok) return null;
  let t = tok.toUpperCase();
  let fl = false;
  if (t.startsWith('FL')) { t = t.slice(2); fl = true; }
  const n = parseInt(t, 10);
  if (isNaN(n)) return null;
  return fl || n <= 600 ? n * 100 : n;
}

function parseRunway(tok) {
  if (!tok) return null;
  let t = tok.toUpperCase().replace(/^(RWY|R)(?=\d)/, '');
  if (/^\d[LR]$/.test(t)) t = '0' + t;
  return RUNWAYS[t] ? t : null;
}

class CommandProcessor {
  constructor(game) { this.game = game; }

  // opts.ai: issued by the AI controller (no ownership check, dimmed in the log).
  execute(line, opts = {}) {
    const g = this.game;
    this.opts = opts;
    line = line.trim();
    if (!line) return;
    if (line.startsWith('.')) return this.system(line.slice(1).trim().split(/\s+/));

    let toks = line.toUpperCase().split(/\s+/);
    // Glued forms like I26L, H270 or DCTNORAX.
    const taxiCtx = toks.includes('TAXI') || toks.includes('TX'); // taxiway names like A7/H1 stay whole
    toks = toks.flatMap((t) => {
      if (taxiCtx) return [t];
      const m = t.match(/^(ILS|I|APP|H|FH|TL|TR|S|A|C|D|LU|CTO)(\d+[LR]?)$/);
      return m && !g.findAircraft(t) ? [m[1], m[2]] : [t];
    });

    let ac = null;
    if (!CMD_ALIASES[toks[0]]) {
      ac = g.findAircraft(toks[0]);
      if (!ac) return g.log(`Unknown callsign or command "${toks[0]}"`, 'err');
      toks.shift();
      if (!opts.ai) g.select(ac);
      if (!toks.length) return;
    } else {
      ac = g.selected;
      if (!ac) return g.log('No aircraft selected — click one or start with its callsign', 'err');
    }
    if (!opts.ai && !g.userOwns(ac)) {
      const who = POSITIONS[ac.owner];
      return g.log(`${ac.cs} is not on your frequency — it is with ${who.name}${ac.owner !== 'CTR' ? ' (AI)' : ''}`, 'err');
    }
    g.log(`${opts.ai ? `[${POSITIONS[ac.owner].short} AI] ` : ''}${ac.cs} ${toks.join(' ').toLowerCase()}`, opts.ai ? 'ai' : 'ctl');
    // Radio failure: the crew can't hear us (only an acknowledgement on our side is possible).
    if (ac.emg?.type === 'RADIO' && !ac.emg.done && ac.state === 'air' && !toks.every((t) => CMD_ALIASES[t] === 'ACK')) {
      return g.log(`${ac.cs}: — no reply — (squawking 7600)`, opts.ai ? 'ai' : 'emg');
    }

    const rb = [];
    const cur = { toks, i: 0, next() { return this.toks[++this.i]; }, peek() { return this.toks[this.i + 1]; } };
    while (cur.i < toks.length) {
      const cmd = CMD_ALIASES[toks[cur.i]];
      if (!cmd) { rb.push(`say again "${toks[cur.i].toLowerCase()}"?`); cur.i++; continue; }
      const res = this.apply(ac, cmd, cur);
      if (res) rb.push(res);
      cur.i++;
    }
    ac._pred = null; // re-predict the flight path
    if (rb.length) g.pilotSay(ac, rb.join(', '), !!opts.ai);
  }

  needAir(ac) { return ac.airborne ? null : 'unable, we are on the ground'; }

  apply(ac, cmd, cur) {
    const g = this.game;
    const arg = () => cur.next();
    switch (cmd) {
      case 'H': case 'TL': case 'TR': {
        const n = parseInt(arg(), 10);
        if (isNaN(n) || n < 0 || n > 360) return 'say again heading?';
        if (this.needAir(ac)) return this.needAir(ac);
        if (ac.est) { ac.est = ac.gs = false; }
        ac.mode = 'heading';
        ac.hold = null;
        ac.tgtHdg = Geo.norm(n);
        ac.turnDir = cmd === 'TL' ? 'L' : cmd === 'TR' ? 'R' : null;
        const word = cmd === 'TL' ? 'turn left heading' : cmd === 'TR' ? 'turn right heading' : 'heading';
        return `${word} ${Geo.fmtHdg(n)}`;
      }
      case 'A': case 'FL': {
        const t = arg();
        const alt = cmd === 'FL' ? parseInt(t, 10) * 100 : parseAltitude(t);
        if (!alt || isNaN(alt)) return 'say again altitude?';
        if (alt < 2000 && ac.isArr) return 'unable, minimum vectoring altitude is 2000';
        if (alt > 41000) return 'unable that level';
        if (ac.gs) return 'we are on the glideslope';
        const was = ac.state === 'air' ? ac.alt : 0;
        ac.tgtAlt = alt;
        const verb = alt > was + 50 ? 'climb' : alt < was - 50 ? 'descend' : 'maintain';
        if (alt >= AIRPORT.transAlt + 500) return `${verb} flight level ${Math.round(alt / 100)}`;
        // Descending through the transition level: pilots set the airfield QNH.
        const qnh = was >= AIRPORT.transAlt + 500 ? `, QNH ${AIRPORT.qnh}` : '';
        return `${verb} altitude ${alt} ft${qnh}`;
      }
      case 'S': {
        const t = arg();
        if (t === 'RS' || t === 'NORM' || t === '0') { ac.tgtSpd = null; return 'resume normal speed'; }
        const n = parseInt(t, 10);
        if (isNaN(n)) return 'say again speed?';
        if (n < ac.perf.vapp) return `unable, minimum speed ${ac.perf.vapp}`;
        if (n > ac.perf.max) return `unable, maximum speed ${ac.perf.max}`;
        ac.tgtSpd = n;
        return `speed ${n}`;
      }
      case 'DCT': {
        const name = arg();
        const fix = name && FIXES[name];
        if (!fix) return `unable, unknown waypoint ${name || ''}`.trim();
        if (this.needAir(ac) && ac.state !== 'ground') return this.needAir(ac);
        this.directTo(ac, name);
        return `direct ${name}`;
      }
      case 'I': case 'APP': {
        const rwy = parseRunway(arg());
        if (!rwy) return 'say again runway?';
        // Optional entry fix: "app 26R NORAX" or "app 26R via NORAX".
        let via = null;
        if (cmd === 'APP') {
          if (cur.peek() === 'VIA') { cur.i++; via = cur.next() || ''; }
          else via = this.optional(cur, (t) => (FIXES[t] ? t : null));
        }
        if (!ac.isArr) return 'unable, we are a departure';
        if (this.needAir(ac)) return this.needAir(ac);
        if (via !== null && !this.approachVia(ac, rwy, via)) {
          const a = APPROACHES[rwy];
          return `unable${via ? ` ${via}` : ''}, expect the runway ${rwy} approach via ${a.outer}, ${a.straightIn} or ${a.if}`;
        }
        if (rwy !== ac.rwy) { ac.rwy = rwy; ac.est = ac.gs = false; }
        ac.ils = true;
        ac.prevLateral = null;
        ac.endOfRouteWarned = false;
        if (cmd === 'APP') {
          if (ac.est) return `cleared ILS approach runway ${rwy}, established`;
          const entry = this.assignApproach(ac, rwy, via);
          return `cleared ILS approach runway ${rwy} via ${entry}`;
        }
        return `cleared ILS runway ${rwy}`;
      }
      case 'CAF': {
        if (ac.isArr) return 'we are already IFR, inbound';
        if (ac.cleared) return 'already have our clearance';
        ac.cleared = true;
        ac.tgtAlt = SID_TOP;
        g.log(`${ac.cs} cleared to ${ac.dest} via ${ac.sid} departure, runway ${ac.rwy}, climb ${SID_TOP}, squawk ${ac.squawk}`, 'sys');
        return `cleared to ${ac.dest}, ${ac.sid} departure, runway ${ac.rwy}, climb ${SID_TOP} ft, squawk ${ac.squawk}`;
      }
      case 'LU': case 'CTO': {
        const r = this.optional(cur, parseRunway) || ac.rwy;
        if (ac.isArr || ac.state === 'air') return 'unable, we are airborne';
        if (ac.state === 'takeoff') return 'already rolling';
        if (cmd === 'CTO' && !ac.cleared) return 'unable, we have not received our IFR clearance yet';
        if (ac.state !== 'ground' && ac.state !== 'lineup') return `unable, we are not at the holding point yet${ac.state === 'stand' ? ' — still on stand ' + ac.stand : ''}`;
        if (r !== ac.rwy) return `unable, we are at the holding point for runway ${ac.rwy}`;
        if (ac.state === 'lineup' && cmd === 'LU') return 'already lined up';
        if (ac.state === 'lineup' && ac.ctoPending) return 'already cleared for take-off';
        if (!this.opts.ai && ac.state === 'ground') g.checkRunwayClear(ac);
        // From the holding point the aircraft taxis onto the runway; a take-off clearance rolls once aligned.
        if (ac.state === 'ground') ac.beginLineup(cmd === 'CTO');
        else if (cmd === 'CTO') {
          if (ac.lining) ac.ctoPending = true;
          else { ac.state = 'takeoff'; ac.spd = 0; ac.hdg = ac.tgtHdg = ac.runway.heading; }
        }
        return cmd === 'LU' ? `lining up runway ${r}` : `cleared for take-off runway ${r}`;
      }
      case 'HOLD': {
        if (this.needAir(ac)) return this.needAir(ac);
        if (ac.emg?.noHold && !ac.emg.done) return 'unable to hold, MAYDAY fuel';
        const fix = this.optional(cur, (t) => FIXES[t] && t) || (ac.mode === 'route' && ac.route[0]) || null;
        if (!fix) return 'say again hold fix?';
        const inbound = this.optional(cur, (t) => (/^\d{3}$/.test(t) && +t <= 360 ? +t || 360 : null));
        const turn = this.optional(cur, (t) => ({ L: 'L', LEFT: 'L', R: 'R', RIGHT: 'R' })[t] || null);
        const leg = this.optional(cur, (t) => {
          const m = t.match(/^(\d(?:\.\d)?)(M|MIN)$/);
          return m ? parseFloat(m[1]) * 60 : null;
        });
        const h = ac.enterHold(fix, inbound, turn, leg);
        const published = HOLDS[fix] && inbound === null && turn === null;
        return `hold at ${fix}${published ? ' as published' : ''}, inbound ${Geo.fmtHdg(h.inbound)}, ` +
          `${h.turn === 'R' ? 'right' : 'left'} turns${leg ? `, ${leg / 60} minute legs` : ''}`;
      }
      case 'RES': {
        if (this.needAir(ac)) return this.needAir(ac);
        if (!ac.route.length) return 'unable, no route to resume';
        ac.mode = 'route';
        ac.hold = null;
        // Skip fixes already behind the aircraft.
        while (ac.route.length > 1) {
          const a = FIXES[ac.route[0]], b = FIXES[ac.route[1]];
          if (Geo.dist(ac, b) < Geo.dist(a, b)) ac.route.shift(); else break;
        }
        return `resuming own navigation, direct ${ac.route[0]}`;
      }
      case 'GA':
        if (!ac.isArr || !ac.airborne) return 'unable';
        ac.goAround(g, 'going around');
        return null;
      case 'HO': {
        if (ac.handedOff) return 'already with next sector';
        let next = null;
        if (ac.owner === 'GND') next = !ac.isArr && ac.onGround() ? 'TWR' : null;
        else if (ac.owner === 'TWR') next = ac.isArr ? (ac.state === 'taxi' || ac.state === 'parked' ? 'GND' : null) : ac.airborne ? 'APP' : null;
        else if (ac.owner === 'APP') next = ac.isArr ? 'TWR' : 'CTR';
        if (g.position === 'ALL' && !this.opts.ai) next = !ac.isArr && ac.airborne ? 'CTR' : null;
        if (!next) {
          if (ac.isArr && ac.airborne) return 'unable, we are already with tower for landing';
          if (ac.isArr && ac.state === 'landed') return 'unable, still rolling out';
          if (!ac.isArr && ac.owner === 'TWR' && !ac.airborne) return 'unable, we are waiting for departure';
          return 'unable';
        }
        if (next === 'TWR' && ac.isArr && !ac.ils) return 'unable, we are not cleared for an approach yet';
        if (next === 'CTR' && !ac.airborne) return 'unable, we are on the ground';
        g.transfer(ac, next, { ai: !!this.opts.ai });
        return `contact ${POSITIONS[next].call} ${POSITIONS[next].freq}, good day`;
      }
      case 'PB': {
        if (ac.state !== 'stand') return 'unable, we are not on stand';
        if (!ac.isArr && !ac.cleared) return 'unable, we need our clearance first';
        const face = this.optional(cur, (t) => ({ E: 'E', EAST: 'E', W: 'W', WEST: 'W' })[t] || null);
        const f = ac.pushback(face);
        return `pushback approved, facing ${f === 'E' ? 'east' : 'west'}`;
      }
      case 'TAXI': {
        if (!['stand', 'pushback', 'taxi', 'ground'].includes(ac.state)) return ac.state === 'landed' ? 'unable, still rolling out' : 'unable';
        if (!ac.isArr && !ac.cleared) return 'unable, we need our IFR clearance first';
        if (ac.state === 'pushback' && !ac.pushTo) return 'unable';
        // Optional target: holding point (A7), runway (26R), or stand number (12 / S12).
        let target = this.optional(cur, (t) => {
          if (GROUND.nodes[t]?.kind === 'hold') return t;
          const rw = parseRunway(t);
          if (rw && !ac.isArr) return GROUND.holdingPoints[rw];
          const m = t.match(/^(?:S|ST|STAND)?(\d{1,2})$/);
          if (m && GROUND.stands[+m[1]]) return `ST${+m[1]}`;
          return null;
        });
        if (!target) target = ac.isArr ? (ac.stand ? `ST${ac.stand}` : null) : GROUND.holdingPoints[ac.rwy];
        if (!target) return 'say again taxi instructions?';
        // Taxiing to the other parallel runway's holding point: switch runway if a matching departure exists.
        const newRwy = !ac.isArr && Object.keys(GROUND.holdingPoints).find((r) => GROUND.holdingPoints[r] === target && RUNWAYS[r].heading === ac.runway.heading);
        if (newRwy && newRwy !== ac.rwy) {
          const exit = ac.route[ac.route.length - 1];
          const sid = PROCS[g.config].sids.find((p) => p.rwy === newRwy && p.fixes[p.fixes.length - 1] === exit);
          if (!sid) return `unable, no ${exit} departure from runway ${newRwy}`;
          Object.assign(ac, { rwy: newRwy, sid: sid.name, route: sid.fixes.slice() });
        } else if (!ac.isArr && GROUND.nodes[target]?.kind === 'hold' && !newRwy && Object.values(GROUND.holdingPoints).includes(target)) {
          return `unable, holding point ${target} is not for our departure runway`;
        }
        if (target.startsWith('ST')) {
          const num = +target.slice(2);
          if (!ac.isArr) return 'unable, we are a departure';
          if (num !== ac.stand && g.aircraft.some((o) => o !== ac && o.stand === num && o.state !== 'gone' && (o.isArr || o.state === 'stand'))) return `unable, stand ${num} is occupied`;
          ac.stand = num;
        }
        const via = [];
        if (cur.peek() === 'VIA') { cur.i++; while (cur.peek() && GROUND.taxiwayNames.has(cur.peek())) via.push(cur.next()); }
        const r = ac.startTaxi(target, via);
        if (!r) return 'unable, no taxi route';
        const names = r.names.filter((n, i) => !(i === r.names.length - 1 && n === target));
        const isRwyHp = Object.values(GROUND.holdingPoints).includes(target);
        const dest = target.startsWith('ST') ? `stand ${ac.stand}` : isRwyHp ? `holding point ${target}, runway ${ac.rwy}` : `holding point ${target}`;
        return `${ac.state === 'pushback' ? 'pushback and ' : ''}taxi to ${dest}${names.length ? ' via ' + names.join(', ') : ''}`;
      }
      case 'HPOS':
        if (ac.state !== 'taxi') return 'unable';
        ac.holdPos = true;
        return 'holding position';
      case 'CONT':
        if (ac.state !== 'taxi' || !ac.holdPos) return 'unable';
        ac.holdPos = false;
        return 'continuing taxi';
      case 'ACK': {
        if (!ac.emg || ac.emg.done) return null;
        if (g.emergency.acknowledge(ac)) g.log(`${ac.cs}, roger ${ac.emg.level === 'RADIO' ? 'radio failure' : ac.emg.level}${ac.emg.level !== 'RADIO' ? ', emergency services alerted' : ''}`, 'ctl');
        return null;
      }
      case 'ASM':
        if (ac.incoming === null || ac.incoming === undefined) return null;
        ac.incoming = null;
        g.log(`${ac.cs} assumed`, 'sys');
        return null;
      case 'CL': {
        if (!ac.isArr || !ac.airborne) return 'unable';
        if (!ac.ils) return 'unable, we are not cleared for an approach';
        if (ac.landClr) return 'already cleared to land';
        if (!this.opts.ai) g.warnRunwayOccupied(ac);
        ac.landClr = true;
        return `cleared to land runway ${ac.rwy}, wind ${g.windText()}`;
      }
      case 'SQ': {
        const code = arg();
        if (!/^[0-7]{4}$/.test(code || '')) return 'say again squawk?';
        ac.squawk = code;
        return `squawk ${code}`;
      }
      case 'DEL':
        ac.state = 'gone';
        g.log(`${ac.cs} deleted`, 'sys');
        return null;
    }
    return null;
  }

  // Optional argument: consume the next token only if `parse` accepts it.
  optional(cur, parse) {
    const t = cur.peek();
    const v = t !== undefined && !CMD_ALIASES[t] ? parse(t) : null;
    if (v) cur.i++;
    return v;
  }

  directTo(ac, name) {
    const idx = ac.route.indexOf(name);
    if (idx >= 0) ac.route = ac.route.slice(idx);
    // An approach fix of the arrival's own runway: continue with that approach from there.
    else if (ac.isArr && approachOf(name)?.rwy === ac.rwy) ac.route = approachFrom(ac.rwy, name);
    else {
      // Off-route fix: fly to it, then rejoin the route at the nearest point ahead.
      const fix = FIXES[name];
      let rest = ac.route.slice();
      if (rest.length) {
        // Never rejoin beyond the first approach fix (IAF/IF), so the approach is still flown properly.
        const appIdx = rest.findIndex((n) => FIXES[n].type === 'iaf' || FIXES[n].type === 'if');
        const maxK = appIdx >= 0 ? appIdx : rest.length - 1;
        let k = 0;
        rest.forEach((n, i) => { if (i <= maxK && Geo.dist(fix, FIXES[n]) < Geo.dist(fix, FIXES[rest[k]])) k = i; });
        // Skip the rejoin fix if reaching it means flying back against the route's direction.
        const cur = FIXES[rest[k]], next = rest[k + 1] && FIXES[rest[k + 1]];
        if (next && k < maxK && (cur.x - fix.x) * (next.x - cur.x) + (cur.y - fix.y) * (next.y - cur.y) < 0) k++;
        rest = rest.slice(k);
      }
      ac.route = [name, ...rest];
    }
    if (ac.state !== 'ground') {
      ac.mode = 'route';
      ac.hold = null;
      if (ac.est) ac.est = ac.gs = false;
    }
  }

  // Route for "app RWY via FIX": direct to one of the runway's approach fixes, or along the current route
  // from a fix on it that leads into the approach. Null if the fix can't be used.
  approachVia(ac, rwy, via) {
    if (approachFrom(rwy, via)) return approachFrom(rwy, via);
    const i = ac.route.indexOf(via);
    return i >= 0 ? this.intoApproach(ac.route.slice(i), rwy) : null;
  }

  // A route cut off where it reaches the runway's approach, continuing with that approach; null if it never does.
  intoApproach(route, rwy) {
    const k = route.findIndex((n) => approachFrom(rwy, n));
    return k < 0 ? null : route.slice(0, k).concat(approachFrom(rwy, route[k]));
  }

  // Approach entries in order of preference from where the aircraft is: the straight-in IAF from behind the
  // final, the outer IAF from the outer side, the IF from abeam or inside the T, the FAF when already close in.
  entryCandidates(ac, rwy) {
    const a = APPROACHES[rwy];
    const { along, lateral } = ac.finalGeometry(RUNWAYS[rwy]);
    const outer = lateral * a.side; // positive on the outer side
    const cone = (from) => along > from + 1 && Math.abs(lateral) <= Math.tan(Geo.rad(60)) * (along - from);
    const A = a.ifAlong;
    if (cone(A + 6)) return [a.straightIn, a.if, a.outer, a.faf];
    if (cone(A)) return [a.if, a.straightIn, a.outer, a.faf];
    if (along >= A - 2) return outer >= 4 ? [a.outer, a.if, a.straightIn, a.faf] : [a.if, a.outer, a.straightIn, a.faf];
    if (along >= 8.8 && Math.abs(lateral) <= Math.tan(Geo.rad(60)) * (along - 6.3)) return [a.faf, a.if, a.outer, a.straightIn];
    return outer > 0 ? [a.outer, a.if, a.faf, a.straightIn] : [a.if, a.outer, a.faf, a.straightIn];
  }

  // Fly a silent copy of the aircraft along `route` with the approach clearance: does it get established
  // (outside 4 nm) and land without going around?
  trialApproach(ac, rwy, route) {
    let wentAround = false, estAlong = null;
    const game = Object.assign({}, SILENT_GAME, { onGoAround() { wentAround = true; } });
    const g = Object.assign(Object.create(Aircraft.prototype), ac, {
      route: route.slice(), rwy, mode: 'route', hold: null, leg: null, app: true, ils: true, est: false, gs: false,
      landClr: true, trail: [], endOfRouteWarned: true, prevLateral: null,
    });
    for (let t = 0; t < 2400 && g.state === 'air'; t++) {
      g.update(1, game);
      if (wentAround || Math.hypot(g.x, g.y) > AIRPORT.radarRange) return false;
      if (g.est && estAlong === null) estAlong = g.finalGeometry().along;
    }
    return g.state === 'landed' && estAlong >= 4;
  }

  // Set up the approach clearance and return the fix the approach is flown from. Without a fix given, a route
  // that already leads into the approach (the STAR, or the hold fix onwards) is kept; otherwise the pilot picks
  // the preferred entry for the aircraft's position that a quick trial shows leads to a stable approach.
  assignApproach(ac, rwy, via = null) {
    let route = via ? this.approachVia(ac, rwy, via) : null;
    if (!route) {
      let kept = null;
      if (ac.mode === 'route') kept = this.intoApproach(ac.route, rwy);
      if (ac.mode === 'hold' && ac.route.includes(ac.hold.fix)) kept = this.intoApproach(ac.route.slice(ac.route.indexOf(ac.hold.fix)), rwy);
      const options = (kept ? [kept] : []).concat(this.entryCandidates(ac, rwy).map((f) => approachFrom(rwy, f)));
      route = options.find((r) => this.trialApproach(ac, rwy, r)) || options[0];
    }
    ac.route = route;
    ac.mode = 'route';
    ac.hold = null;
    ac.app = true;
    return route.find((n) => approachFrom(rwy, n));
  }

  system(t) {
    const g = this.game;
    const cmd = (t[0] || '').toLowerCase();
    const a = (t[1] || '').toLowerCase();
    switch (cmd) {
      case 'pause': case 'p': g.togglePause(); break;
      case 'speed': case 'rate': {
        const r = parseFloat(a);
        if ([1, 2, 4].includes(r)) g.setRate(r); else g.log('Usage: .speed 1|2|4', 'err');
        break;
      }
      case 'config': case 'rwy':
        if (PROCS[a]) g.setConfig(a); else g.log('Usage: .config 26 | .config 08', 'err');
        break;
      case 'traffic':
        if (['low', 'med', 'high'].includes(a)) g.setTraffic(a); else g.log('Usage: .traffic low|med|high', 'err');
        break;
      case 'routes':
        if (['all', 'sel', 'off'].includes(a)) { g.radar.setRoutes(a); g.log(`Route display: ${a}`, 'sys'); }
        else g.log('Usage: .routes all|sel|off', 'err');
        break;
      case 'procs': g.radar.showProcs = !g.radar.showProcs; g.log(`Procedure overlay ${g.radar.showProcs ? 'on' : 'off'}`, 'sys'); break;
      case 'voice': g.voice = !g.voice; g.log(`Pilot voice ${g.voice ? 'on' : 'off'}`, 'sys'); break;
      case 'help': case '?': g.ui.toggleHelp(true); break;
      case 'clear': g.ui.clearLog(); break;
      case 'restart': g.restart(); break;
      case 'gnd': case 'ground': case 'taxi': g.setView('ground'); break;
      case 'emg': case 'emergency': {
        const typ = a ? a.toUpperCase() : null;
        if (typ && ['OFF', 'RARE', 'NORMAL'].includes(typ)) { g.emergency.setRate(a); g.log(`Emergencies: ${a}`, 'sys'); g.ui.update(); break; }
        if (typ && !EMERGENCIES[typ]) { g.log(`Usage: .emg [${Object.keys(EMERGENCIES).join('|').toLowerCase()}] or .emg off|rare|normal`, 'err'); break; }
        if (!g.emergency.trigger(typ, g.selected)) g.log('No suitable aircraft for that emergency right now', 'err');
        break;
      }
      case 'rbl': g.radar.rbls = []; g.log('Range/bearing lines cleared', 'sys'); break;
      case 'radar': case 'scope': g.setView('radar'); break;
      case 'autotaxi': g.autoTaxi = !g.autoTaxi; g.log(`Automatic taxi ${g.autoTaxi ? 'on' : 'off'}`, 'sys'); g.ui.update(); break;
      case 'pos': case 'position': {
        const p = a.toUpperCase();
        if (['ALL', 'GND', 'TWR', 'APP'].includes(p)) g.setPosition(p); else g.log('Usage: .pos gnd | twr | app | all', 'err');
        break;
      }
      default: g.log(`Unknown system command ".${cmd}" — try .help`, 'err');
    }
  }
}
