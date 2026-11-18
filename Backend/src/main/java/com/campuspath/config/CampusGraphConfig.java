package com.campuspath.config;

import com.campuspath.algorithm.Haversine;
import com.campuspath.datastructure.Graph;
import com.campuspath.model.Node;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

@Configuration
public class CampusGraphConfig {

    // Map the tags from geojson.io to the exact IDs expected by the frontend
    private static final Map<String, String> TAG_TO_ID = Map.ofEntries(
            Map.entry("AI/ADIS/Mechanical Building", "AI_AIDS_Mech"),
            Map.entry("Library", "Library"),
            Map.entry("Auditorium", "Auditorium"),
            Map.entry("AIML", "AIML"),
            Map.entry("Fruit Canteen", "FruitCanteen"),
            Map.entry("CS/DESH Building", "CS_DESH"),
            Map.entry("Pune Bakery", "PuneBakery"),
            Map.entry("Paratha House", "ParathaHouse"),
            Map.entry("Main Canteen", "MainCanteen"),
            Map.entry("Staff Canteen", "StaffCanteen"),
            Map.entry("Nescafe", "Nescafe")
    );

    @Bean
    public Graph campusGraph() {
        Graph graph = new Graph();
        ObjectMapper mapper = new ObjectMapper();

        InputStream geojsonStream = null;
        String resolvedSource = null;

        // Try classpath first (packaged jar or target/classes)
        try {
            ClassPathResource resource = new ClassPathResource("coordinates.geojson");
            if (resource.exists()) {
                geojsonStream = resource.getInputStream();
                resolvedSource = "classpath:coordinates.geojson";
            }
        } catch (Exception ignored) {}

        // Fallback checks for filesystem locations
        if (geojsonStream == null) {
            String[] candidatePaths = new String[] {
                    "coordinates.geojson",
                    "../coordinates.geojson",
                    "Backend/src/main/resources/coordinates.geojson",
                    "src/main/resources/coordinates.geojson"
            };

            for (String path : candidatePaths) {
                File file = new File(path);
                if (file.exists() && file.isFile()) {
                    try {
                        geojsonStream = new FileInputStream(file);
                        resolvedSource = file.getAbsolutePath();
                        break;
                    } catch (Exception ignored) {}
                }
            }
        }

        if (geojsonStream == null) {
            throw new IllegalStateException("CRITICAL STARTUP ERROR: Could not locate 'coordinates.geojson' in classpath or working directory hierarchy.");
        }

        System.out.println("CampusGraphConfig: Successfully loading graph from: " + resolvedSource);

        try (InputStream is = geojsonStream) {
            JsonNode root = mapper.readTree(is);
            JsonNode features = root.path("features");

            if (!features.isArray() || features.size() == 0) {
                throw new IllegalStateException("CRITICAL ERROR: 'coordinates.geojson' contains no valid features.");
            }

            // First pass: Generate all generic nodes and edges
            for (JsonNode feature : features) {
                boolean isCovered = feature.path("properties").path("isCovered").asBoolean(false);
                JsonNode coordinates = feature.path("geometry").path("coordinates");
                if (coordinates == null || !coordinates.isArray() || coordinates.size() == 0) continue;

                String prevNodeId = null;
                for (JsonNode coord : coordinates) {
                    String coordStr = "N_" + getCoordStr(coord);

                    double lon = coord.get(0).asDouble();
                    double lat = coord.get(1).asDouble();

                    if (graph.getNode(coordStr) == null) {
                        graph.addNode(new Node(coordStr, lon, lat));
                    }

                    if (prevNodeId != null && !prevNodeId.equals(coordStr)) {
                        Node prev = graph.getNode(prevNodeId);
                        double dist = Haversine.distance(prev.getLatitude(), prev.getLongitude(), lat, lon);
                        graph.addBidirectionalEdge(prevNodeId, coordStr, dist, isCovered, 1.0);
                    }
                    prevNodeId = coordStr;
                }
            }

            // Second pass: Identify Building Nodes.
            for (JsonNode feature : features) {
                String rawBuildingId = feature.path("properties").path("building_id").asText(null);
                JsonNode coordinates = feature.path("geometry").path("coordinates");

                if (rawBuildingId != null && coordinates.isArray() && coordinates.size() > 0) {
                    String finalId = TAG_TO_ID.getOrDefault(rawBuildingId, rawBuildingId.replaceAll(" ", ""));

                    String firstCoordStr = "N_" + getCoordStr(coordinates.get(0));
                    String lastCoordStr = "N_" + getCoordStr(coordinates.get(coordinates.size() - 1));

                    Node firstNode = graph.getNode(firstCoordStr);
                    Node lastNode = graph.getNode(lastCoordStr);

                    Node buildingNode = lastNode;
                    if (firstNode != null && firstNode.getEdges().size() == 1) {
                        buildingNode = firstNode;
                    } else if (lastNode != null && lastNode.getEdges().size() == 1) {
                        buildingNode = lastNode;
                    }

                    if (graph.getNode(finalId) == null) {
                        Node b = new Node(finalId, buildingNode.getLongitude(), buildingNode.getLatitude());
                        b.markVirtual();
                        graph.addNode(b);
                        graph.addBidirectionalEdge(finalId, buildingNode.getId(), 0.1, false, 1.0);
                    } else {
                        graph.addBidirectionalEdge(finalId, buildingNode.getId(), 0.1, false, 1.0);
                    }
                }
            }

            // Third pass: Auto-snap nodes within 3 meters
            java.util.List<Node> allNodes = new java.util.ArrayList<>(graph.getNodes());
            for (int i = 0; i < allNodes.size(); i++) {
                for (int j = i + 1; j < allNodes.size(); j++) {
                    Node n1 = allNodes.get(i);
                    Node n2 = allNodes.get(j);
                    double dist = Haversine.distance(n1.getLatitude(), n1.getLongitude(), n2.getLatitude(), n2.getLongitude());
                    if (dist < 3.0) {
                        boolean exists = n1.getEdges().stream().anyMatch(e -> e.getTo().equals(n2));
                        if (!exists) {
                            graph.addBidirectionalEdge(n1.getId(), n2.getId(), dist, false, 1.0);
                        }
                    }
                }
            }

            // Digitising gaps: a path that dead-ends within 12 m of another path almost always
            // meant to join it (e.g. the AIML Entrance 2 stub stopped 8 m short of the road).
            for (Node n : allNodes) {
                if (n.getEdges().size() != 1 || n.isVirtual()) continue;
                Node best = null;
                double bestD = 12.0;
                for (Node m : allNodes) {
                    if (m == n || m.isVirtual() || n.getEdges().stream().anyMatch(e -> e.getTo() == m)) continue;
                    double d = Haversine.distance(n.getLatitude(), n.getLongitude(), m.getLatitude(), m.getLongitude());
                    if (d < bestD) { bestD = d; best = m; }
                }
                if (best != null) graph.addBidirectionalEdge(n.getId(), best.getId(), bestD, false, 1.0);
            }

            // Manual fallback nodes for gates and parking
            addFallbackIfMissing(graph, "MainGate", 73.86730, 18.46363);
            addFallbackIfMissing(graph, "ExitGate", 73.86730, 18.46337);
            addFallbackIfMissing(graph, "Parking", 73.86814, 18.46351);

            joinCrossings(graph);
            AimlIndoorGraph.addTo(graph);
            stitchIslands(graph, 40.0);
            markCrowdHotspots(graph);

            return graph;

        } catch (IOException e) {
            throw new IllegalStateException("CRITICAL ERROR: Failed to parse coordinates.geojson", e);
        }
    }

