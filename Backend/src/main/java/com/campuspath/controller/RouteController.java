package com.campuspath.controller;

import com.campuspath.dto.RouteRequest;
import com.campuspath.model.Node;
import com.campuspath.service.RouteService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class RouteController {
    private final RouteService routeService;

    public RouteController(RouteService routeService) {
        this.routeService = routeService;
    }

    @GetMapping("/route")
    public ResponseEntity<?> getRoute(
            @RequestParam(name = "start") String start,
            @RequestParam(name = "end") String end,
            @RequestParam(name = "rain", defaultValue = "false") boolean rain,
            @RequestParam(name = "time", defaultValue = "1200") String time,
            @RequestParam(name = "avoidCrowds", defaultValue = "true") boolean avoidCrowds) {

        try {
            RouteService.RouteResult result =
                    routeService.route(start, end, rain, time, avoidCrowds);

            return ResponseEntity.ok(toGeoJson(result));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/route")
    public ResponseEntity<?> postRoute(@RequestBody RouteRequest request) {
        if (request == null) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Request body cannot be empty"));
        }

        String startParam;
        String endParam;

        if (request.getStart() != null) {
            if (request.getStart().getLng() == null || request.getStart().getLat() == null) {
                return ResponseEntity.badRequest()
                        .body(Map.of("error", "Start coordinate must include both lng and lat"));
            }
            startParam = request.getStart().getLng() + "," + request.getStart().getLat();
        } else if (request.getStartNode() != null && !request.getStartNode().isBlank()) {
            startParam = request.getStartNode().trim();
        } else {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Missing start location. Provide 'start' with {lng, lat} or 'startNode'"));
        }

        if (request.getEnd() != null) {
            if (request.getEnd().getLng() == null || request.getEnd().getLat() == null) {
                return ResponseEntity.badRequest()
                        .body(Map.of("error", "End coordinate must include both lng and lat"));
            }
            endParam = request.getEnd().getLng() + "," + request.getEnd().getLat();
        } else if (request.getEndNode() != null && !request.getEndNode().isBlank()) {
            endParam = request.getEndNode().trim();
        } else {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Missing end location. Provide 'end' with {lng, lat} or 'endNode'"));
        }

        boolean rain = Boolean.TRUE.equals(request.getRain());
        String time = (request.getTime() != null && !request.getTime().isBlank())
                ? request.getTime().trim()
                : "1200";

        try {
            RouteService.RouteResult result =
                    routeService.route(startParam, endParam, rain, time,
                            !Boolean.FALSE.equals(request.getAvoidCrowds()));

            return ResponseEntity.ok(toGeoJson(result));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", e.getMessage()));
        }
    }

    private Map<String, Object> toGeoJson(RouteService.RouteResult result) {
        List<List<Double>> coordinates = new ArrayList<>();
        List<Double> floors = new ArrayList<>(); // per coordinate; null = outdoor, x.5 = stair landing

        for (Node node : result.path()) {
            coordinates.add(List.of(
                    node.getLongitude(),
                    node.getLatitude()
            ));
            floors.add(node.getFloor());
        }

        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("floors", floors);
        properties.put("crowdDetour", result.crowdDetour());
        // Nodes in the order A* settled them (for the "how A* searched" animation)
        properties.put("explored", result.explored().stream()
                .map(n -> List.of(n.getLongitude(), n.getLatitude(), n.getFloor() == null ? -1.0 : n.getFloor()))
                .toList());
        properties.put("coveredOutdoorMeters", Math.round(result.coveredOutdoorMeters()));
        properties.put("nodeIds", result.path().stream().map(Node::getId).toList());
        properties.put("destination", result.path().get(result.path().size() - 1).getId());
        properties.put("estimatedTimeMinutes", result.estimatedTimeMinutes());
        properties.put("distanceMeters",
                Math.round(result.distanceMeters() * 100.0) / 100.0);

        Map<String, Object> geometry = new LinkedHashMap<>();
        geometry.put("type", "LineString");
        geometry.put("coordinates", coordinates);

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("type", "Feature");
        response.put("properties", properties);
        response.put("geometry", geometry);

        return response;
    }
}
