# CampusPath 🗺️

**CampusPath** is a constraint-aware 3D routing application built for the VIT Pune campus. Developed as a course project for Fundamentals of Data Structures (FODS), it utilizes advanced graph algorithms to find not just the shortest path, but the *smartest* path.

## 🚀 Features
*   **Interactive 3D Map:** Visualizes the college campus using Mapbox GL JS with 3D building extrusions.
*   **Rain-Free Routing:** Filters out open-air pathways during bad weather to keep students dry.
*   **Crowd-Aware Navigation:** Adjusts path weights dynamically based on the time of day (e.g., avoiding the canteen area during the 1:00 PM lunch rush).
*   **Optimized Performance:** Powered by a custom implementation of Dijkstra's Algorithm utilizing a Min-Heap (PriorityQueue) for O(E log V) time complexity.

## 🛠️ Tech Stack
*   **Backend (Core Logic):** Java (Collections Framework: HashMap, PriorityQueue)
*   **API Framework:** Spring Boot (Java)
*   **Frontend Map Engine:** Mapbox GL JS
*   **Frontend UI:** HTML, CSS, Vanilla JavaScript

## 👥 Team & Roles
*   **Sanket (Frontend):** Mapbox integration, 3D coordinate mapping, UI/UX design, and API request handling.
*   **Pramit (Backend):** Graph architecture, algorithm optimization, time-based constraint logic, and Spring Boot server management.

## ⚙️ How It Works (The Logic)
1.  The frontend captures user constraints (Start, End, Time of Day, Rain status).
2.  An HTTP request is sent to the Java backend.
3.  The backend evaluates the campus `Adjacency List`. If "Rain-Free" is true, all edges with `isCovered == false` are given an infinite weight. If the time matches a busy hour, specific edges receive a weight multiplier.
4.  Dijkstra's algorithm calculates the most efficient route adhering to these modified weights.
5.  The backend returns an array of GPS coordinates, which the frontend visualizes as a glowing path on the 3D map.

## 💻 Local Setup Instructions
*(To be populated once the repository is initialized with code)*
1. Clone this repository.
2. Add your Mapbox API key to the `index.html` file.
3. Run the Spring Boot application on `localhost:8080`.
4. Open `index.html` in your web browser.