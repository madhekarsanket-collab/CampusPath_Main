// ==========================================
// 1. CONFIGURATION & STATE
// ==========================================
mapboxgl.accessToken = 'pk.eyJ1Ijoic2FuNDA0MGciLCJhIjoiY211bjFrY2l0MDV6bTJ6czl3Nzg5ZjU4cyJ9.XVEgOWjAR3DDXyhynLPBng';

// Backend endpoint. Desktop: localhost. Phone: needs `adb reverse tcp:8080 tcp:8080`
// (or change to the laptop's LAN IP / a hosted URL).
// Laptop testing (served on :8000) uses the local backend; the Android app uses the hosted one.
const HOSTED_API = 'https://campuspath-backend-rvct.onrender.com';
const API_BASE = (() => {
  try { const o = localStorage.getItem('cp_api'); if (o) return o; } catch { /* storage blocked */ }
  return location.port === '8000' ? 'http://localhost:8080' : HOSTED_API;
})();
const BACKEND_URL = `${API_BASE}/api/route`;

// Named rooms (from the signboards in the user's floor-3 photos).
const ROOM_NAMES = {
  '4303': 'AIML Dept. Office (HOD)', '4305': 'Staff Room',
  '4307': 'UG Class Room 1', '4308': 'Programming Lab'
};

// AIML rooms = backend node ids (Backend AimlIndoorGraph). Floors 1-3 share one layout.
const AIML_ROOMS = [
  ['4003', '4003 – Liquid Galaxy Lab (Ground)'], ['4004', '4004 (Ground)'], ['4005', '4005 (Ground)'],
  ['4006', '4006 (Ground)'], ['4007', '4007 (Ground)'], ['4008', '4008 (Ground)'], ['AIML_OFFICE', 'AIML Office (Ground)'],
  ['AIML_COE_AI', 'Center of Excellence in AI (Ground)'],
  ...[1, 2, 3].flatMap(f => ['01', '02', '03', '04', '04-B', '05', '06', '07', '08', '09'].map(r => {
    const id = `4${f}${r}`;
    return [id, `${id}${ROOM_NAMES[id] ? ' – ' + ROOM_NAMES[id] : ''} (Floor ${f})`];
  })),
];
const AIML_ENTRANCES = { AIML_E1: [73.867780, 18.463487], AIML_E2: [73.867834, 18.463828] };
const AIML_OSM_BUILDING_ID = 223964767; // Mapbox building feature id of the real AIML block
const XRAY_DISTANCE_M = 30;   // switch to see-through view this close to an entrance
const WALK_SPEED_MPS = 1.4;
const SIM_SPEEDUP = 4;

let startCoords = null, endCoords = null;   // [lng, lat] when pinned / GPS
let startMarker = null, endMarker = null;
let clickCount = 0;
let route = null;            // { coords, floors, nodeIds, props }
let progressIdx = 0;         // index of the route vertex the user has reached
let userMarker = null, gpsWatchId = null, simTimer = null, xrayOn = false;
let userPos = null, userFloor = null; // walker's exact position while navigating

const startSelect = document.getElementById('start-select');
const endSelect = document.getElementById('end-select');
const findPathBtn = document.getElementById('find-path-btn');
const navStartBtn = document.getElementById('nav-start-btn');
const navSimBtn = document.getElementById('nav-sim-btn');
const sheet = document.getElementById('sheet');
const navTop = document.getElementById('nav-top');
const toastEl = document.getElementById('toast');

// Bottom sheet has three steps: 'plan' (where to?) -> 'route' (summary) -> 'nav' (walking).
function setSheet(state) {
  sheet.dataset.state = state;
  // A new screen starts centred; the button comes back the next time the user moves the map.
  document.getElementById('recenter-btn').hidden = true;
  followPaused = false;
  navTop.hidden = state !== 'nav';
  navTop.classList.remove('arrived');
}

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4500);
}

document.getElementById('route-close').addEventListener('click', () => resetNavigation());
document.getElementById('nav-end-btn').addEventListener('click', () => {
  stopNavigation();
  clearWalker();
  setXray(false);
  setSheet('route');
  fitRoute();
});
document.getElementById('dev-toggle').addEventListener('click', e => {
  const panel = document.getElementById('dev-panel');
  panel.hidden = !panel.hidden;
  e.currentTarget.setAttribute('aria-expanded', String(!panel.hidden));
});
const chkRain = document.getElementById('chk-rain');

// Every AIML room is both a destination and a possible start (e.g. 4109 -> 4207).
const roomOptions = AIML_ROOMS.map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
document.getElementById('aiml-rooms').innerHTML = roomOptions;
document.getElementById('start-rooms').innerHTML = roomOptions;

// ==========================================
// 2. MAP INITIALIZATION & 3D BUILDINGS
// ==========================================
// Offline the Mapbox street style can't load; a plain local style keeps the app working
// (campus paths are then drawn from the cached routing graph).
const OFFLINE_STYLE = {
  version: 8, sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eef1ea' } }]
};
const startedOffline = !navigator.onLine;

const map = new mapboxgl.Map({
  container: 'map',
  style: startedOffline ? OFFLINE_STYLE : 'mapbox://styles/mapbox/streets-v12',
  center: [73.8682, 18.4635],
  zoom: 17.2,
  pitch: 50,
  bearing: -15,
  maxZoom: 24, // the indoor follow camera sits ~5 m behind the walker; default max (22) keeps it ~20 m away
  antialias: true
});
window.map = map;

map.on('load', () => {
  const layers = map.getStyle().layers;
  const labelLayerId = layers.find(l => l.type === 'symbol' && l.layout && l.layout['text-field'])?.id;

  if (startedOffline) {
    map.addSource('offline-paths', { type: 'geojson', data: window.CampusOffline.pathsGeoJson() });
    map.addLayer({ id: 'offline-paths', type: 'line', source: 'offline-paths',
      paint: { 'line-color': '#ffffff', 'line-width': 7 } });
    toast('Offline mode: routes are calculated on your phone.');
  } else map.addLayer({
    id: '3d-buildings',
    source: 'composite',
    'source-layer': 'building',
    // Hide Mapbox's own grey AIML block: it overlaps our model and z-fights (flickers).
    filter: ['all', ['==', ['get', 'extrude'], 'true'], ['!=', ['id'], AIML_OSM_BUILDING_ID]],
    type: 'fill-extrusion',
    minzoom: 15,
    paint: {
      'fill-extrusion-color': '#aaa',
      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.05, ['get', 'height']],
      'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.05, ['get', 'min_height']],
      'fill-extrusion-opacity': 0.6
    }
  }, labelLayerId);

  window.CampusPathAIML?.initLayer?.(map);
  window.CampusPathAIML?.loadInterior?.(API_BASE);
  window.CampusOffline.refresh(API_BASE); // keep the offline copy of the graph fresh
  loadWeather();
  initCrowdLayer();
});

