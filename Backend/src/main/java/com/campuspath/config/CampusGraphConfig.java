package com.campuspath.config;

import com.campuspath.algorithm.Haversine;
import com.campuspath.datastructure.Graph;
import com.campuspath.model.Node;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.io.File;
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
        
        // Track the coordinates to alias them to building IDs
        Map<String, String> coordToBuildingId = new HashMap<>();

        try {
            File geojsonFile = new File("coordinates.geojson");
            if (!geojsonFile.exists()) {
                System.out.println("WARNING: coordinates.geojson not found! Loading fallback nodes.");
                return loadFallbackGraph();
            }

            JsonNode root = mapper.readTree(geojsonFile);
            JsonNode features = root.path("features");

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
            // You drew a line from the road to the building. One end is an intersection, the other end is a dead-end (the building).
            for (JsonNode feature : features) {
                String rawBuildingId = feature.path("properties").path("building_id").asText(null);
                JsonNode coordinates = feature.path("geometry").path("coordinates");
                
                if (rawBuildingId != null && coordinates.isArray() && coordinates.size() > 0) {
                    String finalId = TAG_TO_ID.getOrDefault(rawBuildingId, rawBuildingId.replaceAll(" ", ""));
                    
                    String firstCoordStr = "N_" + getCoordStr(coordinates.get(0));
                    String lastCoordStr = "N_" + getCoordStr(coordinates.get(coordinates.size() - 1));
                    
                    Node firstNode = graph.getNode(firstCoordStr);
                    Node lastNode = graph.getNode(lastCoordStr);
                    
                    // The building is the end of the line that is a dead-end (only 1 connection)
                    Node buildingNode = lastNode; 
                    if (firstNode != null && firstNode.getEdges().size() == 1) {
                        buildingNode = firstNode;
                    } else if (lastNode != null && lastNode.getEdges().size() == 1) {
                        buildingNode = lastNode;
                    }

                    // Create an ALIAS node for the building that sits at the exact same spot
                    if (graph.getNode(finalId) == null) {
                        graph.addNode(new Node(finalId, buildingNode.getLongitude(), buildingNode.getLatitude()));
                        graph.addBidirectionalEdge(finalId, buildingNode.getId(), 0.1, false, 1.0);
                    } else {
                        // If there are multiple entrances (like CS_DESH has 2 lines), link the second entrance to the same building node!
                        graph.addBidirectionalEdge(finalId, buildingNode.getId(), 0.1, false, 1.0);
                    }
                }
            }

            // Third pass: Auto-snap nodes! If the geojson export had floating point rounding, 
            // the nodes might not match exactly. We link any nodes that are within 3 meters.
            java.util.List<Node> allNodes = new java.util.ArrayList<>(graph.getNodes());
            for (int i = 0; i < allNodes.size(); i++) {
                for (int j = i + 1; j < allNodes.size(); j++) {
                    Node n1 = allNodes.get(i);
                    Node n2 = allNodes.get(j);
                    double dist = Haversine.distance(n1.getLatitude(), n1.getLongitude(), n2.getLatitude(), n2.getLongitude());
                    if (dist < 3.0) {
                        // Prevent duplicate edges
                        boolean exists = n1.getEdges().stream().anyMatch(e -> e.getTo().equals(n2));
                        if (!exists) {
                            graph.addBidirectionalEdge(n1.getId(), n2.getId(), dist, false, 1.0);
                        }
                    }
                }
            }
            
            // Because you didn't tag MainGate, ExitGate, or Parking in the geojson.io, 
            // I will manually inject them here and connect them to the nearest road!
            addFallbackIfMissing(graph, "MainGate", 73.86730, 18.46363);
            addFallbackIfMissing(graph, "ExitGate", 73.86730, 18.46337);
            addFallbackIfMissing(graph, "Parking", 73.86814, 18.46351);

            return graph;

        } catch (IOException e) {
            e.printStackTrace();
            return loadFallbackGraph();
        }
    }

    private String getCoordStr(JsonNode coord) {
        return coord.get(0).asDouble() + "_" + coord.get(1).asDouble();
    }

    private void addFallbackIfMissing(Graph graph, String id, double lon, double lat) {
        if (graph.getNode(id) == null) {
            graph.addNode(new Node(id, lon, lat));
            // Find nearest node to connect to
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
                // Connect it with a straight line
                graph.addBidirectionalEdge(id, nearest.getId(), minDist, false, 1.0);
            }
        }
    }

    private Graph loadFallbackGraph() {
        Graph graph = new Graph();
        graph.addNode(new Node("MainGate", 73.86730, 18.46363));
        graph.addNode(new Node("AIML", 73.86777, 18.46349));
        graph.addBidirectionalEdge("MainGate", "AIML", 50, false, 1.0);
        return graph;
    }

    @Bean
    public com.campuspath.datastructure.KDTree kdTree(Graph graph) {
        return new com.campuspath.datastructure.KDTree(new java.util.ArrayList<>(graph.getNodes()));
    }
}
