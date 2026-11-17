package com.campuspath.model;

import java.util.ArrayList;
import java.util.List;

public class Node {
    private final String id;
    private final double longitude;
    private final double latitude;
    private final List<Edge> edges = new ArrayList<>();
    // null = outdoor, 0 = ground, 1..3 = floors, x.5 = stair landing between floors
    private final Double floor;
    // Virtual "building" nodes join several entrance stubs at one point: a route may start
    // or end there but must never pass through (that would teleport between entrances).
    private boolean virtual;

    public Node(String id, double longitude, double latitude) {
        this(id, longitude, latitude, null);
    }

    public Node(String id, double longitude, double latitude, Double floor) {
        this.id = id;
        this.longitude = longitude;
        this.latitude = latitude;
        this.floor = floor;
    }

    public Double getFloor() { return floor; }
    public boolean isIndoor() { return floor != null; }
    public boolean isVirtual() { return virtual; }
    public void markVirtual() { this.virtual = true; }

    public String getId() { return id; }
    public double getLongitude() { return longitude; }
    public double getLatitude() { return latitude; }
    public List<Edge> getEdges() { return edges; }

    public void addEdge(Edge edge) {
        edges.add(edge);
    }
}
