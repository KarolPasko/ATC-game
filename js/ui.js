// DOM side panels: status bar, flight strips, selected-aircraft card, message log, command line.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

class UI {
  constructor(game) {
    this.game = game;
    this.history = [];
    this.histIdx = -1;
    this.input = $('cmd');
    this.buildHelp();
    this.bind();
  }

  bind() {
    const g = this.game;
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const v = this.input.value;
        if (v.trim()) { this.history.unshift(v); this.history.length = Math.min(this.history.length, 50); }
        this.histIdx = -1;
        this.input.value = '';
        g.commands.execute(v);
      } else if (e.key === 'ArrowUp') {
        if (this.histIdx < this.history.length - 1) this.input.value = this.history[++this.histIdx];
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        this.histIdx = Math.max(-1, this.histIdx - 1);
        this.input.value = this.histIdx >= 0 ? this.history[this.histIdx] : '';
        e.preventDefault();
      } else if (e.key === 'Escape') {
        this.input.value = '';
        g.select(null);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const list = g.aircraft.filter((a) => a.state !== 'gone');
        if (!list.length) return;
        const i = list.indexOf(g.selected);
        g.select(list[(i + (e.shiftKey ? list.length - 1 : 1)) % list.length]);
      }
    });
    // Typing anywhere goes to the command line.
    document.addEventListener('keydown', (e) => {
      if (e.target === this.input || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') { this.toggleHelp(false); return; }
      if (e.key.length === 1 || e.key === 'Tab') this.input.focus();
    });
    $('btn-pause').onclick = () => g.togglePause();
    for (const r of [1, 2, 4]) $(`btn-x${r}`).onclick = () => g.setRate(r);
    $('btn-help').onclick = () => this.toggleHelp(true);
    $('help-close').onclick = () => this.toggleHelp(false);
    $('help').addEventListener('click', (e) => { if (e.target.id === 'help') this.toggleHelp(false); });
    $('sel-config').onchange = (e) => g.setConfig(e.target.value);
    $('sel-traffic').onchange = (e) => g.setTraffic(e.target.value);
    $('sel-routes').onchange = (e) => g.radar.setRoutes(e.target.value);
    $('sel-pos').onchange = (e) => g.setPosition(e.target.value);
    $('sel-emg').onchange = (e) => { g.emergency.setRate(e.target.value); g.log(`Emergencies: ${e.target.value}`, 'sys'); };
    $('emgbar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cs]');
      if (!b) return;
      const ac = g.findAircraft(b.dataset.cs);
      if (!ac) return;
      if (b.dataset.ack) g.commands.execute(`${ac.cs} ack`);
      else g.select(ac);
    });
    $('sel-vector').onchange = (e) => { g.radar.vectorMin = +e.target.value; g.radar.saveScope(); };
    $('sel-history').onchange = (e) => { g.radar.historyDots = +e.target.value; g.radar.saveScope(); };
    for (const k of ['map', 'areas', 'airspace']) $(`chk-${k}`).onchange = (e) => { g.radar.layers[k] = e.target.checked; g.radar.saveScope(); };
    $('chk-autotaxi').onchange = (e) => { g.autoTaxi = e.target.checked; };
    $('tab-radar').onclick = () => g.setView('radar');
    $('tab-ground').onclick = () => g.setView('ground');
    $('chk-procs').onchange = (e) => { g.radar.showProcs = e.target.checked; };
    $('chk-voice').onchange = (e) => { g.voice = e.target.checked; };
    // Strip and quick-button clicks (delegated).
    $('strips').addEventListener('mousedown', (e) => {
      const row = e.target.closest('[data-cs]');
      if (row) g.select(g.findAircraft(row.dataset.cs));
    });
    $('card').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cmd]');
      if (!b || !g.selected) return;
      const cmd = b.dataset.cmd;
      if (cmd.startsWith('.')) g.commands.execute(cmd);
      else if (cmd.endsWith(' ')) { this.input.value = cmd; this.input.focus(); }
      else g.commands.execute(`${g.selected.cs} ${cmd}`);
    });
  }

  buildHelp() {
    $('help-table').innerHTML = COMMAND_HELP.map(([c, d]) => `<tr><td><code>${esc(c)}</code></td><td>${esc(d)}</td></tr>`).join('');
  }

  toggleHelp(show) { $('help').classList.toggle('show', show); }

  log(text, cls, time) {
    const el = $('log');
    const d = document.createElement('div');
    d.className = 'msg ' + cls;
    d.innerHTML = `<span class="t">${esc(time)}</span> ${esc(text)}`;
    el.appendChild(d);
    while (el.children.length > 200) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  }

  clearLog() { $('log').innerHTML = ''; }

  update() {
    const g = this.game;
    if (!g.aircraft) return;
    $('clock').textContent = g.clock();
    $('score').textContent = g.score;
    $('stats').textContent = `LDG ${g.stats.landed} · DEP ${g.stats.departed} · SEP ${g.stats.losses} · GA ${g.stats.goArounds}`;
    $('btn-pause').textContent = g.paused ? '▶ Resume' : '❚❚ Pause';
    $('btn-pause').classList.toggle('on', g.paused);
    for (const r of [1, 2, 4]) $(`btn-x${r}`).classList.toggle('on', g.rate === r);
    $('sel-config').value = g.config;
    $('sel-pos').value = g.position;
    $('sel-emg').value = g.emergency.rate;
    this.renderEmergencies();
    $('metar').textContent = g.metar();
    $('sel-vector').value = String(g.radar.vectorMin);
    $('sel-history').value = String(g.radar.historyDots);
    for (const k of ['map', 'areas', 'airspace']) $(`chk-${k}`).checked = g.radar.layers[k];
    $('chk-autotaxi').checked = g.autoTaxi;
    $('tab-radar').classList.toggle('on', g.viewMode === 'radar');
    $('tab-ground').classList.toggle('on', g.viewMode === 'ground');
    $('sel-traffic').value = g.traffic;
    $('sel-routes').value = g.radar.routes;
    $('chk-procs').checked = g.radar.showProcs;
    $('chk-voice').checked = g.voice;
    $('active-rwys').textContent = g.activeRunways().join(' / ');
    $('atis').textContent = `${g.atis} · ${g.windText()} · Q${AIRPORT.qnh}`;
    $('cmd-target').textContent = g.selected ? g.selected.cs : '—';
    this.renderStrips();
    this.renderCard();
  }

  strip(ac) {
    const g = this.game;
    const sel = ac === g.selected ? ' sel' : '';
    const conf = ac.emg && !ac.emg.done ? ' emergency' : ac.conflict === 2 ? ' conflict' : ac.conflict === 1 ? ' stca' : '';
    let status, alt = ac.state === 'air' ? ac.altText() : '—';
    if (ac.state === 'stand') status = `${ac.cleared ? 'CLRD' : 'REQ CLR'} S${ac.stand}`;
    else if (ac.state === 'pushback') status = 'PUSHBACK';
    else if (ac.state === 'taxi') status = !ac.taxiPath.length ? 'REQ TAXI' : ac.holdPos ? 'HOLD POSN' : ac.isArr ? `TAXI S${ac.stand}` : `TAXI ${ac.taxiTarget}`;
    else if (ac.state === 'parked') status = `ON STAND ${ac.stand}`;
    else if (ac.state === 'ground') status = `HP ${ac.gnode} RDY`;
    else if (ac.isArr && ac.owner === 'TWR' && ac.airborne && !ac.landClr && g.position !== 'ALL') status = 'REQ LDG CLR';
    else if (ac.state === 'lineup') status = 'LINED UP';
    else if (ac.state === 'takeoff') status = 'T/O ROLL';
    else if (ac.state === 'landed') status = 'LANDED';
    else if (ac.handedOff) status = 'HO';
    else if (ac.est) status = `LOC ${ac.rwy}`;
    else if (ac.mode === 'hold') status = `HOLD ${ac.hold.fix}`;
    else if (ac.mode === 'heading') status = `H${Geo.fmtHdg(ac.tgtHdg)}`;
    else status = ac.route[0] || '';
    const proc = ac.isArr ? ac.star : ac.sid;
    const mine = g.userOwns(ac) ? '' : ' notmine';
    return `<div class="strip ${ac.isArr ? 'arr' : 'dep'}${sel}${conf}${mine}" data-cs="${esc(ac.cs)}">
      <div class="cs">${esc(ac.cs)}<span class="wt">${esc(ac.type)}/${ac.wake}</span><span class="own own-${ac.owner}">${ac.owner}</span></div>
      <div class="rt">${esc(ac.isArr ? ac.orig : ac.dest)} · ${esc(proc)} · ${esc(ac.rwy)}</div>
      <div class="al">${esc(alt)}</div>
      <div class="st">${esc(status)}</div>
    </div>`;
  }

  // Banner listing active emergencies, with an acknowledge button until acknowledged.
  renderEmergencies() {
    const list = this.game.emergency.active();
    const bar = $('emgbar');
    if (!list.length) { bar.hidden = true; this._emg = ''; return; }
    const html = list.map((ac) => {
      const e = ac.emg;
      const lvl = e.level === 'RADIO' ? 'RADIO FAIL' : e.level;
      const where = ac.state === 'air' ? `${ac.altText()} · ${Math.hypot(ac.x, ac.y).toFixed(0)} nm` : ac.state === 'landed' ? 'ON RUNWAY' : 'ON GROUND';
      const fuel = e.endurance ? ` · fuel ${Math.max(0, Math.round((e.endurance - this.game.time) / 60))} min` : '';
      return `<div class="emg-item${e.ack ? ' acked' : ''}"><button data-cs="${esc(ac.cs)}"><b>${esc(lvl)}</b> ${esc(ac.cs)} · ${esc(e.label)} · ${esc(where)}${esc(fuel)} · sq ${esc(ac.squawk)}</button>` +
        (e.ack || e.type === 'RADIO' ? '' : `<button class="ack" data-cs="${esc(ac.cs)}" data-ack="1">ACK</button>`) + '</div>';
    }).join('');
    if (html !== this._emg) { bar.innerHTML = html; this._emg = html; }
    bar.hidden = false;
  }

  renderStrips() {
    const g = this.game;
    const arr = g.aircraft.filter((a) => a.isArr && a.state !== 'gone');
    const dep = g.aircraft.filter((a) => !a.isArr && a.state === 'air');
    const gnd = g.aircraft.filter((a) => !a.isArr && a.state !== 'air' && a.state !== 'gone');
    const html = `
      <h3><span class="sw arr"></span>Arrivals <em>${arr.length}</em></h3>${arr.map((a) => this.strip(a)).join('') || '<p class="none">none</p>'}
      <h3><span class="sw dep"></span>Departures <em>${dep.length}</em></h3>${dep.map((a) => this.strip(a)).join('') || '<p class="none">none</p>'}
      <h3><span class="sw gnd"></span>Ground / Delivery <em>${gnd.length}</em></h3>${gnd.map((a) => this.strip(a)).join('') || '<p class="none">none</p>'}`;
    if (html !== this._strips) { $('strips').innerHTML = html; this._strips = html; }
  }

  renderCard() {
    const ac = this.game.selected;
    let html, quick = '';
    if (!ac) {
      html = '<div class="empty">No aircraft selected.<br>Click a target or strip, or press <kbd>Tab</kbd>.</div>';
    } else {
      const route = (ac.isArr ? [ac.star.slice(0, 5)] : []).concat(ac.route).join(' ') || '—';
      const btn = (label, cmd) => `<button data-cmd="${esc(cmd)}">${esc(label)}</button>`;
      if (!this.game.userOwns(ac)) {
        quick = `<span class="notmine">With ${esc(POSITIONS[ac.owner].name)}${ac.owner !== 'CTR' ? ' (AI)' : ''}</span>`;
      } else if (ac.isArr && ac.state === 'taxi' && ac.owner === 'TWR' && this.game.position === 'TWR') {
        quick = btn('Contact Ground', 'ho');
      } else if (['stand', 'pushback', 'taxi'].includes(ac.state)) {
        if (!ac.isArr && !ac.cleared) quick += btn('CAF', 'caf');
        if (ac.state === 'stand' && !ac.isArr) quick += btn('Push, face east', 'pb e') + btn('Push, face west', 'pb w');
        if (ac.isArr || ac.cleared) quick += btn(ac.isArr ? `Taxi to stand ${ac.stand}` : `Taxi to ${GROUND.holdingPoints[ac.rwy]}`, 'taxi') + btn('Taxi…', 'taxi ');
        if (ac.state === 'taxi' && ac.taxiPath.length) quick += ac.holdPos ? btn('Continue', 'cont') : btn('Hold position', 'hpos');
        if (!ac.isArr && ac.owner === 'GND' && this.game.position === 'GND') quick += btn('Contact Tower', 'ho');
        if (this.game.viewMode !== 'ground') quick += btn('Ground chart', '.gnd');
      } else if (ac.state === 'ground' && ac.owner === 'GND' && this.game.position === 'GND') {
        quick = btn('Contact Tower', 'ho') + btn('Taxi…', 'taxi ');
      } else if (ac.state === 'ground' || ac.state === 'lineup') {
        quick = (!ac.cleared ? btn('CAF', 'caf') : '') + (ac.state === 'ground' ? btn('Line up', 'lu') : '') + btn('Take-off', 'cto');
      } else if (ac.state === 'air') {
        quick = btn('Heading…', 'h ') + btn('Alt…', 'a ') + btn('Speed…', 's ') + btn('Direct…', 'dct ');
        quick += btn('Hold…', 'hold ');
        const pos = this.game.position;
        if (ac.isArr) {
          if (ac.owner === 'TWR' && !ac.landClr) quick += btn('Cleared to land', 'cl');
          if (ac.owner === 'APP') quick += btn(`ILS ${ac.rwy}`, `i ${ac.rwy}`) + btn(`APP ${ac.rwy}`, `app ${ac.rwy}`);
          if (ac.owner === 'APP' && pos === 'APP' && ac.ils) quick += btn('Contact Tower', 'ho');
          quick += btn('Go around', 'ga');
        } else if (ac.owner === 'TWR' && pos === 'TWR') {
          quick += btn('Contact Departure', 'ho');
        } else {
          quick += btn('FL240', 'a FL240') + (!ac.handedOff ? btn('Contact Control', 'ho') : '');
        }
        if (ac.mode !== 'route' && ac.route.length && !ac.est) quick += btn('Resume', 'res');
      }
      html = `
        <div class="card-head ${ac.isArr ? 'arr' : 'dep'}">
          <b>${esc(ac.cs)}</b> <span>${esc(ac.type)}/${ac.wake}</span> <span class="sq">SQ ${esc(ac.squawk)}</span>
        </div>
        <table>
          <tr><th>${ac.isArr ? 'From' : 'To'}</th><td>${esc(ac.isArr ? ac.orig : ac.dest)}</td><th>Rwy</th><td>${esc(ac.rwy)}</td></tr>
          <tr><th>${ac.isArr ? 'STAR' : 'SID'}</th><td>${esc(ac.isArr ? ac.star : ac.sid)}</td><th>Clr</th><td>${ac.cleared ? 'YES' : '<span class="warn">NO</span>'}</td></tr>
          <tr><th>Alt</th><td>${ac.state === 'air' ? esc(ac.altText()) : 'GND'} → ${esc(ac.altText(ac.tgtAlt))}</td><th>Hdg</th><td>${Geo.fmtHdg(ac.hdg)}</td></tr>
          <tr><th>IAS</th><td>${Math.round(ac.spd)}${ac.tgtSpd ? ' → ' + ac.tgtSpd : ''}</td><th>GS</th><td>${Math.round(ac.gs_kt())}</td></tr>
          <tr><th>Route</th><td colspan="3" class="route">${esc(route)}</td></tr>
        </table>`;
    }
    if (html !== this._card) { $('card-info').innerHTML = html; this._card = html; }
    if (quick !== this._quick) { $('card-quick').innerHTML = quick; this._quick = quick; }
  }
}
