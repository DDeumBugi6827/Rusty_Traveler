import { createScene, setOnMapLoaded } from './scene';

import { createNetwork, Position } from './network';
import { LocalPlayer, PeerPlayer } from './player';
import { GameUI } from './ui';
import { SandstormParticles } from './particles';
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

async function bootstrap() {


  let mapLoaded = false;
  let playerLoaded = false;
  let bgmLoaded = false;
  let loadingScreenHidden = false;

  function hideLoadingScreen() {
    if (loadingScreenHidden) return;
    loadingScreenHidden = true;

    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
      loadingOverlay.classList.add('hidden');
    }
  }

  function checkLoadingComplete() {
    if (mapLoaded && playerLoaded && bgmLoaded) {
      const loadingStatus = document.getElementById('loading-status');
      const startBtn = document.getElementById('start-btn');
      if (loadingStatus) {
        loadingStatus.textContent = 'READY TO TRAVEL';
      }
      if (startBtn) {
        startBtn.style.display = 'block';
      }
    }
  }

  // Register map loaded callback
  setOnMapLoaded(() => {
    mapLoaded = true;
    checkLoadingComplete();
  });

  // Safety timeout (4.0 seconds) to guarantee the start button shows up even if network blocks
  setTimeout(() => {
    mapLoaded = true;
    playerLoaded = true;
    bgmLoaded = true;
    checkLoadingComplete();
  }, 4000);

  // 1. Scene setup
  const { scene, renderer, camera, groundColliders, wallColliders, dirLight, hemiLight } = createScene();

  // Load environment map for PBR reflections (Roughness/Metallic textures on models)
  const rgbeLoader = new RGBELoader();
  rgbeLoader.load('/sunny_vondelpark_2k.hdr', (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = texture;
    console.log('Environment map loaded successfully.');
  }, undefined, (err) => {
    console.error('Error loading environment map:', err);
  });

  // Setup BGM using Three.js Audio API (bypasses Safari volume & playback bugs)
  const bgmListener = new THREE.AudioListener();
  camera.add(bgmListener);

  const bgmSound = new THREE.Audio(bgmListener);
  const audioLoader = new THREE.AudioLoader();
  let hasInteracted = false;

  audioLoader.load('/Unfinished_Corridor.mp3', (buffer) => {
    bgmSound.setBuffer(buffer);
    bgmSound.setLoop(true);
    bgmSound.setVolume(0.08); // Soft volume on both mobile and desktop
    bgmLoaded = true;
    checkLoadingComplete();
  }, undefined, (err) => {
    console.error('BGM load error:', err);
    bgmLoaded = true; // Still allow game to load on sound failure
    checkLoadingComplete();
  });

  const startBGM = () => {
    if (hasInteracted) return;
    hasInteracted = true;

    const context = bgmListener.context;
    if (context && context.state === 'suspended') {
      context.resume().catch((err) => console.warn('Failed to resume BGM AudioContext:', err));

      // Play a silent dummy buffer synchronously to transition context to running on iOS Safari
      try {
        const dummyBuffer = context.createBuffer(1, 1, 22050);
        const dummyNode = context.createBufferSource();
        dummyNode.buffer = dummyBuffer;
        dummyNode.connect(context.destination);
        dummyNode.start(0);
      } catch (e) {
        console.warn('Failed to play dummy node:', e);
      }
    }

    if (bgmSound.buffer && !bgmSound.isPlaying) {
      try {
        bgmSound.play();
      } catch (err) {
        console.warn('BGM play failed:', err);
      }
    }
  };

  // Connect start button interaction
  const startBtn = document.getElementById('start-btn');
  if (startBtn) {
    const handleStartButton = () => {
      startBGM();
      hideLoadingScreen();
    };
    startBtn.addEventListener('click', handleStartButton);
    startBtn.addEventListener('touchstart', handleStartButton);
  }

  // Create Sandstorm Particles tracking the camera
  const sandstorm = new SandstormParticles(scene);
  const clock = new THREE.Clock();

  // 2. Network setup (Point to port 8080 on the same host)
  const serverUrl = `ws://${window.location.hostname}:8080`;

  const network = createNetwork(serverUrl);

  // Players management
  let localPlayer: LocalPlayer | null = null;
  const peers = new Map<string, PeerPlayer>();

  // 3. UI setup
  const ui = new GameUI(network);

  const lookupBtn = document.getElementById('lookup-btn') as HTMLButtonElement | null;
  const lookupBtnText = document.getElementById('lookup-btn-text') as HTMLSpanElement | null;
  if (lookupBtn && lookupBtnText) {
    lookupBtn.addEventListener('click', () => {
      if (localPlayer && !localPlayer.isMoving) {
        localPlayer.isLookingUp = !localPlayer.isLookingUp;
        if (localPlayer.isLookingUp) {
          lookupBtn.classList.add('active');
          lookupBtnText.textContent = 'RESET VIEW';
        } else {
          lookupBtn.classList.remove('active');
          lookupBtnText.textContent = 'LOOK UP';
        }
      }
    });
  }

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
      localPlayer = new LocalPlayer(scene, camera, network, myId, groundColliders, wallColliders, bgmListener, () => {
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

      // Sync Lookup button state in the game loop
      if (lookupBtn && lookupBtnText) {
        if (localPlayer.isMoving) {
          lookupBtn.disabled = true;
          lookupBtn.classList.remove('active');
          lookupBtnText.textContent = 'LOOK UP';
        } else {
          lookupBtn.disabled = false;
          if (localPlayer.isLookingUp) {
            lookupBtn.classList.add('active');
            lookupBtnText.textContent = 'RESET VIEW';
          } else {
            lookupBtn.classList.remove('active');
            lookupBtnText.textContent = 'LOOK UP';
          }
        }
      }

      // Dynamically update HemisphereLight position to align with player's local Up normal on the planet sphere
      if (hemiLight) {
        const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(localPlayer.group.quaternion);
        hemiLight.position.copy(localUp).multiplyScalar(50);
      }

      // Dynamically update directional light position to track player in spherical space
      if (dirLight) {
        const playerPos = localPlayer.group.position;

        // Maintain a constant sun direction vector in world space (50, 60, 40)
        // This ensures the local angle of light and shadows changes dynamically as the player walks around the planet sphere
        const sunDirection = new THREE.Vector3(50, 60, 40).normalize();
        const distance = 120; // Keep the light source far enough to cover the shadow area

        // Position the light offset from the player along the constant world sun direction
        dirLight.position.copy(playerPos).addScaledVector(sunDirection, distance);
        dirLight.target.position.copy(playerPos);
      }
    } else {
      if (lookupBtn && lookupBtnText) {
        lookupBtn.disabled = true;
        lookupBtn.classList.remove('active');
        lookupBtnText.textContent = 'LOOK UP';
      }
    }

    // Update peer players (LERP positions)
    peers.forEach((peer) => {
      peer.update();
    });

    // Render 3D Scene directly
    renderer.render(scene, camera);
  }

  animate();
}

bootstrap();
