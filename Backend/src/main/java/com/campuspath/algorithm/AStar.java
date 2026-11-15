package com.campuspath.algorithm;

import com.campuspath.model.Edge;
import com.campuspath.model.Node;

import java.util.*;

public class AStar {

    public List<Node> findPath(Node start, Node goal, boolean rain, int time) {
        if (start == null || goal == null) return List.of();

        Map<Node, Double> gScore = new HashMap<>();
        Map<Node, Double> fScore = new HashMap<>();
        Map<Node, Node> cameFrom = new HashMap<>();

        PriorityQueue<NodeRecord> open = new PriorityQueue<>(
                Comparator.comparingDouble(NodeRecord::fScore));

        gScore.put(start, 0.0);
        double initialHeuristic = heuristic(start, goal);
        fScore.put(start, initialHeuristic);
        open.add(new NodeRecord(start, initialHeuristic));

        Set<Node> closed = new HashSet<>();

        while (!open.isEmpty()) {
            Node current = open.poll().node;

            if (closed.contains(current)) continue;

            if (current == goal) {
                return reconstructPath(cameFrom, current);
            }

            closed.add(current);

            for (Edge edge : current.getEdges()) {
                Node neighbor = edge.getTo();
                if (closed.contains(neighbor)) continue;

                double tentativeG = gScore.getOrDefault(current, Double.POSITIVE_INFINITY)
                        + dynamicCost(edge, time, rain);

                if (tentativeG < gScore.getOrDefault(neighbor, Double.POSITIVE_INFINITY)) {
                    cameFrom.put(neighbor, current);
                    gScore.put(neighbor, tentativeG);

                    double f = tentativeG + heuristic(neighbor, goal);
                    fScore.put(neighbor, f);
                    open.add(new NodeRecord(neighbor, f));
                }
            }
        }

        return List.of();
    }

    private double dynamicCost(Edge edge, int time, boolean rain) {
        double cost = edge.getDistanceMeters();

        // Base crowd multiplier supplied by graph data.
        cost *= crowdMultiplierForTime(edge, time);

        // Rain strongly discourages uncovered outdoor paths.
        if (rain && !edge.isCovered()) {
            cost += 10_000;
        }

        return cost;
    }

    private double crowdMultiplierForTime(Edge edge, int time) {
        // Edge's baseline multiplier is used at all times.
        // Peak campus hours add an additional factor.
        double multiplier = edge.getCrowdMultiplier();

        if ((time >= 1200 && time <= 1400) ||
            (time >= 1700 && time <= 1900)) {
            multiplier *= 1.35;
        }

        return multiplier;
    }

    private double heuristic(Node a, Node b) {
        // DSA Magic: If the destination (b) is a virtual building node with multiple entrances,
        // standard A* heuristic will fail because the virtual node only has one GPS coordinate.
        // Instead, we calculate the distance to the CLOSEST physical entrance!
        if (!b.getId().startsWith("N_") && !b.getEdges().isEmpty()) {
            double minDistance = Double.POSITIVE_INFINITY;
            for (Edge edge : b.getEdges()) {
                Node entrance = edge.getTo();
                double d = Haversine.distance(
                        a.getLatitude(), a.getLongitude(),
                        entrance.getLatitude(), entrance.getLongitude());
                if (d < minDistance) {
                    minDistance = d;
                }
            }
            return minDistance;
        }

        // Standard Haversine heuristic for normal nodes
        return Haversine.distance(
                a.getLatitude(), a.getLongitude(),
                b.getLatitude(), b.getLongitude());
    }

    private List<Node> reconstructPath(Map<Node, Node> cameFrom, Node current) {
        LinkedList<Node> path = new LinkedList<>();
        path.addFirst(current);

        while (cameFrom.containsKey(current)) {
            current = cameFrom.get(current);
            path.addFirst(current);
        }

        return path;
    }

    private record NodeRecord(Node node, double fScore) {}
}
