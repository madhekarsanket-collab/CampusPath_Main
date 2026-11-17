# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project
CampusPath: campus navigation app (FODS/DSA course project, VIT Pune). Goal: a route from anywhere on campus (outdoor GPS) to a specific room, e.g. `4309` = Building 4 (AIML), floor 3, room 09. Near the building, the 3D AIML model goes translucent and the route continues indoors (lift/stairs → corridor → room door). Extras: rain-free routing, crowd avoidance. Only the AIML building is in scope for now; keep things modular so other buildings can be added later.

## Commands
- Backend (Spring Boot 3.5, Java 17, Maven), from `Backend/`:
  - Run: `mvn spring-boot:run` (port 8080; health check `GET /health`)
  - Tests: `mvn test`; single test: `mvn test -Dtest=IndoorRoutingTest`
- Frontend: static files in `Frontend/www/`. For desktop testing, serve over HTTP (e.g. `python -m http.server 8000` in `Frontend/www`); the GLB won't load over `file://`.
- Android (Capacitor, `Frontend/`): `npx cap sync`, then build/run from Android Studio (`Frontend/android`). `bridge.ps1` (repo root) frees port 8080, runs cap sync, and runs `adb reverse tcp:8080 tcp:8080` (adb is at `D:\Android Studio SDK Components\platform-tools\adb.exe`).

## Architecture
- **Backend** (`Backend/src/main/java/com/campuspath/`):
  - `CampusGraphConfig` builds the graph from `src/main/resources/coordinates.geojson`.
  - `Graph` stores it; `KDTree` snaps arbitrary coordinates to the nearest node.
  - `AStar` + `Haversine` do the routing; `RouteService` applies rain and time-of-day costs.
  - `RouteController`: `GET /api/route?start=&end=&rain=&time=` and `POST /api/route` with `{start:{lng,lat}|startNode, end:{lng,lat}|endNode, rain, time}`. Start/end strings are node ids or `"lng,lat"`. The response is a GeoJSON LineString Feature with `estimatedTimeMinutes` and `distanceMeters`. CORS is open.
- **Frontend** (`Frontend/www/`):
  - `app.js`: Mapbox GL map, tap-to-pin start (green) and end (red), and the backend fetch (`BACKEND_URL`, currently `http://localhost:8080` — on a phone this only works with `adb reverse`).
  - `aiml-model.js`: Three.js custom Mapbox layer loading the AIML GLB, with floor isolation, roof toggle and placement calibration (anchor/scale/rotation config at the top of the file).
- `Frontend/www/` must contain only the shipped web app; Capacitor bundles everything in it.

## Indoor routing (implemented)
- `config/AimlIndoorGraph` adds AIML corridor, door, stairs and lift nodes (with `floor` set) to the same `Graph`, so one A* search runs outdoor → entrance → stairs/lift → room door. Room node ids are room numbers (`4309`); others are `AIML_OFFICE`, `AIML_HOD_OFFICE`, `AIML_WASHROOM_*`. Geometry is metres from Entrance 2 (tables at the top of the class).
- The KD-tree holds outdoor nodes only, so GPS taps never snap indoors.
- The route response has `properties.floors` (per coordinate, null = outdoor), `nodeIds` and `destination`.
- Crowds: edges within 35 m of food hotspots get a weight, scaled by time of day (peaks 12–14, 17–19), applied only when `avoidCrowds` is set. Rain: uncovered edges get +10000 cost; indoor edges are covered.
- Frontend: `app.js` draws the outdoor part as a Mapbox line. `CampusPathAIML.setIndoorRoute(coords, floors)` draws the indoor part as a Three.js tube at floor height (3.6 m per floor × scaleZ), plus a green box on the destination. `setXray(true)` turns the model translucent. The walked part of the route is trimmed (`progressIdx`). "Simulate walk" demos the trip without GPS. Rain auto-detects via Open-Meteo.
- Model placement (`aiml-model.js` DEFAULT_CONFIG): model +X = south, rotationZ −90, scaleY 1.6 (long arm), scaleX 1.7; the anchor is chosen so the model entrance sits on the E2 GPS point. If you change these, keep them consistent with `AimlIndoorGraph`. Calibration is saved under the localStorage key `CampusPath_AIML_Calibration_v2`.
- **3D precision:** all Three.js objects live in local metres around `FRAME_ORIGIN` (Entrance 2). `frameMatrix()` folds the Mercator transform into `camera.projectionMatrix` in JS doubles. Never put Mercator-scale matrices on objects: the geometry shreds at close zoom. The map uses `maxZoom: 24` so the indoor follow camera can sit ~9 m behind the walker (Mapbox free camera, `followCamera` in `app.js`).
- **Generated interior:** `GET /api/buildings/aiml/layout` (from `AimlIndoorGraph.layout()`) feeds `buildInterior()`, which draws the corridors, two-tone walls, windows, doors with room signs and stairs. Indoors, the schematic GLB is hidden and only the walker's floor is shown.
- **Indoor positioning:** GPS outdoors. Within 8 m of the entrance, `startPedometer` takes over: `devicemotion` step detection at 0.7 m per step along the route's walking distance (`cumDist`, stairs included), plus an "I'm at: …" checkpoint button to correct drift. On desktop, the `s` key adds a step.
- **Live crowd:** phones POST `/api/crowd/ping` (random device id) every 10 s during GPS navigation. `CrowdService` keeps the last 2 min; A* multiplies costs by 1 + 0.6 × (phones within 15 m), capped at 4×. `GET /api/crowd` feeds the red circle layer.
- **Covered paths:** features 2 and 4 in `coordinates.geojson` (the tree-lined walkway the user marked) have `isCovered: true`.
- Materials are swapped to `MeshLambertMaterial`: PBR rendered as black speckle inside the Mapbox custom layer.
- Headless check: `python -m http.server 8000` in `Frontend/www` with the backend running, then Playwright (installed) with `--use-gl=angle`.

## Known state / data
- AIML entrances (lat, lng): E1 `18.463487, 73.867780`; E2 `18.463828, 73.867834`. All 4 floors share the same layout; room numbers are `4<floor><room>`.
- AIML layout (from the user's hand sketches; same on every floor). The corridor is L-shaped: a long N–S arm plus a short arm running west from its south end. Rooms are on the outer wall; the inner wall has windows and seats.
  - Ground floor, from E2 (north end) going south: male washroom, AIML office, 4003 (Liquid Galaxy lab), 4004, STAIRS (east wall), 4005, SE corner, then westward: 4006, 4007, girls' washroom. E1 sits on the diagonal inner corner, near 4006/4007.
  - Floors 1–3 (shown for floor 3): male washroom, HOD office, x04, STAIRS, x05, x06, corner, x07, x08, x09 (far west end). Floor 0 has no seats.
- Model: `www/assets/aiml_building_final.glb` (30×20 m schematic; mesh names are prefixed `G `/`1 `/`2 `/`3 ` per floor; stairs/lift use `L0`..`L2`). Old models and debug screenshots are in `docs/debug-screenshots/`.
- Maven is not on PATH: use `D:\tools\apache-maven-3.9.9\bin\mvn.cmd`. `DirectRoutingTest` is a `main()` script; the JUnit tests are `IndoorRoutingTest` and `CampusPathApplicationTests`.
- Workflow: test on desktop first, then convert to Android.
