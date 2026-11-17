package com.campuspath;

import com.campuspath.config.CampusGraphConfig;
import com.campuspath.controller.RouteController;
import com.campuspath.datastructure.Graph;
import com.campuspath.datastructure.KDTree;
import com.campuspath.dto.RouteRequest;
import com.campuspath.service.RouteService;
import org.springframework.http.ResponseEntity;

import java.util.List;
import java.util.Map;

public class DirectRoutingTest {
    public static void main(String[] args) {
        System.out.println("--- Starting Direct Unit & Controller Tests ---");

        // 1. Initialize Graph & KD-Tree via CampusGraphConfig
        CampusGraphConfig config = new CampusGraphConfig();
        Graph graph = config.campusGraph();
        KDTree kdTree = config.kdTree(graph);

        System.out.println("Graph initialized with total nodes: " + graph.getNodes().size());

        // 2. Initialize RouteService & Controller
        RouteService routeService = new RouteService(graph, kdTree);
        RouteController controller = new RouteController(routeService);

        // Test 1: GET route between known building IDs
        System.out.print("Test 1: GET /api/route (MainGate -> AIML)... ");
        ResponseEntity<?> resp1 = controller.getRoute("MainGate", "AIML", false, "1200", true);
        assertOkGeoJson(resp1);
        System.out.println("PASSED");

        // Test 2: POST route with coordinates (start & end Point objects)
        System.out.print("Test 2: POST /api/route with {start: {lng, lat}, end: {lng, lat}}... ");
        RouteRequest req2 = new RouteRequest();
        req2.setStart(new RouteRequest.Point(73.86730, 18.46363));
        req2.setEnd(new RouteRequest.Point(73.86777, 18.46349));
        ResponseEntity<?> resp2 = controller.postRoute(req2);
        assertOkGeoJson(resp2);
        System.out.println("PASSED");

        // Test 3: POST route with named building nodes
        System.out.print("Test 3: POST /api/route with {startNode, endNode}... ");
        RouteRequest req3 = new RouteRequest();
        req3.setStartNode("MainGate");
        req3.setEndNode("AIML");
        ResponseEntity<?> resp3 = controller.postRoute(req3);
        assertOkGeoJson(resp3);
        System.out.println("PASSED");

        // Test 4: POST route with empty body / missing parameters (expects 400 Bad Request)
        System.out.print("Test 4: POST /api/route missing parameters (expects 400)... ");
        ResponseEntity<?> resp4 = controller.postRoute(new RouteRequest());
        if (resp4.getStatusCode().value() == 400) {
            System.out.println("PASSED (Got HTTP 400)");
        } else {
            throw new RuntimeException("Expected 400 but got: " + resp4.getStatusCode());
        }

        // Test 5: POST route with invalid coordinate range (expects 400 Bad Request)
        System.out.print("Test 5: POST /api/route invalid longitude 999.0 (expects 400)... ");
        RouteRequest req5 = new RouteRequest();
        req5.setStart(new RouteRequest.Point(999.0, 18.46363));
        req5.setEnd(new RouteRequest.Point(73.86777, 18.46349));
        ResponseEntity<?> resp5 = controller.postRoute(req5);
        if (resp5.getStatusCode().value() == 400) {
            System.out.println("PASSED (Got HTTP 400)");
        } else {
            throw new RuntimeException("Expected 400 but got: " + resp5.getStatusCode());
        }

        System.out.println("\nALL 5 TESTS EXECUTED AND PASSED DIRECTLY!");
    }

    @SuppressWarnings("unchecked")
    private static void assertOkGeoJson(ResponseEntity<?> response) {
        if (response.getStatusCode().value() != 200) {
            throw new RuntimeException("Expected HTTP 200 but got: " + response.getStatusCode() + " body: " + response.getBody());
        }
        Map<String, Object> body = (Map<String, Object>) response.getBody();
        if (body == null || !"Feature".equals(body.get("type"))) {
            throw new RuntimeException("Expected GeoJSON Feature but got: " + body);
        }
        Map<String, Object> geometry = (Map<String, Object>) body.get("geometry");
        if (geometry == null || !"LineString".equals(geometry.get("type"))) {
            throw new RuntimeException("Expected geometry LineString but got: " + geometry);
        }
        List<?> coordinates = (List<?>) geometry.get("coordinates");
        if (coordinates == null || coordinates.isEmpty()) {
            throw new RuntimeException("Coordinates array is empty");
        }
    }
}