// ==========================================
// 3. MAP CLICK & DUAL-INPUT LOGIC
// ==========================================
map.on('click', (e) => {
  if (window.aimlPlacementMode) return; // AIML anchor calibration in progress
  if (sheet.dataset.state === 'nav') return; // taps while walking must not move the pins
  const coords = [e.lngLat.lng, e.lngLat.lat];
  clickCount++;
  if (clickCount === 1) setStartLocation(coords, true);
  else if (clickCount === 2) setEndLocation(coords, true);
  else resetNavigation();
});

startSelect.addEventListener('change', () => {
  if (startSelect.value !== 'gps') return;
  if (!navigator.geolocation) return alert('Location is not available on this device.');
  navigator.geolocation.getCurrentPosition(
    p => setStartLocation([p.coords.longitude, p.coords.latitude], false),
    err => alert('Could not get your location: ' + err.message),
    { enableHighAccuracy: true, timeout: 10000 });
});

function setStartLocation(coords, isPinned) {
  startCoords = coords;
  startMarker?.remove();
  startMarker = new mapboxgl.Marker({ color: '#10b981' }).setLngLat(coords).addTo(map);
  if (isPinned) { startSelect.value = 'pinned'; startSearch.value = 'Pinned on map'; }
}

function setEndLocation(coords, isPinned) {
  endCoords = coords;
  endMarker?.remove();
  endMarker = new mapboxgl.Marker({ color: '#ef4444' }).setLngLat(coords).addTo(map);
  if (isPinned) { endSelect.value = 'pinned'; destSearch.value = 'Pinned on map'; }
}

// Remove the walker's dot from a previous navigation (it must not look like the new start).
function clearWalker() {
  userMarker?.remove(); userMarker = null;
  userPos = null; userFloor = null;
  window.CampusPathAIML?.setUserPosition?.(null);
}

function resetNavigation() {
  stopNavigation();
  clickCount = 0;
  startCoords = endCoords = null;
  startMarker?.remove(); startMarker = null;
  endMarker?.remove(); endMarker = null;
  startSelect.selectedIndex = 0;
  endSelect.selectedIndex = 0;
  startSearch.value = destSearch.value = '';
  clearWalker();
  route = null;
  clearAstar();
  clearRouteLayer();
  window.CampusPathAIML?.clearIndoorRoute?.();
  setXray(false);
  setSheet('plan');
}

function clearRouteLayer() {
  if (map.getLayer('route-line')) map.removeLayer('route-line');
  if (map.getSource('route-source')) map.removeSource('route-source');
}

// ==========================================
// 4. WEATHER (live rain detection)
// ==========================================
async function loadWeather() {
  const info = document.getElementById('weather-info');
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=18.4635&longitude=73.8682'
      + '&current=temperature_2m,precipitation,weather_code';
    const cur = (await (await fetch(url)).json()).current;
    // WMO codes: 51-67 drizzle/rain, 80-82 showers, 95-99 thunderstorm
    const code = cur.weather_code;
    const raining = cur.precipitation > 0 || (code >= 51 && code <= 67) || (code >= 80 && code <= 99);
    chkRain.checked = raining;
    info.textContent = `${raining ? 'Raining' : 'No rain'} · ${Math.round(cur.temperature_2m)}°C`;
    info.parentElement.classList.add(raining ? 'chip-warn' : 'chip-good');
  } catch {
    info.textContent = 'Weather offline';
  }
}

// ==========================================
// 5. BACKEND FETCH & ROUTE RENDERING
// ==========================================
const isPlace = v => v && v !== 'pinned' && v !== 'gps';

findPathBtn.addEventListener('click', async () => {
  const payload = {
    rain: chkRain.checked,
    avoidCrowds: true, // always: nobody wants the crowded way
    time: (() => { const d = new Date(); return String(d.getHours() * 100 + d.getMinutes()).padStart(4, '0'); })()
  };
  if (isPlace(startSelect.value)) payload.startNode = startSelect.value;
  else if (startCoords && startSelect.value === 'pinned') payload.start = { lng: startCoords[0], lat: startCoords[1] };
  else {
    // No start chosen: use where the phone actually is (asks for location permission once).
    findPathBtn.disabled = true;
    findPathBtn.textContent = 'Finding your location…';
    try {
      const p = await new Promise((ok, fail) => navigator.geolocation
        ? navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: true, timeout: 12000 })
        : fail(new Error('Location not available')));
      setStartLocation([p.coords.longitude, p.coords.latitude], false); // fresh fix every time
      payload.start = { lng: p.coords.longitude, lat: p.coords.latitude };
    } catch (err) {
      alert('Could not get your location (' + err.message + '). Allow location access, or choose a start point.');
      return;
    } finally {
      findPathBtn.disabled = false;
      findPathBtn.textContent = 'Get directions';
    }
  }
  if (isPlace(endSelect.value)) payload.endNode = endSelect.value;
  else if (endCoords) payload.end = { lng: endCoords[0], lat: endCoords[1] };

  if (!(payload.startNode || payload.start) || !(payload.endNode || payload.end)) {
    alert('Choose a start and a destination (dropdowns, GPS, or tap the map).');
    return;
  }

  findPathBtn.disabled = true;
  findPathBtn.textContent = 'Finding route…';
  const slowHint = setTimeout(() => { findPathBtn.textContent = 'Waking up the server… (up to a minute)'; }, 4000);
  try {
    let data;
    try {
      const response = await fetch(BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout ? AbortSignal.timeout(75000) : undefined // free server may be waking up
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw Object.assign(new Error(`Server returned HTTP ${response.status}: ${errorText || response.statusText}`), { fromServer: true });
      }
      data = await response.json();
    } catch (err) {
      if (err.fromServer) throw err; // a real "no route" answer: don't mask it
      // No internet / server unreachable: same A* on the phone, from the cached graph.
      data = window.CampusOffline.route(payload);
      toast('Offline: route calculated on your phone.');
    }
    stopNavigation();
    setXray(false);
    clearAstar();
    clearWalker();
    lastPayload = payload;
    route = {
      coords: data.geometry.coordinates,
      floors: data.properties.floors || data.geometry.coordinates.map(() => null),
      nodeIds: data.properties.nodeIds || [],
      props: data.properties
    };
    progressIdx = 0;
    renderRoute();
    fitRoute();
    renderRouteSheet();
    setSheet('route');
  } catch (error) {
    console.error('Routing request failed:', error);
    alert(`Couldn't find a route: ${error.message}`);
  } finally {
    clearTimeout(slowHint);
    findPathBtn.disabled = false;
    findPathBtn.textContent = 'Get directions';
  }
});

