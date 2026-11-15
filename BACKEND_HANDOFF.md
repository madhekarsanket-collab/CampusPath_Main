# CampusPath - Frontend to Backend Handoff Document

**To Pramit & Pramit's AI Assistant:**
This document outlines the current state of the CampusPath frontend and specifies exactly what the Java Spring Boot backend needs to implement. Please use this to build the backend routing engine from scratch.

---

## 1. Project Overview
**CampusPath** is a smart 3D routing and navigation application for the VIT Pune campus. It handles both outdoor routing (between buildings) and indoor routing (to specific rooms/floors). The frontend is built using Vanilla JS, HTML, CSS, and Mapbox GL JS. 

The backend must act as the routing engine. It should hold the campus graph data and run pathfinding algorithms (A*, Dijkstra) to return exact coordinates to the frontend.

## 2. What the Frontend Currently Does
*   **3D Map:** Renders the campus using Mapbox GL JS with extruded 3D buildings that become translucent when zoomed in.
*   **UI Controls:** A Glassmorphism sidebar allowing users to select `Start` and `Destination`. 
*   **Custom Map Pins:** Users can click anywhere on the map to drop a custom Start (Green) or End (Red) pin. The frontend captures these exact `lng,lat` coordinates.
*   **Modifiers:** Users can check "Find Rain-Free Route" and input the "Current Time" to avoid crowds.
*   **Indoor Handoff:** The frontend handles the UI for switching between "Outdoor Route" (map view) and "Indoor Navigation" (step-by-step room instructions).

## 3. The API Contract (What the Backend Needs to Build)

The frontend is programmed to make a `GET` request to the following endpoint when the user clicks "Find Smart Path":

### **Endpoint:**
`GET http://localhost:8080/api/route`

### **Query Parameters:**
1.  **`start`** (String): Can be a predefined building ID (e.g., `"MainGate"`, `"CS_DESH"`) OR a comma-separated coordinate string from a custom map click (e.g., `"73.8682,18.4632"`).
2.  **`end`** (String): Same format as `start` (e.g., `"AIML"` or `"73.8690,18.4640"`).
3.  **`rain`** (Boolean): `"true"` or `"false"`. If true, the backend algorithm must penalize outdoor paths heavily to route the user under roofs.
4.  **`time`** (String): e.g., `"1300"` (representing 13:00 or 1 PM). The backend should use this to apply a crowd multiplier to specific paths (e.g., canteens are crowded at 1300).

*Example Request:*
`http://localhost:8080/api/route?start=73.8675,18.4625&end=AIML&rain=true&time=1300`

### **Expected Response format (GeoJSON):**
The frontend expects a standard **GeoJSON LineString** object representing the exact path points so Mapbox can draw the glowing blue line. 

```json
{
    "type": "Feature",
    "properties": {
        "estimatedTimeMinutes": 5,
        "distanceMeters": 450
    },
    "geometry": {
        "type": "LineString",
        "coordinates": [
            [73.8675, 18.4625],
            [73.8680, 18.4630],
            [73.8685, 18.4635]
            // ... more coordinates representing the path
        ]
    }
}
```

## 4. Predefined Building IDs (Graph Nodes)
If the `start` or `end` parameter is not a coordinate, it will be one of these exact strings. The backend graph must recognize these as specific node IDs:
*   `MainGate`
*   `CS_DESH` (Building)
*   `AI_AIDS_Mech` (Building)
*   `AIML` (Building)
*   `MainCanteen`
*   `Nescafe`
*   `StaffCanteen`
*   `FruitCanteen`
*   `PuneBakery`
*   `ParathaHouse`
*   `Parking`
*   `Auditorium`

## 5. Required Backend DSA Architecture (Instructions for AI)
To make this work efficiently, the backend AI should implement the following:
1.  **Graph Data Structure:** Create a weighted directed graph representing the campus. Nodes are path intersections; edges are walkways.
2.  **K-D Tree (Spatial Partitioning):** If the `start` or `end` parameter is a coordinate (e.g., `73.86,18.46`), you MUST use a K-D Tree to perform a Nearest-Neighbor search to snap that coordinate to the nearest valid Graph Node before running the routing algorithm.
3.  **A* Search Algorithm:** Use A* for the core pathfinding. The heuristic should be the Haversine formula (straight-line distance between lat/lng points).
4.  **Dynamic Weights (Modified Dijkstra):** The edge weights should be a formula: `Cost = Distance * CrowdMultiplier(time) + RainPenalty(isCovered)`. If `rain=true`, apply a massive penalty to edges where `isCovered == false`.

**End of Document.** You can begin setting up the Spring Boot Application, Controllers, and the Graph/Node models based on this spec.
