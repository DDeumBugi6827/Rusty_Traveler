import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { WebSocketNetwork, Position } from './network';

// Player Dimensions Configuration
const PLAYER_HEIGHT = 1.0;
const PLAYER_COLLIDER_RADIUS = 0.35;

// Toon shading 3-step gradient map for players via canvas (highly compatible)
const canvasGradient = document.createElement('canvas');
canvasGradient.width = 3;
canvasGradient.height = 1;
const ctxGradient = canvasGradient.getContext('2d');
if (ctxGradient) {
  ctxGradient.fillStyle = '#000000'; // Dark shadow
  ctxGradient.fillRect(0, 0, 1, 1);
  ctxGradient.fillStyle = '#787878'; // Mid shadow
  ctxGradient.fillRect(1, 0, 1, 1);
  ctxGradient.fillStyle = '#ffffff'; // Light
  ctxGradient.fillRect(2, 0, 1, 1);
}
const toonGradient = new THREE.CanvasTexture(canvasGradient);
toonGradient.minFilter = THREE.NearestFilter;
toonGradient.magFilter = THREE.NearestFilter;

export function createEmojiSprite(emoji: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Sprite();

  ctx.font = '72px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 64, 64);

  const texture = new THREE.CanvasTexture(canvas);
  const spriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false, // Make emojis render on top
  });
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.scale.set(0.6, 0.6, 1);
  return sprite;
}

interface FloatingEmoji {
  sprite: THREE.Sprite;
  life: number; // 0 to 1
  speedY: number;
  speedX: number;
}

export class LocalPlayer {
  public group: THREE.Group;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private network: WebSocketNetwork;
  private keys: Record<string, boolean> = {};
  private joystickInput = { x: 0, y: 0 };

  public speed = 0.05; // Set to a very slow, atmospheric walking speed
  private lastSentTime = 0;
  private floatingEmojis: FloatingEmoji[] = [];

  private yawAngle = 0;
  private groundColliders: THREE.Object3D[];
  private wallColliders: { mesh: THREE.Mesh; box: THREE.Box3 }[];
  private raycaster = new THREE.Raycaster();
  private groundNormal = new THREE.Vector3(0, 1, 0);
  private targetNormal = new THREE.Vector3(0, 1, 0);
  private smoothedLookAt = new THREE.Vector3();
  private isFirstUpdate = true;