// Draws everything from progressIdx onward: the walked part disappears, like Google Maps.
function renderRoute() {
  if (!route) return;
  // What is still ahead, starting exactly at the walker so nothing behind them stays drawn.
  const tracking = userPos && route.navigating;
  const from = tracking ? progressIdx : 0;
  const coords = route.coords.slice(from), floors = route.floors.slice(from);
  if (tracking) { coords[0] = userPos; floors[0] = userFloor; }
  const inside = f => f !== null && f !== undefined;

  // Outdoor stretches (before entering and/or after leaving AIML) as 2D map lines;
  // each ends or starts at the entrance node, which is an outdoor point.
  const lines = [];
  let run = [];
  coords.forEach((c, i) => {
    if (inside(floors[i])) { if (run.length >= 2) lines.push(run); run = []; }
    else run.push(c);
  });
  if (run.length >= 2) lines.push(run);

  const feature = { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } };
  if (map.getSource('route-source')) {
    map.getSource('route-source').setData(feature);
  } else {
    map.addSource('route-source', { type: 'geojson', data: feature });
    map.addLayer({
      id: 'route-line', type: 'line', source: 'route-source',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#2563eb', 'line-width': 6, 'line-opacity': 0.85 }
    });
  }

  // Indoor stretch in 3D: from the point before the first indoor node to the one after the last.
  const firstIn = floors.findIndex(inside);
  if (firstIn >= 0) {
    let lastIn = floors.length - 1;
    while (!inside(floors[lastIn])) lastIn--;
    const a = Math.max(0, firstIn - 1), b = Math.min(floors.length, lastIn + 2);
    window.CampusPathAIML?.setIndoorRoute?.(coords.slice(a, b), floors.slice(a, b));
  } else {
    window.CampusPathAIML?.clearIndoorRoute?.();
  }
}

function fitRoute() {
  const c = route.coords;
  const bounds = c.reduce((b, p) => b.extend(p), new mapboxgl.LngLatBounds(c[0], c[0]));
  const wide = window.innerWidth >= 900; // keep the route clear of the side panel / bottom sheet
  map.fitBounds(bounds, {
    padding: wide ? { top: 60, bottom: 60, left: 420, right: 60 } : { top: 60, bottom: window.innerHeight * 0.5, left: 40, right: 40 },
    duration: 1000
  });
}

const destinationName = () =>
  AIML_ROOMS.find(([id]) => id === route.props.destination)?.[1]
  || endSelect.selectedOptions[0]?.textContent || route.props.destination;

// Human directions, built from the node ids the backend returns.
function routeSteps() {
  const { nodeIds, floors } = route;
  const inside = f => f !== null && f !== undefined;
  const startFloor = floors[0], destFloor = floors[floors.length - 1];
  const floorName = f => (f === 0 ? 'the ground floor' : `floor ${f}`);
  const entName = id => (id === 'AIML_E1' ? 'Entrance 1 (the corner gate)' : 'Entrance 2 (the north gate)');
  const viaLift = nodeIds.some(id => id.startsWith('AIML_LIFT'));
  const changeFloor = (to, down) => viaLift
    ? `Take the lift (it stops at the half-landings), then half a flight ${down ? 'down' : 'up'} to ${floorName(to)}`
    : `Take the zig-zag stairs ${down ? 'down' : 'up'} to ${floorName(to)}`;
  const entrance = nodeIds.find(id => id.startsWith('AIML_E'));
  const steps = [];

  if (inside(startFloor)) {                       // starting in a room inside AIML
    if (inside(destFloor)) {
      if (destFloor !== startFloor) steps.push(changeFloor(destFloor, destFloor < startFloor));
      steps.push(`Walk the corridor to ${destinationName()}`);
    } else {
      if (startFloor > 0) steps.push(changeFloor(0, true));
      if (entrance) steps.push(`Leave AIML by ${entName(entrance)}`);
      steps.push(`Walk to ${destinationName()}`);
    }
  } else {                                        // starting outside
    if (entrance) steps.push(`Walk to AIML ${entName(entrance)}`);
    if (destFloor > 0) steps.push(changeFloor(destFloor, false));
    steps.push(inside(destFloor) ? `Walk the corridor to ${destinationName()}` : `Arrive at ${destinationName()}`);
  }
  return steps;
}

function renderRouteSheet() {
  const p = route.props;
  document.getElementById('route-time').textContent = `${p.estimatedTimeMinutes} min`;
  document.getElementById('route-dist').textContent = `${Math.round(p.distanceMeters)} m walk`;
  const badges = [];
  if (p.crowdDetour) badges.push(['chip-warn', 'Rerouted around a live crowd']);
  if (chkRain.checked) badges.push(['chip-good', `${p.coveredOutdoorMeters || 0} m under tree cover`]);
  document.getElementById('route-badges').innerHTML =
    badges.map(([cls, text]) => `<span class="chip ${cls}">${text}</span>`).join('');
  document.getElementById('route-steps').innerHTML = routeSteps().map(s => `<li>${s}</li>`).join('');
}

// Remaining walking distance from the walker to route vertex `toIdx`.
function remainingTo(toIdx) {
  const c = route.coords;
  let d = metersBetween(userPos || c[progressIdx], c[Math.min(progressIdx + 1, c.length - 1)]);
  for (let i = progressIdx + 1; i < toIdx; i++) d += metersBetween(c[i], c[i + 1]);
  return Math.max(0, Math.round(d));
}

