import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

let onMapLoadedCallback: (() => void) | null = null;
export function setOnMapLoaded(cb: () => void) {
  onMapLoadedCallback = cb;
}

export function createScene() {
  // Bind loading manager callbacks to update the loading screen UI
  const loadingProgress = document.getElementById('loading-progress');
  const loadingStatus = document.getElementById('loading-status');
  const loadingOverlay = document.getElementById('loading-overlay');

  const manager = new THREE.LoadingManager();

  manager.onProgress = (url, itemsLoaded, itemsTotal) => {
    const percentage = Math.round((itemsLoaded / itemsTotal) * 100);
    if (loadingProgress) {
      loadingProgress.style.width = `${percentage}%`;
    }
    if (loadingStatus) {
      loadingStatus.textContent = `CONNECTING... (${percentage}%)`;
    }
  };

  manager.onLoad = () => {
    if (loadingProgress) {
      loadingProgress.style.width = '100%';
    }
    if (onMapLoadedCallback) {
      onMapLoadedCallback();
    } else {
      if (loadingStatus) {
        loadingStatus.textContent = 'CONNECTED';
      }
      setTimeout(() => {
        if (loadingOverlay) {
          loadingOverlay.classList.add('hidden');
        }
      }, 500);
    }
  };

  manager.onError = (url) => {
    console.error('Error loading resource:', url);
    if (loadingStatus) {
      loadingStatus.textContent = 'ERROR LOADING DATA';
    }
  };

  const scene = new THREE.Scene();
  // Dark atmospheric space-black night sky
  scene.background = new THREE.Color(0x0a0a1a);
  scene.fog = new THREE.FogExp2(0x0a0a1a, 0.005);

  // Skydome background using background.png (with fog disabled so it remains fully visible)
  const skyGeo = new THREE.SphereGeometry(500, 60, 40);
  skyGeo.scale(-1, 1, 1);
  const skyTex = new THREE.TextureLoader(manager).load('/background.png');
  const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, fog: false });
  const skydome = new THREE.Mesh(skyGeo, skyMat);
  scene.add(skydome);


  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  // Start at a default position for a flat world
  camera.position.set(0, 15, 20);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, precision: 'highp' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const appContainer = document.getElementById('app');
  if (appContainer) {
    appContainer.appendChild(renderer.domElement);
  }

  // Low-intensity deep purple ambient light to tint the dark shadows (Brightened for lower hemisphere visibility)
  const ambientLight = new THREE.AmbientLight(0x4a3b75, 0.60);
  scene.add(ambientLight);

  // Hemisphere light representing ambient reflection from purple sky to ground (Brightened ground color)
  const hemiLight = new THREE.HemisphereLight(0x4a3675, 0x2e204a, 0.50);
  hemiLight.position.set(0, 50, 0);
  scene.add(hemiLight);

  // Soft sunset directional light to show shapes in the distance (adjusted to 0.4)
  const dirLight = new THREE.DirectionalLight(0xff9e2c, 0.3);
  //원래 dirLight.position.set(50, 60, 40);
  //dirLight.position.set(0, 60, 0);
  dirLight.castShadow = true;
  dirLight.shadow.camera.top = 80;
  dirLight.shadow.camera.bottom = -80;
  dirLight.shadow.camera.left = -80;
  dirLight.shadow.camera.right = 80;
  dirLight.shadow.camera.near = 0.1;
  dirLight.shadow.camera.far = 250;
  dirLight.shadow.mapSize.width = 2048; // High res shadow for toon shading
  dirLight.shadow.mapSize.height = 2048;
  scene.add(dirLight);

  // Secondary soft cyan rim light for subtle neon outlines (adjusted to 0.3)
  const rimLight = new THREE.DirectionalLight(0x00ffff, 0.25);
  rimLight.position.set(-50, 20, -40);
  scene.add(rimLight);

  // Bottom fill light to illuminate the lower hemisphere of the spherical planet map (Significantly brightened)
  const bottomLight = new THREE.DirectionalLight(0x765fcc, 0.65);
  bottomLight.position.set(0, -60, 0);
  scene.add(bottomLight);

  // Colliders for terrain height and wall collision
  const groundColliders: THREE.Object3D[] = [];
  const wallColliders: { mesh: THREE.Mesh; box: THREE.Box3 }[] = [];

  // Load the 3D Map
  console.log('Loading map_001.glb...');
  const loader = new GLTFLoader(manager);
  loader.load(
    '/map_001.glb',
    (gltf) => {
      const mapModel = gltf.scene;

      // Force matrix world update so geometry world coordinates are accurate
      mapModel.updateMatrixWorld(true);

      // Enable shadow and collect meshes for collider detection
      const mapUniqueNames = new Set<string>();
      mapModel.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const prefix = child.name.split(/[0-9_\-\s]/)[0] || child.name;
          mapUniqueNames.add(prefix);
          child.castShadow = true;
          child.receiveShadow = true;

          const isTree = prefix.toLowerCase() === 'tree' || prefix.toLowerCase() === 'darktree';
          if (!isTree) {
            child.layers.enable(1);
          }

          // Adjust tree materials to MeshBasicMaterial (unlit) for consistent styling
          if (isTree) {
            if (child.material) {
              const convertToBasicMaterial = (mat: THREE.Material): THREE.MeshBasicMaterial => {
                const map = (mat as any).map;
                if (map) {
                  map.magFilter = THREE.NearestFilter;
                  map.minFilter = THREE.NearestFilter;
                  map.needsUpdate = true;
                }
                return new THREE.MeshBasicMaterial({
                  map: map,
                  color: (mat as any).color || new THREE.Color(0xffffff),
                  transparent: true,
                  alphaTest: 0.5,
                  depthWrite: true,
                  side: mat.side
                });
              };

              if (Array.isArray(child.material)) {
                child.material = child.material.map(convertToBasicMaterial);
              } else {
                child.material = convertToBasicMaterial(child.material);
              }
            }
          }

          const nameLower = child.name.toLowerCase();
          if (nameLower.includes('ground')) {
            groundColliders.push(child);
          } else if (nameLower.includes('wall')) {
            // Compute precise bounding box in world coordinates
            child.geometry.computeBoundingBox();
            if (child.geometry.boundingBox) {
              const box = new THREE.Box3().copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
              wallColliders.push({ mesh: child, box });
            }
          }
        }
      });

      scene.add(mapModel);
      console.log(`map_001.glb loaded successfully. Ground: ${groundColliders.length} meshes, Wall: ${wallColliders.length} meshes`);
      console.log('map_001.glb Unique Mesh Name Prefixes:', JSON.stringify(Array.from(mapUniqueNames)));
    },
    (xhr) => {
      if (xhr.total > 0) {
        console.log(`Map loading progress: ${(xhr.loaded / xhr.total * 100).toFixed(2)}%`);
      }
    },
    (error) => {
      console.error('Error loading map_001.glb:', error);
    }
  );
  // Load the Props (Rocks, Pipes, etc.)
  console.log('Loading prop.glb...');
  loader.load(
    '/prop.glb',
    (gltf) => {
      const propModel = gltf.scene;

      // Force matrix world update so geometry world coordinates are accurate
      propModel.updateMatrixWorld(true);

      // Enable shadow and collect all meshes in prop.glb for wall collision
      const propUniqueNames = new Set<string>();
      propModel.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const prefix = child.name.split(/[0-9_\-\s]/)[0] || child.name;
          propUniqueNames.add(prefix);
          child.castShadow = true;
          child.receiveShadow = true;

          const isTree = prefix.toLowerCase() === 'tree' || prefix.toLowerCase() === 'darktree';
          if (!isTree) {
            child.layers.enable(1);
          }

          // Adjust tree materials to MeshBasicMaterial (unlit) for consistent styling
          if (isTree) {
            if (child.material) {
              const convertToBasicMaterial = (mat: THREE.Material): THREE.MeshBasicMaterial => {
                const map = (mat as any).map;
                if (map) {
                  map.magFilter = THREE.NearestFilter;
                  map.minFilter = THREE.NearestFilter;
                  map.needsUpdate = true;
                }
                return new THREE.MeshBasicMaterial({
                  map: map,
                  color: (mat as any).color || new THREE.Color(0xffffff),
                  transparent: true,
                  alphaTest: 0.5,
                  depthWrite: true,
                  side: mat.side
                });
              };

              if (Array.isArray(child.material)) {
                child.material = child.material.map(convertToBasicMaterial);
              } else {
                child.material = convertToBasicMaterial(child.material);
              }
            }
          }

          // Calculate precise bounding box in world coordinates for collision
          child.geometry.computeBoundingBox();
          if (child.geometry.boundingBox) {
            const box = new THREE.Box3().copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
            wallColliders.push({ mesh: child, box });
          }
        }
      });

      scene.add(propModel);
      console.log(`prop.glb loaded successfully. Wall meshes added to colliders.`);
      console.log('prop.glb Unique Mesh Name Prefixes:', JSON.stringify(Array.from(propUniqueNames)));
    },
    (xhr) => {
      if (xhr.total > 0) {
        console.log(`Props loading progress: ${(xhr.loaded / xhr.total * 100).toFixed(2)}%`);
      }
    },
    (error) => {
      console.error('Error loading prop.glb:', error);
    }
  );



  // Resize handler
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
  });

  return { scene, renderer, camera, groundColliders, wallColliders };
}