  // GLB Model & Animation Properties
  private placeholder: THREE.Mesh;
  private visorPlaceholder: THREE.Mesh;
  private model: THREE.Group | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private clock = new THREE.Clock();
  private walkAction: THREE.AnimationAction | null = null;
  private idleAction: THREE.AnimationAction | null = null;
  private isDestroyed = false;
  private modelRotationY = 0; // Face forward (+Z)

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    network: WebSocketNetwork,
    id: string,
    groundColliders: THREE.Object3D[],
    wallColliders: { mesh: THREE.Mesh; box: THREE.Box3 }[],
    onModelLoaded?: () => void
  ) {
    this.scene = scene;
    this.camera = camera;
    this.network = network;
    this.groundColliders = groundColliders;
    this.wallColliders = wallColliders;

    this.group = new THREE.Group();
    // Spawn at a default position initially
    this.group.position.set(0, 10, 0);

    // Create a sleek player mesh (Futuristic capsule bot)
    const bodyGeo = new THREE.CylinderGeometry(PLAYER_COLLIDER_RADIUS * 0.7, PLAYER_COLLIDER_RADIUS * 0.7, PLAYER_HEIGHT * 0.8, 16);
    const bodyMat = new THREE.MeshToonMaterial({
      color: 0x38bdf8,
      gradientMap: toonGradient
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = (PLAYER_HEIGHT * 0.8) / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);
    this.placeholder = body;

    // Visor/eyes (glowing emission)
    const visorGeo = new THREE.BoxGeometry(0.45 * (PLAYER_HEIGHT / 1.5), 0.15 * (PLAYER_HEIGHT / 1.5), 0.3 * (PLAYER_HEIGHT / 1.5));
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x00f3ff,
      emissive: 0x00f3ff,
      emissiveIntensity: 1.5,
    });
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 1.25 * (PLAYER_HEIGHT / 1.5), 0.2 * (PLAYER_HEIGHT / 1.5));
    this.group.add(visor);
    this.visorPlaceholder = visor;

    // Flashlight SpotLight setup for LocalPlayer (White, eye-level, positioned slightly forward to prevent self-shadowing)
    const flashlight = new THREE.SpotLight(0xffffff, 15, 25, Math.PI / 6, 0.5, 1.0);
    flashlight.position.set(0, 1.25 * (PLAYER_HEIGHT / 1.5), 0.35 * (PLAYER_HEIGHT / 1.5));
    flashlight.target.position.set(0, 1.25 * (PLAYER_HEIGHT / 1.5), 5);
    flashlight.castShadow = true;
    flashlight.shadow.bias = -0.002;
    flashlight.shadow.mapSize.width = 512;
    flashlight.shadow.mapSize.height = 512;
    this.group.add(flashlight);
    this.group.add(flashlight.target);

    // Asynchronous GLB model load
    const loader = new GLTFLoader();
    loader.load(
      '/knownbot.glb',
      (gltf) => {
        if (this.isDestroyed) {
          gltf.scene.traverse((node) => {
            if (node instanceof THREE.Mesh) {
              node.geometry.dispose();
              if (Array.isArray(node.material)) {
                node.material.forEach((m) => m.dispose());
              } else {
                node.material.dispose();
              }
            }
          });
          return;
        }

        gltf.scene.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });

        this.model = gltf.scene;

        // Auto-scale and ground the model
        const box = new THREE.Box3().setFromObject(this.model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        const targetHeight = PLAYER_HEIGHT;
        const scale = targetHeight / (size.y || 1);
        this.model.scale.set(scale, scale, scale);

        // Position model: origin is at the feet and centered
        this.model.position.y = 0;
        this.model.position.x = 0;
        this.model.position.z = 0;
        this.model.rotation.y = this.modelRotationY;

        // Setup Animation
        this.mixer = new THREE.AnimationMixer(this.model);
        gltf.animations.forEach((clip) => {
          console.log(`LocalPlayer: Found animation "${clip.name}"`);
          const nameLower = clip.name.toLowerCase();
          if (nameLower.includes('walk')) {
            this.walkAction = this.mixer!.clipAction(clip);
          } else if (nameLower.includes('idle') || nameLower.includes('idel')) {
            this.idleAction = this.mixer!.clipAction(clip);
          }
        });

        // Fallback walking animation
        if (!this.walkAction && gltf.animations.length > 0) {
          this.walkAction = this.mixer.clipAction(gltf.animations[0]);
        }

        // Swap out placeholder mesh
        this.group.remove(this.placeholder);
        this.group.remove(this.visorPlaceholder);
        this.placeholder.geometry.dispose();
        if (Array.isArray(this.placeholder.material)) {
          this.placeholder.material.forEach((m) => m.dispose());
        } else {
          this.placeholder.material.dispose();
        }
        this.visorPlaceholder.geometry.dispose();
        if (Array.isArray(this.visorPlaceholder.material)) {
          this.visorPlaceholder.material.forEach((m) => m.dispose());
        } else {
          this.visorPlaceholder.material.dispose();
        }

        this.group.add(this.model);

        if (this.idleAction) {
          this.idleAction.play();
        }

        if (onModelLoaded) {
          onModelLoaded();
        }
      },
      undefined,
      (error) => {
        console.error('Error loading knownbot.glb for LocalPlayer:', error);
      }
    );

    // Nametag removed per user request
    // const nametag = createNametagSprite('You', true);
    // nametag.position.y = 1.6;
    // this.group.add(nametag);

    this.scene.add(this.group);

    // Keyboard bindings
    window.addEventListener('keydown', (e) => {
      this.keys[e.key.toLowerCase()] = true;
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });

    // Touch Joystick bindings
    const joystickBase = document.getElementById('joystick-base');
    const joystickKnob = document.getElementById('joystick-knob');
    if (joystickBase && joystickKnob) {
      let isDragging = false;
      let startX = 0;
      let startY = 0;
      const maxRadius = 40; // Max drag radius in pixels

      const handleStart = (e: TouchEvent) => {
        isDragging = true;
        const rect = joystickBase.getBoundingClientRect();
        startX = rect.left + rect.width / 2;
        startY = rect.top + rect.height / 2;
        e.preventDefault();
      };

      const handleMove = (e: TouchEvent) => {
        if (!isDragging) return;
        const touch = e.touches[0];
        let dx = touch.clientX - startX;
        let dy = touch.clientY - startY;

        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > maxRadius) {
          dx = (dx / distance) * maxRadius;
          dy = (dy / distance) * maxRadius;
        }

        // Visual position of the knob
        joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

        // Normalize inputs
        this.joystickInput.x = dx / maxRadius;
        this.joystickInput.y = -dy / maxRadius; // Invert Y so up is positive
        e.preventDefault();
      };

      const handleEnd = () => {
        isDragging = false;
        joystickKnob.style.transform = `translate(-50%, -50%)`;
        this.joystickInput.x = 0;
        this.joystickInput.y = 0;
      };

      joystickBase.addEventListener('touchstart', handleStart, { passive: false });
      window.addEventListener('touchmove', handleMove, { passive: false });
      window.addEventListener('touchend', handleEnd);
    }
  }

  public spawnEmoji(emoji: string) {
    const sprite = createEmojiSprite(emoji);
    sprite.position.set(
      (Math.random() - 0.5) * 0.2,
      PLAYER_HEIGHT * 1.2,
      (Math.random() - 0.5) * 0.2
    );
    this.group.add(sprite);

    this.floatingEmojis.push({
      sprite,
      life: 1.0,
      speedY: 0.02 + Math.random() * 0.015,
      speedX: (Math.random() - 0.5) * 0.01,
    });
  }

  public update() {
    const prevPos = this.group.position.clone();
    // 1. Rotation (Yaw): A/D or Left/Right arrows rotate the character around their local Y axis
    const rotationSpeed = 0.045;
    if (this.keys['a'] || this.keys['arrowleft']) {
      this.yawAngle += rotationSpeed;
    }
    if (this.keys['d'] || this.keys['arrowright']) {
      this.yawAngle -= rotationSpeed;
    }
    // Apply joystick rotation: x-axis controls turn
    this.yawAngle -= this.joystickInput.x * rotationSpeed * 1.2;

    // 2. Movement along the flat plane: W/S or Up/Down arrows + Joystick Y-axis
    let step = 0;
    if (this.keys['w'] || this.keys['arrowup']) {
      step += this.speed;
    }
    if (this.keys['s'] || this.keys['arrowdown']) {
      step -= this.speed;
    }
    // Add joystick forward/backward speed
    step += this.joystickInput.y * this.speed;

    // Apply rotation and normal alignment
    const qNormal = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.groundNormal);
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yawAngle);
    this.group.quaternion.copy(qNormal).multiply(qYaw);

    // Compute tangent forward direction in world space (aligned with model facing local +Z)
    const localForward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.group.quaternion).normalize();

    // 2.3 Wall Collision & Sliding Physics (Raycast-based for spherical compatibility)
    let canMove = true;
    if (Math.abs(step) > 0.0001 && this.wallColliders && this.wallColliders.length > 0) {
      const playerRadius = PLAYER_COLLIDER_RADIUS;
      const playerHeight = PLAYER_HEIGHT;
      const moveVec = localForward.clone().multiplyScalar(step);

      // Ray origin is at the center of the player's height along localUp
      const localUp = this.groundNormal.clone().normalize();
      const rayOrigin = this.group.position.clone().addScaledVector(localUp, playerHeight * 0.5);
      const rayDir = moveVec.clone().normalize();

      // Collect all wall meshes for raycasting
      const wallMeshes = this.wallColliders.map(w => w.mesh);

      this.raycaster.set(rayOrigin, rayDir);
      // Limit far distance to playerRadius + step size
      this.raycaster.far = playerRadius + Math.abs(step);
      
      const intersects = this.raycaster.intersectObjects(wallMeshes, true);

      if (intersects.length > 0) {
        const hit = intersects[0];
        if (hit.face) {
          const normal = hit.face.normal.clone();
          if (hit.object) {
            normal.transformDirection(hit.object.matrixWorld);
          }

          if (moveVec.dot(normal) < 0) {
            // Project movement onto the wall plane: slideVec = moveVec - (moveVec . normal) * normal
            const slideVec = moveVec.clone().sub(normal.multiplyScalar(moveVec.dot(normal)));
            if (slideVec.lengthSq() > 0.0001) {
              // Verify if the sliding direction also hits a wall within playerRadius
              const slideRayDir = slideVec.clone().normalize();
              this.raycaster.set(rayOrigin, slideRayDir);
              this.raycaster.far = playerRadius;
              
              const slideIntersects = this.raycaster.intersectObjects(wallMeshes, true);
              if (slideIntersects.length === 0) {
                // Safe to slide!
                this.group.position.add(slideVec);
                canMove = false;
              }
            }
          }

          if (canMove) {
            canMove = false; // Blocked
          }
        }
      }
      this.raycaster.far = Infinity; // Reset raycaster.far
    }

    if (canMove) {
      this.group.position.addScaledVector(localForward, step);
    }

    // Snap to ground using Raycaster along localUp in world space
    if (this.groundColliders && this.groundColliders.length > 0) {
      const localUp = this.groundNormal.clone().normalize();
      // Start raycast from 1.0 unit above the player's current position to avoid hitting high ceilings/ledges
      const rayOrigin = this.group.position.clone().addScaledVector(localUp, 1.0);
      const rayDirection = localUp.clone().negate();

      this.raycaster.set(rayOrigin, rayDirection);
      const intersects = this.raycaster.intersectObjects(this.groundColliders, true);
      
      let groundHit: THREE.Intersection | null = null;
      let groundNormal = new THREE.Vector3();

      for (const hit of intersects) {
        if (hit.face && hit.object) {
          const worldNormal = hit.face.normal.clone();
          worldNormal.transformDirection(hit.object.matrixWorld);
          
          // Check if this face is flat enough to be ground relative to our current normal
          const dot = worldNormal.dot(localUp);
          if (dot >= 0.707) { // Slope angle <= 45 degrees
            groundHit = hit;
            groundNormal.copy(worldNormal);
            break; // Found the closest valid ground!
          }
        }
      }

      if (groundHit) {
        // Safe to snap and update our target normal
        this.targetNormal.copy(groundNormal);
        this.group.position.copy(groundHit.point);
      } else {
        // If we hit a wall/slope too steep to climb, revert position
        this.group.position.copy(prevPos);
      }
    } else {
      this.group.position.y = 0;
      this.targetNormal.set(0, 1, 0);
    }

    // Smoothly interpolate the ground normal
    this.groundNormal.lerp(this.targetNormal, 0.015);
    this.groundNormal.normalize();

    // 3. Smooth 3rd-person follow camera tracking in spherical space
    const followDistance = 4.5;
    const followHeight = 2.6;

    // Ideal camera position behind player (along -localForward) and above player
    const localUp = this.groundNormal.clone().normalize();
    const targetCamPos = this.group.position.clone()
      .addScaledVector(localForward, -followDistance)
      .addScaledVector(localUp, followHeight);

    // Camera looks at the player (slightly offset up along ground normal)
    const targetLookAt = this.group.position.clone().addScaledVector(localUp, PLAYER_HEIGHT * (1.0 / 1.5));

    if (this.isFirstUpdate) {
      this.smoothedLookAt.copy(targetLookAt);
      this.camera.position.copy(targetCamPos);
      this.camera.up.copy(localUp);
      this.isFirstUpdate = false;
    } else {
      // Lerp camera position slowly for extra smoothness over bumpy terrain
      this.camera.position.lerp(targetCamPos, 0.04);

      // Keep camera up vector aligned to ground normal with smooth lerp
      this.camera.up.lerp(localUp, 0.03);
      this.camera.up.normalize();

      // Lerp look-at point slowly to prevent camera jerking on height snaps
      this.smoothedLookAt.lerp(targetLookAt, 0.04);
    }

    this.camera.lookAt(this.smoothedLookAt);

    // Network update rate control (10Hz)
    const now = performance.now();
    if (now - this.lastSentTime > 100) {
      this.network.sendState({
        x: this.group.position.x,
        y: this.group.position.y,
        z: this.group.position.z,
      });
      this.lastSentTime = now;
    }

    // Emojis update
    for (let i = this.floatingEmojis.length - 1; i >= 0; i--) {
      const fe = this.floatingEmojis[i];
      fe.life -= 0.015;
      fe.sprite.position.y += fe.speedY;
      fe.sprite.position.x += fe.speedX;

      if (Array.isArray(fe.sprite.material)) {
        fe.sprite.material.forEach(m => m.opacity = fe.life);
      } else {
        fe.sprite.material.opacity = fe.life;
      }

      if (fe.life <= 0) {
        this.group.remove(fe.sprite);
        fe.sprite.geometry.dispose();
        if (Array.isArray(fe.sprite.material)) {
          fe.sprite.material.forEach(m => m.dispose());
        } else {
          fe.sprite.material.dispose();
        }
        this.floatingEmojis.splice(i, 1);
      }
    }

    // Update mixer and handle animations
    const deltaTime = this.clock.getDelta();
    if (this.mixer) {
      this.mixer.update(deltaTime);

      const isInputActive =
        this.keys['w'] || this.keys['arrowup'] ||
        this.keys['s'] || this.keys['arrowdown'] ||
        this.keys['a'] || this.keys['arrowleft'] ||
        this.keys['d'] || this.keys['arrowright'] ||
        Math.abs(this.joystickInput.x) > 0.01 ||
        Math.abs(this.joystickInput.y) > 0.01;

      if (isInputActive) {
        if (this.walkAction && !this.walkAction.isRunning()) {
          if (this.idleAction && this.idleAction.isRunning()) {
            this.idleAction.fadeOut(0.25);
          }
          this.walkAction.reset().fadeIn(0.25).play();
        }
      } else {
        if (this.idleAction && !this.idleAction.isRunning()) {
          if (this.walkAction && this.walkAction.isRunning()) {
            this.walkAction.fadeOut(0.25);
          }
          this.idleAction.reset().fadeIn(0.25).play();
        } else if (!this.idleAction && this.walkAction && this.walkAction.isRunning()) {
          this.walkAction.stop();
        }
      }
    }
  }

  public destroy() {
    this.isDestroyed = true;
    this.scene.remove(this.group);

    // Clean up placeholder if not swapped yet
    if (this.placeholder && this.placeholder.parent) {
      this.placeholder.geometry.dispose();
      if (Array.isArray(this.placeholder.material)) {
        this.placeholder.material.forEach((m) => m.dispose());
      } else {
        this.placeholder.material.dispose();
      }
    }
    if (this.visorPlaceholder && this.visorPlaceholder.parent) {
      this.visorPlaceholder.geometry.dispose();
      if (Array.isArray(this.visorPlaceholder.material)) {
        this.visorPlaceholder.material.forEach((m) => m.dispose());
      } else {
        this.visorPlaceholder.material.dispose();
      }
    }

    // Clean up loaded GLB model
    if (this.model) {
      this.model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    }

    // Clean up floating emojis
    this.floatingEmojis.forEach((fe) => {
      this.group.remove(fe.sprite);
      fe.sprite.geometry.dispose();
      if (Array.isArray(fe.sprite.material)) {
        fe.sprite.material.forEach((m) => m.dispose());
      } else {
        fe.sprite.material.dispose();
      }
    });
  }
}