    /**
     * Two drawn paths that cross without sharing a point would otherwise not connect
     * (e.g. the E1 path crossing the road to the canteen). Add a junction node at each crossing,
     * linked to the four segment ends; the original edges stay.
     * shortcut: two crossings on one segment aren't linked to each other directly; split segments if that matters.
     */
    private void joinCrossings(Graph graph) {
        java.util.List<Node[]> segs = new java.util.ArrayList<>();
        java.util.Map<Node[], Boolean> covered = new java.util.HashMap<>();
        for (Node a : graph.getNodes()) {
            if (a.isVirtual()) continue;
            for (com.campuspath.model.Edge e : a.getEdges()) {
                Node b = e.getTo();
                if (b.isVirtual() || a.getId().compareTo(b.getId()) >= 0) continue;
                Node[] s = {a, b};
                segs.add(s);
                covered.put(s, e.isCovered());
            }
        }
        int added = 0;
        for (int i = 0; i < segs.size(); i++) {
            for (int j = i + 1; j < segs.size(); j++) {
                Node[] s = segs.get(i), t = segs.get(j);
                if (s[0] == t[0] || s[0] == t[1] || s[1] == t[0] || s[1] == t[1]) continue;
                double[] x = intersect(s[0], s[1], t[0], t[1]);
                if (x == null) continue;
                String id = String.format(java.util.Locale.ROOT, "X_%.6f_%.6f", x[0], x[1]);
                Node junction = graph.getNode(id); // duplicate drawn segments meet at the same point
                if (junction == null) { junction = new Node(id, x[0], x[1]); graph.addNode(junction); }
                for (Node[] seg : new Node[][]{s, t}) {
                    for (Node end : seg) {
                        double d = Haversine.distance(end.getLatitude(), end.getLongitude(), x[1], x[0]);
                        graph.addBidirectionalEdge(end.getId(), junction.getId(), d, covered.get(seg), 1.0);
                    }
                }
                added++;
            }
        }
        // T-junctions: a path that ends on the middle of another segment (not at one of its points).
        java.util.List<Node> ends = new java.util.ArrayList<>(graph.getNodes());
        for (Node p : ends) {
            if (p.isVirtual() || p.isIndoor()) continue;
            for (Node[] s : segs) {
                if (p == s[0] || p == s[1]) continue;
                double k = Math.cos(Math.toRadians(p.getLatitude())) * 111320, m = 110574;
                double bx = (s[1].getLongitude() - s[0].getLongitude()) * k, by = (s[1].getLatitude() - s[0].getLatitude()) * m;
                double px = (p.getLongitude() - s[0].getLongitude()) * k, py = (p.getLatitude() - s[0].getLatitude()) * m;
                double len2 = bx * bx + by * by;
                if (len2 == 0) continue;
                double t = (px * bx + py * by) / len2;
                if (t <= 0.02 || t >= 0.98 || Math.hypot(px - t * bx, py - t * by) > 3.0) continue;
                for (Node end : s) {
                    if (p.getEdges().stream().noneMatch(e -> e.getTo() == end))
                        graph.addBidirectionalEdge(p.getId(), end.getId(), Haversine.distance(
                                p.getLatitude(), p.getLongitude(), end.getLatitude(), end.getLongitude()), covered.get(s), 1.0);
                }
                added++;
            }
        }
        System.out.println("Joined " + added + " path crossings / T-junctions");
    }

