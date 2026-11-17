package com.campuspath.controller;

import com.campuspath.datastructure.Graph;
import com.campuspath.model.Edge;
import com.campuspath.model.Node;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.*;

/**
 * The whole routing graph in compact form, so the app can keep a copy and route offline.
 * nodes: [id, lng, lat, floor(-1 = outdoor), virtual(0/1)]
 * edges: [fromIndex, toIndex, metres, covered(0/1), crowdMultiplier] (directed)
 */
@RestController
@CrossOrigin(origins = "*")
public class GraphController {
    private final Graph graph;

    public GraphController(Graph graph) {
        this.graph = graph;
    }

    @GetMapping("/api/graph")
    public Map<String, Object> graph() {
        List<Node> nodes = new ArrayList<>(graph.getNodes());
        Map<Node, Integer> index = new HashMap<>();
        List<List<Object>> nodeRows = new ArrayList<>();
        for (Node n : nodes) {
            index.put(n, nodeRows.size());
            nodeRows.add(List.of(n.getId(), n.getLongitude(), n.getLatitude(),
                    n.getFloor() == null ? -1.0 : n.getFloor(), n.isVirtual() ? 1 : 0));
        }
        List<List<Object>> edgeRows = new ArrayList<>();
        for (Node n : nodes) {
            for (Edge e : n.getEdges()) {
                edgeRows.add(List.of(index.get(n), index.get(e.getTo()),
                        Math.round(e.getDistanceMeters() * 100) / 100.0,
                        e.isCovered() ? 1 : 0, e.getCrowdMultiplier()));
            }
        }
        return Map.of("nodes", nodeRows, "edges", edgeRows);
    }
}
