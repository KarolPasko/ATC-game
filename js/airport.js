// Picks the airport (the URL hash such as #EGCC, else the last one played) and builds its data before the rest of
// the game loads. Switching airport reloads the page.
const AIRPORT_ID = (() => {
  let id = null;
  if (typeof globalThis.ATC_AIRPORT === 'string') id = globalThis.ATC_AIRPORT;
  try { if (!AIRPORTS[id]) id = location.hash.replace('#', '').toUpperCase(); } catch (e) { /* no location */ }
  try { if (!AIRPORTS[id]) id = localStorage.getItem('atc.airport'); } catch (e) { /* no storage */ }
  return AIRPORTS[id] ? id : 'EGRV';
})();
const AIRPORT_DEF = AIRPORTS[AIRPORT_ID];
AIRPORT_DEF.build();
AIRLINE_POOL = AIRLINES.flatMap((a) => Array(AIRPORT.airlineWeights?.[a.icao] ?? a.w).fill(a));

function switchAirport(id) {
  if (!AIRPORTS[id]) return;
  try { localStorage.setItem('atc.airport', id); } catch (e) { /* ignore */ }
  location.hash = id;
  location.reload();
}