// The big instruction card at the top while navigating.
function updateNavTop() {
  if (!route) return;
  const last = route.coords.length - 1;
  const firstIndoor = route.floors.findIndex(f => f != null);
  let main, target = last;
  if (firstIndoor > 0 && progressIdx < firstIndoor - 1) {
    target = firstIndoor - 1;
    main = `Walk to ${route.nodeIds[target] === 'AIML_E1' ? 'Entrance 1' : 'Entrance 2'}`;
  } else {
    const cp = nextCheckpoint();
    if (cp) {
      target = cp.i;
      const goingDown = route.floors[cp.i] < (userFloor ?? route.floors[progressIdx] ?? 0);
      main = cp.label === 'Destination door' ? `${destinationName()} is ahead`
        : cp.label.startsWith('Leave') ? cp.label
        : cp.label.startsWith('Floor') ? `${goingDown ? 'Go down to' : 'Climb to'} ${cp.label.replace(' (top of stairs)', '').replace('Floor 0', 'the ground floor')}`
        : cp.label === 'Foot of the stairs' ? 'Go to the stairs'
        : cp.label.startsWith('Stair landing') ? 'Climb to the landing'
        : cp.label === 'Corridor corner' ? 'Turn at the corridor corner' : cp.label;
    } else {
      main = `Head to ${destinationName()}`;
    }
  }
  document.getElementById('nav-top-main').textContent = main;
  if (sheet.dataset.state === 'nav') {
    // Speak only the meaningful steps: one stairs instruction, not every landing / floor.
    const destFloor = route.floors[route.floors.length - 1];
    if (main === 'Go to the stairs' && destFloor > 0) speak(`Go to the stairs, then up to floor ${destFloor}`);
    else if (main.startsWith('Climb to Floor')) { if (main.endsWith(` ${destFloor}`)) speak(`You're almost on floor ${destFloor}`); }
    else if (main.startsWith('Head to') && route.floors.some(f => f != null)) { /* already said "…is ahead" */ }
    else if (main !== 'Climb to the landing') speak(main);
  }
  document.getElementById('nav-top-sub').textContent = `${remainingTo(target)} m`;
  const total = remainingTo(last);
  const eta = new Date(Date.now() + Math.ceil(total / 84) * 60000);
  document.getElementById('nav-eta').textContent = `${Math.max(1, Math.ceil(total / 84))} min`;
  if (!indoorMode) document.getElementById('step-info').textContent =
    `${total} m · arrive ${eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function startNavUi() {
  document.getElementById('nav-end-btn').textContent = 'End';
  setSheet('nav');
  clearAstar();
  lastSpoken = '';
  userPos = route.coords[0];
  progressIdx = 0;
  updateNavTop();

  // Starting inside a room: play the same "arriving at the building" shot as an outdoor
  // start (see-through building from outside, facing the way ahead), then dive into the
  // corridor follow camera.
  const f0 = route.floors[0];
  if (f0 !== null && f0 !== undefined) {
    setXray(true);
    window.CampusPathAIML?.setMaxFloor?.(Math.floor(f0));
    const ahead = route.coords.find(c => metersBetween(c, route.coords[0]) > 3) || route.coords[route.coords.length - 1];
    camBearing = bearingTo(route.coords[0], ahead);
    map.flyTo({ center: route.coords[0], zoom: 19.4, pitch: 62, bearing: camBearing, duration: 1800, essential: true });
    followHoldUntil = Date.now() + 2000;
    // Hand over to the corridor camera even if the walker hasn't moved yet (real Start, no steps).
    setTimeout(() => {
      if (sheet.dataset.state === 'nav' && userPos) followCamera(userPos, userFloor ?? f0, false);
    }, 2050);
  }
}

function showArrived() {
  navTop.hidden = false;
  navTop.classList.add('arrived');
  document.getElementById('nav-top-main').textContent = 'You have arrived';
  speak(`You have arrived at ${destinationName().replace(/\(.*\)/, '')}`);
  document.getElementById('nav-top-sub').textContent = destinationName();
  document.getElementById('nav-eta').textContent = 'Arrived';
  document.getElementById('nav-end-btn').textContent = 'Done';
}

// ==========================================
// 6. LIVE NAVIGATION (GPS) + SIMULATION
// ==========================================
// Distance in metres from p to segment a-b (local flat projection; fine at campus scale).
function distToSegment(p, a, b) {
  const mLng = 111320 * Math.cos(a[1] * Math.PI / 180), mLat = 110574;
  const ax = 0, ay = 0, bx = (b[0] - a[0]) * mLng, by = (b[1] - a[1]) * mLat;
  const px = (p[0] - a[0]) * mLng, py = (p[1] - a[1]) * mLat;
  const len2 = bx * bx + by * by;
  const t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
  return Math.hypot(px - (ax + t * bx), py - (ay + t * by));
}

function metersBetween(a, b) {
  const mLat = 110574, mLng = 111320 * Math.cos(a[1] * Math.PI / 180);
  return Math.hypot((a[0] - b[0]) * mLng, (a[1] - b[1]) * mLat);
}

// ---- Follow camera (Google-Maps style: behind the walker, facing the way ahead) ----
let camBearing = null;

function bearingTo(a, b) {
  const mLng = 111320 * Math.cos(a[1] * Math.PI / 180);
  return Math.atan2((b[0] - a[0]) * mLng, (b[1] - a[1]) * 110574) * 180 / Math.PI;
}

function lookAhead(pos) {
  const c = route.coords;
  for (let i = progressIdx + 1; i < c.length; i++) {
    if (metersBetween(pos, c[i]) > 3) return c[i];
  }
  return c[c.length - 1];
}

// The user dragged / rotated / tilted the map: stop following until they tap "Re-centre".
let followPaused = false;
const recenterBtn = document.getElementById('recenter-btn');
map.on('movestart', e => {
  if (!e.originalEvent) return; // our own camera moves don't count
  followPaused = sheet.dataset.state === 'nav';
  recenterBtn.hidden = false;
});
recenterBtn.addEventListener('click', () => {
  recenterBtn.hidden = true;
  followPaused = false;
  const state = sheet.dataset.state;
  if (state === 'nav' && userPos) followCamera(userPos, userFloor, true);
  else if (state === 'route' && route) fitRoute();
  else map.flyTo({ center: [73.8682, 18.4635], zoom: 17.2, pitch: 50, bearing: -15, duration: 1000 });
});

let followHoldUntil = 0; // an entry fly-in is playing: don't fight it

function followCamera(pos, floor, animate) {
  if (followPaused || Date.now() < followHoldUntil) return;
  const target = bearingTo(pos, lookAhead(pos));
  if (camBearing === null) camBearing = target;
  camBearing += ((((target - camBearing) % 360) + 540) % 360 - 180) * (animate ? 1 : 0.15); // smooth turns

  if (floor === null || floor === undefined) {
    const opts = { center: pos, bearing: camBearing, pitch: 62, zoom: 19.6 };
    if (animate) map.easeTo({ ...opts, duration: 900, easing: t => t });
    else map.jumpTo(opts);
    return;
  }
  // Indoors: free camera just behind and above the walker (above the 3.2 m walls), looking
  // down the corridor ahead.
  // Corridors: low and tilted toward the horizon so the way ahead is visible.
  // Stairs: higher overview, because a low camera would face the stair-hall wall.
  const ids = [route.nodeIds[progressIdx], route.nodeIds[progressIdx + 1]].join(' ');
  const onStairs = Math.abs(floor - Math.round(floor)) > 0.01 || /STAIRS|LANDING|LIFT/.test(ids);
  const [back, height, pitch] = onStairs ? [9, 8, 55] : [7, 4.2, 70];
  const rad = camBearing * Math.PI / 180;
  const mLng = 111320 * Math.cos(pos[1] * Math.PI / 180);
  const behind = [pos[0] - Math.sin(rad) * back / mLng, pos[1] - Math.cos(rad) * back / 110574];
  const cam = map.getFreeCameraOptions();
  cam.position = mapboxgl.MercatorCoordinate.fromLngLat(behind, window.CampusPathAIML.floorHeight(floor) + height);
  cam.setPitchBearing(pitch, camBearing);
  map.setFreeCameraOptions(cam);
}

// pos: [lng,lat]; simIdx/simFloor: exact progress from the simulator (GPS can't tell floors).
function updateUserPosition(pos, simIdx, simFloor) {
  if (!route) return;
  if (!userMarker) {
    const el = document.createElement('div');
    el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 0 10px #2563eb;';
    userMarker = new mapboxgl.Marker({ element: el }).setLngLat(pos).addTo(map);
  }
  userMarker.setLngLat(pos);

  if (simIdx !== undefined) {
    progressIdx = simIdx;
  } else {
    // Only move forward: the nearest route *segment* among the next few is the one we're on.
    let best = progressIdx, bestD = Infinity;
    for (let i = progressIdx; i < Math.min(route.coords.length - 1, progressIdx + 15); i++) {
      const d = distToSegment(pos, route.coords[i], route.coords[i + 1]);
      if (d < bestD) { bestD = d; best = i; }
    }
    progressIdx = best;
  }
  const floor = simFloor !== undefined ? simFloor : route.floors[progressIdx];
  route.navigating = true;
  userPos = pos;
  userFloor = floor ?? null;
  renderRoute();
  const inside = floor !== null && floor !== undefined;
  const nearBuilding = Object.values(AIML_ENTRANCES).some(e => metersBetween(pos, e) < XRAY_DISTANCE_M);
  if ((nearBuilding || inside) && route.floors.some(f => f !== null && f !== undefined)) {
    if (!xrayOn) setXray(true);
  }
  // Indoors: hide floors above the walker and draw them at floor height instead of on the ground.
  window.CampusPathAIML?.setMaxFloor?.(inside ? Math.floor(floor) : null);
  window.CampusPathAIML?.setInteriorFloor?.(inside ? floor : null);
  updateCheckpointButton();
  window.CampusPathAIML?.setUserPosition?.(inside ? pos : null, floor);
  userMarker.getElement().style.display = inside ? 'none' : '';
  followCamera(pos, inside ? floor : null, simIdx === undefined);
  updateNavTop();

  if (progressIdx >= route.coords.length - 1) {
    stopNavigation();
    showArrived();
    return;
  }
}

function setXray(on) {
  xrayOn = on;
  window.CampusPathAIML?.setXray?.(on);
  if (!on) {
    window.CampusPathAIML?.setMaxFloor?.(null);
    window.CampusPathAIML?.setInteriorFloor?.(null);
  }
}

function stopNavigation() {
  if (gpsWatchId !== null) navigator.geolocation.clearWatch(gpsWatchId);
  gpsWatchId = null;
  clearInterval(simTimer);
  simTimer = null;
  stopPedometer();
}

// ==========================================
// 7. INDOOR POSITIONING: step counting + checkpoints
// ==========================================
// GPS can't see floors and drifts indoors, so once the walker reaches the entrance we
// stop trusting GPS and advance along the indoor route by counted steps instead.
const STEP_LENGTH_M = 0.7;
let indoorMode = false, walkedM = 0, stepCount = 0, cumDist = [];
const checkpointBtn = document.getElementById('nav-checkpoint-btn');
const stepInfo = document.getElementById('step-info');

// Walking distance along the route (stairs count their climb too).
function buildCumDist() {
  cumDist = [0];
  for (let i = 1; i < route.coords.length; i++) {
    const h = metersBetween(route.coords[i - 1], route.coords[i]);
    const v = ((route.floors[i] ?? 0) - (route.floors[i - 1] ?? 0)) * 3.6;
    cumDist.push(cumDist[i - 1] + Math.hypot(h, v));
  }
}

function positionAtDistance(d) {
  const c = route.coords, f = route.floors;
  let i = 0;
  while (i < c.length - 2 && cumDist[i + 1] < d) i++;
  const seg = Math.max(cumDist[i + 1] - cumDist[i], 1e-6);
  const t = Math.min(1, Math.max(0, (d - cumDist[i]) / seg));
  const pos = [c[i][0] + (c[i + 1][0] - c[i][0]) * t, c[i][1] + (c[i + 1][1] - c[i][1]) * t];
  const floor = f[i] == null && f[i + 1] == null ? null : (f[i] ?? 0) + ((f[i + 1] ?? 0) - (f[i] ?? 0)) * t;
  return { pos, floor, idx: t >= 1 ? i + 1 : i };
}

function advanceIndoor(meters) {
  walkedM = Math.min(walkedM + meters, cumDist[cumDist.length - 1]);
  const p = positionAtDistance(walkedM);
  updateUserPosition(p.pos, p.idx, p.floor);
  if (indoorMode) stepInfo.textContent = `Indoor mode · ${stepCount} steps counted`;
}

let lastMag = 9.8, lastStepAt = 0, aboveThreshold = false;
function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  const mag = Math.hypot(a.x, a.y, a.z);
  lastMag = 0.75 * lastMag + 0.25 * mag; // low-pass filter
  const now = performance.now();
  // A step = the filtered acceleration rising through ~11.3 m/s², at most every 300 ms.
  if (!aboveThreshold && lastMag > 11.3 && now - lastStepAt > 300) {
    aboveThreshold = true;
    lastStepAt = now;
    stepCount++;
    advanceIndoor(STEP_LENGTH_M);
  } else if (aboveThreshold && lastMag < 10.3) {
    aboveThreshold = false;
  }
}

function startPedometer(fromIdx) {
  if (indoorMode) return;
  indoorMode = true;
  buildCumDist();
  walkedM = cumDist[fromIdx];
  stepCount = 0;
  if (gpsWatchId !== null) navigator.geolocation.clearWatch(gpsWatchId); // GPS useless indoors
  gpsWatchId = null;
  window.addEventListener('devicemotion', onMotion);
  advanceIndoor(0);
}

function stopPedometer() {
  indoorMode = false;
  window.removeEventListener('devicemotion', onMotion);
  checkpointBtn.hidden = true;
  stepInfo.textContent = '';
}

// Desktop testing: press "s" to take a step.
window.addEventListener('keydown', e => {
  if (indoorMode && e.key.toLowerCase() === 's' && e.target.tagName !== 'INPUT') { stepCount++; advanceIndoor(STEP_LENGTH_M); }
});

// Checkpoints: stairs, landings, lift, corridor corner, destination. Tapping one snaps the
// position there, correcting step-count drift.
function nextCheckpoint() {
  if (!route) return null;
  const here = route.floors[progressIdx] ?? 0;
  for (let i = progressIdx + 1; i < route.nodeIds.length; i++) {
    const id = route.nodeIds[i];
    const label =
      // stairs on my own floor = go to them; on another floor = that floor (up or down)
      id.startsWith('AIML_STAIRS_') ? (route.floors[i] === here ? 'Foot of the stairs' : `Floor ${route.floors[i]} (top of stairs)`) :
      id.startsWith('AIML_E') && route.floors[0] != null ? `Leave by Entrance ${id.slice(-1)}` :
      id.startsWith('AIML_LANDING_') ? 'Stair landing (lift doors)' :
      id.startsWith('AIML_LIFT_') ? 'Inside the lift' :
      /_A40(\.0)?$/.test(id) ? 'Corridor corner' :
      i === route.nodeIds.length - 1 ? `Destination door` : null;
    if (label) return { i, label };
  }
  return null;
}

function updateCheckpointButton() {
  const cp = indoorMode ? nextCheckpoint() : null;
  checkpointBtn.hidden = !cp;
  if (cp) checkpointBtn.textContent = `I'm at: ${cp.label}`;
}

