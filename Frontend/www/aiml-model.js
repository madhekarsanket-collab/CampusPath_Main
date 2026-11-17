/* CampusPath AIML Building 4 — High-Fidelity 3D Layer & Calibration System */
(() => {
  // Default Initial Transformation Configuration
  const DEFAULT_CONFIG = {
    modelUrl: 'assets/aiml_building_final.glb',
    // Model bbox centre placed so the model's entrance (x=0) lands on Entrance 2 GPS
    // and its long arm (model +X) runs south. Must match Backend AimlIndoorGraph.
    // Fitted to the Mapbox/OSM AIML footprint (50.6 m N-S, 11.5 m wide main arm).
    anchor: { lng: 73.867743, lat: 18.463599, altitude: 0.0 },
    // Translation Offsets in meters
    offsetX: 0.0,
    offsetY: 0.0,
    offsetZ: 0.0,
    // Rotations in degrees
    rotationX: 0.0,
    rotationY: 0.0,
    rotationZ: -90.0,
    // Scale factors (applied in world axes: X = east-west, Y = north-south)
    scaleUniform: 1.0,
    scaleX: 1.44,
    scaleY: 1.69,
    scaleZ: 1.0,
    // Visual toggles
    visible: true,
    opacity: 1.0,
    floor: 'all',
    showRoof: true,
    showExtrusions: true,
    showAnchorMarker: false,
    showBoundingBox: false,
    showAxes: false
  };

  // Active configuration (deep clone of defaults)
  let CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

  // Undo / Redo history stacks
  const historyUndo = [];
  const historyRedo = [];
  const MAX_HISTORY = 30;

  // Runtime references
  let mapRef = null;
  let gltfScene = null;
  let modelRoot = null;
  let camera = null;
  let scene = null;
  let renderer = null;
  let bboxHelper = null;
  let axesHelper = null;
  let debugMarker = null;
  let calibrationPending = false;

  const status = (msg, isError = false) => {
    const el = document.getElementById('aiml-status');
    if (el) {
      el.textContent = msg;
      el.style.color = isError ? '#ef4444' : '#2563eb';
    }
    console.log(`[AIML-3D] ${msg}`);
  };

  // Push state to undo stack
  function recordState() {
    if (historyUndo.length >= MAX_HISTORY) historyUndo.shift();
    historyUndo.push(JSON.stringify(CONFIG));
    historyRedo.length = 0; // Clear redo on new action
    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons() {
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    if (btnUndo) btnUndo.disabled = historyUndo.length === 0;
    if (btnRedo) btnRedo.disabled = historyRedo.length === 0;
  }

  // Versioned key: calibrations saved for the old GLB must not apply to the final one.
  const STORAGE_KEY = 'CampusPath_AIML_Calibration_v3';
  const FLOOR_HEIGHT_M = 3.6; // slab-to-slab height in the GLB

  // Load saved calibration from localStorage
  function loadPersistedCalibration() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        CONFIG = Object.assign({}, DEFAULT_CONFIG, parsed);
        console.log('[AIML-3D] Loaded saved calibration from localStorage:', CONFIG);
      }
    } catch (e) {
      console.warn('[AIML-3D] Failed to load calibration from localStorage:', e);
    }
  }

  // Save calibration to localStorage
  function saveCalibrationToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(CONFIG));
      status('Calibration saved locally.');
    } catch (e) {
      status('Failed to save calibration.', true);
    }
  }

  // Geographic anchor marker
  function updateDebugMarker() {
    if (!mapRef) return;
    if (debugMarker) debugMarker.remove();

    if (!CONFIG.showAnchorMarker || !CONFIG.visible) return;

    const el = document.createElement('div');
    el.className = 'aiml-anchor-pin';
    el.style.width = '14px';
    el.style.height = '14px';
    el.style.borderRadius = '50%';
    el.style.background = '#2563eb';
    el.style.border = '2px solid #ffffff';
    el.style.boxShadow = '0 0 12px rgba(37, 99, 235, 0.9)';
    el.title = `AIML Anchor: ${CONFIG.anchor.lng.toFixed(6)}, ${CONFIG.anchor.lat.toFixed(6)}`;

    debugMarker = new mapboxgl.Marker({ element: el })
      .setLngLat([CONFIG.anchor.lng, CONFIG.anchor.lat])
      .addTo(mapRef);
  }

  // Floor and Roof visibility & Diagnostic Mesh Isolation
  const DIAGNOSTIC_ISOLATION = {
    showRoof: true,
    showSlabs: true,
    showExtWalls: true,
    showRooms: true
  };

  function applyFloorVisibility() {
    if (!gltfScene) return;
    gltfScene.traverse(obj => {
      if (!obj.isMesh) return;
      // Sanitize name: GLTFLoader replaces spaces with underscores
      const rawName = obj.name || '';
      const n = rawName.replace(/_/g, ' ');

      // Diagnostic isolation filters
      if (n.includes('| ROOF |')) {
        obj.visible = CONFIG.showRoof && DIAGNOSTIC_ISOLATION.showRoof && CONFIG.floor === 'all';
        return;
      }

      if (n.includes('| slab')) {
        if (!DIAGNOSTIC_ISOLATION.showSlabs) {
          obj.visible = false;
          return;
        }
      }

      if (n.includes('| exterior wall')) {
        if (!DIAGNOSTIC_ISOLATION.showExtWalls) {
          obj.visible = false;
          return;
        }
      }

      if (n.includes('| room') || n.includes('| stair') || n.includes('| corridor') || n.includes('| window')) {
        if (!DIAGNOSTIC_ISOLATION.showRooms) {
          obj.visible = false;
          return;
        }
      }

      // Final GLB names meshes "G floor slab main", "3 C1 door", ...; stairs/lift (L0..L2) are shared.
      const match = n.match(/^([G123]) /);
      const level = match ? (match[1] === 'G' ? 0 : Number(match[1])) : null;
      obj.visible = (!match || CONFIG.floor === 'all' || match[1] === CONFIG.floor)
        && (maxFloor === null || level === null || level <= maxFloor); // indoor cutaway
      // shared stairs/lift (L0..L2) sit between floor n and n+1
      const shared = n.match(/ L(\d)$/);
      if (shared && maxFloor !== null) obj.visible = Number(shared[1]) < maxFloor;
    });
    mapRef?.triggerRepaint();
  }

  // Opacity adjustment across all materials
  function applyOpacity() {
    if (!gltfScene) return;
    gltfScene.traverse(obj => {
      if (obj.isMesh && obj.material) {
        if (CONFIG.opacity < 1.0) {
          obj.material.transparent = true;
          obj.material.opacity = CONFIG.opacity;
          obj.material.depthWrite = false; // X-ray: see-through walls must not hide the route
        } else {
          // Keep original material alpha if present
          obj.material.opacity = obj.material.userData?.origOpacity ?? 1.0;
          obj.material.transparent = obj.material.opacity < 1.0;
          obj.material.depthWrite = true;
        }
        obj.material.needsUpdate = true;
      }
    });
    mapRef?.triggerRepaint();
  }

  // ---- Precision: everything is placed in local metres around FRAME_ORIGIN (Entrance 2). ----
  // The Earth-scale Mercator transform is folded into the camera matrix once, in JS doubles.
  // (Multiplying Mercator-scale numbers on the GPU in float32 shreds geometry at close range.)
  const FRAME_ORIGIN = [73.867834, 18.463828];
  const M_PER_DEG_LAT = 110574, M_PER_DEG_LNG = 111320 * Math.cos(FRAME_ORIGIN[1] * Math.PI / 180);
  const frameLocal = lngLat => [(lngLat[0] - FRAME_ORIGIN[0]) * M_PER_DEG_LNG, (lngLat[1] - FRAME_ORIGIN[1]) * M_PER_DEG_LAT];

  function frameMatrix() {
    const mc = mapboxgl.MercatorCoordinate.fromLngLat(FRAME_ORIGIN, 0);
    const ms = mc.meterInMercatorCoordinateUnits();
    return new THREE.Matrix4().makeTranslation(mc.x, mc.y, mc.z).multiply(new THREE.Matrix4().makeScale(ms, -ms, ms));
  }

  // Update Model Matrix and Helpers
  function updateTransform() {
    if (!modelRoot || !mapRef || !gltfScene) return;
    const [anchorE, anchorN] = frameLocal([CONFIG.anchor.lng, CONFIG.anchor.lat]);
    const meterScale = 1; // metres: the frame matrix supplies the Mercator scale and Y flip

    // Model bounding box centering
    const bounds = new THREE.Box3().setFromObject(gltfScene);
    const center = new THREE.Vector3();
    bounds.getCenter(center);

    // 1. Center model at ground level (Z min = 0)
    const local = new THREE.Matrix4().makeTranslation(-center.x, -center.y, -bounds.min.z);

    // 2. Offsets (meters converted to local coordinate shifts)
    const offsets = new THREE.Matrix4().makeTranslation(CONFIG.offsetX, CONFIG.offsetY, 0);

    // 3. Rotations in radians (Euler XYZ)
    const rotEuler = new THREE.Euler(
      THREE.MathUtils.degToRad(CONFIG.rotationX),
      THREE.MathUtils.degToRad(CONFIG.rotationY),
      THREE.MathUtils.degToRad(CONFIG.rotationZ),
      'ZYX'
    );
    const rotation = new THREE.Matrix4().makeRotationFromEuler(rotEuler);

    // 4. Scales: Mapbox Y points South; model Y points North. GLB is Z-up.
    const finalScaleX = meterScale * CONFIG.scaleUniform * CONFIG.scaleX;
    const finalScaleY = meterScale * CONFIG.scaleUniform * CONFIG.scaleY;
    const finalScaleZ = meterScale * CONFIG.scaleUniform * CONFIG.scaleZ;
    const scale = new THREE.Matrix4().makeScale(finalScaleX, finalScaleY, finalScaleZ);

    // 5. Anchor translation, in local metres from FRAME_ORIGIN
    const translate = new THREE.Matrix4().makeTranslation(anchorE, anchorN, CONFIG.anchor.altitude + CONFIG.offsetZ);

    // Multiply together: Translate * Scale * Rotation * Offsets * Local
    modelRoot.matrix
      .copy(translate)
      .multiply(scale)
      .multiply(rotation)
      .multiply(offsets)
      .multiply(local);

    modelRoot.matrixWorldNeedsUpdate = true;

    // Update helpers visibility
    if (bboxHelper) bboxHelper.visible = CONFIG.showBoundingBox;
    if (axesHelper) axesHelper.visible = CONFIG.showAxes;

    // Extrusions visibility
    if (mapRef.getLayer('3d-buildings')) {
      mapRef.setLayoutProperty(
        '3d-buildings',
        'visibility',
        CONFIG.showExtrusions ? 'visible' : 'none'
      );
    }

    updateDebugMarker();
    syncUIValues();
    mapRef.triggerRepaint();
  }

  // Create Mapbox Custom 3D Layer
  function createCustom3DLayer() {
    return {
      id: 'campuspath-aiml-glb',
      type: 'custom',
      renderingMode: '3d',

      onAdd(map, gl) {
        mapRef = map;

        camera = new THREE.Camera();
        scene = new THREE.Scene();

        routeRoot = new THREE.Group();
        routeRoot.matrixAutoUpdate = false;
        scene.add(routeRoot);

        // Balanced architectural lighting attached to camera for consistent illumination
        // Ambient provides baseline illumination for all faces
        const ambLight = new THREE.AmbientLight(0xffffff, 0.55);
        scene.add(ambLight);

        // Hemisphere gives sky/ground gradient — boosts upward-facing surfaces
        const hemiLight = new THREE.HemisphereLight(0xddeeff, 0x8899aa, 0.35);
        scene.add(hemiLight);

        // Directional light from camera direction so all surfaces facing the camera receive illumination
        const sun1 = new THREE.DirectionalLight(0xffffff, 0.45);
        sun1.position.set(0, 50, 100);
        camera.add(sun1);
        scene.add(camera);

        // Secondary fill light from opposite side to soften shadows
        const sun2 = new THREE.DirectionalLight(0xffeedd, 0.25);
        sun2.position.set(0, -50, -50);
        scene.add(sun2);

        // WebGLRenderer on Mapbox canvas context
        renderer = new THREE.WebGLRenderer({
          canvas: map.getCanvas(),
          context: gl,
          antialias: true
        });
        renderer.autoClear = false;

        // Color management — sRGB output for correct color display
        // r128: use outputEncoding not outputColorSpace
        if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

        // CRITICAL FIX: Do NOT use ACES Filmic tone mapping.
        // ACES aggressively darkens mid-tones, making the already-matte
        // architectural materials (roughness 0.82) appear near-black.
        // The GLB materials have correct non-black base colors (grays, browns,
        // greens, blues) — they just need faithful reproduction.
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.toneMappingExposure = 1.0;

        status('Loading architectural AIML GLB...');
        const loader = new THREE.GLTFLoader();
        loader.load(
          CONFIG.modelUrl,
          gltf => {
            gltfScene = gltf.scene;

            // ===== MATERIAL DIAGNOSTIC LOG =====
            let meshIdx = 0;
            const materialReport = [];

            // FIX: All 317 primitives in this GLB lack normal vectors.
            // Without normals, PBR lighting cannot compute diffuse/specular
            // response and the surface renders black regardless of base color.
            //
            // Additionally the GLTFLoader in r128 may produce non-indexed
            // BufferGeometry. computeVertexNormals() on non-indexed geometry
            // produces flat normals per-triangle (which is acceptable for
            // an architectural model — gives a faceted/crisp look).
            gltfScene.traverse(obj => {
              if (obj.isMesh) {
                obj.frustumCulled = false;
                meshIdx++;

                // ---- Geometry: Force normal computation ----
                if (obj.geometry) {
                  // Always recompute — the GLB ships 0/317 primitives with normals
                  obj.geometry.computeVertexNormals();
                }

                // ---- Material: Record originals, then apply corrections ----
                if (obj.material) {
                  // Store ALL original properties and references for diagnostic reversal
                  const mat = obj.material;
                  mat.userData = {
                    origMaterial: mat,
                    origOpacity: mat.opacity !== undefined ? mat.opacity : 1.0,
                    origColor: mat.color ? mat.color.clone() : null,
                    origRoughness: mat.roughness,
                    origMetalness: mat.metalness,
                    origSide: mat.side,
                    origEmissive: mat.emissive ? mat.emissive.clone() : null,
                    origName: mat.name || `mesh_${meshIdx}`
                  };

                  // Log first occurrence of each material for diagnostics
                  if (!materialReport.find(r => r.name === mat.name)) {
                    materialReport.push({
                      name: mat.name || `unnamed_${meshIdx}`,
                      colorHex: mat.color ? '#' + mat.color.getHexString() : 'n/a',
                      colorRGB: mat.color ? `r=${mat.color.r.toFixed(3)}, g=${mat.color.g.toFixed(3)}, b=${mat.color.b.toFixed(3)}` : 'n/a',
                      roughness: mat.roughness,
                      metalness: mat.metalness,
                      opacity: mat.opacity,
                      transparent: mat.transparent,
                      side: mat.side,
                      hasNormals: !!(obj.geometry && obj.geometry.attributes.normal),
                      hasVertexColors: !!(obj.geometry && obj.geometry.attributes.color)
                    });
                  }

                  // === Conditional corrections ===
                  // Force double-sided rendering (GLB says doubleSided=false
                  // but we need to see internal walls)
                  mat.side = THREE.DoubleSide;

                  // Depth handling
                  mat.depthTest = true;
                  mat.depthWrite = true;

                  // Roughness: GLB has 0.82 for ALL materials.
                  // Under limited Three.js-in-Mapbox lighting, 0.82 produces
                  // almost no specular highlight, making surfaces very dark.
                  // 0.55 gives a realistic matte concrete/plaster look while
                  // still reflecting enough light to show color.
                  mat.roughness = Math.min(mat.roughness, 0.55);

                  // Metalness: keep at 0 (already 0 in GLB, correct for building)
                  mat.metalness = Math.min(mat.metalness, 0.1);

                  // CONDITIONAL color correction:
                  // Only brighten genuinely near-black materials (R+G+B < 0.15)
                  // None of the 9 materials in this GLB are near-black, but
                  // this guard future-proofs against re-exports.
                  if (mat.color) {
                    const c = mat.color;
                    if (c.r < 0.05 && c.g < 0.05 && c.b < 0.05) {
                      console.warn(`[AIML-3D] Near-black material "${mat.name}" corrected to light gray`);
                      c.setHex(0xcccccc);
                    }
                  }

                  // PBR (MeshStandard) renders as black speckle inside Mapbox's custom layer,
                  // and is slow on phones. Lambert with the GLB's own colours looks right and is cheap.
                  const lambert = new THREE.MeshLambertMaterial({
                    color: mat.color.clone(),
                    side: THREE.DoubleSide,
                    transparent: mat.opacity < 1,
                    opacity: mat.opacity
                  });
                  lambert.userData = mat.userData;
                  obj.material = lambert;
                }
              }
            });

            // Print full material diagnostic report to console
            console.log('[AIML-3D] === MATERIAL DIAGNOSTIC REPORT ===');
            console.table(materialReport);
            console.log(`[AIML-3D] Total meshes processed: ${meshIdx}`);
            console.log(`[AIML-3D] Normals computed for all ${meshIdx} meshes (GLB shipped 0/317 with normals)`);
            console.log('[AIML-3D] Tone mapping: NoToneMapping (ACES was causing darkening)');
            console.log('[AIML-3D] Roughness capped at 0.55 (was 0.82)');

            modelRoot = new THREE.Group();
            modelRoot.matrixAutoUpdate = false;
            modelRoot.add(gltfScene);
            scene.add(modelRoot);

            // Add visual bounding box & axes helpers
            bboxHelper = new THREE.BoxHelper(gltfScene, 0x00ff88);
            bboxHelper.visible = CONFIG.showBoundingBox;
            modelRoot.add(bboxHelper);

            axesHelper = new THREE.AxesHelper(20);
            axesHelper.visible = CONFIG.showAxes;
            modelRoot.add(axesHelper);

            applyFloorVisibility();
            applyOpacity();
            updateTransform();

            status('AIML 3D Model loaded successfully.');
            map.triggerRepaint();
          },
          undefined,
          err => {
            console.error('[AIML-3D] Load error:', err);
            status('Failed to load AIML GLB.', true);
          }
        );
      },

      render(gl, matrix) {
        if (!CONFIG.visible || !modelRoot || !renderer) return;

        // Apply Mapbox projection matrix directly to Three.js camera
        camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(frameMatrix());

        // Reset Three.js internal state cache (no per-frame diagnostics: they stall the GPU on phones)
        renderer.resetState();

        // Save initial state for Mapbox restoration
        const prevBlend = gl.isEnabled(gl.BLEND);
        const prevDepthTest = gl.isEnabled(gl.DEPTH_TEST);
        const prevDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
        const prevColorMask = Array.from(gl.getParameter(gl.COLOR_WRITEMASK) || [true, true, true, true]);

        // Explicitly enforce proper WebGL draw state
        gl.colorMask(true, true, true, true);
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);
        gl.depthFunc(gl.LEQUAL);

        // For opaque Basic or unlit rendering, disable alpha blending so dest pixel is replaced directly
        if (currentRenderMode === 'basic' || currentRenderMode === 'diagnostic') {
          gl.disable(gl.BLEND);
        } else {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        }

        // Render Three.js scene
        renderer.render(scene, camera);

        // --- STEP 4: RESTORE MAPBOX WEBGL STATE ---
        // Restore color mask, depth mask, depth test, and blending to avoid corrupting Mapbox passes
        gl.colorMask(prevColorMask[0], prevColorMask[1], prevColorMask[2], prevColorMask[3]);
        gl.depthMask(prevDepthMask);
        if (prevDepthTest) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
        if (prevBlend) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
      },

      onRemove() {
        if (renderer) renderer.dispose();
      }
    };
  }

  // ---------- Indoor route (3D) ----------
  let routeRoot = null;
  let routeOrigin = null;   // [lng, lat] the route group's local metres are measured from
  let userMesh = null;
  let maxFloor = null;      // null = all floors; n = hide floors above n (indoor cutaway)

  const floorHeight = f => (f ?? 0) * FLOOR_HEIGHT_M * CONFIG.scaleZ * CONFIG.scaleUniform;

  function toLocal(lngLat) {
    const mLat = 110574, mLng = 111320 * Math.cos(routeOrigin[1] * Math.PI / 180);
    return [(lngLat[0] - routeOrigin[0]) * mLng, (lngLat[1] - routeOrigin[1]) * mLat];
  }

  function setMaxFloor(f) {
    maxFloor = f;
    applyFloorVisibility();
  }

  // 3D "you are here" dot at the right floor height (a Mapbox marker would sit on the ground).
  function setUserPosition(lngLat, floor) {
    if (!routeRoot || !routeOrigin) return;
    if (!userMesh) {
      userMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0x1d4ed8, depthTest: false }));
      userMesh.renderOrder = 1001;
    }
    if (userMesh.parent !== routeRoot) routeRoot.add(userMesh);
    userMesh.visible = lngLat !== null;
    if (lngLat) {
      const [x, y] = toLocal(lngLat);
      userMesh.position.set(x, y, floorHeight(floor) + 0.5);
    }
    mapRef?.triggerRepaint();
  }

  function clearIndoorRoute() {
    if (!routeRoot) return;
    routeRoot.children.slice().forEach(c => {
      routeRoot.remove(c);
      if (c === userMesh) return; // reused, not disposed
      c.geometry?.dispose();
      c.material?.dispose();
    });
    mapRef?.triggerRepaint();
  }

  // coords: [[lng,lat],...], floors: same length, null = outdoor. Draws the indoor part
  // (plus the entrance point it starts from) as a blue tube at floor height, and a green
  // box on the destination if it is indoors.
  function setIndoorRoute(coords, floors) {
    clearIndoorRoute();
    if (!routeRoot || !coords?.length) return;
    const first = floors.findIndex(f => f !== null && f !== undefined);
    if (first < 0) return;
    const startIdx = Math.max(0, first - 1);
    const origin = coords[startIdx];
    routeOrigin = origin;

    const [oE, oN] = frameLocal(origin);
    routeRoot.matrix.makeTranslation(oE, oN, CONFIG.anchor.altitude + CONFIG.offsetZ);
    routeRoot.matrixWorldNeedsUpdate = true;

    const floorZ = floorHeight;
    const pts = [];
    for (let i = startIdx; i < coords.length; i++) {
      const [x, y] = toLocal(coords[i]);
      pts.push(new THREE.Vector3(x, y, floorZ(floors[i]) + 0.15)); // just above the floor tiles
    }
    if (pts.length >= 2) {
      const path = new THREE.CurvePath();
      for (let i = 0; i < pts.length - 1; i++) {
        if (pts[i].distanceTo(pts[i + 1]) > 0.01) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
      }
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(path, Math.max(8, pts.length * 6), 0.22, 6, false),
        new THREE.MeshBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.95, depthTest: false }));
      tube.renderOrder = 999; // draw on top of the translucent building
      routeRoot.add(tube);
    }
    const lastFloor = floors[floors.length - 1];
    if (lastFloor !== null && lastFloor !== undefined) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(3, 3, 2.6),
        new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.3, depthTest: false }));
      const end = pts[pts.length - 1];
      box.position.set(end.x, end.y, floorZ(lastFloor) + 1.3);
      box.renderOrder = 1000;
      routeRoot.add(box);
    }
    mapRef?.triggerRepaint();
  }

  // ---------- Generated interior (matches the routing graph exactly) ----------
  // Built from GET /api/buildings/aiml/layout: corridors, two-tone walls, windows, doors
  // with room signs, and the zig-zag stair hall. Shown one floor at a time when indoors.
  let interiorRoot = null;
  const interiorFloors = {};
  const CORRIDOR_W = 3.0, WALL_H = 3.2, DADO_H = 1.0;

  // Ground floor: slate-grey tiles, light grout. Upper floors: glossy cream tiles (photos).
  function makeTileTexture(w, h, upper) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = upper ? '#ece5d6' : '#8f969c'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = upper ? '#e4dccb' : '#858c92'; g.fillRect(0, 0, 32, 32); g.fillRect(32, 32, 32, 32);
    g.strokeStyle = upper ? '#d3cab7' : '#c9cdd0'; g.lineWidth = 2; g.strokeRect(0, 0, 64, 64);
    g.beginPath(); g.moveTo(32, 0); g.lineTo(32, 64); g.moveTo(0, 32); g.lineTo(64, 32); g.stroke();
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(w / 1.2, h / 1.2); // 0.6 m tiles
    return t;
  }

  function makeSign(text) {
    const wide = text.length > 6; // named labs get a longer board
    const c = document.createElement('canvas');
    c.width = wide ? 640 : 256; c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = '#1e3a8a'; g.fillRect(0, 0, c.width, 96);
    g.strokeStyle = '#ffffff'; g.lineWidth = 6; g.strokeRect(6, 6, c.width - 12, 84);
    g.fillStyle = '#ffffff'; g.font = `bold ${wide ? 40 : 48}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, c.width / 2, 50);
    // A flat board, not a Sprite: sprite billboarding breaks when the whole Mercator transform
    // lives in the projection matrix (signs came out mirrored or lying flat).
    return new THREE.Mesh(new THREE.PlaneGeometry(1.3 * c.width / 256, 0.5),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide }));
  }

  // Stand a sign upright on a wall, text facing the corridor. facing: 'west' | 'north' | 'south'
  // (the direction a person reading it looks from = the sign's normal).
  function mountSign(sign, facing) {
    const rz = { south: 0, north: Math.PI, west: -Math.PI / 2 }[facing];
    sign.rotation.set(Math.PI / 2, 0, rz, 'ZYX');
    return sign;
  }

  const MAT = {
    upper: new THREE.MeshLambertMaterial({ color: 0xf3ecd6, side: THREE.DoubleSide }),
    dado: new THREE.MeshLambertMaterial({ color: 0xe6cf7f, side: THREE.DoubleSide }),
    glass: new THREE.MeshLambertMaterial({ color: 0x9fd3ea, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
    door: new THREE.MeshLambertMaterial({ color: 0x8a5a32 }),
    stone: new THREE.MeshLambertMaterial({ color: 0xbab6ad }),
    steel: new THREE.MeshLambertMaterial({ color: 0x9aa3ab }),
    board: new THREE.MeshLambertMaterial({ color: 0x7a1f2b }),
    terracotta: new THREE.MeshLambertMaterial({ color: 0xa5533a }),
    frame: new THREE.MeshLambertMaterial({ color: 0xd8d2c4 }),
    red: new THREE.MeshLambertMaterial({ color: 0xd62828 }),
    bench: new THREE.MeshLambertMaterial({ color: 0x3f5f4f }),
    vending: new THREE.MeshLambertMaterial({ color: 0xf4f6f8 }),
    vendingFront: new THREE.MeshBasicMaterial({ color: 0xfff3c4 }) // lit display, unaffected by lights
  };

  // Display names for doors with a known name (everything else shows its room number).
  const DOOR_LABELS = {
    '4003': '4003 · Liquid Galaxy Lab',
    AIML_COE_AI: 'Center of Excellence in AI',
    AIML_OFFICE: 'AIML Office',
    '4303': '4303 · AIML Dept. Office',
    '4305': '4305 · Staff Room',
    '4307': '4307 · UG Class Room 1',
    '4308': '4308 · Programming Lab'
  };
  const WIDE_DOORS = new Set(['4003', 'AIML_COE_AI', '4307', '4308']); // double doors on labs/classrooms

  // Axis-aligned box from min/max corners (local metres: x east, y north, z up).
  function box(group, mat, x0, x1, y0, y1, z0, z1) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0) || 0.05, Math.abs(y1 - y0) || 0.05, z1 - z0), mat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    group.add(m);
  }

  // A solid two-tone wall along x or y, with optional window band.
  function wall(group, x0, x1, y0, y1, z, windows) {
    box(group, MAT.dado, x0, x1, y0, y1, z, z + DADO_H);
    if (windows) {
      box(group, MAT.glass, x0, x1, y0, y1, z + DADO_H, z + 2.4);
      box(group, MAT.upper, x0, x1, y0, y1, z + 2.4, z + WALL_H);
    } else {
      box(group, MAT.upper, x0, x1, y0, y1, z + DADO_H, z + WALL_H);
    }
  }

  function buildInterior(L) {
    if (!scene || interiorRoot) return;
    interiorRoot = new THREE.Group();
    interiorRoot.matrixAutoUpdate = false;
    const [oE, oN] = frameLocal(L.origin);
    interiorRoot.matrix.makeTranslation(oE, oN, CONFIG.anchor.altitude + CONFIG.offsetZ);
    scene.add(interiorRoot);

    const half = CORRIDOR_W / 2, cx = L.corridorEast, corner = L.cornerAlong, sa = L.stairsAlong;
    const outerX = cx + half, innerX = cx - half;             // long arm walls (east = rooms)
    const southY = -corner - half, northY = -corner + half;    // short arm walls (south = rooms)
    const westX = cx - L.westEnd - half;
    const T = 0.15;                                            // wall thickness

    Object.entries(L.floors).forEach(([key, F]) => {
      const f = Number(key), z = floorHeight(f), g = new THREE.Group();

      // Tiled corridor floors
      const longFloor = new THREE.Mesh(new THREE.PlaneGeometry(CORRIDOR_W, corner + half),
        new THREE.MeshLambertMaterial({ map: makeTileTexture(CORRIDOR_W, corner + half, f > 0) }));
      longFloor.position.set(cx, -(corner + half) / 2, z + 0.02);
      const shortFloor = new THREE.Mesh(new THREE.PlaneGeometry(innerX - westX, CORRIDOR_W),
        new THREE.MeshLambertMaterial({ map: makeTileTexture(innerX - westX, CORRIDOR_W, f > 0) }));
      shortFloor.position.set((innerX + westX) / 2, -corner, z + 0.02);
      g.add(longFloor, shortFloor);
      // Upper floors: terracotta squares down the middle of the corridor
      if (f > 0) {
        for (let a = 1.5; a < corner; a += 2) box(g, MAT.terracotta, cx - 0.35, cx + 0.35, -a - 0.35, -a + 0.35, z + 0.02, z + 0.03);
        for (let w = 2; w < L.westEnd; w += 2) box(g, MAT.terracotta, cx - w - 0.35, cx - w + 0.35, -corner - 0.35, -corner + 0.35, z + 0.02, z + 0.03);
      }

      // Room-side walls (with a gap for the stair hall), window walls, end walls
      wall(g, outerX, outerX + T, 0, -(sa - 2.5), z, false);
      wall(g, outerX, outerX + T, -(sa + 2.5), southY, z, false);
      wall(g, outerX + T, westX, southY, southY - T, z, false);
      wall(g, innerX - T, innerX, 0, northY, z, true);
      wall(g, innerX, westX, northY, northY + T, z, true);
      wall(g, westX - T, westX, northY, southY, z, false);
      if (f === 0) box(g, MAT.glass, innerX, outerX, 0, 0.1, z, z + 2.6);      // Entrance 2 glass doors
      else wall(g, innerX, outerX, 0, 0.1, z, false);                         // end wall: 4x01, 4x02, water

      // Doors + room signs on the outer walls
      const door = (x, y, alongX, id) => {
        const hw = WIDE_DOORS.has(id) ? 0.8 : 0.5;
        if (alongX) box(g, MAT.door, x - 0.03, x, y - hw, y + hw, z, z + 2.1);
        else box(g, MAT.door, x - hw, x + hw, y, y + 0.03, z, z + 2.1);
        const text = DOOR_LABELS[id] || id.replace(/^AIML_/, '').replace(/WASHROOM_M.*/, "GENTS' WC").replace(/WASHROOM_F.*/, "LADIES' WC");
        const s = mountSign(makeSign(text), alongX ? 'west' : 'north');
        s.position.set(alongX ? x - 0.06 : x, alongX ? y : y + 0.06, z + 2.45);
        g.add(s);
      };
      F.longArm.forEach(([id, pos]) => door(outerX, -pos, true, id));
      F.shortArm.forEach(([id, pos]) => door(cx - pos, southY, false, id));

      // North end wall (floors 1-3): two doors with the drinking-water cooler between them
      (F.endWall || []).forEach(([id, east]) => {
        const x = cx + east;
        box(g, MAT.door, x - 0.42, x + 0.42, -0.03, 0, z, z + 2.1);
        const s = mountSign(makeSign(id), 'south');
        s.position.set(x, -0.06, z + 2.45);
        g.add(s);
      });
      if ((F.endWall || []).length) {
        box(g, MAT.steel, cx - 0.4, cx + 0.4, -0.55, -0.02, z, z + 1.1);          // water cooler
        const w = mountSign(makeSign('Drinking Water'), 'south');
        w.position.set(cx, -0.06, z + 1.9);
        w.scale.multiplyScalar(0.6);
        g.add(w);
      }

      // Maroon notice boards midway between neighbouring doors on the room wall
      const longPos = F.longArm.map(([, p]) => p).sort((a, b) => a - b);
      for (let i = 0; i + 1 < longPos.length; i++) {
        const mid = (longPos[i] + longPos[i + 1]) / 2;
        if (longPos[i + 1] - longPos[i] < 3.5 || Math.abs(mid - sa) < 3) continue; // no room / stair hall
        box(g, MAT.frame, outerX - 0.05, outerX, -mid - 0.7, -mid + 0.7, z + 1.05, z + 2.05);
        box(g, MAT.board, outerX - 0.07, outerX - 0.05, -mid - 0.62, -mid + 0.62, z + 1.12, z + 1.98);
      }
      // Fire extinguishers on the window side, benches under the windows on upper floors
      for (let a = 8; a < corner - 2; a += 12) {
        box(g, MAT.red, innerX + 0.02, innerX + 0.2, -a - 0.09, -a + 0.09, z + 0.9, z + 1.5);
        if (f > 0) box(g, MAT.bench, innerX + 0.05, innerX + 0.5, -a - 3.5, -a - 1.9, z, z + 0.45);
      }
      if (f > 0) for (let w = 4; w < L.westEnd - 1; w += 7) {
        box(g, MAT.bench, cx - w - 0.8, cx - w + 0.8, northY - 0.5, northY - 0.05, z, z + 0.45);
      }
      // Vending machine against the short-arm window wall, just past the corner (ground floor)
      if (f === 0) {
        box(g, MAT.vending, cx - half - 1.6, cx - half - 0.7, northY - 0.85, northY - 0.05, z, z + 1.9);
        box(g, MAT.vendingFront, cx - half - 1.55, cx - half - 0.75, northY - 0.87, northY - 0.85, z + 0.3, z + 1.75);
      }

      // Stair hall going east: flight up on the north half to the landing, back on the south half.
      if (f < 3) {
        const x0 = outerX + T, x1 = L.landingEast, steps = 10, run = (x1 - x0) / steps, rise = 1.8 / steps;
        for (let i = 0; i < steps; i++) {
          box(g, MAT.stone, x0 + i * run, x0 + (i + 1) * run, -sa + 2.3, -sa + 0.1, z, z + (i + 1) * rise);
          box(g, MAT.stone, x1 - (i + 1) * run, x1 - i * run, -sa - 0.1, -sa - 2.3, z + 1.8, z + 1.8 + (i + 1) * rise);
        }
        box(g, MAT.stone, x1, x1 + 1.5, -sa + 2.3, -sa - 2.3, z + 1.6, z + 1.8);   // half-landing
        box(g, MAT.steel, x1 + 1.5, x1 + 1.56, -sa - 0.6, -sa - 2.0, z + 1.8, z + 3.9); // lift doors
        const lift = mountSign(makeSign('LIFT'), 'west');
        lift.position.set(x1 + 1.5, -sa - 1.3, z + 4.2);
        g.add(lift);
      }
      g.visible = false;
      interiorFloors[f] = g;
      interiorRoot.add(g);
    });
    mapRef?.triggerRepaint();
  }

  async function loadInterior(apiBase) {
    try {
      const L = await (await fetch(`${apiBase}/api/buildings/aiml/layout`)).json();
      buildInterior(L);
    } catch (e) {
      console.warn('[AIML-3D] Interior layout unavailable:', e);
    }
  }

  // floor: null = outside (show the GLB building), number = show that floor's interior only.
  function setInteriorFloor(floor) {
    const inside = floor !== null && floor !== undefined;
    Object.entries(interiorFloors).forEach(([k, g]) => { g.visible = inside && Number(k) === Math.floor(floor); });
    if (gltfScene) gltfScene.visible = !inside || !interiorRoot; // keep the GLB if the interior failed to load
    mapRef?.triggerRepaint();
  }

  function setXray(on) {
    CONFIG.opacity = on ? 0.28 : 1.0;
    applyOpacity();
    syncUIValues();
  }

  // Camera Actions
  function campusOverview() {
    if (!mapRef) return;
    mapRef.flyTo({
      center: [73.8682, 18.4635],
      zoom: 17.2,
      pitch: 50,
      bearing: -15,
      duration: 1200
    });
  }

  function focusAIMLBuilding() {
    if (!mapRef) return;
    CONFIG.visible = true;
    updateTransform();
    // One-off offset (not `padding`: map padding persists and misaligns Mapbox custom 3D layers)
    const wide = window.innerWidth > 700;
    mapRef.flyTo({
      center: [CONFIG.anchor.lng, CONFIG.anchor.lat],
      zoom: 19.2,
      pitch: 60,
      bearing: mapRef.getBearing(),
      offset: wide ? [170, 0] : [0, -window.innerHeight * 0.2],
      duration: 1400
    });
  }

  function resetView() {
    campusOverview();
  }

  // Synchronize values into UI inputs
  function syncUIValues() {
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    };
    const setTxt = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };

    setVal('cal-off-x', CONFIG.offsetX);
    setTxt('cal-off-x-val', `${CONFIG.offsetX.toFixed(1)}m`);
    setVal('cal-off-y', CONFIG.offsetY);
    setTxt('cal-off-y-val', `${CONFIG.offsetY.toFixed(1)}m`);
    setVal('cal-off-z', CONFIG.offsetZ);
    setTxt('cal-off-z-val', `${CONFIG.offsetZ.toFixed(1)}m`);

    setVal('cal-rot-x', CONFIG.rotationX);
    setTxt('cal-rot-x-val', `${CONFIG.rotationX}°`);
    setVal('cal-rot-y', CONFIG.rotationY);
    setTxt('cal-rot-y-val', `${CONFIG.rotationY}°`);
    setVal('cal-rot-z', CONFIG.rotationZ);
    setTxt('cal-rot-z-val', `${CONFIG.rotationZ}°`);

    setVal('cal-scale-u', CONFIG.scaleUniform);
    setTxt('cal-scale-u-val', `${CONFIG.scaleUniform.toFixed(2)}×`);
    setVal('cal-scale-x', CONFIG.scaleX);
    setTxt('cal-scale-x-val', `${CONFIG.scaleX.toFixed(2)}×`);
    setVal('cal-scale-y', CONFIG.scaleY);
    setTxt('cal-scale-y-val', `${CONFIG.scaleY.toFixed(2)}×`);
    setVal('cal-scale-z', CONFIG.scaleZ);
    setTxt('cal-scale-z-val', `${CONFIG.scaleZ.toFixed(2)}×`);

    setVal('cal-opacity', CONFIG.opacity);
    setTxt('cal-opacity-val', `${Math.round(CONFIG.opacity * 100)}%`);

    setVal('cal-lng-input', CONFIG.anchor.lng.toFixed(6));
    setVal('cal-lat-input', CONFIG.anchor.lat.toFixed(6));

    const chkExt = document.getElementById('chk-extrusions');
    if (chkExt) chkExt.checked = CONFIG.showExtrusions;
    const chkPin = document.getElementById('chk-pin');
    if (chkPin) chkPin.checked = CONFIG.showAnchorMarker;
    const chkBbox = document.getElementById('chk-bbox');
    if (chkBbox) chkBbox.checked = CONFIG.showBoundingBox;
    const chkAxes = document.getElementById('chk-axes');
    if (chkAxes) chkAxes.checked = CONFIG.showAxes;
    const chkVis = document.getElementById('chk-model-vis');
    if (chkVis) chkVis.checked = CONFIG.visible;

    updateUndoRedoButtons();
  }

  // Bind Calibration UI listeners
  function initUI() {
    loadPersistedCalibration();

    // Toggle Calibration Panel accordion
    const togglePanelBtn = document.getElementById('toggle-cal-panel');
    const calContent = document.getElementById('cal-panel-content');
    if (togglePanelBtn && calContent) {
      togglePanelBtn.addEventListener('click', () => {
        calContent.classList.toggle('hidden');
        togglePanelBtn.textContent = calContent.classList.contains('hidden')
          ? '⚙️ Expand Calibration'
          : '✖ Collapse Calibration';
      });
    }

    // Sliders with real-time update and state record
    const bindSlider = (id, prop, transformFunc) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('mousedown', recordState);
      el.addEventListener('touchstart', recordState, { passive: true });
      el.addEventListener('input', e => {
        CONFIG[prop] = parseFloat(e.target.value);
        if (transformFunc) transformFunc();
        else updateTransform();
      });
    };

    bindSlider('cal-off-x', 'offsetX');
    bindSlider('cal-off-y', 'offsetY');
    bindSlider('cal-off-z', 'offsetZ');
    bindSlider('cal-rot-x', 'rotationX');
    bindSlider('cal-rot-y', 'rotationY');
    bindSlider('cal-rot-z', 'rotationZ');
    bindSlider('cal-scale-u', 'scaleUniform');
    bindSlider('cal-scale-x', 'scaleX');
    bindSlider('cal-scale-y', 'scaleY');
    bindSlider('cal-scale-z', 'scaleZ');
    bindSlider('cal-opacity', 'opacity', () => {
      applyOpacity();
      syncUIValues();
    });

    // Checkboxes
    const bindCheckbox = (id, prop, callback) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', e => {
        recordState();
        CONFIG[prop] = e.target.checked;
        if (callback) callback();
        updateTransform();
      });
    };

    bindCheckbox('chk-model-vis', 'visible');
    bindCheckbox('chk-extrusions', 'showExtrusions');
    bindCheckbox('chk-pin', 'showAnchorMarker');
    bindCheckbox('chk-bbox', 'showBoundingBox');
    bindCheckbox('chk-axes', 'showAxes');
    bindCheckbox('aiml-roof', 'showRoof', applyFloorVisibility);

    // Floor Selector
    const floorSelect = document.getElementById('aiml-floor');
    if (floorSelect) {
      floorSelect.addEventListener('change', e => {
        recordState();
        CONFIG.floor = e.target.value;
        applyFloorVisibility();
      });
    }

    // Directional Nudge Buttons (0.5m increments)
    const nudge = (dx, dy) => {
      recordState();
      // Latitude: 1 deg ~ 111,000m; Longitude: 1 deg ~ 111,000m * cos(lat)
      const latOffset = dy / 111000.0;
      const lngOffset = dx / (111000.0 * Math.cos(CONFIG.anchor.lat * Math.PI / 180.0));
      CONFIG.anchor.lat += latOffset;
      CONFIG.anchor.lng += lngOffset;
      updateTransform();
    };

    document.getElementById('nudge-n')?.addEventListener('click', () => nudge(0, 0.5));
    document.getElementById('nudge-s')?.addEventListener('click', () => nudge(0, -0.5));
    document.getElementById('nudge-w')?.addEventListener('click', () => nudge(-0.5, 0));
    document.getElementById('nudge-e')?.addEventListener('click', () => nudge(0.5, 0));

    // Numerical Lat / Lng inputs
    const applyCoordsInput = () => {
      const lngEl = document.getElementById('cal-lng-input');
      const latEl = document.getElementById('cal-lat-input');
      if (lngEl && latEl) {
        const lng = parseFloat(lngEl.value);
        const lat = parseFloat(latEl.value);
        if (!isNaN(lng) && !isNaN(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90) {
          recordState();
          CONFIG.anchor.lng = lng;
          CONFIG.anchor.lat = lat;
          updateTransform();
        }
      }
    };

    document.getElementById('cal-lng-input')?.addEventListener('change', applyCoordsInput);
    document.getElementById('cal-lat-input')?.addEventListener('change', applyCoordsInput);

    // Click on map to reposition anchor
    document.getElementById('aiml-place')?.addEventListener('click', () => {
      if (!mapRef) return;
      calibrationPending = true;
      window.aimlPlacementMode = true;
      mapRef.getCanvas().style.cursor = 'crosshair';
      status('Click on map to reposition building anchor.');

      mapRef.once('click', e => {
        if (!calibrationPending) return;
        recordState();
        CONFIG.anchor.lng = e.lngLat.lng;
        CONFIG.anchor.lat = e.lngLat.lat;
        calibrationPending = false;
        window.aimlPlacementMode = false;
        mapRef.getCanvas().style.cursor = '';
        updateTransform();
        status(`Anchor placed: ${CONFIG.anchor.lng.toFixed(6)}, ${CONFIG.anchor.lat.toFixed(6)}`);
      });
    });

    // Camera buttons
    document.getElementById('btn-campus-view')?.addEventListener('click', campusOverview);
    document.getElementById('btn-focus-aiml')?.addEventListener('click', focusAIMLBuilding);
    document.getElementById('btn-reset-view')?.addEventListener('click', resetView);

    // Save / Reset / Undo / Redo
    document.getElementById('btn-save-cal')?.addEventListener('click', saveCalibrationToStorage);

    document.getElementById('btn-reset-cal')?.addEventListener('click', () => {
      recordState();
      CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      localStorage.removeItem(STORAGE_KEY);
      applyFloorVisibility();
      applyOpacity();
      updateTransform();
      status('Reset to factory default calibration.');
    });

    document.getElementById('btn-undo')?.addEventListener('click', () => {
      if (historyUndo.length > 0) {
        historyRedo.push(JSON.stringify(CONFIG));
        const prev = JSON.parse(historyUndo.pop());
        CONFIG = prev;
        applyFloorVisibility();
        applyOpacity();
        updateTransform();
      }
    });

    document.getElementById('btn-redo')?.addEventListener('click', () => {
      if (historyRedo.length > 0) {
        historyUndo.push(JSON.stringify(CONFIG));
        const next = JSON.parse(historyRedo.pop());
        CONFIG = next;
        applyFloorVisibility();
        applyOpacity();
        updateTransform();
      }
    });

    // Export JSON
    document.getElementById('btn-export-cal')?.addEventListener('click', () => {
      const jsonStr = JSON.stringify(CONFIG, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'CampusPath_AIML_Calibration.json';
      a.click();
      URL.revokeObjectURL(url);
      status('Exported calibration JSON.');
    });

    // Import JSON
    const importInput = document.getElementById('input-import-cal');
    document.getElementById('btn-import-cal')?.addEventListener('click', () => {
      if (importInput) importInput.click();
    });

    if (importInput) {
      importInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
          try {
            const imported = JSON.parse(ev.target.result);
            recordState();
            CONFIG = Object.assign({}, DEFAULT_CONFIG, imported);
            applyFloorVisibility();
            applyOpacity();
            updateTransform();
            saveCalibrationToStorage();
            status('Imported calibration successfully.');
          } catch (err) {
            status('Invalid calibration JSON file.', true);
          }
        };
        reader.readAsText(file);
      });
    }

    // Render mode buttons
    document.getElementById('btn-mode-basic')?.addEventListener('click', () => setRenderMode('basic'));
    document.getElementById('btn-mode-corrected')?.addEventListener('click', () => setRenderMode('corrected'));
    document.getElementById('btn-mode-original')?.addEventListener('click', () => setRenderMode('original'));

    // Diagnostic Mesh Isolation Checkboxes
    const bindDiagCheck = (id, key) => {
      const el = document.getElementById(id);
      if (el) {
        el.checked = DIAGNOSTIC_ISOLATION[key];
        el.addEventListener('change', e => {
          DIAGNOSTIC_ISOLATION[key] = e.target.checked;
          applyFloorVisibility();
        });
      }
    };
    bindDiagCheck('chk-diag-roof', 'showRoof');
    bindDiagCheck('chk-diag-slabs', 'showSlabs');
    bindDiagCheck('chk-diag-extwalls', 'showExtWalls');
    bindDiagCheck('chk-diag-rooms', 'showRooms');

    syncUIValues();
  }

  // Diagnostic rendering modes
  // mode: 'original' | 'corrected' | 'basic' | 'diagnostic'
  let currentRenderMode = 'corrected';
  function setRenderMode(mode) {
    if (!gltfScene) return;
    currentRenderMode = mode;
    gltfScene.traverse(obj => {
      if (!obj.isMesh) return;
      const ud = obj.material?.userData || obj.userData?.meshMaterialData;
      if (!ud) return;

      if (!obj.userData.meshMaterialData) {
        obj.userData.meshMaterialData = ud;
      }

      if (mode === 'basic') {
        // STEP 1: Unlit diagnostic material — ZERO light or normal dependencies
        if (!obj.userData.basicMaterial) {
          obj.userData.basicMaterial = new THREE.MeshBasicMaterial({
            color: 0xcccccc,
            side: THREE.DoubleSide,
            transparent: false,
            opacity: 1.0,
            depthTest: true,
            depthWrite: true
          });
        }
        obj.material = obj.userData.basicMaterial;
      } else if (mode === 'original') {
        // Restore original GLB material reference and properties
        const origMat = ud.origMaterial || obj.material;
        obj.material = origMat;
        if (ud.origColor) obj.material.color.copy(ud.origColor);
        obj.material.roughness = ud.origRoughness !== undefined ? ud.origRoughness : 0.82;
        obj.material.metalness = ud.origMetalness !== undefined ? ud.origMetalness : 0.0;
        obj.material.side = ud.origSide !== undefined ? ud.origSide : THREE.FrontSide;
        if (ud.origEmissive) obj.material.emissive.copy(ud.origEmissive);
      } else if (mode === 'corrected') {
        // Restore original PBR material reference with corrections
        const origMat = ud.origMaterial || obj.material;
        obj.material = origMat;
        if (ud.origColor) obj.material.color.copy(ud.origColor);
        if (obj.material.color.r < 0.05 && obj.material.color.g < 0.05 && obj.material.color.b < 0.05) {
          obj.material.color.setHex(0xcccccc);
        }
        obj.material.roughness = Math.min(ud.origRoughness !== undefined ? ud.origRoughness : 0.82, 0.55);
        obj.material.metalness = Math.min(ud.origMetalness !== undefined ? ud.origMetalness : 0.0, 0.1);
        obj.material.side = THREE.DoubleSide;
      } else if (mode === 'diagnostic') {
        // Neutral gray matte material for isolating geometry/lighting issues
        const origMat = ud.origMaterial || obj.material;
        obj.material = origMat;
        obj.material.color.setHex(0xbbbbbb);
        obj.material.roughness = 0.5;
        obj.material.metalness = 0.0;
        obj.material.side = THREE.DoubleSide;
        obj.material.emissive.setHex(0x000000);
      }
      obj.material.needsUpdate = true;
    });
    mapRef?.triggerRepaint();
    console.log(`[AIML-3D] Render mode set to: ${mode}`);
  }

  // Public Interface
  window.CampusPathAIML = {
    show: () => {
      CONFIG.visible = true;
      updateTransform();
    },
    hide: () => {
      CONFIG.visible = false;
      updateTransform();
    },
    focus: focusAIMLBuilding,
    campusView: campusOverview,
    setIndoorRoute,
    clearIndoorRoute,
    setXray,
    setMaxFloor,
    setUserPosition,
    floorHeight,
    loadInterior,
    setInteriorFloor,
    initLayer: targetMap => {
      const m = targetMap || window.map;
      if (!m) return;
      mapRef = m;
      if (!m.getLayer('campuspath-aiml-glb')) {
        console.log('[AIML-3D] Registering Mapbox custom 3D layer: campuspath-aiml-glb');
        m.addLayer(createCustom3DLayer());
      }
    },
    setAnchor: (lng, lat) => {
      CONFIG.anchor.lng = Number(lng);
      CONFIG.anchor.lat = Number(lat);
      updateTransform();
    },
    applyFloor: floor => {
      CONFIG.floor = String(floor);
      applyFloorVisibility();
    },
    getConfig: () => ({ ...CONFIG }),
    getDiagnostics: () => {
      let meshCount = 0;
      let visibleMeshes = 0;
      if (gltfScene) {
        gltfScene.traverse(o => {
          if (o.isMesh) {
            meshCount++;
            if (o.visible) visibleMeshes++;
          }
        });
      }

      let glErrors = [];
      let rendererInfo = null;
      if (renderer) {
        try {
          rendererInfo = {
            calls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
            points: renderer.info.render.points,
            lines: renderer.info.render.lines,
            geometries: renderer.info.memory.geometries,
            textures: renderer.info.memory.textures
          };
          const gl = renderer.getContext();
          if (gl) {
            let err = gl.getError();
            while (err !== gl.NO_ERROR) {
              glErrors.push(err);
              err = gl.getError();
            }
          }
        } catch (e) {
          glErrors.push('Failed to query WebGL: ' + e.message);
        }
      }

      return {
        visible: CONFIG.visible,
        meshCount,
        visibleMeshes,
        hasScene: !!gltfScene,
        hasRenderer: !!renderer,
        layerRegistered: !!(mapRef && mapRef.getLayer('campuspath-aiml-glb')),
        renderMode: currentRenderMode,
        rendererInfo,
        glErrors,
        calibration: {
          lng: CONFIG.anchor.lng,
          lat: CONFIG.anchor.lat,
          offsetX: CONFIG.offsetX,
          offsetY: CONFIG.offsetY,
          offsetZ: CONFIG.offsetZ,
          rotationZ: CONFIG.rotationZ,
          scaleUniform: CONFIG.scaleUniform,
          scaleX: CONFIG.scaleX,
          scaleY: CONFIG.scaleY,
          scaleZ: CONFIG.scaleZ
        }
      };
    },
    // Diagnostic rendering modes: 'original', 'corrected', 'diagnostic', 'basic'
    setRenderMode,
    // Expose scene for runtime debugging
    getScene: () => gltfScene,
    // Diagnostic mesh isolation
    setIsolation: (part, visible) => {
      if (DIAGNOSTIC_ISOLATION.hasOwnProperty(part)) {
        DIAGNOSTIC_ISOLATION[part] = !!visible;
        const el = document.getElementById({
          showRoof: 'chk-diag-roof',
          showSlabs: 'chk-diag-slabs',
          showExtWalls: 'chk-diag-extwalls',
          showRooms: 'chk-diag-rooms'
        }[part]);
        if (el) el.checked = !!visible;
        applyFloorVisibility();
      }
    },
    // Isolate a single target mesh with a custom material for testing
    isolateSingleMesh: (targetName, testColor = 0xff0055) => {
      if (!gltfScene) return null;
      let foundMesh = null;
      gltfScene.traverse(obj => {
        if (!obj.isMesh) return;
        if (obj.name && obj.name.includes(targetName)) {
          obj.visible = true;
          obj.material = new THREE.MeshBasicMaterial({
            color: testColor,
            side: THREE.DoubleSide,
            transparent: false,
            opacity: 1.0,
            depthTest: true,
            depthWrite: true
          });
          foundMesh = {
            name: obj.name,
            materialType: obj.material.type,
            colorHex: '#' + obj.material.color.getHexString()
          };
        } else {
          obj.visible = false;
        }
      });
      mapRef?.triggerRepaint();
      return foundMesh;
    }
  };

  // Run on ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }
})();
