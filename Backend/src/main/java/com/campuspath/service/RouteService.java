package com.campuspath.service;

import com.campuspath.algorithm.AStar;
import com.campuspath.algorithm.Haversine;
import com.campuspath.datastructure.Graph;
import com.campuspath.datastructure.KDTree;
import com.campuspath.model.Edge;
import com.campuspath.model.Node;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

@Service
public class RouteService {
    private final Graph graph;
    private final KDTree kdTree;
    private final CrowdService crowd;
    private final AStar aStar = new AStar();

    public RouteService(Graph graph, KDTree kdTree) {
        this(graph, kdTree, new CrowdService());
    }

    @org.springframework.beans.factory.annotation.Autowired
    public RouteService(Graph graph, KDTree kdTree, CrowdService crowd) {
        this.graph = graph;
        this.kdTree = kdTree;
        this.crowd = crowd;
    }

    public RouteResult route(String startInput, String endInput,
                             boolean rain, String timeInput) {
        return route(startInput, endInput, rain, timeInput, true);
    }

    public RouteResult route(String startInput, String endInput,
                             boolean rain, String timeInput, boolean avoidCrowds) {
        int time = parseTime(timeInput);

        Node start = resolveNode(startInput);
        Node end = resolveNode(endInput);

        var live = crowd.snapshot();
        List<Node> path = aStar.findPath(start, end, rain, time, avoidCrowds, live);

        if (path.isEmpty()) {
            throw new IllegalArgumentException(
                    "No route found between " + start.getId() + " and " + end.getId());
        }

        double distance = calculateDistance(path);

        // Would the route have been different without the live crowd? (shown to the user)
        boolean crowdDetour = false;
        if (avoidCrowds) {
            List<Node> ignoringLive = aStar.findPath(start, end, rain, time, true, n -> 1.0);
            crowdDetour = !ignoringLive.equals(path);
        }

        return new RouteResult(path, distance, estimateMinutes(distance), crowdDetour, coveredOutdoorMeters(path));
    }

    private double coveredOutdoorMeters(List<Node> path) {
        double total = 0;
        for (int i = 0; i < path.size() - 1; i++) {
            Node a = path.get(i), b = path.get(i + 1);
            if (a.isIndoor() || b.isIndoor()) continue;
            for (Edge e : a.getEdges()) {
                if (e.getTo() == b && e.isCovered()) { total += e.getDistanceMeters(); break; }
            }
        }
        return total;
    }

    private Node resolveNode(String input) {
        if (input == null || input.isBlank()) {
            throw new IllegalArgumentException("Start/end cannot be empty");
        }

        Node named = graph.getNode(input.trim());
        if (named != null) return named;

        String[] parts = input.trim().split(",");
        if (parts.length != 2) {
            throw new IllegalArgumentException(
                    "Invalid location '" + input + "'. Use a node ID or lng,lat.");
        }

        try {
            double lon = Double.parseDouble(parts[0].trim());
            double lat = Double.parseDouble(parts[1].trim());

            if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
                throw new IllegalArgumentException("Invalid coordinate range: " + input);
            }

            return kdTree.nearest(lon, lat);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(
                    "Invalid coordinate '" + input + "'. Expected lng,lat.");
        }
    }

    private int parseTime(String timeInput) {
        if (timeInput == null || timeInput.isBlank()) return 1200;

        try {
            int time = Integer.parseInt(timeInput);
            if (time < 0 || time > 2359 || time % 100 >= 60) {
                throw new IllegalArgumentException("Time must be HHMM, e.g. 1300");
            }
            return time;
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("Time must be HHMM, e.g. 1300");
        }
    }

    private double calculateDistance(List<Node> path) {
        double total = 0;

        for (int i = 0; i < path.size() - 1; i++) {
            Node a = path.get(i);
            Node b = path.get(i + 1);

            Edge edge = a.getEdges().stream()
                    .filter(e -> e.getTo() == b)
                    .findFirst()
                    .orElseThrow();

            total += edge.getDistanceMeters();
        }

        return total;
    }

    private int estimateMinutes(double meters) {
        // Approx. walking speed = 1.4 m/s.
        return Math.max(1, (int) Math.ceil(meters / 84.0));
    }

    public record RouteResult(List<Node> path,
                              double distanceMeters,
                              int estimatedTimeMinutes,
                              boolean crowdDetour,
                              double coveredOutdoorMeters) {}
}