checkpointBtn.addEventListener('click', () => {
  const cp = nextCheckpoint();
  if (!cp) return;
  walkedM = cumDist[cp.i];
  advanceIndoor(0);
});

// ==========================================
// 8. LIVE CROWD (anonymous pings from every navigating phone)
// ==========================================
const DEVICE_ID = (() => {
  try {
    let id = localStorage.getItem('cp_device_id');
    if (!id) { id = (crypto.randomUUID?.() || String(Math.random()).slice(2)); localStorage.setItem('cp_device_id', id); }
    return id;
  } catch { return String(Math.random()).slice(2); }
})();
let lastPingAt = 0;

function pingCrowd(pos) {
  if (Date.now() - lastPingAt < 10_000) return;
  lastPingAt = Date.now();
  fetch(`${API_BASE}/api/crowd/ping`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: DEVICE_ID, lng: pos[0], lat: pos[1] })
  }).catch(() => {}); // crowd data is best-effort
}

function initCrowdLayer() {
  map.addSource('crowd', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  // Soft heatmap: separate phones blend into one warm glow that grows with density.
  map.addLayer({
    id: 'crowd-heat', type: 'heatmap', source: 'crowd',
    paint: {
      'heatmap-weight': 1,
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 15, 0.6, 19, 1.2],
      'heatmap-radius': ['interpolate', ['exponential', 2], ['zoom'], 15, 12, 19, 60, 21, 160],
      'heatmap-opacity': 0.75,
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(255,255,255,0)', 0.2, 'rgba(253,224,71,0.35)', 0.5, 'rgba(251,146,60,0.6)',
        0.8, 'rgba(239,68,68,0.75)', 1, 'rgba(190,18,60,0.85)']
    }
  });
  const crowdInfo = document.getElementById('crowd-info');
  const refresh = async () => {
    try {
      const pts = await (await fetch(`${API_BASE}/api/crowd`)).json();
      crowdInfo.textContent = `${pts.length} ${pts.length === 1 ? 'person' : 'people'} on the move`;
      map.getSource('crowd').setData({
        type: 'FeatureCollection',
        features: pts.map(c => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } }))
      });
    } catch { /* backend offline */ }
  };
  refresh();
  setInterval(refresh, 15_000);

  // Classroom demo with a single phone: clearly labelled test pings (they expire in 2 min).
  document.getElementById('demo-crowd-btn').addEventListener('click', async () => {
    const [lng, lat] = AIML_ENTRANCES.AIML_E2;
    await Promise.all([...Array(6)].map((_, i) => fetch(`${API_BASE}/api/crowd/ping`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: `demo-${i}`, lng: lng + (i % 3) * 0.00002, lat: lat + Math.floor(i / 3) * 0.00002 })
    }).catch(() => {})));
    await refresh();
    toast('Demo: 6 test phones placed at Entrance 2 for 2 minutes. Get directions again to see the route avoid them.');
  });
}

