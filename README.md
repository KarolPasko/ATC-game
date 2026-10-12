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

| Position | You handle |
| --- | --- |
| **Ground** (DEL/GND) | Clearances (`caf`), pushback, taxi out on the route you assign, transfer to Tower at the holding point (`ho`); arrivals after they vacate, taxi in to their stand |
| **Tower** | Line-up and take-off, transfer departures to Departure (`ho`); landing clearances (`cl`), transfer vacated arrivals to Ground (`ho`) |
| **Approach** (APP/DEP) | Arrivals from entry to the ILS, then transfer to Tower (`ho`); departures from Tower up to Control (`ho`) |
| **Combined** | Everything; transfers between your positions and landing clearances are automatic |

AI controllers work every position you are not working.

Arrivals without a landing clearance go around at 1 nm. Aircraft on the AI's frequency have grey tags and strips, and their
radio calls are dimmed in the log. You only lose points for separation involving your own aircraft.

- **Arrivals** enter on STARs. Their route into the airport is drawn in **magenta**.
  Descend them and clear them for an approach.
- **Departures** wait at the holding point. Give them their clearance (`caf`), clear them for take-off (`cto`),
  climb them, and hand them off (`ho`) once they're above FL100 and 20 nm out. Their SID is drawn in **blue**.
- Keep **3 nm or 1000 ft** between airborne aircraft. A yellow tag means a predicted conflict; red means separation is lost.

### Ground chart

Switch the scope to **Ground chart** (tab at the top left, or `.gnd`). It is a detailed aerodrome chart:
- **Runways:** threshold piano keys, designators, aiming-point and touchdown-zone markings, blast pads, approach lights, PAPIs, ILS antennas and windsocks.
- **Taxiways:** parallel taxiways A and B, rapid exits K/M, cross taxiways E and F, and apron taxilanes P and Q, all with curved junction fillets.
- **Holding points:** A1–A7 and B1–B7, with holding-position markings, stop bars and mandatory signs.
- **Stands and buildings:** 24 stands with lead-in lines and jet bridges, the terminal, tower, fire station, cargo/GA apron and car parks.

Departures start on a stand and call Delivery. Give them `caf`, then assign the taxi route. Select the aircraft, click the
taxiways in order, then click the holding point (A1/A7 for 08L/26R, B1/B7 for 08R/26L) and press **Send taxi**, or type
`taxi A7 via P J3 A`. Aircraft push back in an arc (`pb e` / `pb w` picks the facing), then follow the curves on the chart,
slowing for corners and stopping behind traffic. **At the holding point Ground hands them to Tower automatically.** `lu`/`cto`
taxis them onto the runway (stop bar off, green lead-on lights); with a take-off clearance they roll once aligned.

Arrivals brake for the first exit they can make. Once clear of the runway, Tower hands them to Ground automatically and they
ask for taxi: `taxi` sends them to their stand (or `taxi 14` for stand 14). Right-click an aircraft on the chart for its
instructions, or a holding point / stand for taxi options. Tick **Auto taxi** to let the AI do ground movement.

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
| `pb [e\|w]` | Pushback, ending up facing east or west |
| `taxi [A7\|26R\|12] [via P J3 A]` | Taxi to a holding point, runway or stand, optionally via named taxiways |
| `hpos` / `cont` | Hold position / continue taxi |
| `lu [rwy]` | Line up and wait (at the holding point) |
| `cto [rwy]` | Cleared for take-off |
| `h 270` / `tl 180` / `tr 090` | Heading, shortest turn / turn left / turn right |
| `a 5000`, `c FL120`, `d 30` | Climb/descend (values ≤ 600 are read as flight levels) |
| `s 210` / `s rs` | Assign speed / resume normal speed |
| `dct NORAX` | Direct to a waypoint, then continue the route |
| `i 26L` / `ils 26L` | Cleared ILS: intercept the localizer from vectors |
| `app 26R [via FIX]` | Cleared for the approach: the best entry (straight-in IAF, outer IAF, IF or FAF) is chosen from the aircraft's position, or name it; descends via the published altitudes, then ILS |
| `hold [fix] [inbound] [L\|R] [1.5M]` | Hold as published, or with your own inbound course, turns and leg time |
| `res` | Resume own navigation on the route |
| `ga` | Go around |
| `cl` | Cleared to land (tower) |
| `ho` | Transfer: Ground → Tower, Tower → Ground (vacated arrivals), Tower → Departure, Approach → Tower, Departure → Control |
| `sq 4521` | Squawk code |
| `del` | Delete an aircraft |

System commands: `.gnd`, `.radar`, `.autotaxi`, `.pos gnd|twr|app|all`, `.pause`, `.speed 1|2|4`, `.config 26|08`, `.traffic low|med|high`, `.routes all|sel|off`,
`.procs`, `.voice`, `.help`, `.restart`.

## Realism

- **Route lines** show only for the selected aircraft by default (top bar: *Routes: selected only / all mine / off*).
- **Procedures**: 11 STARs and 8 SIDs per runway direction. Every runway end has an RNAV T-bar approach: a straight-in IAF and
  an outer IAF (joining the final at 90°) feeding the IF and FAF. The north runway's approach is 1000 ft higher than the south
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
| `js/ground.js` | Airfield layout, taxi routing, ground movement and the ground chart |
| `js/ai.js` | AI controller for the position you are not working |
| `js/game.js` | Simulation loop, traffic spawning, separation checks, scoring |
| `js/radar.js` | Radar scope drawing and mouse interaction |
| `js/ui.js` | Flight strips, selected aircraft panel, message log |
