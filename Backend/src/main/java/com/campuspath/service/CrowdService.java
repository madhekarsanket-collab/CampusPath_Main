package com.campuspath.service;

import com.campuspath.algorithm.Haversine;
import com.campuspath.model.Node;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;
import java.util.function.ToDoubleFunction;

/**
 * Live crowd detection: every phone running a navigation sends an anonymous ping
 * (random device id + position). A node is crowded by the number of phones seen within
 * RADIUS_M of it in the last WINDOW_MS. A* multiplies edge costs by that crowding.
 */
@Service
public class CrowdService {
    static final long WINDOW_MS = 120_000;
    static final double RADIUS_M = 15, PER_PERSON = 0.6, MAX_MULTIPLIER = 4.0;

    public record Ping(double lng, double lat, long timeMs) {}

    private final Map<String, Ping> lastPingByDevice = new ConcurrentHashMap<>();
    private final LongSupplier clock;

    public CrowdService() { this(System::currentTimeMillis); }

    public CrowdService(LongSupplier clock) { this.clock = clock; }

    public void report(String deviceId, double lng, double lat) {
        lastPingByDevice.put(deviceId, new Ping(lng, lat, clock.getAsLong()));
    }

    public List<Ping> active() {
        long cutoff = clock.getAsLong() - WINDOW_MS;
        lastPingByDevice.values().removeIf(p -> p.timeMs() < cutoff);
        return List.copyOf(lastPingByDevice.values());
    }

    /** Snapshot taken once per route request: node -> live crowd multiplier (1 = empty). */
    public ToDoubleFunction<Node> snapshot() {
        List<Ping> pings = active();
        if (pings.isEmpty()) return n -> 1.0;
        return n -> {
            long people = pings.stream().filter(p ->
                    Haversine.distance(p.lat(), p.lng(), n.getLatitude(), n.getLongitude()) < RADIUS_M).count();
            return Math.min(MAX_MULTIPLIER, 1.0 + PER_PERSON * people);
        };
    }
}