    /** Interior intersection point [lng, lat] of segments ab and cd, or null. Planar: fine at campus scale. */
    private static double[] intersect(Node a, Node b, Node c, Node d) {
        double k = Math.cos(Math.toRadians(a.getLatitude())); // shrink longitude to metres-ish
        double ax = a.getLongitude() * k, ay = a.getLatitude(), bx = b.getLongitude() * k, by = b.getLatitude();
        double cx = c.getLongitude() * k, cy = c.getLatitude(), dx = d.getLongitude() * k, dy = d.getLatitude();
        double den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
        if (Math.abs(den) < 1e-18) return null;
        double t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
        double u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
        if (t <= 0.02 || t >= 0.98 || u <= 0.02 || u >= 0.98) return null; // near an end: the 3 m snap handles it
        return new double[]{a.getLongitude() + t * (b.getLongitude() - a.getLongitude()), ay + t * (by - ay)};
    }

    /**
     * BFS the walkable graph into connected components (virtual building nodes don't join
     * paths) and link every island to the main network at its closest point, if within maxGapM.
     * Fixes digitising gaps such as the Parking stub that only touched the virtual AIML node.
     */
    private void stitchIslands(Graph graph, double maxGapM) {
        java.util.Map<Node, Integer> comp = new java.util.HashMap<>();
        java.util.List<java.util.List<Node>> comps = new java.util.ArrayList<>();
        for (Node start : graph.getNodes()) {
            if (start.isVirtual() || comp.containsKey(start)) continue;
            java.util.List<Node> members = new java.util.ArrayList<>();
            java.util.ArrayDeque<Node> queue = new java.util.ArrayDeque<>(java.util.List.of(start));
            comp.put(start, comps.size());
            while (!queue.isEmpty()) {
                Node cur = queue.poll();
                members.add(cur);
                for (com.campuspath.model.Edge e : cur.getEdges()) {
                    Node nb = e.getTo();
                    if (nb.isVirtual() || comp.containsKey(nb)) continue;
                    comp.put(nb, comps.size());
                    queue.add(nb);
                }
            }
            comps.add(members);
        }
        java.util.List<Node> main = comps.stream().max(java.util.Comparator.comparingInt(java.util.List::size)).orElseThrow();
        for (java.util.List<Node> island : comps) {
            if (island == main) continue;
            Node bestA = null, bestB = null;
            double bestD = maxGapM;
            for (Node a : island) {
                if (a.isIndoor()) continue;
                for (Node b : main) {
                    if (b.isIndoor()) continue;
                    double d = Haversine.distance(a.getLatitude(), a.getLongitude(), b.getLatitude(), b.getLongitude());
                    if (d < bestD) { bestD = d; bestA = a; bestB = b; }
                }
            }
            if (bestA != null) graph.addBidirectionalEdge(bestA.getId(), bestB.getId(), bestD, false, 1.0);
        }
    }

