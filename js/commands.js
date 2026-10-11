// Command line parser. Syntax:  [CALLSIGN] cmd [arg] [cmd [arg] ...]
// e.g.  BAW123 h 270 a 5000 s 210     |    i 26L    |    EZY45 caf    |    dct NORAX
const COMMAND_HELP = [
  ['CAF', 'Cleared as filed (IFR clearance, SID, squawk, climb ' + SID_TOP + ')'],
  ['LU [rwy]', 'Line up and wait'],
  ['CTO [rwy]', 'Cleared for take-off'],
  ['H 270 / FH 270', 'Fly heading (shortest turn)'],
  ['TL 180 / TR 090', 'Turn left / right heading'],
  ['A 5000 / C FL120 / D 30', 'Climb/descend (values ≤ 600 are flight levels)'],
  ['S 210 / S RS', 'Speed / resume normal speed'],
  ['DCT NORAX', 'Proceed direct to waypoint (then continue route)'],
  ['I 26L / ILS 26L', 'Cleared ILS approach (intercept from vectors)'],
  ['APP 26R', 'Cleared full approach: fly IAF→IF→FAF, descend via, then ILS'],
  ['HOLD [fix]', 'Hold at fix (right-hand turns, 1 min legs)'],
  ['RES', 'Resume own navigation on the route'],
  ['GA', 'Go around'],
  ['HO', 'Hand off / contact next sector (departures)'],
  ['SQ 4521', 'Squawk code'],
  ['DEL', 'Delete aircraft'],
  ['.pause  .speed 2', 'Pause / simulation rate (1, 2, 4)'],
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

  execute(line) {
    const g = this.game;
    line = line.trim();
    if (!line) return;
    if (line.startsWith('.')) return this.system(line.slice(1).trim().split(/\s+/));

    let toks = line.toUpperCase().split(/\s+/);
    // Glued forms like I26L, H270 or DCTNORAX.
    toks = toks.flatMap((t) => {
      const m = t.match(/^(ILS|I|APP|H|FH|TL|TR|S|A|C|D|LU|CTO)(\d+[LR]?)$/);
      return m && !g.findAircraft(t) ? [m[1], m[2]] : [t];
    });

    let ac = null;
    if (!CMD_ALIASES[toks[0]]) {
      ac = g.findAircraft(toks[0]);
      if (!ac) return g.log(`Unknown callsign or command "${toks[0]}"`, 'err');
      toks.shift();
      g.select(ac);
      if (!toks.length) return;
    } else {
      ac = g.selected;
      if (!ac) return g.log('No aircraft selected — click one or start with its callsign', 'err');
    }
    g.log(`${ac.cs} ${toks.join(' ').toLowerCase()}`, 'ctl');

    const rb = [];
    const cur = { toks, i: 0, next() { return this.toks[++this.i]; }, peek() { return this.toks[this.i + 1]; } };
    while (cur.i < toks.length) {
      const cmd = CMD_ALIASES[toks[cur.i]];
      if (!cmd) { rb.push(`say again "${toks[cur.i].toLowerCase()}"?`); cur.i++; continue; }
      const res = this.apply(ac, cmd, cur);
      if (res) rb.push(res);
      cur.i++;
    }
    if (rb.length) ac.say(g, rb.join(', '));
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
        return `${verb} ${alt >= AIRPORT.transAlt + 500 ? 'flight level ' + Math.round(alt / 100) : alt + ' ft'}`;
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
        if (!ac.isArr) return 'unable, we are a departure';
        if (this.needAir(ac)) return this.needAir(ac);
        if (rwy !== ac.rwy) { ac.rwy = rwy; ac.est = ac.gs = false; }
        ac.ils = true;
        ac.prevLateral = null;
        ac.endOfRouteWarned = false;
        if (cmd === 'APP') {
          this.assignApproach(ac, rwy);
          return `cleared ILS approach runway ${rwy} via ${ac.route[0]}`;
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
        if (r !== ac.rwy) {
          if (RUNWAYS[r].heading !== ac.runway.heading) return `unable, runway ${r} not in use for our departure`;
          ac.rwy = r;
        }
        ac.x = ac.runway.thr.x; ac.y = ac.runway.thr.y;
        ac.hdg = ac.tgtHdg = ac.runway.heading;
        g.checkRunwayClear(ac);
        if (cmd === 'LU') { ac.state = 'lineup'; return `lining up runway ${r}`; }
        ac.state = 'takeoff';
        ac.spd = 0;
        return `cleared for take-off runway ${r}`;
      }
      case 'HOLD': {
        if (this.needAir(ac)) return this.needAir(ac);
        const next = this.optional(cur, (t) => FIXES[t] && t) || ac.route[0];
        if (!next || !FIXES[next]) return 'say again hold fix?';
        ac.est = ac.gs = false;
        ac.mode = 'hold';
        ac.hold = { fix: next, phase: 'to', inbound: null, timer: 0 };
        return `hold at ${next}, right turns`;
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
        if (!ac.airborne) return 'unable';
        if (ac.handedOff) return 'already with next sector';
        g.handOff(ac);
        return ac.isArr ? 'contact tower, good day' : 'contact Ravenwood Control, good day';
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
    ac.route = idx >= 0 ? ac.route.slice(idx) : [name];
    if (ac.state !== 'ground') {
      ac.mode = 'route';
      ac.hold = null;
      if (ac.est) ac.est = ac.gs = false;
    }
  }

  // Build the approach route IAF→IF→FAF from where the aircraft is.
  assignApproach(ac, rwy) {
    const [iaf, ifx, faf] = APPROACHES[rwy];
    const { along } = ac.finalGeometry(RUNWAYS[rwy]);
    let start = 0;
    if (Geo.dist(ac, FIXES[ifx]) < Geo.dist(ac, FIXES[iaf]) && along > 8) start = 1;
    if (along < 11 && along > 6.5) start = 2;
    ac.route = [iaf, ifx, faf].slice(start);
    ac.mode = 'route';
    ac.hold = null;
    ac.app = true;
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
        if (['all', 'sel', 'off'].includes(a)) { g.radar.routes = a; g.log(`Route display: ${a}`, 'sys'); }
        else g.log('Usage: .routes all|sel|off', 'err');
        break;
      case 'procs': g.radar.showProcs = !g.radar.showProcs; g.log(`Procedure overlay ${g.radar.showProcs ? 'on' : 'off'}`, 'sys'); break;
      case 'voice': g.voice = !g.voice; g.log(`Pilot voice ${g.voice ? 'on' : 'off'}`, 'sys'); break;
      case 'help': case '?': g.ui.toggleHelp(true); break;
      case 'clear': g.ui.clearLog(); break;
      case 'restart': g.restart(); break;
      default: g.log(`Unknown system command ".${cmd}" — try .help`, 'err');
    }
  }
}
