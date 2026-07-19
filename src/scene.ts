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
  // Warm atmospheric sunset/dust fog
  scene.background = new THREE.Color(0x8c3f2d);
  scene.fog = new THREE.FogExp2(0x8c3f2d, 0.006);

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

  const isMobile = window.innerWidth <= 768 || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  const targetHeight = isMobile ? 240 : 240;
  const initialAspect = window.innerWidth / window.innerHeight;
  const initialWidth = Math.round(targetHeight * initialAspect);

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, precision: 'mediump' });
  renderer.setSize(initialWidth, targetHeight, false);
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.6;

  const appContainer = document.getElementById('app');
  if (appContainer) {
    appContainer.appendChild(renderer.domElement);
  }

  //환경광 진보라빛 전역조명 (그림자 명암 강화를 위해 강도 대폭 감소)
  const ambientLight = new THREE.AmbientLight(0x4a3b75, 0.20);
  scene.add(ambientLight);

  // Hemisphere light representing ambient reflection from purple sky to ground (Toned down)
  const hemiLight = new THREE.HemisphereLight(0x280d4f, 0x280d4f, 0.20);
  hemiLight.position.set(0, 50, 0);
  scene.add(hemiLight);

  // Soft sunset directional light to show shapes in the distance (Increased intensity to make shadows stronger by comparison)
  const dirLight = new THREE.DirectionalLight(0xff7e33, 1.30); // 따뜻한 우윳빛 주 조명
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
  dirLight.shadow.bias = -0.0005; // Prevent shadow acne depth fight
  dirLight.shadow.normalBias = 0.03; // Shift shadow map sample coordinates slightly along normal to prevent self-shadowing on hills
  scene.add(dirLight);
  scene.add(dirLight.target);

  // Secondary soft cyan rim light for subtle neon outlines (adjusted to 0.15)
  const rimLight = new THREE.DirectionalLight(0x00ffff, 0.15);
  rimLight.position.set(-50, 20, -40);
  scene.add(rimLight);

  // Bottom fill light to illuminate the lower hemisphere of the spherical planet map (Reduced to avoid washing out shadows)
  const bottomLight = new THREE.DirectionalLight(0x4a3b75, 0.10);
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
            const adjustMaterial = (mat: THREE.Material) => {
              if (mat) {
                // Nearest filtering for pixelated retro texture look
                const map = (mat as any).map;
                if (map) {
                  map.magFilter = THREE.NearestFilter;
                  map.minFilter = THREE.NearestFilter;
                  map.needsUpdate = true;
                }
                const roughnessMap = (mat as any).roughnessMap;
                if (roughnessMap) {
                  roughnessMap.magFilter = THREE.NearestFilter;
                  roughnessMap.minFilter = THREE.NearestFilter;
                  roughnessMap.needsUpdate = true;
                }
                const metalnessMap = (mat as any).metalnessMap;
                if (metalnessMap) {
                  metalnessMap.magFilter = THREE.NearestFilter;
                  metalnessMap.minFilter = THREE.NearestFilter;
                  metalnessMap.needsUpdate = true;
                }
                const normalMap = (mat as any).normalMap;
                if (normalMap) {
                  normalMap.magFilter = THREE.NearestFilter;
                  normalMap.minFilter = THREE.NearestFilter;
                  normalMap.needsUpdate = true;
                }
                if ((mat as any).transparent || (mat as any).opacity < 1.0 || (mat as any).alphaMap) {
                  mat.depthWrite = true;
                  mat.depthTest = true;
                  (mat as any).transparent = false;
                  if ((mat as any).alphaTest === 0) {
                    (mat as any).alphaTest = 0.5;
                  }
                }
                if ('envMapIntensity' in mat) {
                  (mat as any).envMapIntensity = 0.4;
                }
              }
            };
            if (Array.isArray(child.material)) {
              child.material.forEach(adjustMaterial);
            } else {
              adjustMaterial(child.material);
            }
          }

          const nameLower = child.name.toLowerCase();
          if (nameLower.includes('ground')) {
            // Compute BVH bounds tree for fast raycasting and ground locking
            (child.geometry as any).computeBoundsTree();
            groundColliders.push(child);

            // Apply mipmapping and anisotropy to ground textures to fix shimmering
            if (child.material) {
              const adjustGroundMaterial = (mat: THREE.Material) => {
                if (mat) {
                  const map = (mat as any).map;
                  if (map) {
                    map.minFilter = THREE.NearestMipmapLinearFilter;
                    map.magFilter = THREE.NearestFilter;
                    map.generateMipmaps = true;
                    map.anisotropy = renderer.capabilities.getMaxAnisotropy();
                    map.needsUpdate = true;
                  }
                  const roughnessMap = (mat as any).roughnessMap;
                  if (roughnessMap) {
                    roughnessMap.minFilter = THREE.NearestMipmapLinearFilter;
                    roughnessMap.magFilter = THREE.NearestFilter;
                    roughnessMap.generateMipmaps = true;
                    roughnessMap.anisotropy = renderer.capabilities.getMaxAnisotropy();
                    roughnessMap.needsUpdate = true;
                  }
                  const metalnessMap = (mat as any).metalnessMap;
                  if (metalnessMap) {
                    metalnessMap.minFilter = THREE.NearestMipmapLinearFilter;
                    metalnessMap.magFilter = THREE.NearestFilter;
                    metalnessMap.generateMipmaps = true;
                    metalnessMap.anisotropy = renderer.capabilities.getMaxAnisotropy();
                    metalnessMap.needsUpdate = true;
                  }
                  const normalMap = (mat as any).normalMap;
                  if (normalMap) {
                    normalMap.minFilter = THREE.NearestMipmapLinearFilter;
                    normalMap.magFilter = THREE.NearestFilter;
                    normalMap.generateMipmaps = true;
                    normalMap.anisotropy = renderer.capabilities.getMaxAnisotropy();
                    normalMap.needsUpdate = true;
                  }
                }
              };
              if (Array.isArray(child.material)) {
                child.material.forEach(adjustGroundMaterial);
              } else {
                adjustGroundMaterial(child.material);
              }
            }
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
            const adjustMaterial = (mat: THREE.Material) => {
              if (mat) {
                const map = (mat as any).map;
                if (map) {
                  map.magFilter = THREE.NearestFilter;
                  map.minFilter = THREE.NearestFilter;
                  map.needsUpdate = true;
                }
                const roughnessMap = (mat as any).roughnessMap;
                if (roughnessMap) {
                  roughnessMap.magFilter = THREE.NearestFilter;
                  roughnessMap.minFilter = THREE.NearestFilter;
                  roughnessMap.needsUpdate = true;
                }
                const metalnessMap = (mat as any).metalnessMap;
                if (metalnessMap) {
                  metalnessMap.magFilter = THREE.NearestFilter;
                  metalnessMap.minFilter = THREE.NearestFilter;
                  metalnessMap.needsUpdate = true;
                }
                const normalMap = (mat as any).normalMap;
                if (normalMap) {
                  normalMap.magFilter = THREE.NearestFilter;
                  normalMap.minFilter = THREE.NearestFilter;
                  normalMap.needsUpdate = true;
                }
                if ((mat as any).transparent || (mat as any).opacity < 1.0 || (mat as any).alphaMap) {
                  mat.depthWrite = true;
                  mat.depthTest = true;
                  (mat as any).transparent = false;
                  if ((mat as any).alphaTest === 0) {
                    (mat as any).alphaTest = 0.5;
                  }
                }
                if ('envMapIntensity' in mat) {
                  (mat as any).envMapIntensity = 0.4;
                }
              }
            };
            if (Array.isArray(child.material)) {
              child.material.forEach(adjustMaterial);
            } else {
              adjustMaterial(child.material);
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
    const isMobile = window.innerWidth <= 768 || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    const targetHeight = isMobile ? 120 : 180;
    const aspect = window.innerWidth / window.innerHeight;
    const targetWidth = Math.round(targetHeight * aspect);

    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    renderer.setSize(targetWidth, targetHeight, false);
    renderer.setPixelRatio(1);
  });

  return { scene, renderer, camera, groundColliders, wallColliders, dirLight, hemiLight };
}
