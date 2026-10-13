# Radar ATC Sim

A browser air traffic control game inspired by EuroScope. Work ground, tower and approach with a radar scope, a detailed
ground chart and a command line. AI controllers work the positions you don't. There are two airports:

| Airport | What it is |
| --- | --- |
| **EGRV Ravenwood International** | Fictional. Parallel runways 08L/26R and 08R/26L with the terminal between them, both used for arrivals and departures. 11 STARs and 8 SIDs per direction. Flying club apron with up to two aircraft in the circuit. |
| **EGCC Manchester** | Real airport, from the UK AIP where possible. Runways 05L/23R (3048 m) and 05R/23L (3050 m), 390 m apart and staggered 1849 m, with displaced thresholds. In westerly dual-runway ops arrivals land on 23R and departures leave from 23L, so departures cross runway 23R (easterly: arrivals on 05R cross 05L). ROSUN, MIRSI and DAYNE holds; SIDs to EKLAD, KUXEM, SANBA, LISTO, POL, SONEX, ASMIM and DESIG. GA on the South Side. |

Manchester's runway lengths, displaced thresholds, spacing and stagger, the airport reference point, the holds, the local
VORs and several SID and approach fixes (TICZU, NODUC, TABLY, LISTO, DESIG, SANBA …) come from the UK AIP and charts.
STAR entry points, some SID fixes and the taxiway layout are approximations, and the downwind/base transition fixes are
simplified coded points (`DN23R`, `NW23R`, `C05RI`, `MC231` …). Not for real-world navigation.

## Run it

No build step. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

## How to play

### Starting a session

The **New session** screen opens at start (and from the toolbar). Pick the airport, your position, the runway configuration,
traffic density and how often emergencies happen. Your choices are remembered. Picking another airport reloads the page
into it; you can also open an airport directly with `index.html#EGCC` or `index.html#EGRV`.

### Positions

Pick your position in the top bar (or type `.pos twr`, `.pos app`, `.pos all`). An AI controller works the other position,
and you can switch at any time.

| Position | You handle |
| --- | --- |
| **Ground** (DEL/GND) | Clearances (`caf`), pushback, taxi out on the route you assign, transfer to Tower at the holding point (`ho`); arrivals after they vacate, taxi in to their stand |
| **Tower** | Line-up and take-off, runway crossings (`cross`), transfer departures to Departure (`ho`); landing clearances (`cl`), transfer vacated arrivals to Ground (`ho`) |
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
- **Taxiways:** parallel taxiways, rapid exits, connectors and apron taxilanes, all with curved junction fillets.
- **Holding points:** holding-position markings (with ILS critical-area markings at the runway ends), stop bars and mandatory signs.
- **Stands and buildings:** stands with lead-in lines and jet bridges, terminals, tower, fire station, cargo apron and car parks.

| | Ravenwood (EGRV) | Manchester (EGCC) |
| --- | --- | --- |
| Departure holding points | A1/A7 (08L/26R), B1/B7 (08R/26L) | V5 (23L), V1 (05R), J1 (23R), A1 (05L) |
| Runway crossings | — | D, F, G, H across 23R/05L (hold short at D1, F1, G1, H1) |
| Rapid exits | K1–K4, M1–M4 | C (23R), K (05L) |
| Stands | 1–12, 21–32 | 1–12 (T1/T2/T3), 21–25 (west apron) |

Departures start on a stand and call Delivery. Give them `caf`, then assign the taxi route. Select the aircraft, click the
taxiways in order, then click the runway holding point and press **Send taxi**, or type it (`taxi A7 via P J3 A` at
Ravenwood, `taxi V5 via A G V` at Manchester). Aircraft push back in an arc (`pb e` / `pb w` picks the facing), then follow the curves on the chart,
slowing for corners and stopping behind traffic. **At the holding point Ground hands them to Tower automatically.** `lu`/`cto`
taxis them onto the runway (stop bar off, green lead-on lights); with a take-off clearance they roll once aligned.

