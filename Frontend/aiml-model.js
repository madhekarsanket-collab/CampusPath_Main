/* CampusPath AIML Building 4 — Mapbox custom 3D layer */
(() => {
  const CONFIG = {
    modelUrl: 'assets/AIML_Building4_Standalone.glb',
    // Approximate centre derived from AIML-labelled GeoJSON lines, not surveyed.
    anchor: { lng: 73.86779, lat: 18.46369 },
    scale: 1, rotationDeg: 0, visible: false, floor: 'all', showRoof: true
  };
  let mapRef, gltfScene, modelRoot, layer, calibrationPending = false;

  const status = msg => {
    const el = document.getElementById('aiml-status');
    if (el) el.textContent = msg;
  };

  function applyFloorVisibility() {
    if (!gltfScene) return;
    gltfScene.traverse(obj => {
      if (!obj.isMesh) return;
      const n = obj.name || '';
      if (n.includes('| ROOF |')) obj.visible = CONFIG.showRoof && CONFIG.floor === 'all';
      else {
        const match = n.match(/\| FLOOR ([G123]) \|/);
        obj.visible = !match || CONFIG.floor === 'all' || match[1] === CONFIG.floor;
      }
    });
  }

  function updateTransform() {
    if (!modelRoot || !mapRef || !gltfScene) return;
    const mc = mapboxgl.MercatorCoordinate.fromLngLat(CONFIG.anchor, 0);
    const meterScale = mc.meterInMercatorCoordinateUnits();
    const bounds = new THREE.Box3().setFromObject(gltfScene);
    const center = new THREE.Vector3();
    bounds.getCenter(center);
    const local = new THREE.Matrix4().makeTranslation(-center.x, -center.y, -bounds.min.z);
    const rotation = new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(CONFIG.rotationDeg));
    // Mapbox Y points south; model Y points north. The GLB is already Z-up.
    const scale = new THREE.Matrix4().makeScale(meterScale*CONFIG.scale, -meterScale*CONFIG.scale, meterScale*CONFIG.scale);
    const translate = new THREE.Matrix4().makeTranslation(mc.x, mc.y, mc.z);
    modelRoot.matrix.copy(translate).multiply(scale).multiply(rotation).multiply(local);
    modelRoot.matrixWorldNeedsUpdate = true;
    mapRef.triggerRepaint();
  }

  function createLayer() {
    return {
      id: 'campuspath-aiml-glb', type: 'custom', renderingMode: '3d',
      onAdd(map, gl) {
        mapRef = map;
        this.camera = new THREE.Camera();
        this.scene = new THREE.Scene();
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x667080, 2));
        const sun = new THREE.DirectionalLight(0xffffff, 2);
        sun.position.set(-40, -60, 100);
        this.scene.add(sun);
        this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
        this.renderer.autoClear = false;

        new THREE.GLTFLoader().load(CONFIG.modelUrl, gltf => {
          gltfScene = gltf.scene;
          gltfScene.traverse(obj => {
            if (obj.isMesh) {
              obj.frustumCulled = false;
              if (obj.material) obj.material.side = THREE.DoubleSide;
            }
          });
          modelRoot = new THREE.Group();
          modelRoot.matrixAutoUpdate = false;
          modelRoot.add(gltfScene);
          this.scene.add(modelRoot);
          applyFloorVisibility();
          updateTransform();
          status('Model loaded. Initial placement is approximate; calibrate it on the map.');
          map.triggerRepaint();
        }, undefined, err => {
          console.error('Could not load AIML GLB', err);
          status('GLB load failed. Serve the Frontend folder over HTTP and check the assets path.');
        });
      },
      render(gl, matrix) {
        if (!CONFIG.visible || !modelRoot) return;
        this.camera.projectionMatrix.fromArray(matrix);
        this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
        this.camera.matrixWorld.identity();
        this.camera.matrixWorldInverse.identity();
        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);
      },
      onRemove() { this.renderer?.dispose(); }
    };
  }

  function setVisible(value) {
    CONFIG.visible = value;
    const button = document.getElementById('aiml-toggle');
    if (button) button.textContent = value ? 'Hide 3D' : 'Show 3D';
    mapRef?.triggerRepaint();
    if (value) status('3D model visible. Select a floor or calibrate its position.');
  }

  function init() {
    document.getElementById('aiml-toggle')?.addEventListener('click', () => setVisible(!CONFIG.visible));
    document.getElementById('aiml-floor')?.addEventListener('change', e => {
      CONFIG.floor = e.target.value; applyFloorVisibility(); mapRef?.triggerRepaint();
    });
    document.getElementById('aiml-roof')?.addEventListener('change', e => {
      CONFIG.showRoof = e.target.checked; applyFloorVisibility(); mapRef?.triggerRepaint();
    });
    document.getElementById('aiml-rotation')?.addEventListener('input', e => {
      CONFIG.rotationDeg = Number(e.target.value);
      document.getElementById('aiml-rotation-value').textContent = `${CONFIG.rotationDeg}°`;
      updateTransform();
    });
    document.getElementById('aiml-scale')?.addEventListener('input', e => {
      CONFIG.scale = Number(e.target.value);
      document.getElementById('aiml-scale-value').textContent = `${CONFIG.scale.toFixed(2)}×`;
      updateTransform();
    });
    document.getElementById('aiml-place')?.addEventListener('click', () => {
      if (!mapRef) return;
      calibrationPending = true;
      window.aimlPlacementMode = true;
      mapRef.getCanvas().style.cursor = 'crosshair';
      status('Click the centre of AIML Building 4 on the map to reposition the model.');
      mapRef.once('click', e => {
        if (!calibrationPending) return;
        CONFIG.anchor = { lng: e.lngLat.lng, lat: e.lngLat.lat };
        calibrationPending = false;
        window.aimlPlacementMode = false;
        mapRef.getCanvas().style.cursor = '';
        updateTransform();
        status(`Anchor set to ${CONFIG.anchor.lng.toFixed(6)}, ${CONFIG.anchor.lat.toFixed(6)}. Tune rotation and scale.`);
      });
    });
  }

  window.CampusPathAIML = {
    show: () => setVisible(true), hide: () => setVisible(false),
    setAnchor: (lng, lat) => { CONFIG.anchor = {lng:Number(lng),lat:Number(lat)}; updateTransform(); },
    applyFloor: floor => { CONFIG.floor = String(floor); applyFloorVisibility(); mapRef?.triggerRepaint(); },
    getConfig: () => ({...CONFIG})
  };

  document.addEventListener('DOMContentLoaded', () => {
    init();
    const wait = () => {
      if (window.map) {
        const add = () => {
          if (!window.map.isStyleLoaded()) { window.map.once('load', add); return; }
          if (!window.map.getLayer('campuspath-aiml-glb')) window.map.addLayer(createLayer());
          mapRef = window.map;
        };
        add();
      } else requestAnimationFrame(wait);
    };
    wait();
  });
})();
