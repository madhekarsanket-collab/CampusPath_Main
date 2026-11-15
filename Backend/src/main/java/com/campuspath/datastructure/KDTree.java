package com.campuspath.datastructure;

import com.campuspath.model.Node;

import java.util.List;

public class KDTree {
    private static class KDNode {
        Node point;
        KDNode left;
        KDNode right;
        int axis;

        KDNode(Node point, int axis) {
            this.point = point;
            this.axis = axis;
        }
    }

    private KDNode root;

    public KDTree(List<Node> points) {
        root = build(points, 0);
    }

    private KDNode build(List<Node> points, int depth) {
        if (points == null || points.isEmpty()) return null;

        int axis = depth % 2;
        points.sort((a, b) -> Double.compare(
                coordinate(a, axis), coordinate(b, axis)));

        int mid = points.size() / 2;
        KDNode node = new KDNode(points.get(mid), axis);

        node.left = build(points.subList(0, mid), depth + 1);
        node.right = build(points.subList(mid + 1, points.size()), depth + 1);

        return node;
    }

    public Node nearest(double longitude, double latitude) {
        if (root == null) throw new IllegalStateException("KD-Tree is empty");
        return nearest(root, longitude, latitude, root.point,
                Double.POSITIVE_INFINITY);
    }

    private Node nearest(KDNode current, double lon, double lat,
                         Node best, double bestDistance) {
        if (current == null) return best;

        double currentDistance = squaredDistance(current.point, lon, lat);
        if (currentDistance < bestDistance) {
            best = current.point;
            bestDistance = currentDistance;
        }

        double targetCoordinate = current.axis == 0 ? lon : lat;
        double nodeCoordinate = coordinate(current.point, current.axis);

        KDNode first = targetCoordinate < nodeCoordinate ? current.left : current.right;
        KDNode second = targetCoordinate < nodeCoordinate ? current.right : current.left;

        best = nearest(first, lon, lat, best, squaredDistance(best, lon, lat));

        double axisDifference = targetCoordinate - nodeCoordinate;
        if (axisDifference * axisDifference < squaredDistance(best, lon, lat)) {
            best = nearest(second, lon, lat, best, squaredDistance(best, lon, lat));
        }

        return best;
    }

    private double coordinate(Node node, int axis) {
        return axis == 0 ? node.getLongitude() : node.getLatitude();
    }

    private double squaredDistance(Node node, double lon, double lat) {
        double dx = node.getLongitude() - lon;
        double dy = node.getLatitude() - lat;
        return dx * dx + dy * dy;
    }
}