export class PeerPlayer {
  public group: THREE.Group;
  private scene: THREE.Scene;
  private id: string;
  private targetPosition: THREE.Vector3;
  private floatingEmojis: FloatingEmoji[] = [];

  // GLB Model & Animation Properties
  private placeholder: THREE.Mesh;
  private visorPlaceholder: THREE.Mesh;
  private model: THREE.Group | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private clock = new THREE.Clock();
  private walkAction: THREE.AnimationAction | null = null;
  private idleAction: THREE.AnimationAction | null = null;
  private isDestroyed = false;
  private modelRotationY = 0;

  private groundColliders: THREE.Object3D[];
  private raycaster = new THREE.Raycaster();
  private groundNormal = new THREE.Vector3(0, 1, 0);
  private targetNormal = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene, id: string, startPos: Position, groundColliders: THREE.Object3D[] = []) {
    this.scene = scene;
    this.id = id;
    this.targetPosition = new THREE.Vector3(startPos.x, startPos.y, startPos.z);
    this.groundColliders = groundColliders;

    this.group = new THREE.Group();
    this.group.position.set(startPos.x, startPos.y, startPos.z);

    // Peer player Mesh (Purple capsule bot) with toon shading
    const bodyGeo = new THREE.CylinderGeometry(PLAYER_COLLIDER_RADIUS * 0.7, PLAYER_COLLIDER_RADIUS * 0.7, PLAYER_HEIGHT * 0.8, 16);
    const bodyMat = new THREE.MeshToonMaterial({
      color: 0xd946ef, // Neon violet
      gradientMap: toonGradient
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = (PLAYER_HEIGHT * 0.8) / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);
    this.placeholder = body;

    // Visor/eyes
    const visorGeo = new THREE.BoxGeometry(0.45 * (PLAYER_HEIGHT / 1.5), 0.15 * (PLAYER_HEIGHT / 1.5), 0.3 * (PLAYER_HEIGHT / 1.5));
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0xff00ff,
      emissive: 0xff00ff,
      emissiveIntensity: 1.5,
    });
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 1.25 * (PLAYER_HEIGHT / 1.5), 0.2 * (PLAYER_HEIGHT / 1.5));
    this.group.add(visor);
    this.visorPlaceholder = visor;

    // Flashlight SpotLight setup for PeerPlayer (White, eye-level, positioned slightly forward to prevent self-shadowing)
    const flashlight = new THREE.SpotLight(0xffa500, 12, 25, Math.PI / 6, 0.5, 1.0);
    flashlight.position.set(0, 1.25 * (PLAYER_HEIGHT / 1.5), 0.35 * (PLAYER_HEIGHT / 1.5));
    flashlight.target.position.set(0, 1.25 * (PLAYER_HEIGHT / 1.5), 5);
    flashlight.castShadow = true;
    flashlight.shadow.bias = -0.002;
    flashlight.shadow.mapSize.width = 512;
    flashlight.shadow.mapSize.height = 512;
    this.group.add(flashlight);
    this.group.add(flashlight.target);

    // Nametag removed per user request
    // const shortId = id.substring(0, 6);
    // const nametag = createNametagSprite(shortId, false);
    // nametag.position.y = 1.6;
    // this.group.add(nametag);

    // Asynchronous GLB model load for Peer
    const loader = new GLTFLoader();
    loader.load(
      '/knownbot.glb',
      (gltf) => {
        if (this.isDestroyed) {
          gltf.scene.traverse((node) => {
            if (node instanceof THREE.Mesh) {
              node.geometry.dispose();
              if (Array.isArray(node.material)) {
                node.material.forEach((m) => m.dispose());
              } else {
                node.material.dispose();
              }
            }
          });
          return;
        }

        gltf.scene.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });

        this.model = gltf.scene;

        const box = new THREE.Box3().setFromObject(this.model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        const targetHeight = PLAYER_HEIGHT;
        const scale = targetHeight / (size.y || 1);
        this.model.scale.set(scale, scale, scale);

        // Position model: origin is at the feet and centered
        this.model.position.y = 0;
        this.model.position.x = 0;
        this.model.position.z = 0;
        this.model.rotation.y = this.modelRotationY;

        this.mixer = new THREE.AnimationMixer(this.model);
        gltf.animations.forEach((clip) => {
          console.log(`PeerPlayer: Found animation "${clip.name}"`);
          const nameLower = clip.name.toLowerCase();
          if (nameLower.includes('walk')) {
            this.walkAction = this.mixer!.clipAction(clip);
          } else if (nameLower.includes('idle') || nameLower.includes('idel')) {
            this.idleAction = this.mixer!.clipAction(clip);
          }
        });

        if (!this.walkAction && gltf.animations.length > 0) {
          this.walkAction = this.mixer.clipAction(gltf.animations[0]);
        }

        // Swap out placeholder mesh
        this.group.remove(this.placeholder);
        this.group.remove(this.visorPlaceholder);
        this.placeholder.geometry.dispose();
        if (Array.isArray(this.placeholder.material)) {
          this.placeholder.material.forEach((m) => m.dispose());
        } else {
          this.placeholder.material.dispose();
        }
        this.visorPlaceholder.geometry.dispose();
        if (Array.isArray(this.visorPlaceholder.material)) {
          this.visorPlaceholder.material.forEach((m) => m.dispose());
        } else {
          this.visorPlaceholder.material.dispose();
        }

        this.group.add(this.model);

        if (this.idleAction) {
          this.idleAction.play();
        }
      },
      undefined,
      (error) => {
        console.error('Error loading knownbot.glb for PeerPlayer:', error);
      }
    );

    this.scene.add(this.group);
  }

  public updateState(state: Position) {
    this.targetPosition.set(state.x, state.y, state.z);
  }

  public spawnEmoji(emoji: string) {
    const sprite = createEmojiSprite(emoji);
    sprite.position.set(
      (Math.random() - 0.5) * 0.2,
      PLAYER_HEIGHT * 1.2,
      (Math.random() - 0.5) * 0.2
    );
    this.group.add(sprite);

    this.floatingEmojis.push({
      sprite,
      life: 1.0,
      speedY: 0.02 + Math.random() * 0.015,
      speedX: (Math.random() - 0.5) * 0.01,
    });
  }

  public update() {
    // Lerp position for smooth movement
    const prevPos = this.group.position.clone();
    this.group.position.lerp(this.targetPosition, 0.15);

    // Snap to ground using Raycaster along localUp in world space
    if (this.groundColliders && this.groundColliders.length > 0) {
      const localUp = this.groundNormal.clone().normalize();
      // Start raycast from 1.0 unit above the peer's current position to avoid hitting high ceilings/ledges
      const rayOrigin = this.group.position.clone().addScaledVector(localUp, 1.0);
      const rayDirection = localUp.clone().negate();

      this.raycaster.set(rayOrigin, rayDirection);
      const intersects = this.raycaster.intersectObjects(this.groundColliders, true);
      
      let groundHit: THREE.Intersection | null = null;
      let groundNormal = new THREE.Vector3();

      for (const hit of intersects) {
        if (hit.face && hit.object) {
          const worldNormal = hit.face.normal.clone();
          worldNormal.transformDirection(hit.object.matrixWorld);
          
          // Check if this face is flat enough to be ground relative to our current normal
          const dot = worldNormal.dot(localUp);
          if (dot >= 0.707) { // Slope angle <= 45 degrees
            groundHit = hit;
            groundNormal.copy(worldNormal);
            break; // Found the closest valid ground!
          }
        }
      }

      if (groundHit) {
        this.targetNormal.copy(groundNormal);
        this.group.position.copy(groundHit.point);
      }
    }

    this.groundNormal.lerp(this.targetNormal, 0.015);
    this.groundNormal.normalize();

    // Calculate rotation towards movement direction on tangent plane
    const movement = this.group.position.clone().sub(prevPos);
    const isMoving = (movement.x * movement.x + movement.z * movement.z + movement.y * movement.y) > 0.0001;
    
    const up = this.groundNormal.clone().normalize();
    let projectedForward: THREE.Vector3;

    if (isMoving) {
      const forward = movement.clone().normalize();
      projectedForward = forward.clone().sub(up.clone().multiplyScalar(forward.dot(up))).normalize();
    } else {
      const currentForward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.group.quaternion).normalize();
      projectedForward = currentForward.clone().sub(up.clone().multiplyScalar(currentForward.dot(up))).normalize();
    }

    if (projectedForward.lengthSq() < 0.0001) {
      const fallbackForward = new THREE.Vector3(0, 0, 1);
      projectedForward.crossVectors(up, fallbackForward).normalize();
      if (projectedForward.lengthSq() < 0.0001) {
        projectedForward.crossVectors(new THREE.Vector3(1, 0, 0), up).normalize();
      }
    }

    const right = new THREE.Vector3().crossVectors(up, projectedForward).normalize();
    const matrix = new THREE.Matrix4().makeBasis(right, up, projectedForward);
    const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
    
    if (isMoving) {
      this.group.quaternion.slerp(targetQuaternion, 0.15);
    } else {
      this.group.quaternion.copy(targetQuaternion);
    }

    // Emojis update
    for (let i = this.floatingEmojis.length - 1; i >= 0; i--) {
      const fe = this.floatingEmojis[i];
      fe.life -= 0.015;
      fe.sprite.position.y += fe.speedY;
      fe.sprite.position.x += fe.speedX;

      if (Array.isArray(fe.sprite.material)) {
        fe.sprite.material.forEach(m => m.opacity = fe.life);
      } else {
        fe.sprite.material.opacity = fe.life;
      }

      if (fe.life <= 0) {
        this.group.remove(fe.sprite);
        fe.sprite.geometry.dispose();
        if (Array.isArray(fe.sprite.material)) {
          fe.sprite.material.forEach(m => m.dispose());
        } else {
          fe.sprite.material.dispose();
        }
        this.floatingEmojis.splice(i, 1);
      }
    }

    // Update mixer and handle animations
    const deltaTime = this.clock.getDelta();
    if (this.mixer) {
      this.mixer.update(deltaTime);

      if (isMoving) {
        if (this.walkAction && !this.walkAction.isRunning()) {
          if (this.idleAction && this.idleAction.isRunning()) {
            this.idleAction.fadeOut(0.25);
          }
          this.walkAction.reset().fadeIn(0.25).play();
        }
      } else {
        if (this.idleAction && !this.idleAction.isRunning()) {
          if (this.walkAction && this.walkAction.isRunning()) {
            this.walkAction.fadeOut(0.25);
          }
          this.idleAction.reset().fadeIn(0.25).play();
        } else if (!this.idleAction && this.walkAction && this.walkAction.isRunning()) {
          this.walkAction.stop();
        }
      }
    }
  }

  public destroy() {
    this.isDestroyed = true;
    this.scene.remove(this.group);

    // Clean up placeholder if not swapped yet
    if (this.placeholder && this.placeholder.parent) {
      this.placeholder.geometry.dispose();
      if (Array.isArray(this.placeholder.material)) {
        this.placeholder.material.forEach((m) => m.dispose());
      } else {
        this.placeholder.material.dispose();
      }
    }
    if (this.visorPlaceholder && this.visorPlaceholder.parent) {
      this.visorPlaceholder.geometry.dispose();
      if (Array.isArray(this.visorPlaceholder.material)) {
        this.visorPlaceholder.material.forEach((m) => m.dispose());
      } else {
        this.visorPlaceholder.material.dispose();
      }
    }

    // Clean up loaded GLB model
    if (this.model) {
      this.model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    }

    // Clean up floating emojis
    this.floatingEmojis.forEach((fe) => {
      this.group.remove(fe.sprite);
      fe.sprite.geometry.dispose();
      if (Array.isArray(fe.sprite.material)) {
        fe.sprite.material.forEach((m) => m.dispose());
      } else {
        fe.sprite.material.dispose();
      }
    });
  }
}