navStartBtn.addEventListener('click', () => {
  stopNavigation();
  camBearing = null;
  startNavUi();
  // Starting in a room: GPS can't see floors, so count steps from the room door.
  if (route.floors[0] !== null && route.floors[0] !== undefined) { startPedometer(0); return; }
  if (!navigator.geolocation) return alert('Location is not available on this device.');
  gpsWatchId = navigator.geolocation.watchPosition(
    p => {
      const pos = [p.coords.longitude, p.coords.latitude];
      pingCrowd(pos);
      if (indoorMode) return; // indoors the step counter drives the position
      updateUserPosition(pos);
      // Reached the entrance: hand over from GPS to step counting.
      const firstIndoor = route.floors.findIndex(f => f !== null && f !== undefined);
      if (firstIndoor > 0 && progressIdx >= firstIndoor - 1
          && metersBetween(pos, route.coords[firstIndoor - 1]) < 8) {
        startPedometer(firstIndoor - 1);
      }
    },
    err => alert('GPS error: ' + err.message),
    { enableHighAccuracy: true, maximumAge: 2000 });
});

// Walks the route at SIM_SPEEDUP × walking speed: lets you demo the whole trip on a desktop.
navSimBtn.addEventListener('click', () => {
  if (!route) return;
  stopNavigation();
  setXray(false);
  progressIdx = 0;
  camBearing = null;
  startNavUi();
  let seg = 0, t = 0;
  const tickMs = 100;
  simTimer = setInterval(() => {
    const c = route.coords;
    if (seg >= c.length - 1) { updateUserPosition(c[c.length - 1], c.length - 1); return; }
    const len = Math.max(metersBetween(c[seg], c[seg + 1]), 0.5);
    t += (WALK_SPEED_MPS * SIM_SPEEDUP * tickMs / 1000) / len;
    while (t >= 1 && seg < c.length - 1) { t -= 1; seg++; }
    if (seg >= c.length - 1) return;
    const p = [c[seg][0] + (c[seg + 1][0] - c[seg][0]) * t, c[seg][1] + (c[seg + 1][1] - c[seg][1]) * t];
    const f0 = route.floors[seg], f1 = route.floors[seg + 1];
    const floor = f0 == null ? f1 == null ? null : 0 : f1 == null ? f0 : f0 + (f1 - f0) * t; // smooth on stairs
    updateUserPosition(p, seg, floor);
  }, tickMs);
});

