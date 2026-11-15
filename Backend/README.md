# CampusPath Backend

Java Spring Boot backend for the CampusPath college navigation project.

## DSA used

1. **Weighted Graph** - represents campus walkways and intersections.
2. **KD-Tree** - nearest-neighbor lookup when the frontend sends arbitrary map coordinates.
3. **A\*** - primary pathfinding algorithm.
4. **Haversine formula** - straight-line geographic distance used as the A* heuristic.
5. **Dynamic edge costs** - crowd and rain modify route selection.

## Important

The graph coordinates and edge measurements in `CampusGraphConfig.java` are a **demo dataset**.
Before final submission, replace them with your team's verified VIT Pune coordinates and actual
walkway distances.

The backend API contract follows the frontend handoff:
`GET /api/route?start=...&end=...&rain=...&time=...`

## Requirements

- Java 17+
- Maven 3.9+

## Run

```bash
mvn spring-boot:run
```

Server:
`http://localhost:8080`

Health:
`GET /health`

## Test examples

Named nodes:

```text
http://localhost:8080/api/route?start=MainGate&end=AIML&rain=false&time=1100
```

Rain:

```text
http://localhost:8080/api/route?start=MainGate&end=AIML&rain=true&time=1300
```

Coordinate input:

```text
http://localhost:8080/api/route?start=73.8570,18.4781&end=AIML&rain=false&time=1300
```

The coordinate input is snapped to the nearest graph node using the KD-Tree.

## Folder structure

```text
src/
└── main/
    └── java/com/campuspath/
        ├── algorithm/
        │   ├── AStar.java
        │   └── Haversine.java
        ├── config/
        │   └── CampusGraphConfig.java
        ├── controller/
        │   ├── HealthController.java
        │   └── RouteController.java
        ├── datastructure/
        │   ├── Graph.java
        │   └── KDTree.java
        ├── model/
        │   ├── Edge.java
        │   └── Node.java
        ├── service/
        │   └── RouteService.java
        └── CampusPathApplication.java
```

## Architecture

Frontend -> RouteController -> RouteService -> KD-Tree (if needed) -> A* -> GeoJSON

## Dynamic cost

Conceptually:

`Cost = Distance × CrowdMultiplier(time) + RainPenalty`

When rain is enabled, uncovered edges receive a large penalty so covered paths are preferred.

## What to replace for the real campus

Edit only `CampusGraphConfig.java` initially:

- Add all real graph intersections.
- Use verified longitude/latitude coordinates.
- Add real walkway distances.
- Mark covered walkways correctly.
- Set realistic crowd multipliers.
- Add additional edges where paths intersect.

Do not add only buildings as nodes if the goal is accurate turn-by-turn routing.
Use intersections/junctions as graph nodes and buildings as meaningful destination nodes.
