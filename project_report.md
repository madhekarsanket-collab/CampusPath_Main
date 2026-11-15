# CampusPath: Weighted Graph Routing with Constraint-Aware Path Selection
**Subject:** Fundamentals of Data Structures (FODS) - Course Project  
**Institution:** VIT Pune  
**Team:** Sanket (Frontend & UI) and Pramit (Backend & Core Algorithms)

## 1. Project Overview
CampusPath is a 3D interactive campus navigation system built to apply theoretical graph data structures to real-world spatial problems. Standard routing algorithms compute the shortest distance; CampusPath introduces **Constraint-Aware Routing**, allowing users to filter paths based on environmental and temporal factors.

### 1.1 Key Features & Novel Ideas
1. **Rain-Free Routing:** Paths are mapped with an `isCovered` boolean tag. If it is raining, the algorithm dynamically avoids uncovered pathways.
2. **Time-Based Crowd Avoidance:** Paths near high-traffic areas (e.g., the Canteen or Main Gate) have dynamic weights. If a user inputs a specific time (e.g., "1:00 PM - Lunch Break"), the algorithm artificially increases the weight of those specific edges, routing the user through quieter parts of the campus.
3. **3D Interactive Mapping:** A fully interactive 3D map of the VIT Pune campus displaying building extrusions and a dynamic glowing path overlay.

---

## 2. Technical Architecture & Algorithms

### 2.1 Data Structures Used (Core Java)
*   **Adjacency List (`HashMap<String, List<Edge>>`):** Used to store the campus map in memory, providing O(1) lookup time for connected nodes.
*   **Min-Heap (`PriorityQueue`):** Used to optimize the routing algorithm, automatically keeping the closest unvisited node at the front of the queue, reducing time complexity to O(E log V).

### 2.2 The Algorithm: Constraint-Aware Dijkstra's
The core logic relies on a modified Dijkstra's algorithm. During the edge relaxation phase, a custom cost function evaluates the path:
*   **If Rain-Free is checked:** `if (!edge.isCovered) return Infinity;`
*   **If Crowd-Free is checked:** The cost is multiplied by a time-based density factor. `cost = edge.distance * edge.getCrowdMultiplier(currentTime);`

---

## 3. Team Task Allocation & Execution Plan

### 3.1 Backend & Algorithms: Pramit's Tasks
Pramit is responsible for the Java backend, the graph logic, and exposing the API.

*   **Task 1: Graph Modeling (Java Core)**
    *   Create the `Node` and `Edge` classes.
    *   The `Edge` class must include variables for: `targetNode`, `distance` (meters), `isCovered` (boolean), and a method/map for `crowdMultiplier` based on the hour.
*   **Task 2: Algorithm Implementation**
    *   Build the `HashMap` Adjacency List representing VIT Pune.
    *   Write the modified Dijkstra's algorithm utilizing a `PriorityQueue`. 
    *   Create the logic that alters edge weights based on time (e.g., if Time = 13:00, multiply canteen edge distances by 5).
*   **Task 3: Spring Boot API Server**
    *   Initialize a Java Spring Boot project.
    *   Create a REST Endpoint: `GET /api/route?start=Gate&end=Lib&rain=true&time=1300`.
    *   Format the output as a GeoJSON coordinate array to send to the frontend.

### 3.2 Frontend & 3D Visuals: Sanket's Tasks
Sanket is responsible for the web interface, the Mapbox 3D rendering, and API integration.

*   **Task 1: The UI Layout & Design (HTML/CSS)**
    *   **Look & Feel:** The interface should feature a full-screen, edge-to-edge 3D map. On the top-left, place a floating "Glassmorphism" panel (slightly transparent white background with a blur effect).
    *   **Components to Build:**
        *   Dropdown 1: Starting Location.
        *   Dropdown 2: Destination.
        *   Checkbox: "Find Rain-Free Route".
        *   Time Picker / Dropdown: "Current Time" (to trigger Pramit's crowd logic).
        *   Button: "Find Path".
*   **Task 2: Mapbox GL JS Integration (JavaScript)**
    *   Register for a Mapbox Access Token.
    *   Initialize the map centered precisely on VIT Pune (`[73.868, 18.463]`).
    *   Set the map `pitch` to 60 degrees to activate the 3D perspective.
    *   Add the 3D building extrusion layer provided natively by Mapbox.
*   **Task 3: API Fetch & Dynamic Rendering (JavaScript)**
    *   Write a JS function attached to the "Find Path" button.
    *   Use the `fetch()` API to send the selected dropdown and checkbox data to Pramit's Spring Boot server.
    *   Receive the route coordinates, parse them into a GeoJSON `LineString`, and use `map.addLayer()` to draw a thick, glowing blue line on the map.

---

## 4. Evaluation Criteria
This project fulfills the FODS requirements by demonstrating a clear, practical application of standard Data Structures (Graphs, HashMaps, Priority Queues) to solve a complex mathematical constraint problem, wrapped in a modern software engineering architecture.