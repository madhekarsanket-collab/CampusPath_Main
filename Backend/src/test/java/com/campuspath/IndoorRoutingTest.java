package com.campuspath;

import com.campuspath.config.CampusGraphConfig;
import com.campuspath.datastructure.Graph;
import com.campuspath.model.Node;
import com.campuspath.service.RouteService;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class IndoorRoutingTest {
    private final CampusGraphConfig config = new CampusGraphConfig();
    private final Graph graph = config.campusGraph();
    private final RouteService service = new RouteService(graph, config.kdTree(graph));

    @Test
    void mainGateToRoom4309GoesThroughEntranceAndUpToFloor3() {
        List<Node> path = service.route("MainGate", "4309", false, "1000").path();

        assertEquals("4309", path.get(path.size() - 1).getId());
        assertTrue(path.stream().anyMatch(n -> n.getId().startsWith("AIML_E")), "must enter via an entrance");
        assertTrue(path.stream().anyMatch(n -> n.getId().equals("AIML_STAIRS_3")), "must climb the stairs");
        assertEquals(3.0, path.get(path.size() - 1).getFloor());
        assertTrue(path.stream().anyMatch(n -> n.getId().startsWith("AIML_LANDING")), "stairs zig-zag via landings");
    }

    @Test
    void fromNorthRoadTo4003UsesEntrance2AndNeverPassesThroughVirtualBuildingNode() {
        List<Node> path = service.route("73.86779,18.46399", "4003", false, "1000").path();
        assertTrue(path.stream().anyMatch(n -> n.getId().equals("AIML_E2")), "north side should use Entrance 2");
        assertTrue(path.stream().noneMatch(n -> n.getId().equals("AIML")), "virtual node is not a shortcut");
    }

    @Test
    void room4003ToMainCanteenLeavesByEntrance1ViaThePathCrossing() {
        var r = service.route("4003", "MainCanteen", false, "1000");
        assertTrue(r.path().stream().anyMatch(n -> n.getId().equals("AIML_E1")), "E1 is the short way south");
        assertTrue(r.distanceMeters() < 150, "was 173 m via the north road: " + r.distanceMeters());
    }

    @Test
    void outdoorTripsNeverCutThroughTheBuilding() {
        for (String from : new String[]{"MainGate", "73.867834,18.463840"}) {
            var path = service.route(from, "MainCanteen", false, "1000").path();
            assertFalse(path.isEmpty());
            assertTrue(path.stream().noneMatch(Node::isIndoor), from + " went through AIML");
        }
    }

    @Test
    void everyUpperFloorHasTheSameRoomsWithItsOwnNumbers() {
        for (int f = 1; f <= 3; f++) {
            for (String r : new String[]{"01", "02", "03", "04", "04-B", "05", "06", "07", "08", "09"}) {
                Node room = graph.getNode("4" + f + r);
                assertNotNull(room, "missing room 4" + f + r);
                assertEquals((double) f, room.getFloor());
            }
        }
        // 4207 sits exactly below 4307
        Node a = graph.getNode("4207"), b = graph.getNode("4307");
        assertEquals(a.getLatitude(), b.getLatitude(), 1e-12);
        assertEquals(a.getLongitude(), b.getLongitude(), 1e-12);
    }

    @Test
    void everyCampusPlaceReachesEveryKindOfAimlRoom() {
        String[] places = {"MainGate", "ExitGate", "Parking", "Library", "Auditorium", "MainCanteen", "AIML"};
        String[] rooms = {"4003", "4006", "AIML_COE_AI", "AIML_WASHROOM_F_0", "4101", "4204-B", "4309"};
        for (String p : places) {
            for (String r : rooms) {
                assertFalse(service.route(p, r, false, "1000").path().isEmpty(), p + " -> " + r);
            }
        }
    }

    @Test
    void groundFloorRoomStaysOnGroundFloor() {
        List<Node> path = service.route("MainGate", "4003", false, "1000").path();
        assertTrue(path.stream().allMatch(n -> n.getFloor() == null || n.getFloor() == 0));
    }

    @Test
    void avoidingCrowdsAtLunchNeverGivesShorterWalkThanShortestPath() {
        double shortest = service.route("MainGate", "4309", false, "1300", false).distanceMeters();
        double calm = service.route("MainGate", "4309", false, "1300", true).distanceMeters();
        assertTrue(calm >= shortest - 1e-6);
    }

    @Test
    void gpsTapNeverSnapsIndoors() {
        List<Node> path = service.route("73.867834,18.463828", "4309", false, "1000").path();
        assertNull(path.get(0).getFloor());
    }
}
