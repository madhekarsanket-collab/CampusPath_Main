package com.campuspath.config;

import com.campuspath.algorithm.Haversine;
import com.campuspath.datastructure.Graph;
import com.campuspath.model.Node;

import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;

/**
 * Indoor graph for AIML (Building 4), from the user's floor sketches, fitted to the Mapbox/OSM
 * footprint: an L ~50 m long N-S (x -6.7..+4.8 m east of Entrance 2) whose short arm runs
 * ~33 m west from the south end. The corridor runs along the inner (west / north) walls,
 * rooms sit on the outer (east / south) walls. Entrance 1 is the diagonal inner corner.
 *
 * Local frame: metres from Entrance 2; "along" = metres south of E2 on the long arm,
 * "west" = metres west of the corner on the short arm. Edit the tables to recalibrate.
 *
 * Stairs zig-zag: floor f -> half flight -> landing (f + 0.5) -> half flight -> floor f+1.
 * The lift stops only at the landings (between floors), not on the floors.
 */
public final class AimlIndoorGraph {

    // Real GPS readings of the two entrances.
    static final double E2_LNG = 73.867834, E2_LAT = 18.463828; // north end of long arm
    static final double E1_LNG = 73.867780, E1_LAT = 18.463487; // inner corner (diagonal)

    static final double CORRIDOR_EAST = -5.0;  // long-arm corridor centre line (inner side)
    static final double CORNER_ALONG = 40;     // short-arm corridor centre line
    static final double WEST_END = 21;         // short-arm corridor length from the corner
    static final double STAIRS_ALONG = 27, E1_ALONG = 37.7;
    static final double DOOR_OFFSET = 1.5;     // corridor centre -> door on the outer wall
    static final double STAIR_FOOT_EAST = CORRIDOR_EAST + 3, LANDING_EAST = CORRIDOR_EAST + 7.5;
    static final double HALF_FLIGHT_COST = 7;  // metres-equivalent effort per half flight
    static final double LIFT_WAIT = 25, LIFT_COST_PER_FLOOR = 4;

    private static final double M_PER_DEG_LAT = 110_574;
    private static final double M_PER_DEG_LNG = 111_320 * Math.cos(Math.toRadians(E2_LAT));

    private record Slot(String id, double pos) {}

    private AimlIndoorGraph() {}

    public static void addTo(Graph graph) {
        for (int f = 0; f <= 3; f++) {
            addFloor(graph, f, longArm(f), shortArm(f));
        }
        for (int f = 0; f < 3; f++) {
            addNode(graph, landing(f), LANDING_EAST, -STAIRS_ALONG, f + 0.5);
            addNode(graph, lift(f), LANDING_EAST + 1.5, -STAIRS_ALONG - 1.5, f + 0.5);
            edge(graph, stairs(f), landing(f), HALF_FLIGHT_COST);
            edge(graph, landing(f), stairs(f + 1), HALF_FLIGHT_COST);
            edge(graph, landing(f), lift(f), LIFT_WAIT);
        }
        for (int f = 0; f < 2; f++) {
            edge(graph, lift(f), lift(f + 1), LIFT_COST_PER_FLOOR);
        }

        // Entrances: real GPS nodes, linked indoors and to the nearest outdoor path node.
        graph.addNode(new Node("AIML_E2", E2_LNG, E2_LAT));
        graph.addNode(new Node("AIML_E1", E1_LNG, E1_LAT));
        edge(graph, "AIML_E2", spine(0, 0), dist(graph, "AIML_E2", spine(0, 0)));
        edge(graph, "AIML_E1", spine(0, E1_ALONG), dist(graph, "AIML_E1", spine(0, E1_ALONG)));
        linkToOutdoor(graph, "AIML_E2");
        linkToOutdoor(graph, "AIML_E1");
    }

    private static List<Slot> longArm(int f) {
        if (f == 0) return List.of(
                new Slot("AIML_WASHROOM_M_0", 5), new Slot("AIML_OFFICE", 12.5),
                new Slot("4003", 17.5), new Slot("4004", 22.5), new Slot("4005", 34),
                new Slot("AIML_COE_AI", 38.5)); // Center of Excellence in AI, faces Entrance 1
        // Floors 1-3 share one layout; on floor 3, 4303 is the AIML department office (HOD).
        return List.of(
                new Slot("AIML_WASHROOM_M_" + f, 6), new Slot("4" + f + "03", 11.5),
                new Slot("4" + f + "04", 19), new Slot("4" + f + "04-B", 21),
                new Slot("4" + f + "05", 32), new Slot("4" + f + "06", 37));
    }

    // Doors on the north end wall (floors 1-3), either side of the drinking-water point.
    // pos = metres east of the corridor centre line.
    private static List<Slot> endWall(int f) {
        if (f == 0) return List.of(); // Entrance 2 is there on the ground floor
        return List.of(new Slot("4" + f + "01", 0.95), new Slot("4" + f + "02", -0.95));
    }

    private static List<Slot> shortArm(int f) {
        if (f == 0) return List.of(
                new Slot("4006", 5), new Slot("4007", 13), new Slot("4008", 17), new Slot("AIML_WASHROOM_F_0", 20));
        return List.of(new Slot("4" + f + "07", 5), new Slot("4" + f + "08", 12), new Slot("4" + f + "09", 19));
    }

