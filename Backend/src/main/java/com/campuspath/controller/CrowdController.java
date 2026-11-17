package com.campuspath.controller;

import com.campuspath.config.AimlIndoorGraph;
import com.campuspath.service.CrowdService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class CrowdController {
    private final CrowdService crowd;

    public CrowdController(CrowdService crowd) {
        this.crowd = crowd;
    }

    public record PingRequest(String deviceId, Double lng, Double lat) {}

    @PostMapping("/crowd/ping")
    public ResponseEntity<?> ping(@RequestBody PingRequest req) {
        if (req == null || req.deviceId() == null || req.deviceId().isBlank() || req.deviceId().length() > 64
                || req.lng() == null || req.lat() == null
                || Math.abs(req.lng()) > 180 || Math.abs(req.lat()) > 90) {
            return ResponseEntity.badRequest().body(Map.of("error", "Need deviceId (<=64 chars), lng, lat"));
        }
        crowd.report(req.deviceId(), req.lng(), req.lat());
        return ResponseEntity.ok(Map.of("ok", true));
    }

    /** Active pings (no device ids), for the live crowd layer on the map. */
    @GetMapping("/crowd")
    public List<List<Double>> active() {
        return crowd.active().stream().map(p -> List.of(p.lng(), p.lat())).toList();
    }

    /** AIML indoor layout: the same tables the routing graph uses, so 3D walls match routes. */
    @GetMapping("/buildings/aiml/layout")
    public Map<String, Object> aimlLayout() {
        return AimlIndoorGraph.layout();
    }
}
