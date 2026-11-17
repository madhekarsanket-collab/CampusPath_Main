// Offline routing: a cached copy of the campus graph (GET /api/graph) and the same A*
// rules as the Java backend, run on the phone when the server can't be reached.
window.CampusOffline = (() => {
  const KEY = 'cp_graph_v1';
  let G = null; // { nodes: [{id, lng, lat, floor, virt, edges: [{to, d, covered, crowd}]}], byId: Map }

  const prepare = raw => {
    const nodes = raw.nodes.map(([id, lng, lat, floor, virt]) =>
      ({ id, lng, lat, floor: floor < 0 ? null : floor, virt: !!virt, edges: [] }));
    raw.edges.forEach(([a, b, d, c, crowd]) => nodes[a].edges.push({ to: b, d, covered: !!c, crowd }));
    return { nodes, byId: new Map(nodes.map((n, i) => [n.id, i])) };
  };

  function load() {
    try { const s = localStorage.getItem(KEY); if (s) G = prepare(JSON.parse(s)); } catch { /* no cache */ }
  }

  async function refresh(api) {
    try {
      const r = await fetch(`${api}/api/graph`);
      if (!r.ok) return;
      const raw = await r.json();
      G = prepare(raw);
      try { localStorage.setItem(KEY, JSON.stringify(raw)); } catch { /* storage full: keep in memory */ }
    } catch { /* offline: keep the cached copy */ }
  }

  const meters = (a, b) => {
    const R = 6371000, toR = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };

  // Same snapping rule as the backend KD-tree: GPS points never snap to indoor nodes.
  function nearestOutdoor(lng, lat) {
    let best = -1, bestD = Infinity;
    G.nodes.forEach((n, i) => {
      if (n.floor !== null) return;
      const d = meters(n, { lng, lat });
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  function crowdFactor(e, time, avoid) {
    if (!avoid) return 1;
    const occ = (time >= 1200 && time <= 1400) || (time >= 1700 && time <= 1900) ? 1
      : time >= 800 && time <= 1800 ? 0.3 : 0;
    return 1 + (e.crowd - 1) * occ;
  }

  // Binary-heap A*; payload is the same body the app sends to POST /api/route.
  function route(payload) {
    if (!G) throw new Error('No offline map data yet. Open the app once with internet.');
    const pick = (node, pt) => node != null ? G.byId.get(node) : nearestOutdoor(pt.lng, pt.lat);
    const s = pick(payload.startNode, payload.start), t = pick(payload.endNode, payload.end);
    if (s === undefined || t === undefined || s < 0 || t < 0) throw new Error('Unknown start or destination');
    const time = Number(payload.time) || 1200, goal = G.nodes[t];
    // heuristic:false turns A* into plain Dijkstra (used to compare how much work each does)
    const h = i => payload.heuristic === false ? 0 : hA(i);
    const hA = i => {
      const n = G.nodes[i];
      // Virtual building nodes: aim at their nearest entrance stub (as the backend does)
      if (goal.virt && goal.edges.length) return Math.min(...goal.edges.map(e => meters(n, G.nodes[e.to])));
      return meters(n, goal);
    };

    const gScore = new Map([[s, 0]]), came = new Map(), closed = new Set(), explored = [];
    const heap = [[h(s), s]];
    const push = item => {
      heap.push(item);
      for (let i = heap.length - 1; i > 0;) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]]; i = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top;
    };

    while (heap.length) {
      const [, cur] = pop();
      if (closed.has(cur)) continue;
      closed.add(cur);
      explored.push(cur);
      if (cur === t) break;
      if (G.nodes[cur].virt && cur !== s) continue; // no passing through building nodes
      for (const e of G.nodes[cur].edges) {
        if (closed.has(e.to)) continue;
        let cost = e.d * crowdFactor(e, time, payload.avoidCrowds !== false);
        if (payload.rain && !e.covered) cost += 10000;
        const g = gScore.get(cur) + cost;
        if (g < (gScore.get(e.to) ?? Infinity)) {
          gScore.set(e.to, g);
          came.set(e.to, cur);
          push([g + h(e.to), e.to]);
        }
      }
    }
    if (!closed.has(t)) throw new Error('No route found');

    const path = [t];
    while (came.has(path[0])) path.unshift(came.get(path[0]));
    let dist = 0, covered = 0;
    for (let i = 0; i + 1 < path.length; i++) {
      const e = G.nodes[path[i]].edges.find(x => x.to === path[i + 1]);
      dist += e.d;
      if (e.covered && G.nodes[path[i]].floor === null && G.nodes[path[i + 1]].floor === null) covered += e.d;
    }
    const ns = path.map(i => G.nodes[i]);
    return {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: ns.map(n => [n.lng, n.lat]) },
      properties: {
        floors: ns.map(n => n.floor), nodeIds: ns.map(n => n.id), destination: goal.id,
        distanceMeters: Math.round(dist * 100) / 100, estimatedTimeMinutes: Math.max(1, Math.ceil(dist / 84)),
        crowdDetour: false, coveredOutdoorMeters: Math.round(covered), offline: true,
        explored: explored.map(i => [G.nodes[i].lng, G.nodes[i].lat, G.nodes[i].floor ?? -1])
      }
    };
  }

  // Outdoor campus paths as GeoJSON, drawn when the Mapbox map can't load offline.
  function pathsGeoJson() {
    if (!G) return { type: 'FeatureCollection', features: [] };
    const features = [];
    G.nodes.forEach((n, i) => n.floor === null && n.edges.forEach(e => {
      const m = G.nodes[e.to];
      if (e.to > i && m.floor === null && !n.virt && !m.virt) {
        features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[n.lng, n.lat], [m.lng, m.lat]] } });
      }
    }));
    return { type: 'FeatureCollection', features };
  }

  load();
  return { refresh, route, pathsGeoJson, nodeCount: () => (G ? G.nodes.length : 0) };
})();
