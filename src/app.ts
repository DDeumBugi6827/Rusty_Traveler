import { createScene, setOnMapLoaded } from './scene';

import { createNetwork, Position } from './network';
import { LocalPlayer, PeerPlayer } from './player';
import { GameUI } from './ui';
import { SandstormParticles } from './particles';
import * as THREE from 'three';

async function bootstrap() {
  // Start loop BGM (handling browser autoplay policies)
  const bgm = new Audio('/Unfinished_Corridor.mp3');
  bgm.loop = true;
  bgm.volume = 0.3; // Fallback default soft volume

  let audioCtx: AudioContext | null = null;
  let gainNode: GainNode | null = null;
  let isConnected = false;

  const startBGM = () => {
    // Initialize Web Audio API on first interaction to bypass iOS volume/autoplay bugs
    if (!isConnected) {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          audioCtx = new AudioContextClass();
          gainNode = audioCtx.createGain();
          gainNode.gain.setValueAtTime(1, audioCtx.currentTime); // Soft volume on both mobile and desktop

          const source = audioCtx.createMediaElementSource(bgm);
          source.connect(gainNode);
          gainNode.connect(audioCtx.destination);

          bgm.volume = 1.5; // Let GainNode handle the volume entirely
          isConnected = true;
        }
      } catch (e) {
        console.warn('Web Audio API failed to initialize:', e);
      }
    }

    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch((err) => console.warn('Failed to resume AudioContext:', err));
    }

    bgm.play().then(() => {
      // Once successfully playing, remove event listeners
      document.removeEventListener('click', startBGM);
      document.removeEventListener('keydown', startBGM);
      document.removeEventListener('touchstart', startBGM);
    }).catch((error) => {
      console.warn('Autoplay blocked. Waiting for user interaction to play BGM:', error);
    });
  };

  // Try to play immediately (might work if page navigation carried context)
  startBGM();

  // Fallback to play when user interacts
  document.addEventListener('click', startBGM);
  document.addEventListener('keydown', startBGM);
  document.addEventListener('touchstart', startBGM);

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
  const { scene, renderer, camera, groundColliders, wallColliders, dirLight } = createScene();

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
