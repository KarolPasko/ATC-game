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
    $('sel-routes').onchange = (e) => { g.radar.routes = e.target.value; };
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
      if (cmd.endsWith(' ')) { this.input.value = cmd; this.input.focus(); }
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
    $('sel-traffic').value = g.traffic;
    $('sel-routes').value = g.radar.routes;
    $('chk-procs').checked = g.radar.showProcs;
    $('chk-voice').checked = g.voice;
    $('active-rwys').textContent = g.activeRunways().join(' / ');
    $('cmd-target').textContent = g.selected ? g.selected.cs : '—';
    this.renderStrips();
    this.renderCard();
  }

  strip(ac) {
    const g = this.game;
    const sel = ac === g.selected ? ' sel' : '';
    const conf = ac.conflict === 2 ? ' conflict' : ac.conflict === 1 ? ' stca' : '';
    let status, alt = ac.state === 'air' ? ac.altText() : '—';
    if (ac.state === 'ground') status = ac.cleared ? 'CLRD' : 'REQ CLR';
    else if (ac.state === 'lineup') status = 'LINED UP';
    else if (ac.state === 'takeoff') status = 'T/O ROLL';
    else if (ac.state === 'landed') status = 'LANDED';
    else if (ac.handedOff) status = 'HO';
    else if (ac.est) status = `LOC ${ac.rwy}`;
    else if (ac.mode === 'hold') status = `HOLD`;
    else if (ac.mode === 'heading') status = `H${Geo.fmtHdg(ac.tgtHdg)}`;
    else status = ac.route[0] || '';
    const proc = ac.isArr ? ac.star : ac.sid;
    return `<div class="strip ${ac.isArr ? 'arr' : 'dep'}${sel}${conf}" data-cs="${esc(ac.cs)}">
      <div class="cs">${esc(ac.cs)}<span class="wt">${esc(ac.type)}/${ac.wake}</span></div>
      <div class="rt">${esc(ac.isArr ? ac.orig : ac.dest)} · ${esc(proc)} · ${esc(ac.rwy)}</div>
      <div class="al">${esc(alt)}</div>
      <div class="st">${esc(status)}</div>
    </div>`;
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
      if (ac.state === 'ground' || ac.state === 'lineup') {
        quick = (!ac.cleared ? btn('CAF', 'caf') : '') + (ac.state === 'ground' ? btn('Line up', 'lu') : '') + btn('Take-off', 'cto');
      } else if (ac.state === 'air') {
        quick = btn('Heading…', 'h ') + btn('Alt…', 'a ') + btn('Speed…', 's ') + btn('Direct…', 'dct ');
        if (ac.isArr) quick += btn(`ILS ${ac.rwy}`, `i ${ac.rwy}`) + btn(`APP ${ac.rwy}`, `app ${ac.rwy}`) + btn('Go around', 'ga');
        else quick += btn('FL240', 'a FL240') + (!ac.handedOff ? btn('Hand off', 'ho') : '');
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
