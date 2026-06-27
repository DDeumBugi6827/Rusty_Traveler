import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { WebSocketNetwork, Position } from './network';

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

export function createNametagSprite(name: string, isLocal: boolean = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Sprite();

  // Rounded background
  ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(4, 4, 248, 56, 12);
  } else {
    ctx.rect(4, 4, 248, 56);
  }
  ctx.fill();

  // Border glowing/color
  ctx.lineWidth = 3;
  ctx.strokeStyle = isLocal ? '#38bdf8' : 'rgba(255, 255, 255, 0.3)';
  ctx.stroke();

  // Text
  ctx.font = 'bold 24px "Plus Jakarta Sans", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 128, 32);

  const texture = new THREE.CanvasTexture(canvas);
  const spriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
  });
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.scale.set(1.5, 0.375, 1);
  return sprite;
}

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
    wallColliders: { mesh: THREE.Mesh; box: THREE.Box3 }[]
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
    const bodyGeo = new THREE.CylinderGeometry(0.3, 0.3, 1.2, 16);
    const bodyMat = new THREE.MeshToonMaterial({
      color: 0x38bdf8,
      gradientMap: toonGradient
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.6;
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);
    this.placeholder = body;

    // Visor/eyes (glowing emission)
    const visorGeo = new THREE.BoxGeometry(0.45, 0.15, 0.3);
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x00f3ff,
      emissive: 0x00f3ff,
      emissiveIntensity: 1.5,
    });
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 1.25, 0.2);
    this.group.add(visor);
    this.visorPlaceholder = visor;

    // Flashlight SpotLight setup for LocalPlayer (White, eye-level, positioned slightly forward to prevent self-shadowing)
    const flashlight = new THREE.SpotLight(0xffffff, 15, 25, Math.PI / 6, 0.5, 1.0);
    flashlight.position.set(0, 1.25, 0.35);
    flashlight.target.position.set(0, 1.25, 5);
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

        const targetHeight = 1.5;
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
      1.8,
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

    // Apply rotation
    this.group.rotation.y = this.yawAngle;

    // Compute tangent forward direction in world space (aligned with model facing local +Z)
    const localForward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.group.quaternion).normalize();

    // 2.3 Wall Collision & Sliding Physics (BoundingBox + Raycaster)
    let canMove = true;
    if (Math.abs(step) > 0.0001 && this.wallColliders && this.wallColliders.length > 0) {
      const playerRadius = 0.45;
      const playerHeight = 1.5;
      const moveVec = localForward.clone().multiplyScalar(step);

      // Compute player's candidate position and bounding box
      const candidatePos = this.group.position.clone().add(moveVec);
      const playerBox = new THREE.Box3(
        new THREE.Vector3(candidatePos.x - playerRadius, candidatePos.y, candidatePos.z - playerRadius),
        new THREE.Vector3(candidatePos.x + playerRadius, candidatePos.y + playerHeight, candidatePos.z + playerRadius)
      );

      // 1. Fast BoundingBox Collision Check
      let collidedWall: { mesh: THREE.Mesh; box: THREE.Box3 } | null = null;
      for (const wall of this.wallColliders) {
        if (playerBox.intersectsBox(wall.box)) {
          collidedWall = wall;
          break;
        }
      }

      // 2. If collided, perform precise Raycast to find the normal and apply sliding
      if (collidedWall) {
        const rayDir = localForward.clone().multiplyScalar(Math.sign(step)).normalize();
        const rayOrigin = new THREE.Vector3(
          this.group.position.x,
          this.group.position.y + 0.5, // Center of player height
          this.group.position.z
        );

        this.raycaster.set(rayOrigin, rayDir);
        const intersects = this.raycaster.intersectObject(collidedWall.mesh, true);

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
                const slidePos = this.group.position.clone().add(slideVec);
                const slidePlayerBox = new THREE.Box3(
                  new THREE.Vector3(slidePos.x - playerRadius, slidePos.y, slidePos.z - playerRadius),
                  new THREE.Vector3(slidePos.x + playerRadius, slidePos.y + playerHeight, slidePos.z + playerRadius)
                );

                // Verify if the sliding position intersects any wall BoundingBox
                let slideCollided = false;
                for (const wall of this.wallColliders) {
                  if (slidePlayerBox.intersectsBox(wall.box)) {
                    slideCollided = true;
                    break;
                  }
                }

                if (!slideCollided) {
                  this.group.position.add(slideVec);
                  canMove = false; // Moved by sliding
                }
              }
            }
          }

          // If sliding wasn't possible or slide also collided, player is blocked
          if (canMove) {
            canMove = false;
          }
        }
      }
    }

    if (canMove) {
      this.group.position.addScaledVector(localForward, step);
    }

    // Snap to ground using Raycaster (from y + 4 to avoid ceilings) on groundColliders
    if (this.groundColliders && this.groundColliders.length > 0) {
      this.raycaster.set(
        new THREE.Vector3(this.group.position.x, this.group.position.y + 4, this.group.position.z),
        new THREE.Vector3(0, -1, 0)
      );
      const intersects = this.raycaster.intersectObjects(this.groundColliders, true);
      if (intersects.length > 0) {
        this.group.position.y = intersects[0].point.y;
      }
    } else {
      this.group.position.y = 0;
    }

    // 3. Smooth 3rd-person follow camera tracking in flat space
    const followDistance = 6.5;
    const followHeight = 3.8;

    // Ideal camera position behind player (along -localForward) and above player
    const targetCamPos = this.group.position.clone()
      .addScaledVector(localForward, -followDistance);
    targetCamPos.y += followHeight;

    // Lerp camera position
    this.camera.position.lerp(targetCamPos, 0.08);

    // Keep camera up vector aligned to standard +Y
    this.camera.up.set(0, 1, 0);

    // Camera looks at the player (slightly offset up along Y)
    const targetLookAt = this.group.position.clone();
    targetLookAt.y += 1.0;
    this.camera.lookAt(targetLookAt);

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

  constructor(scene: THREE.Scene, id: string, startPos: Position) {
    this.scene = scene;
    this.id = id;
    this.targetPosition = new THREE.Vector3(startPos.x, startPos.y, startPos.z);

    this.group = new THREE.Group();
    this.group.position.set(startPos.x, startPos.y, startPos.z);

    // Peer player Mesh (Purple capsule bot) with toon shading
    const bodyGeo = new THREE.CylinderGeometry(0.3, 0.3, 1.2, 16);
    const bodyMat = new THREE.MeshToonMaterial({
      color: 0xd946ef, // Neon violet
      gradientMap: toonGradient
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.6;
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);
    this.placeholder = body;

    // Visor/eyes
    const visorGeo = new THREE.BoxGeometry(0.45, 0.15, 0.3);
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0xff00ff,
      emissive: 0xff00ff,
      emissiveIntensity: 1.5,
    });
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 1.25, 0.2);
    this.group.add(visor);
    this.visorPlaceholder = visor;

    // Flashlight SpotLight setup for PeerPlayer (White, eye-level, positioned slightly forward to prevent self-shadowing)
    const flashlight = new THREE.SpotLight(0xffa500, 12, 25, Math.PI / 6, 0.5, 1.0);
    flashlight.position.set(0, 1.25, 0.35);
    flashlight.target.position.set(0, 1.25, 5);
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

        const targetHeight = 1.5;
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
      1.8,
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

    // Calculate rotation towards movement direction on flat XZ plane
    const movement = this.group.position.clone().sub(prevPos);
    const isMoving = movement.x * movement.x + movement.z * movement.z > 0.0001;
    if (isMoving) {
      const angle = Math.atan2(movement.x, movement.z);
      this.group.rotation.y = angle;
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