    // Food spots draw crowds at break times; outdoor edges near them get a crowd weight.
    // shortcut: static hotspots, not live sensing; upgrade by feeding counts from a crowd source.
    private static final java.util.List<String> CROWD_HOTSPOTS = java.util.List.of(
            "MainCanteen", "FruitCanteen", "StaffCanteen", "Nescafe", "PuneBakery", "ParathaHouse");
    private static final double HOTSPOT_RADIUS_M = 35, HOTSPOT_WEIGHT = 2.5;

    private void markCrowdHotspots(Graph graph) {
        java.util.List<Node> spots = CROWD_HOTSPOTS.stream().map(graph::getNode)
                .filter(java.util.Objects::nonNull).toList();
        for (Node n : graph.getNodes()) {
            if (n.isIndoor()) continue;
            for (com.campuspath.model.Edge e : n.getEdges()) {
                if (spots.stream().anyMatch(s -> near(s, n) || near(s, e.getTo()))) {
                    e.setCrowdMultiplier(HOTSPOT_WEIGHT);
                }
            }
        }
    }

    private static boolean near(Node a, Node b) {
        return Haversine.distance(a.getLatitude(), a.getLongitude(), b.getLatitude(), b.getLongitude()) < HOTSPOT_RADIUS_M;
    }

    private String getCoordStr(JsonNode coord) {
        return coord.get(0).asDouble() + "_" + coord.get(1).asDouble();
    }

    private void addFallbackIfMissing(Graph graph, String id, double lon, double lat) {
        if (graph.getNode(id) == null) {
            graph.addNode(new Node(id, lon, lat));
            Node nearest = null;
            double minDist = Double.MAX_VALUE;
            for (Node n : graph.getNodes()) {
                if (n.getId().equals(id)) continue;
                double d = Haversine.distance(lat, lon, n.getLatitude(), n.getLongitude());
                if (d < minDist) {
                    minDist = d;
                    nearest = n;
                }
            }
            if (nearest != null) {
                graph.addBidirectionalEdge(id, nearest.getId(), minDist, false, 1.0);
            }
        }
    }

    @Bean
    public com.campuspath.datastructure.KDTree kdTree(Graph graph) {
        // Only outdoor nodes: a GPS fix can't tell floors apart, so never snap to an indoor node.
        return new com.campuspath.datastructure.KDTree(new java.util.ArrayList<>(
                graph.getNodes().stream().filter(n -> !n.isIndoor()).toList()));
    }
}
