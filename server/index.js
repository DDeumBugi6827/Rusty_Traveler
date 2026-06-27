const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const port = process.env.PORT || 8080;

// Serve client built static assets in production
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// Fallback to index.html for SPA router
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Map to store connected clients: id -> websocket connection
const clients = new Map();

// Helper to broadcast JSON packet to all clients except sender
function broadcast(senderId, packet, includeSender = false) {
  const messageStr = JSON.stringify(packet);
  for (const [id, ws] of clients.entries()) {
    if (!includeSender && id === senderId) continue;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(messageStr);
    }
  }
}

wss.on('connection', (ws) => {
  // Generate unique ID for client
  const id = 'client_' + Math.random().toString(36).substring(2, 9);
  
  // Send welcome packet with client ID and current client IDs list (peers)
  const existingPeers = Array.from(clients.keys());
  ws.send(JSON.stringify({
    type: 'welcome',
    id: id,
    peers: existingPeers
  }));

  // Store client socket connection
  clients.set(id, ws);
  console.log(`[CONNECT] User ${id} connected. Total active: ${clients.size}`);

  // Broadcast connection event to existing peers
  broadcast(id, {
    type: 'peerConnect',
    id: id
  }, false);

  // Message Handler
  ws.on('message', (messageStr) => {
    try {
      const data = JSON.parse(messageStr);
      
      switch (data.type) {
        case 'state':
          // Broadcast position to all other peers
          broadcast(id, {
            type: 'peerState',
            id: id,
            payload: data.payload
          }, false);
          break;
          
        case 'chat':
          // Print on server console and broadcast
          console.log(`[CHAT] ${id}: "${data.message}"`);
          broadcast(id, {
            type: 'peerChat',
            id: id,
            message: data.message
          }, false);
          break;
          
        case 'emoji':
          // Broadcast emoji trigger to other players
          broadcast(id, {
            type: 'peerEmoji',
            id: id,
            emoji: data.emoji
          }, false);
          break;

        default:
          console.warn(`[WARNING] Unknown message type: ${data.type} from ${id}`);
      }
    } catch (err) {
      console.error(`[ERROR] Parsing message from ${id}:`, err.message);
    }
  });

  // Disconnect Handler
  ws.on('close', () => {
    clients.delete(id);
    console.log(`[DISCONNECT] User ${id} disconnected. Total active: ${clients.size}`);
    
    // Broadcast disconnect event to all remaining peers
    broadcast(id, {
      type: 'peerDisconnect',
      id: id
    }, false);
  });

  ws.on('error', (err) => {
    console.error(`[ERROR] Socket error on user ${id}:`, err.message);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`=============================================`);
  console.log(`  WebSocket Server running on port ${port} `);
  console.log(`  Local static files root: ${distPath}`);
  console.log(`=============================================`);
});
