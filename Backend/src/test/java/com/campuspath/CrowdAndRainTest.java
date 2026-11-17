package com.campuspath;

import com.campuspath.config.CampusGraphConfig;
import com.campuspath.datastructure.Graph;
import com.campuspath.model.Node;
import com.campuspath.service.CrowdService;
import com.campuspath.service.RouteService;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.*;

class CrowdAndRainTest {
    private final CampusGraphConfig config = new CampusGraphConfig();
    private final Graph graph = config.campusGraph();

    @Test
    void pingsMakeNearbyNodesCrowdedAndExpireAfterTwoMinutes() {
        AtomicLong now = new AtomicLong(0);
        CrowdService crowd = new CrowdService(now::get);
        Node e2 = graph.getNode("AIML_E2");
        for (int i = 0; i < 3; i++) crowd.report("phone" + i, e2.getLongitude(), e2.getLatitude());

        assertEquals(1.0 + 3 * 0.6, crowd.snapshot().applyAsDouble(e2), 1e-9);
        now.set(121_000);
        assertEquals(1.0, crowd.snapshot().applyAsDouble(e2), 1e-9);
    }

    @Test
    void liveCrowdAtEntrance2SendsRouteThroughEntrance1() {
        AtomicLong now = new AtomicLong(0);
        CrowdService crowd = new CrowdService(now::get);
        RouteService service = new RouteService(graph, config.kdTree(graph), crowd);
        String start = "73.86779,18.46399"; // road north of AIML: Entrance 2 is the natural way in

        assertTrue(ids(service.route(start, "4005", false, "1000", true).path()).contains("AIML_E2"));

        Node e2 = graph.getNode("AIML_E2");
        for (int i = 0; i < 6; i++) crowd.report("p" + i, e2.getLongitude(), e2.getLatitude());
        var crowded = service.route(start, "4005", false, "1000", true);
        List<String> crowdedRoute = ids(crowded.path());
        assertFalse(crowdedRoute.contains("AIML_E2"), "should avoid the crowded entrance: " + crowdedRoute);
        assertTrue(crowded.crowdDetour(), "result must report that live crowd changed the route");
    }

    @Test
    void coveredWalkwayExistsInGraph() {
        long covered = graph.getNodes().stream().filter(n -> !n.isIndoor())
                .flatMap(n -> n.getEdges().stream()).filter(e -> e.isCovered()).count();
        assertTrue(covered > 0, "user-marked tree walkway should be covered");
    }

    private static List<String> ids(List<Node> path) {
        return path.stream().map(Node::getId).toList();
    }
}
