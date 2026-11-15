package com.campuspath.controller;

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
            @RequestParam String start,
            @RequestParam String end,
            @RequestParam(defaultValue = "false") boolean rain,
            @RequestParam(defaultValue = "1200") String time) {

        try {
            RouteService.RouteResult result =
                    routeService.route(start, end, rain, time);

            return ResponseEntity.ok(toGeoJson(result));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", e.getMessage()));
        }
    }

    private Map<String, Object> toGeoJson(RouteService.RouteResult result) {
        List<List<Double>> coordinates = new ArrayList<>();

        for (Node node : result.path()) {
            coordinates.add(List.of(
                    node.getLongitude(),
                    node.getLatitude()
            ));
        }

        Map<String, Object> properties = new LinkedHashMap<>();
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
