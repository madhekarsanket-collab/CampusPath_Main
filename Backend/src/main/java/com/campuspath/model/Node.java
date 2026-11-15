package com.campuspath.model;

import java.util.ArrayList;
import java.util.List;

public class Node {
    private final String id;
    private final double longitude;
    private final double latitude;
    private final List<Edge> edges = new ArrayList<>();

    public Node(String id, double longitude, double latitude) {
        this.id = id;
        this.longitude = longitude;
        this.latitude = latitude;
    }

    public String getId() { return id; }
    public double getLongitude() { return longitude; }
    public double getLatitude() { return latitude; }
    public List<Edge> getEdges() { return edges; }

    public void addEdge(Edge edge) {
        edges.add(edge);
    }
}
