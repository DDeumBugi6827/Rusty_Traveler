import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// Add BVH extension methods to Three.js prototypes
(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

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

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, precision: 'mediump' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
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
  dirLight.position.set(50, 60, 40);
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
  const bottomLight = new THREE.DirectionalLight(0x4a3b75, 0.65);
  bottomLight.position.set(0, -60, 0);
  scene.add(bottomLight);

  // Colliders for terrain height and wall collision
  const groundColliders: THREE.Object3D[] = [];
  const wallColliders: THREE.Mesh[] = [];

  // Load the 3D Map (map_001.glb)
  console.log('Loading map_001.glb...');
  const loader = new GLTFLoader(manager);
  loader.load(
    '/map_001.glb',
    (gltf) => {
      const mapModel = gltf.scene;
      mapModel.updateMatrixWorld(true);

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
                  transparent: false,
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
          } else if (child.material) {
            const adjustTransparentMaterial = (mat: THREE.Material) => {
              if (mat) {
                if ((mat as any).transparent || (mat as any).opacity < 1.0 || (mat as any).alphaMap) {
                  mat.depthWrite = true;
                  mat.depthTest = true;
                  (mat as any).transparent = false;
                  if ((mat as any).alphaTest === 0) {
                    (mat as any).alphaTest = 0.5;
                  }
                }
              }
            };
            if (Array.isArray(child.material)) {
              child.material.forEach(adjustTransparentMaterial);
            } else {
              adjustTransparentMaterial(child.material);
            }
          }

          const nameLower = child.name.toLowerCase();
          if (nameLower.includes('ground')) {
            // Compute BVH bounds tree for fast raycasting and ground locking
            (child.geometry as any).computeBoundsTree();
            groundColliders.push(child);
          }
        }
      });

      scene.add(mapModel);
      console.log(`map_001.glb loaded successfully. Ground: ${groundColliders.length} meshes`);
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

  // Load the Collision Mesh (collision_mesh.glb) for wall collision (invisible)
  console.log('Loading collision_mesh.glb...');
  loader.load(
    '/collision_mesh.glb',
    (gltf) => {
      const collisionModel = gltf.scene;
      collisionModel.updateMatrixWorld(true);

      collisionModel.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          // Hide visual representation
          child.visible = false;

          // Compute BVH bounds tree
          (child.geometry as any).computeBoundsTree();

          // Push directly to wallColliders (which is now THREE.Mesh[])
          wallColliders.push(child);
        }
      });

      scene.add(collisionModel);
      console.log(`collision_mesh.glb loaded successfully. Wall colliders: ${wallColliders.length}`);
    },
    (xhr) => {
      if (xhr.total > 0) {
        console.log(`Collision mesh loading progress: ${(xhr.loaded / xhr.total * 100).toFixed(2)}%`);
      }
    },
    (error) => {
      console.error('Error loading collision_mesh.glb:', error);
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

      const propUniqueNames = new Set<string>();

      // Cache converted materials to reuse them and keep groupings consistent
      const materialCache = new Map<THREE.Material, THREE.Material>();
      const convertToBasicMaterial = (mat: THREE.Material): THREE.Material => {
        if (materialCache.has(mat)) {
          return materialCache.get(mat)!;
        }
        const map = (mat as any).map;
        if (map) {
          map.magFilter = THREE.NearestFilter;
          map.minFilter = THREE.NearestFilter;
          map.needsUpdate = true;
        }
        const newMat = new THREE.MeshBasicMaterial({
          map: map,
          color: (mat as any).color || new THREE.Color(0xffffff),
          transparent: false,
          alphaTest: 0.5,
          depthWrite: true,
          side: mat.side
        });
        materialCache.set(mat, newMat);
        return newMat;
      };

      // Define grouping interface
      interface InstancedGroup {
        geometry: THREE.BufferGeometry;
        material: THREE.Material | THREE.Material[];
        isTree: boolean;
        matrices: THREE.Matrix4[];
      }

      const groups = new Map<string, InstancedGroup>();

      propModel.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const prefix = child.name.split(/[0-9_\-\s]/)[0] || child.name;
          propUniqueNames.add(prefix);

          const isTree = prefix.toLowerCase() === 'tree' || prefix.toLowerCase() === 'darktree';

          let finalMaterial: THREE.Material | THREE.Material[] = child.material;
          if (isTree && child.material) {
            if (Array.isArray(child.material)) {
              finalMaterial = child.material.map(convertToBasicMaterial);
            } else {
              finalMaterial = convertToBasicMaterial(child.material);
            }
          } else if (child.material) {
            const adjustTransparentMaterial = (mat: THREE.Material) => {
              if (mat) {
                if ((mat as any).transparent || (mat as any).opacity < 1.0 || (mat as any).alphaMap) {
                  mat.depthWrite = true;
                  mat.depthTest = true;
                  (mat as any).transparent = false;
                  if ((mat as any).alphaTest === 0) {
                    (mat as any).alphaTest = 0.5;
                  }
                }
              }
            };
            if (Array.isArray(child.material)) {
              child.material.forEach(adjustTransparentMaterial);
            } else {
              adjustTransparentMaterial(child.material);
            }
          }

          // Generate key based on geometry UUID and material UUID(s)
          const getMatKey = (mat: THREE.Material | THREE.Material[]): string => {
            if (Array.isArray(mat)) {
              return mat.map(m => m.uuid).join(',');
            }
            return mat ? mat.uuid : 'no-material';
          };
          const key = `${child.geometry.uuid}_${getMatKey(finalMaterial)}`;

          let group = groups.get(key);
          if (!group) {
            group = {
              geometry: child.geometry,
              material: finalMaterial,
              isTree: isTree,
              matrices: []
            };
            groups.set(key, group);
          }

          // Handle already instanced meshes (from EXT_mesh_gpu_instancing)
          if ((child as any).isInstancedMesh) {
            const instancedChild = child as THREE.InstancedMesh;
            const tempMatrix = new THREE.Matrix4();
            console.log(`[Instancing] Found InstancedMesh child "${child.name}" with ${instancedChild.count} instances.`);
            for (let i = 0; i < instancedChild.count; i++) {
              instancedChild.getMatrixAt(i, tempMatrix);
              // Multiply by child's matrixWorld to put instances in the absolute world coordinates
              const worldMatrix = tempMatrix.clone().premultiply(child.matrixWorld);
              group.matrices.push(worldMatrix);
            }
          } else {
            group.matrices.push(child.matrixWorld.clone());
          }
        }
      });

      // Instantiate InstancedMesh for each group and add to the scene
      groups.forEach((group) => {
        const instancedMesh = new THREE.InstancedMesh(
          group.geometry,
          group.material as any,
          group.matrices.length
        );

        instancedMesh.castShadow = true;
        instancedMesh.receiveShadow = true;

        for (let i = 0; i < group.matrices.length; i++) {
          instancedMesh.setMatrixAt(i, group.matrices[i]);
        }

        // Upload instance matrices to GPU
        instancedMesh.instanceMatrix.needsUpdate = true;

        // Maintain layer 1 configuration for outline shader/effect if not tree
        if (!group.isTree) {
          instancedMesh.layers.enable(1);
        }

        scene.add(instancedMesh);
      });

      console.log(`prop.glb loaded and instanced successfully. Total groups: ${groups.size}`);
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  });

  return { scene, renderer, camera, groundColliders, wallColliders };
}