// ==========================================
// 9. SEARCH (type a room number or name)
// ==========================================
// Two fields, "From" and "To", each backed by a hidden select that holds the chosen value.
const startSearch = document.getElementById('start-search');
const destSearch = document.getElementById('dest-search');
const searchable = sel => [...sel.options].filter(o => o.value && o.value !== 'pinned' && o.value !== 'gps');
document.getElementById('dest-list').innerHTML =
  searchable(endSelect).map(o => `<option value="${o.textContent}"></option>`).join('');
document.getElementById('start-list').innerHTML =
  searchable(startSelect).map(o => `<option value="${o.textContent}"></option>`).join('');

// commit = Enter / picked a suggestion / Get directions: also accept the first partial match.
function applySearch(input, commit) {
  const isStart = input === startSearch;
  const sel = isStart ? startSelect : endSelect;
  const q = input.value.trim().toLowerCase();
  if (q === 'pinned on map') return true; // keep the map pin
  if (!q) {
    if (isStart) { startSelect.value = ''; startCoords = null; startMarker?.remove(); startMarker = null; } // = my GPS location
    return false;
  }
  const hit = searchable(sel).find(o => o.textContent.toLowerCase() === q || o.value.toLowerCase() === q)
    || (commit && searchable(sel).find(o => o.textContent.toLowerCase().includes(q)));
  if (hit) {
    sel.value = hit.value;
    if (isStart) { startCoords = null; startMarker?.remove(); startMarker = null; }
    else { endCoords = null; endMarker?.remove(); endMarker = null; }
    if (commit) input.value = hit.textContent;
  }
  return !!hit;
}
for (const input of [startSearch, destSearch]) {
  input.addEventListener('input', () => applySearch(input, false));
  input.addEventListener('change', () => applySearch(input, true));
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (input === startSearch) { applySearch(input, true); destSearch.focus(); return; }
    if (applySearch(input, true)) findPathBtn.click(); else toast(`No room or place matches "${input.value}"`);
  });
}
// Typed but never confirmed? Use the best matches when "Get directions" is pressed (runs first: capture).
findPathBtn.addEventListener('click', () => {
  if (startSearch.value) applySearch(startSearch, true); else applySearch(startSearch, false);
  if (destSearch.value && !isPlace(endSelect.value)) applySearch(destSearch, true);
}, true);
endSelect.addEventListener('change', () => { destSearch.value = isPlace(endSelect.value) ? endSelect.selectedOptions[0].textContent : ''; });

// ==========================================
// 10. VOICE DIRECTIONS
// ==========================================
const voiceBtn = document.getElementById('voice-btn');
let voiceOn = (() => { try { return localStorage.getItem('cp_voice') !== 'off'; } catch { return true; } })();
let lastSpoken = '';

function syncVoiceBtn() {
  voiceBtn.setAttribute('aria-pressed', String(voiceOn));
  voiceBtn.setAttribute('aria-label', voiceOn ? 'Voice directions on' : 'Voice directions off');
}
syncVoiceBtn();
voiceBtn.addEventListener('click', () => {
  voiceOn = !voiceOn;
  try { localStorage.setItem('cp_voice', voiceOn ? 'on' : 'off'); } catch { /* not persisted */ }
  syncVoiceBtn();
  if (!voiceOn) stopSpeaking();
});

// Make text sound natural: "4308" -> "room 4 3 0 8" (not "four thousand..."), drop "(Floor 3)".
function speakable(text) {
  return text
    .replace(/\s*\((Floor \d|Ground)\)/g, '')
    .replace(/\b4\d{3}(-B)?\b/g, m => `room ${m.replace('-B', ' B').split('').join(' ')}`)
    .replace(/room room/gi, 'room')
    .replace(/–/g, ',');
}

// Pick the most natural installed voice once: Indian English first, then UK/US; prefer
// high-quality "network"/Google voices over the default robotic one.
let ttsVoice = undefined, webVoice = null;
async function chooseVoice() {
  const tts = window.Capacitor?.Plugins?.TextToSpeech;
  const rank = v => (/en[-_]IN/i.test(v.lang) ? 30 : /en[-_]GB/i.test(v.lang) ? 20 : /^en/i.test(v.lang) ? 10 : 0)
    + (/network|google|natural|neural/i.test(`${v.name} ${v.voiceURI}`) ? 5 : 0) + (v.localService === false ? 2 : 0);
  try {
    if (tts) {
      const { voices } = await tts.getSupportedVoices();
      let best = -1;
      voices.forEach((v, i) => { if (best < 0 || rank(v) > rank(voices[best])) best = i; });
      if (best >= 0 && rank(voices[best]) > 0) ttsVoice = best;
    } else if (window.speechSynthesis) {
      const vs = speechSynthesis.getVoices();
      webVoice = vs.slice().sort((a, b) => rank(b) - rank(a))[0] || null;
    }
  } catch { /* default voice */ }
}
chooseVoice();
window.speechSynthesis?.addEventListener?.('voiceschanged', chooseVoice);

