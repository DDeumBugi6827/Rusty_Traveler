import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export function createScene() {
  const scene = new THREE.Scene();
  // Dark atmospheric space-black night sky
  scene.background = new THREE.Color(0x0a0a1a);
  scene.fog = new THREE.FogExp2(0x0a0a1a, 0.005);

  // Skydome background using background.png (with fog disabled so it remains fully visible)
  const skyGeo = new THREE.SphereGeometry(500, 60, 40);
  skyGeo.scale(-1, 1, 1);
  const skyTex = new THREE.TextureLoader().load('/background.png');
  const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, fog: false });
  const skydome = new THREE.Mesh(skyGeo, skyMat);
  scene.add(skydome);


  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  // Start at a default position for a flat world
  camera.position.set(0, 15, 20);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, precision: 'highp' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  const appContainer = document.getElementById('app');
  if (appContainer) {
    appContainer.appendChild(renderer.domElement);
  }

  // Post-apocalyptic dark atmospheric lighting (adjusted for flashlight exploration visibility)
  // Low-intensity deep purple ambient light to tint the dark shadows (adjusted to 0.2)
  const ambientLight = new THREE.AmbientLight(0x2c204d, 0.5);
  scene.add(ambientLight);

  // Hemisphere light representing ambient reflection from purple sky to ground (adjusted to 0.2)
  const hemiLight = new THREE.HemisphereLight(0x4a3675, 0x18122b, 0.5);
  hemiLight.position.set(0, 50, 0);
  scene.add(hemiLight);

  // Soft sunset directional light to show shapes in the distance (adjusted to 0.4)
  const dirLight = new THREE.DirectionalLight(0xff9e2c, 0.4);
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
  const rimLight = new THREE.DirectionalLight(0x00ffff, 0.3);
  rimLight.position.set(-50, 20, -40);
  scene.add(rimLight);

  // Colliders for terrain height and wall collision
  const groundColliders: THREE.Object3D[] = [];
  const wallColliders: { mesh: THREE.Mesh; box: THREE.Box3 }[] = [];

  // Load the 3D Map
  console.log('Loading map_001.glb...');
  const loader = new GLTFLoader();
  loader.load(
    '/map_001.glb',
    (gltf) => {
      const mapModel = gltf.scene;

      // Force matrix world update so geometry world coordinates are accurate
      mapModel.updateMatrixWorld(true);

      // Enable shadow and collect meshes for collider detection
      mapModel.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;

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
      propModel.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          
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
  });

  return { scene, renderer, camera, groundColliders, wallColliders };
}