**Runway crossings (Manchester):** a departure for runway 23L (05R) stops at the stop bar before runway 23R (05L). Ground
hands it to Tower and it calls "holding short runway 23R at G1, request crossing". Clear it with `cross` (or right-click ›
Cross) when no arrival is within about 3 nm, nothing is rolling towards the crossing and there's room beyond. It counts as
on the runway until it reports vacated, so an arrival reaching the threshold first will go around.

Arrivals brake for the first exit they can make. Once clear of the runway, Tower hands them to Ground automatically and they
ask for taxi: `taxi` sends them to their stand (or `taxi 14` for stand 14). Right-click an aircraft on the chart for its
instructions, or a holding point / stand for taxi options. Tick **Auto taxi** to let the AI do ground movement.

### EuroScope-style scope

- **Data tags:** callsign, Mode-C level ↑↓ cleared level, ground speed/10, heading or next fix, and assigned speed.
- **Clickable fields:** click the cleared level, heading/direct-to or speed field to open a list and pick a value. Headings
  can be forced left or right. Click the callsign for the aircraft menu: transfer, approach clearances, hold, go-around and
  landing clearance.
- **Handoffs:** an aircraft handed to you by another controller flashes until you assume it (click the callsign or type
  `asm`). An aircraft you hand away briefly shows `→TWR` etc.
- **Range/bearing lines:** Shift+drag (or middle-drag) between points or aircraft. Between two aircraft the line shows the
  predicted minimum distance and when it happens. Right-click a line to remove it, or type `.rbl clear` to remove them all.
- **Video map:** coastline, rivers, towns, nearby airfields, danger/restricted areas, the CTR and TMA (at Manchester also
  the Liverpool CTR and the Low Level Route), each switchable in the **Display** menu.
- **Display menu:** route lines, speed-vector length (off/1/2/3/5 min), history dots, map layers, the SID/STAR overlay and
  pilot voice. The top bar shows the METAR.

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
| `caf` | Cleared as filed: IFR clearance, SID, squawk, initial climb (6000 ft Ravenwood, 5000 ft Manchester) |
| `pb [e\|w]` | Pushback, ending up facing east or west (north-east / south-west at Manchester) |
| `taxi [A7\|26R\|12] [via P J3 A]` | Taxi to a holding point, runway or stand, optionally via named taxiways |
| `hpos` / `cont` | Hold position / continue taxi |
| `cross` | Cross the runway ahead on the taxi route (Manchester) |
| `lu [rwy]` | Line up and wait (at the holding point) |
| `cto [rwy]` | Cleared for take-off |
| `h 270` / `tl 180` / `tr 090` | Heading, shortest turn / turn left / turn right |
| `a 5000`, `c FL120`, `d 30` | Climb/descend (values ≤ 600 are read as flight levels) |
| `s 210` / `s rs` | Assign speed / resume normal speed |
| `dct NORAX` | Direct to a waypoint, then continue the route |
| `i 26L` / `ils 26L` | Cleared ILS: intercept the localizer from vectors |
| `app 26R [via FIX]` | Cleared for the approach on a pre-made transition from the aircraft's side of the airport (downwind, base or straight in), ending lined up with the runway at the IF; or name the entry fix. Descends via the published altitudes, then ILS |
| `hold [fix] [inbound] [L\|R] [1.5M]` | Hold as published, or with your own inbound course, turns and leg time |
| `res` | Resume own navigation on the route |
| `ga` | Go around (arrivals and circuit traffic) |
| `cl` | Cleared to land (tower). Circuit traffic: cleared touch and go (cleared to land on the last circuit) |
| `fs` | Circuit traffic: make this circuit a full stop |
| `ext` / `base` | Circuit traffic: extend downwind (beyond 4 nm it holds in a racetrack on the downwind side) / turn base now |
| `orbit [l\|r]` | Circuit traffic: one orbit away from the runway, then carry on |
| `asm` | Assume an aircraft handed to you |
| `ack` | Acknowledge a MAYDAY / PAN call |
| `ho` | Transfer: Ground → Tower, Tower → Ground (vacated arrivals), Tower → Departure, Approach → Tower, Departure → Control |
| `sq 4521` | Squawk code |
| `del` | Delete an aircraft |