// Native Android TTS in the app (the WebView has no speechSynthesis); browser voice on desktop.
function speak(text) {
  if (!voiceOn || !text || text === lastSpoken) return;
  lastSpoken = text;
  const say = speakable(text);
  const tts = window.Capacitor?.Plugins?.TextToSpeech;
  if (tts) {
    tts.speak({ text: say, lang: 'en-IN', rate: 0.9, pitch: 1.0, ...(ttsVoice !== undefined ? { voice: ttsVoice } : {}) }).catch(() => {});
    return;
  }
  if (window.speechSynthesis) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(say);
    u.lang = 'en-IN'; u.rate = 0.92;
    if (webVoice) u.voice = webVoice;
    speechSynthesis.speak(u);
  }
}
function stopSpeaking() {
  window.Capacitor?.Plugins?.TextToSpeech?.stop?.()?.catch?.(() => {});
  window.speechSynthesis?.cancel();
}

// ==========================================
// 11. "HOW A* SEARCHED" (trial feature)
// ==========================================
const astarBtn = document.getElementById('astar-btn');
const astarInfo = document.getElementById('astar-info');
let astarAnim = null, lastPayload = null;

function clearAstar() {
  cancelAnimationFrame(astarAnim);
  if (map.getLayer('astar-pts')) map.removeLayer('astar-pts');
  if (map.getSource('astar')) map.removeSource('astar');
  astarInfo.hidden = true;
}

astarBtn.addEventListener('click', () => {
  const explored = route?.props?.explored;
  if (!explored?.length) return;
  clearAstar();
  map.addSource('astar', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'astar-pts', type: 'circle', source: 'astar',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 3, 19, 7],
      'circle-color': ['case', ['get', 'frontier'], '#f59e0b', '#8b5cf6'],
      'circle-opacity': 0.85, 'circle-stroke-width': 1, 'circle-stroke-color': '#ffffff'
    }
  }, map.getLayer('route-line') ? 'route-line' : undefined);
  fitRoute();

  // Same search without the heuristic = Dijkstra, run on the phone for comparison.
  let dijkstra = null;
  try { dijkstra = window.CampusOffline.route({ ...lastPayload, heuristic: false }).properties.explored.length; } catch { /* no cached graph */ }
  const total = window.CampusOffline.nodeCount();
  const feats = explored.map(([lng, lat]) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } }));
  const duration = 3500, t0 = performance.now();
  astarInfo.hidden = false;

  const step = now => {
    const n = Math.min(feats.length, Math.max(1, Math.ceil(feats.length * (now - t0) / duration)));
    const shown = feats.slice(0, n).map((f, i) => ({ ...f, properties: { frontier: i >= n - 3 } }));
    map.getSource('astar')?.setData({ type: 'FeatureCollection', features: shown });
    astarInfo.textContent = `A* examined ${n}${total ? ` of ${total}` : ''} junctions (purple dots) to find the best path.`
      + (n === feats.length && dijkstra ? ` Dijkstra (no heuristic) would examine ${dijkstra}.` : '');
    if (n < feats.length) astarAnim = requestAnimationFrame(step);
  };
  astarAnim = requestAnimationFrame(step);
});

// ==========================================
// 12. DARK MODE
// ==========================================
const themeBtn = document.getElementById('theme-btn');
const OUR_LAYERS = new Set(['route-line', 'crowd-heat', 'astar-pts', 'campuspath-aiml-glb']);
const originalPaint = new Map(); // "layerId|prop" -> light value, to restore

// Dark colour for a Mapbox style layer, chosen from its type and id (water, parks, roads...).
function darkPaint(layer) {
  const id = layer.id;
  const is = re => re.test(id);
  switch (layer.type) {
    case 'background': return { 'background-color': '#12161d' };
    case 'fill': return { 'fill-color': is(/water/) ? '#13263a' : is(/park|grass|wood|pitch|landuse|national/) ? '#17261e' : '#1a1f27' };
    case 'line': return { 'line-color': is(/water|river/) ? '#13263a' : is(/road|street|path|bridge|tunnel|offline/) ? '#38404e' : '#262c36' };
    case 'fill-extrusion': return { 'fill-extrusion-color': '#2b313c' };
    case 'symbol': return layer.layout?.['text-field'] ? { 'text-color': '#cbd5e1', 'text-halo-color': '#0b0f14' } : {};
    default: return {};
  }
}

function themeMap(dark) {
  if (!map.isStyleLoaded()) return;
  for (const layer of map.getStyle().layers) {
    if (OUR_LAYERS.has(layer.id)) continue;
    for (const [prop, value] of Object.entries(darkPaint(layer))) {
      const key = `${layer.id}|${prop}`;
      try {
        if (dark) {
          if (!originalPaint.has(key)) originalPaint.set(key, map.getPaintProperty(layer.id, prop));
          map.setPaintProperty(layer.id, prop, value);
        } else if (originalPaint.has(key)) {
          map.setPaintProperty(layer.id, prop, originalPaint.get(key));
        }
      } catch { /* property not valid for this layer */ }
    }
  }
}

let darkMode = (() => {
  try { const s = localStorage.getItem('cp_theme'); if (s) return s === 'dark'; } catch { /* default */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
})();

function applyTheme() {
  document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
  themeBtn.setAttribute('aria-pressed', String(darkMode));
  themeBtn.setAttribute('aria-label', darkMode ? 'Switch to light mode' : 'Switch to dark mode');
  themeMap(darkMode);
}
themeBtn.addEventListener('click', () => {
  darkMode = !darkMode;
  try { localStorage.setItem('cp_theme', darkMode ? 'dark' : 'light'); } catch { /* not persisted */ }
  applyTheme();
});
applyTheme();
map.on('load', () => applyTheme()); // the map's own layers exist only after load
