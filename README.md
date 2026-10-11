# Radar ATC Sim — Ravenwood International (EGRV)

A browser air traffic control game inspired by EuroScope. You work approach and tower at a fictional
airport with parallel runways 08L/26R and 08R/26L, using a radar scope and a command line.

## Run it

No build step. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

## How to play

- **Arrivals** enter on STARs. Their route into the airport is drawn in **magenta**.
  Descend them and clear them for an approach.
- **Departures** wait at the holding point. Give them their clearance (`caf`), clear them for take-off (`cto`),
  climb them, and hand them off (`ho`) once they're above FL100 and 20 nm out. Their SID is drawn in **blue**.
- Keep **3 nm or 1000 ft** between airborne aircraft. A yellow tag means a predicted conflict; red means separation is lost.

### Mouse

| Action | Effect |
| --- | --- |
| Click aircraft / strip | Select it |
| Click a waypoint (with an aircraft selected) | Direct to that waypoint |
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
| `hold [fix]` | Hold at a fix |
| `res` | Resume own navigation on the route |
| `ga` | Go around |
| `ho` | Hand off to the next sector |
| `sq 4521` | Squawk code |
| `del` | Delete an aircraft |

System commands: `.pause`, `.speed 1|2|4`, `.config 26|08`, `.traffic low|med|high`, `.routes all|sel|off`,
`.procs`, `.voice`, `.help`, `.restart`.

## Scoring

Landing +100 · good handoff +100 (early +50/+20) · go-around −10 · runway not clear −50 ·
separation loss −50 · departure leaving without a handoff −50 · arrival lost −100.

## Code layout

| File | Contents |
| --- | --- |
| `js/geo.js` | Geometry helpers (nm, compass headings) |
| `js/data.js` | Runways, waypoints, STARs/SIDs/approaches, aircraft performance |
| `js/aircraft.js` | Flight model, route following, localizer and glideslope capture, holds |
| `js/commands.js` | Command line parser |
| `js/game.js` | Simulation loop, traffic spawning, separation checks, scoring |
| `js/radar.js` | Radar scope drawing and mouse interaction |
| `js/ui.js` | Flight strips, selected aircraft panel, message log |
