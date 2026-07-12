import { createScene, setOnMapLoaded } from './scene';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPixelatedPass } from 'three/examples/jsm/postprocessing/RenderPixelatedPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createNetwork, Position } from './network';
import { LocalPlayer, PeerPlayer } from './player';
import { GameUI } from './ui';
import { SandstormParticles } from './particles';
import * as THREE from 'three';

async function bootstrap() {
  let mapLoaded = false;
  let playerLoaded = false;
  let loadingScreenHidden = false;

  function hideLoadingScreen() {
    if (loadingScreenHidden) return;
    loadingScreenHidden = true;

    const loadingStatus = document.getElementById('loading-status');
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingStatus) {
      loadingStatus.textContent = 'CONNECTED';
    }
    setTimeout(() => {
      if (loadingOverlay) {
        loadingOverlay.classList.add('hidden');
      }
    }, 500);
  }

  function checkLoadingComplete() {
    if (mapLoaded && playerLoaded) {
      hideLoadingScreen();
    }
  }

  // Register map loaded callback
  setOnMapLoaded(() => {
    mapLoaded = true;
    checkLoadingComplete();
  });

  // Safety timeout (4.0 seconds) to prevent stuck loading screen in offline mode
  setTimeout(() => {
    hideLoadingScreen();
  }, 4000);

  // 1. Scene setup
  const { scene, renderer, camera, groundColliders, wallColliders } = createScene();

  // Create Sandstorm Particles tracking the camera
  const sandstorm = new SandstormParticles(scene);
  const clock = new THREE.Clock();

  // Pixel post-processing shader setup (Pixel size scaled by devicePixelRatio for consistent retro chunkiness on mobile)
  const composer = new EffectComposer(renderer);
  const isMobile = window.innerWidth <= 768 || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  // Increase pixel base scale on mobile to make pixels chunkier/larger (3.8 on mobile, 2.5 on desktop)
  const basePixelScale = isMobile ? 3.8 : 2.5;
  const pixelSize = Math.max(isMobile ? 6 : 4, Math.round(basePixelScale * window.devicePixelRatio));
  const renderPixelatedPass = new RenderPixelatedPass(pixelSize, scene, camera);
  renderPixelatedPass.depthEdgeStrength = 2;
  renderPixelatedPass.normalEdgeStrength = 0.5;

  // ⭐ [비침 해결 핵심 코드] 
  if ((renderPixelatedPass as any).normalMaterial) {
    const normMat = (renderPixelatedPass as any).normalMaterial;
    normMat.depthWrite = true;       // 앞면이 뒷면을 무조건 가리도록 고정
    normMat.depthTest = true;        // 깊이 테스트 활성화
    normMat.blending = THREE.NoBlending; // 반사/반투명으로 인한 블렌딩 간섭 차단
  }

  // Override render to exclude trees (Layer 0) from the normal edge outlines (Layer 1 only)
  renderPixelatedPass.render = function (this: any, renderer: any, writeBuffer: any) {
    const uniforms = this.fsQuad.material.uniforms;
    uniforms.normalEdgeStrength.value = this.normalEdgeStrength;
    uniforms.depthEdgeStrength.value = this.depthEdgeStrength;

    // Save camera layer mask
    const originalMask = this.camera.layers.mask;

    // 1. Beauty pass: Render all objects (Layer 0 & 1)
    this.camera.layers.enable(0);
    this.camera.layers.enable(1);
    renderer.setRenderTarget(this.beautyRenderTarget);
    renderer.render(this.scene, this.camera);

    // 2. Normal pass: Render only Layer 1 (excludes trees on Layer 0)
    this.camera.layers.set(1);
    const overrideMaterial_old = this.scene.overrideMaterial;
    renderer.setRenderTarget(this.normalRenderTarget);
    this.scene.overrideMaterial = this.normalMaterial;
    renderer.render(this.scene, this.camera);
    this.scene.overrideMaterial = overrideMaterial_old;

    // Restore camera layers
    this.camera.layers.mask = originalMask;

    uniforms.tDiffuse.value = this.beautyRenderTarget.texture;
    uniforms.tDepth.value = this.beautyRenderTarget.depthTexture;
    uniforms.tNormal.value = this.normalRenderTarget.texture;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
    }

    this.fsQuad.render(renderer);
  };

  composer.addPass(renderPixelatedPass);

  // Final color grading / sRGB gamma / tone mapping pass
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  // Resize composer along with window resizing
  window.addEventListener('resize', () => {
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  // 2. Network setup (Point to port 8080 on the same host)
  const serverUrl = `ws://${window.location.hostname}:8080`;

  const network = createNetwork(serverUrl);

  // Players management
  let localPlayer: LocalPlayer | null = null;
  const peers = new Map<string, PeerPlayer>();

  // 3. UI setup
  const ui = new GameUI(network);

  // Local Emoji handler
  ui.setOnLocalEmoji((emoji) => {
    if (localPlayer) {
      localPlayer.spawnEmoji(emoji);
    }
  });

  // 4. Register Network Callbacks
  network.connect({
    onWelcome(myId, existingPeers) {
      ui.addChatMessage(myId, 'System', `Connected! Welcome to the server. Your ID is ${myId.substring(0, 6)}`, 'system');

      // Spawn local player
      if (localPlayer) {
        localPlayer.destroy();
      }
      localPlayer = new LocalPlayer(scene, camera, network, myId, groundColliders, wallColliders, () => {
        playerLoaded = true;
        checkLoadingComplete();
      });

      // Clear current peers if any, and add existing ones
      peers.forEach((p) => p.destroy());
      peers.clear();

      existingPeers.forEach((peerId) => {
        const peer = new PeerPlayer(scene, peerId, { x: 0, y: 10, z: 0 }, groundColliders);
        peers.set(peerId, peer);
      });

      ui.updateUserList(myId, Array.from(peers.keys()));
    },

    onPeerConnect(peerId) {
      const shortId = peerId.substring(0, 6);
      ui.addChatMessage(peerId, 'System', `Player ${shortId} joined the lobby`, 'system');

      if (!peers.has(peerId)) {
        const peer = new PeerPlayer(scene, peerId, { x: 0, y: 10, z: 0 }, groundColliders);
        peers.set(peerId, peer);
      }

      if (network.myId) {
        ui.updateUserList(network.myId, Array.from(peers.keys()));
      }
    },

    onPeerDisconnect(peerId) {
      const shortId = peerId.substring(0, 6);
      ui.addChatMessage(peerId, 'System', `Player ${shortId} disconnected`, 'system');

      const peer = peers.get(peerId);
      if (peer) {
        peer.destroy();
        peers.delete(peerId);
      }

      if (network.myId) {
        ui.updateUserList(network.myId, Array.from(peers.keys()));
      }
    },

    onPeerState(peerId, state: Position) {
      const peer = peers.get(peerId);
      if (peer) {
        peer.updateState(state);
      }
    },

    onPeerChat(peerId, message: string) {
      const shortId = peerId.substring(0, 6);
      ui.addChatMessage(peerId, `Player ${shortId}`, message, 'peer');
    },

    onPeerEmoji(peerId, emoji: string) {
      const peer = peers.get(peerId);
      if (peer) {
        peer.spawnEmoji(emoji);
      }
    },

    onConnectionStatus(connected) {
      ui.setConnectionStatus(connected);
      if (!connected) {
        ui.addChatMessage('system', 'System', 'Disconnected from server. Reconnecting...', 'system');

        // Remove local player and peers from scene
        if (localPlayer) {
          localPlayer.destroy();
          localPlayer = null;
        }
        peers.forEach((p) => p.destroy());
        peers.clear();
      }
    }
  });

  // 5. Game Loop
  function animate() {
    requestAnimationFrame(animate);

    const deltaTime = clock.getDelta();
    // Track the local player's group for position & orientation, fallback to camera
    const trackingTarget = localPlayer ? localPlayer.group : camera;
    sandstorm.update(trackingTarget, deltaTime);

    // Update local player
    if (localPlayer) {
      localPlayer.update();
    }

    // Update peer players (LERP positions)
    peers.forEach((peer) => {
      peer.update();
    });

    // Render 3D Scene with pixel post-processing
    composer.render();
  }

  animate();
}

bootstrap();