    private static void addFloor(Graph g, int f, List<Slot> longArm, List<Slot> shortArm) {
        // Spine along the long-arm corridor, sorted and chained.
        TreeSet<Double> along = new TreeSet<>(List.of(0.0, STAIRS_ALONG, E1_ALONG, CORNER_ALONG));
        longArm.forEach(s -> along.add(s.pos()));
        Double prev = null;
        for (double a : along) {
            addNode(g, spine(f, a), CORRIDOR_EAST, -a, f);
            if (prev != null) edge(g, spine(f, prev), spine(f, a), a - prev);
            prev = a;
        }
        // Short-arm corridor runs west from the corner node.
        TreeSet<Double> west = new TreeSet<>(List.of(WEST_END));
        shortArm.forEach(s -> west.add(s.pos()));
        String prevId = spine(f, CORNER_ALONG);
        double prevW = 0;
        for (double w : west) {
            addNode(g, westNode(f, w), CORRIDOR_EAST - w, -CORNER_ALONG, f);
            edge(g, prevId, westNode(f, w), w - prevW);
            prevId = westNode(f, w);
            prevW = w;
        }
        // Doors on the outer wall (east wall of the long arm, south wall of the short arm).
        for (Slot s : longArm) {
            addNode(g, s.id(), CORRIDOR_EAST + DOOR_OFFSET, -s.pos(), f);
            edge(g, s.id(), spine(f, s.pos()), DOOR_OFFSET);
        }
        for (Slot s : shortArm) {
            addNode(g, s.id(), CORRIDOR_EAST - s.pos(), -CORNER_ALONG - DOOR_OFFSET, f);
            edge(g, s.id(), westNode(f, s.pos()), DOOR_OFFSET);
        }
        for (Slot s : endWall(f)) {
            addNode(g, s.id(), CORRIDOR_EAST + s.pos(), 0.5, f);
            edge(g, s.id(), spine(f, 0), 1.0);
        }
        // Foot of the stairs, off the corridor on the east side.
        addNode(g, stairs(f), STAIR_FOOT_EAST, -STAIRS_ALONG, f);
        edge(g, stairs(f), spine(f, STAIRS_ALONG), STAIR_FOOT_EAST - CORRIDOR_EAST);
    }

    /** Layout for the frontend's 3D interior; all positions are metres in the local frame. */
    public static java.util.Map<String, Object> layout() {
        java.util.Map<String, Object> floors = new java.util.LinkedHashMap<>();
        for (int f = 0; f <= 3; f++) {
            floors.put(String.valueOf(f), java.util.Map.of(
                    "longArm", longArm(f).stream().map(s -> List.of(s.id(), s.pos())).toList(),
                    "shortArm", shortArm(f).stream().map(s -> List.of(s.id(), s.pos())).toList(),
                    "endWall", endWall(f).stream().map(s -> List.of(s.id(), s.pos())).toList()));
        }
        return java.util.Map.ofEntries(
                java.util.Map.entry("origin", List.of(E2_LNG, E2_LAT)),
                java.util.Map.entry("entrance1", List.of(E1_LNG, E1_LAT)),
                java.util.Map.entry("corridorEast", CORRIDOR_EAST),
                java.util.Map.entry("cornerAlong", CORNER_ALONG),
                java.util.Map.entry("westEnd", WEST_END),
                java.util.Map.entry("stairsAlong", STAIRS_ALONG),
                java.util.Map.entry("stairFootEast", STAIR_FOOT_EAST),
                java.util.Map.entry("landingEast", LANDING_EAST),
                java.util.Map.entry("doorOffset", DOOR_OFFSET),
                java.util.Map.entry("floors", floors));
    }

    static String spine(int f, double along) { return "AIML_F" + f + "_A" + along; }
    static String westNode(int f, double w) { return "AIML_F" + f + "_W" + w; }
    static String stairs(int f) { return "AIML_STAIRS_" + f; }
    static String landing(int f) { return "AIML_LANDING_" + f; }
    static String lift(int f) { return "AIML_LIFT_" + f; }

    private static void addNode(Graph g, String id, double eastM, double northM, double floor) {
        g.addNode(new Node(id, E2_LNG + eastM / M_PER_DEG_LNG, E2_LAT + northM / M_PER_DEG_LAT, floor));
    }

    // Indoor edges are covered (rain-safe) with normal crowding.
    private static void edge(Graph g, String a, String b, double cost) {
        g.addBidirectionalEdge(a, b, cost, true, 1.0);
    }

    private static double dist(Graph g, String a, String b) {
        Node n1 = g.getNode(a), n2 = g.getNode(b);
        return Haversine.distance(n1.getLatitude(), n1.getLongitude(), n2.getLatitude(), n2.getLongitude());
    }

    private static void linkToOutdoor(Graph g, String entranceId) {
        Node e = g.getNode(entranceId);
        Node best = null;
        double bestD = Double.MAX_VALUE;
        for (Node n : g.getNodes()) {
            if (n.isIndoor() || n.isVirtual() || n.getId().startsWith("AIML_E")) continue;
            double d = Haversine.distance(e.getLatitude(), e.getLongitude(), n.getLatitude(), n.getLongitude());
            if (d < bestD) { bestD = d; best = n; }
        }
        if (best != null) g.addBidirectionalEdge(entranceId, best.getId(), bestD, false, 1.0);
    }
}
