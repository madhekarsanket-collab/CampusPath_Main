# CampusPath - DSA Course Project Presentation Content

You can copy and paste the text below directly into Gemini or Claude to generate your PPT slides, or use it to build the slides yourself.

---

## Slide 1: Title
**Title:** CampusPath: Immersive 3D & Indoor Navigation System
**Subtitle:** DSA Course Project
**Team Members:** [Your Name/Team Names]
**Course:** Data Structures and Algorithms

## Slide 2: Introduction
*   **What is CampusPath?** A smart, 3D routing and navigation web application specifically designed for the VIT Pune campus.
*   **Key Innovation:** It provides a seamless transition from outdoor campus routing to highly detailed indoor room-to-room navigation.
*   **Features:** Real-time vanishing paths, cinematic auto-zoom with translucent 3D buildings (X-ray vision), rain-free routing, and time-based crowd avoidance.

## Slide 3: Problem Statement
*   **The Problem:** Large university campuses are complex. Freshers, visitors, and even regular students often struggle to find specific rooms, labs, or accessible routes.
*   **Current Limitations:** Commercial apps like Google Maps stop at the building entrance. They do not route you to "3rd floor, Room 4301".
*   **Environmental Factors:** During monsoons, students need to find covered paths, and during peak breaks, they need to avoid crowded bottlenecks.

## Slide 4: Literature Survey (Current Solutions vs. Ours)
*   **Traditional Campus Maps:** Static 2D images or PDFs. Lacks real-time tracking and spatial context.
*   **Google Maps/Apple Maps:** Excellent outdoor routing, but lacks detailed indoor floor plans, staircase routing, and custom institutional constraints (like "rain-free").
*   **Our Solution:** Uses Mapbox GL JS for 3D extrusion, combined with custom Graph Data Structures to map indoor hallways and stairs, bridging the gap between outdoor and indoor navigation.

## Slide 5: DSA Used in Project
*   **Core Data Structure:** Weighted Directed Graphs (representing outdoor paths, building entrances, stairs, and corridors).
*   **Routing Algorithm:** A* (A-Star) Search Algorithm & Modified Dijkstra's Algorithm.
*   **Spatial Searching:** K-D Tree (K-Dimensional Tree).
*   **Geometry/Math:** Vector Projection.

## Slide 6: Details of DSA Used
*   **Graph & A* Search:** The campus is a graph where nodes are intersections/doors and edges are paths. A* is used for blazing-fast shortest-path calculations using Euclidean distance as a heuristic.
*   **Dynamic Edge Weights (Modified Dijkstra):** We modify the algorithm's cost function dynamically. If the user selects "Rain-Free", outdoor edges receive a massive weight penalty (+9999), forcing the algorithm to find indoor/covered paths.
*   **K-D Tree (Spatial Partitioning):** Used when the user drops a custom pin on the map. The K-D Tree performs a Nearest Neighbor Search in `O(log N)` time to snap their random GPS click to the nearest valid graph node to start routing.
*   **Vector Projection:** Used for the "Vanishing Path" feature to snap the user's messy GPS coordinates mathematically onto the path line segment.

## Slide 7: Block Diagram / Architecture Workflow
*   **Frontend (UI):** Mapbox GL JS (renders 3D buildings, translucent zoom effects, GeoJSON paths).
*   **User Input:** Start, Destination (or custom map clicks), Checkboxes (Rain-free, Time).
*   **Backend (Java Spring Boot):** Houses the Graph Data Structure and runs the A* / K-D Tree algorithms.
*   **Output:** Backend returns a GeoJSON LineString array. Frontend dynamically slices this array using Geolocation API to create the vanishing path effect.

## Slide 8: Time Complexity of Project
*   **K-D Tree Construction:** `O(N log N)` (done once at server startup).
*   **K-D Tree Nearest Neighbor (Custom Pin):** `O(log N)` (very fast).
*   **A* Search Algorithm (Routing):** `O(E + V log V)` where V is vertices (nodes) and E is edges (paths).
*   **Path Rendering (Frontend):** `O(P)` where P is the number of points in the generated route.
*   *Overall:* Highly optimized for real-time, instantaneous path generation.

## Slide 9: Result / Current Status
*   **Achieved:** Modern Glassmorphism UI built. 3D Mapbox integration complete. Implemented the cinematic "Translucent Zoom Effect" where buildings become see-through as the user gets closer. Dropdown routing UI and custom pin logic is functional.
*   **In Progress:** Backend Spring Boot integration and mapping the exact indoor polygon coordinates.

## Slide 10: Conclusion
*   CampusPath successfully applies advanced Data Structures (Graphs, Trees) to solve a complex, real-world spatial problem.
*   By combining A* routing with dynamic weights and 3D web mapping, it provides an unprecedented, immersive navigation experience that standard GPS apps cannot offer.

---

### 📝 Extra Notes for your Review Tomorrow (Progress, Challenges, Workflow)
*If your teacher asks about your progress and challenges, tell them this:*

**Current Progress & Workflow:**
"We have successfully built the frontend architecture using Mapbox GL JS. We've implemented 3D building extrusions and a dynamic event listener that changes building opacity to be translucent when the camera zooms in. The UI is complete, including the logic for custom drop-pins and outdoor-to-indoor view switching."

**Current Challenges (Be honest, teachers love this):**
1. **Data Collection (Indoor Mapping):** The biggest challenge is that indoor GeoJSON floor plans don't exist publicly. We have to manually map the nodes for stairs, corridors, and room doors for our Graph database.
2. **GPS Inaccuracy:** Mobile GPS can drift by 5-10 meters. The challenge for the 'Vanishing Path' feature is using vector projection mathematics to ensure the app doesn't think the user is walking through a wall when the GPS drifts.
