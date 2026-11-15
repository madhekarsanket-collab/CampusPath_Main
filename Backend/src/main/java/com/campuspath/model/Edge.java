package com.campuspath.model;

public class Edge {
    private final Node to;
    private final double distanceMeters;
    private final boolean covered;
    private final double crowdMultiplier;

    public Edge(Node to, double distanceMeters, boolean covered, double crowdMultiplier) {
        this.to = to;
        this.distanceMeters = distanceMeters;
        this.covered = covered;
        this.crowdMultiplier = crowdMultiplier;
    }

    public Node getTo() { return to; }
    public double getDistanceMeters() { return distanceMeters; }
    public boolean isCovered() { return covered; }
    public double getCrowdMultiplier() { return crowdMultiplier; }
}