System commands: `.gnd`, `.radar`, `.autotaxi`, `.pos gnd|twr|app|all`, `.pause`, `.speed 1|2|4`, `.config` (Ravenwood
`26|08`, Manchester `23|05|23S|05S`), `.traffic low|med|high`, `.routes all|sel|off`, `.emg [type]|off|rare|normal`,
`.rbl clear`, `.procs`, `.voice`, `.help`, `.restart`.

### Approach transitions

`app RWY` clears an arrival for a pre-made transition chosen from where it is: a downwind leg past the airfield, a base leg,
or straight in from behind. Each transition ends with a constant-radius turn (an RF leg) that rolls out exactly on the
extended centreline at the IF, 11–14 nm out, so aircraft no longer cut across the airfield or join the final at a wide
angle. The localizer is captured only once the aircraft is on the straight part of the final. Name the entry with
`app 23R via NW23R`, or right-click a fix and pick *Cleared approach … via*. The scope draws the transitions for the arrival
runways.

### General aviation circuits

Light aircraft (Cessna 152/172, Piper Warrior, Diamond Star, Cirrus SR22) start on the GA ramp (stands 91–96) with
yellow VFR strips and squawk 7010, and ask Ground to taxi for 2–5 circuits. Tower clears them for take-off (at Ravenwood
from an intersection near the ramp), then they fly the circuit at 1000 ft about 1 nm from the runway, on the side away from the other runway:
upwind, crosswind, downwind, base and final. They call downwind and final. Clear each touch and go with `cl` (they go
around without it, or if the runway is occupied), shape them around the jets with `ext`, `base` and `orbit`, and end the
detail early with `fs`, or send them around with `ga`. They refuse headings, levels, speeds and routings. After the last
circuit they land and taxi back to the ramp. If the runway direction changes, they join crosswind for the new runway.

Traffic is kept realistic. At Ravenwood at most two are in the circuit at once (one in high traffic). Manchester needs
prior permission for circuit training, so there is at most one, and none in high traffic. The AI tower turns one in only
if the next IFR arrival will still be 3 nm out when it touches down (counting its own way in from the downwind), and never
with a departure lined up. After 4 minutes without a gap it makes the circuit a full stop, and after 6 it stops lining
departures up until the light aircraft is in. While circuits are flying, new IFR arrivals go to the other runway where
there is one. An extended aircraft holds in a racetrack 2.5–4 nm out on the downwind side, so it never drifts away. In
the combined position the AI tower handles circuit traffic until you give it an instruction yourself. Light aircraft need 2 minutes behind a medium
and 3 behind a heavy (wake penalty), and two aircraft closer than 0.3 nm and 300 ft count as an airprox.

### Emergencies

Now and then (Emergencies: rare / normal in the toolbar) an aircraft declares an emergency: a MAYDAY or PAN call, squawk
7700 (7600 for a radio failure) and a flashing banner on the scope. Acknowledge with `ack`, then give it priority.

| Emergency | What happens |
| --- | --- |
| Engine failure (MAYDAY) | After take-off: stops climbing with poor performance and returns to land; may stop on the runway |
| Bird strike (PAN) | After take-off: returns to land |
| Medical (PAN) | Arrival asks for priority; a quick landing earns a bonus |
| Minimum fuel (MAYDAY) | Cannot hold; diverts if its fuel endurance runs out |
| Depressurisation (MAYDAY) | Emergency descent to FL100 with a turn off track |
| Hydraulic failure (PAN) | Faster, longer final; stops on the runway and closes it until towed clear (about 5 min) |
| Radio failure (7600) | No replies: follows its route, flies the approach and lands |

