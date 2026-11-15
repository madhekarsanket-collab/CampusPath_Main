# CampusPath AIML Mapbox Integration — handoff

## Implemented
- Preserved the existing CampusPath frontend, outdoor route form, route rendering, and backend API call.
- Added the standalone AIML GLB under `Frontend/assets/`.
- Added a Three.js + GLTFLoader Mapbox custom 3D layer.
- Added show/hide, G/1/2/3 floor selection, roof toggle, scale and rotation controls.
- Added click-to-calibrate anchor placement on the existing map.

## Run
Serve `Frontend` over HTTP, e.g. `python -m http.server 8000` from the Frontend folder.
Open `http://localhost:8000`. Keep the Spring Boot backend running on port 8080 for outdoor routing.

## Georeferencing caveat
The supplied GeoJSON has three AIML-labelled LineString features, not a surveyed building footprint polygon. The initial anchor (73.867790, 18.463690) is an approximate centre derived from those lines. Use the calibration control to reposition; use the rotation and scale sliders for rough alignment. Accurate placement requires the four building footprint corners (or a GeoJSON Polygon) and a north reference.

## Indoor routing caveat
This adds GLB rendering and floor visibility, not a real indoor pathfinding engine. The current model contains eight schematic classrooms per floor. Real room-to-room routing requires measured corridor nodes, door nodes, stair links and a room-ID-to-door mapping for each floor. The existing "I've Arrived" view still only shows generic textual instructions.

## Libraries
Three.js 0.160.0 and GLTFLoader are loaded from unpkg CDN; Mapbox GL JS remains at the project's existing v2.14.1.
