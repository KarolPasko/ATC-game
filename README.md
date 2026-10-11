# Radar ATC Sim — Ravenwood International (EGRV)

A browser air traffic control game inspired by EuroScope. You work approach and tower at a fictional
airport with parallel runways 08L/26R and 08R/26L, using a radar scope and a command line.

## Run it

No build step. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

## How to play

### Positions

Pick your position in the top bar (or type `.pos twr`, `.pos app`, `.pos all`). An AI controller works the other position,
and you can switch at any time.

| Position | You handle | The AI handles |
| --- | --- | --- |
| **Tower** (DEL/GND/TWR) | Clearances (`caf`), line-up and take-off, landing clearances (`cl`), transfer of departures to Departure (`ho`) | Arrivals from entry to the ILS, then it transfers them to you; departures after you transfer them |
| **Approach** (APP/DEP) | Arrivals from entry to the ILS, then transfer to Tower (`ho`); departures from take-off up to Control (`ho`) | Clearances, take-offs, landing clearances |
| **Combined** | Everything; Tower↔Approach transfers and landing clearances are automatic | — |

Arrivals without a landing clearance go around at 1 nm. Aircraft on the AI's frequency have grey tags and strips, and their
radio calls are dimmed in the log. You only lose points for separation involving your own aircraft.

- **Arrivals** enter on STARs. Their route into the airport is drawn in **magenta**.
  Descend them and clear them for an approach.
- **Departures** wait at the holding point. Give them their clearance (`caf`), clear them for take-off (`cto`),
  climb them, and hand them off (`ho`) once they're above FL100 and 20 nm out. Their SID is drawn in **blue**.
- Keep **3 nm or 1000 ft** between airborne aircraft. A yellow tag means a predicted conflict; red means separation is lost.

### Mouse

| Action | Effect |
| --- | --- |
| Click aircraft / strip | Select it |
| **Press and hold** a waypoint (with an aircraft selected) | Direct to that waypoint, then rejoin the route |
| Right-click a waypoint | Menu: direct, hold as published, hold with left/right turns, approach via that fix |
| Right-click the map | Give the selected aircraft a heading toward that point |
| Drag / wheel | Pan / zoom |
| `Tab` / `Esc` | Cycle through aircraft / deselect |

### Commands

Type `CALLSIGN cmd args…`. You can leave out the callsign if an aircraft is selected, and a unique part of it
works too (`123` for `BAW123`). You can chain commands: `BAW123 tl 180 d 4000 s 220`.

| Command | Meaning |
| --- | --- |
| `caf` | Cleared as filed: IFR clearance, SID, squawk, initial climb 6000 |
| `lu [rwy]` | Line up and wait |
| `cto [rwy]` | Cleared for take-off |
| `h 270` / `tl 180` / `tr 090` | Heading, shortest turn / turn left / turn right |
| `a 5000`, `c FL120`, `d 30` | Climb/descend (values ≤ 600 are read as flight levels) |
| `s 210` / `s rs` | Assign speed / resume normal speed |
| `dct NORAX` | Direct to a waypoint, then continue the route |
| `i 26L` / `ils 26L` | Cleared ILS: intercept the localizer from vectors |
| `app 26R` | Cleared for the full approach: IAF → IF → FAF, descending via the published altitudes, then ILS |
| `hold [fix] [inbound] [L\|R] [1.5M]` | Hold as published, or with your own inbound course, turns and leg time |
| `res` | Resume own navigation on the route |
| `ga` | Go around |
| `cl` | Cleared to land (tower) |
| `ho` | Transfer: Tower → Departure, Approach → Tower (once on the ILS), Departure → Control |
| `sq 4521` | Squawk code |
| `del` | Delete an aircraft |

System commands: `.pos twr|app|all`, `.pause`, `.speed 1|2|4`, `.config 26|08`, `.traffic low|med|high`, `.routes all|sel|off`,
`.procs`, `.voice`, `.help`, `.restart`.

## Realism

- **Route lines** show only for the selected aircraft by default (top bar: *Routes: selected only / all mine / off*).
- **Procedures**: 11 STARs and 8 SIDs per runway direction. The north runway's approach is 1000 ft higher than the south
  runway's, so arrivals are vertically separated until established. Departure routes splay 15° away from the parallel runway.
- **Predicted flight path**: the line ahead of each aircraft comes from simulating it forward, so it shows the real
  curved turns, fly-by waypoints, localizer intercepts and holding patterns. A dashed line means the aircraft is on a heading.
- **Wind** (shown in the ATIS) drifts aircraft that are flying a heading. On routes, in holds and on the localizer, pilots correct for it.
- **Turns** are standard rate (3°/s) but limited to 25° of bank, so fast aircraft turn wider.
- **Holds** use direct, parallel and teardrop entries, 1-minute legs up to FL140 (1.5 min above) and holding speed
  (230/240/265 kt). Published holds are marked with a dot under the fix.
- **Wake turbulence** on final: 4 nm behind a heavy for a heavy, 5 nm for a medium.
- 250 kt below FL100, transition altitude 6000 ft, and pilots set QNH when descending below it.
- Departures check in after take-off. Arrivals report the end of their route if they haven't been cleared for an approach.

## Scoring

Landing +100 · handoff to Control +100 (early +50/+20) · Tower→Departure +30 · Approach→Tower +20 · go-around −10 · runway not clear −50 ·
separation loss −50 · wake spacing −30 · departure leaving without a handoff −50 · arrival lost −100.

## Code layout

| File | Contents |
| --- | --- |
| `js/geo.js` | Geometry helpers (nm, compass headings) |
| `js/data.js` | Runways, waypoints, STARs/SIDs/approaches, aircraft performance |
| `js/aircraft.js` | Flight model, route following, localizer and glideslope capture, holds |
| `js/commands.js` | Command line parser |
| `js/ai.js` | AI controller for the position you are not working |
| `js/game.js` | Simulation loop, traffic spawning, separation checks, scoring |
| `js/radar.js` | Radar scope drawing and mouse interaction |
| `js/ui.js` | Flight strips, selected aircraft panel, message log |