Practise one with `.emg engine`, `.emg fuel` and so on.

## Realism

- **Route lines** show only for the selected aircraft by default (top bar: *Routes: selected only / all mine / off*).
- **Procedures**: at Ravenwood, 11 STARs and 8 SIDs per runway direction; every runway end has downwind, base and straight-in
  transitions with RF arcs onto the final, with the north runway's approach 1000 ft higher than the south one's. At
  Manchester, 9 STARs through the ROSUN, MIRSI and DAYNE holds (minimum FL70) to downwind or base transitions on either
  side, and 6 SIDs off the 23s and 4 off the 05s climbing to 5000 ft (SANBA jets only, LISTO props only off the 23s).
- **Traffic**: arrivals and departures come at random intervals, with an occasional inbound wave, from weighted airlines with
  realistic fleets (Manchester sees more Jet2, Ryanair, easyJet and TUI).
- **AI approach** sequences arrivals with speed control and holds them first come, first served when the runway is busy.
- **Predicted flight path**: the line ahead of each aircraft comes from simulating it forward, so it shows the real
  curved turns, fly-by waypoints, localizer intercepts and holding patterns. A dashed line means the aircraft is on a heading.
- **Wind** (shown in the ATIS) drifts aircraft that are flying a heading. On routes, in holds and on the localizer, pilots correct for it.
- **Turns** are standard rate (3°/s) but limited to 25° of bank, so fast aircraft turn wider.
- **Holds** use direct, parallel and teardrop entries, 1-minute legs up to FL140 (1.5 min above) and holding speed
  (230/240/265 kt). Published holds are marked with a dot under the fix.
- **Wake turbulence** on final: 4 nm behind a heavy for a heavy, 5 nm for a medium.
- 250 kt below FL100, transition altitude 6000 ft at Ravenwood and 5000 ft at Manchester; pilots set QNH when descending below it.
- Departures check in after take-off. Arrivals report the end of their route if they haven't been cleared for an approach.

## Scoring

Landing +100 · handoff to Control +100 (early +50/+20) · Tower→Departure +30 · Approach→Tower +20 · go-around −10 · runway not clear −50 ·
crossing with traffic landing or departing −50 · separation loss −50 · wake spacing −30 · departure leaving without a handoff −50 ·
arrival lost −100 · emergency handled +100 (quick medical / fuel +50) · emergency acknowledged within 45 s +20 ·
circuit flown +10 · circuit detail complete +30 · airprox −50.

## Code layout

| File | Contents |
| --- | --- |
| `js/geo.js` | Geometry helpers (nm, compass headings) |
| `js/data.js` | Shared data and helpers: airport containers, runway and T-bar builders, wind, aircraft types, airlines |
| `js/airports/egrv.js` | Ravenwood: runways, fixes, procedures, configurations, ground layout, chart decoration, video map |
| `js/airports/egcc.js` | Manchester: the same, from approximate real positions |
| `js/airport.js` | Picks the airport (URL hash or last used) and builds it |
| `js/aircraft.js` | Flight model, route following (including RF arcs), localizer and glideslope capture, holds |
| `js/circuit.js` | VFR circuit flying: legs, touch and go, orbits, full stop |
| `js/commands.js` | Command line parser |
| `js/ground.js` | Taxi graph and routing, runway crossings, ground movement and the ground chart drawing |
| `js/emergency.js` | Emergency types, MAYDAY/PAN calls and their handling |
| `js/ai.js` | AI controller for the position you are not working |
| `js/game.js` | Simulation loop, traffic spawning, separation checks, scoring |
| `js/radar.js` | Radar scope drawing and mouse interaction |
| `js/scope.js` | EuroScope-style tags and pop-up lists, handoff states, range/bearing lines, video map drawing |
| `js/ui.js` | Session setup, toolbar, flight strips, selected aircraft panel, message log |
