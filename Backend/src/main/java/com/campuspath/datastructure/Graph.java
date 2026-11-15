package com.campuspath.datastructure;

import com.campuspath.model.Edge;
import com.campuspath.model.Node;

import java.util.*;

public class Graph {
    private final Map<String, Node> nodes = new HashMap<>();

    public void addNode(Node node) {
        nodes.put(node.getId(), node);
    }

    public Node getNode(String id) {
        return nodes.get(id);
    }

    public Collection<Node> getNodes() {
        return nodes.values();
    }

    public void addDirectedEdge(String from, String to, double distance,
                                boolean covered, double crowdMultiplier) {
        Node source = requireNode(from);
        Node destination = requireNode(to);
        source.addEdge(new Edge(destination, distance, covered, crowdMultiplier));
    }

    public void addBidirectionalEdge(String a, String b, double distance,
                                     boolean covered, double crowdMultiplier) {
        addDirectedEdge(a, b, distance, covered, crowdMultiplier);
        addDirectedEdge(b, a, distance, covered, crowdMultiplier);
    }

    private Node requireNode(String id) {
        Node node = nodes.get(id);
        if (node == null) {
            throw new IllegalArgumentException("Unknown graph node: " + id);
        }
        return node;
    }
}
