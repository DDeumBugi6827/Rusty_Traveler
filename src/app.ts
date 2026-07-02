import { createScene, setOnMapLoaded } from './scene';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPixelatedPass } from 'three/examples/jsm/postprocessing/RenderPixelatedPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createNetwork, Position } from './network';
import { LocalPlayer, PeerPlayer } from './player';
import { GameUI } from './ui';

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

  // Pixel post-processing shader setup (Pixel size scaled by devicePixelRatio for consistent retro chunkiness on mobile)
  const composer = new EffectComposer(renderer);
  const pixelSize = Math.max(4, Math.round(2.5 * window.devicePixelRatio));
  const renderPixelatedPass = new RenderPixelatedPass(pixelSize, scene, camera);
  renderPixelatedPass.depthEdgeStrength = 2;
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
