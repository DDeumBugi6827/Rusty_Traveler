export type Position = { x: number; y: number; z: number };

export interface NetworkCallbacks {
  onWelcome?: (id: string, existingPeers: string[]) => void;
  onPeerConnect?: (id: string) => void;
  onPeerDisconnect?: (id: string) => void;
  onPeerState?: (id: string, state: Position) => void;
  onPeerChat?: (id: string, message: string) => void;
  onPeerEmoji?: (id: string, emoji: string) => void;
  onConnectionStatus?: (connected: boolean) => void;
  onDisconnect?: () => void;
}

export class WebSocketNetwork {
  private ws: WebSocket | null = null;
  private url: string;
  private callbacks: NetworkCallbacks = {};
  public myId: string | null = null;

  constructor(url: string) {
    this.url = url;
  }

  public connect(callbacks: NetworkCallbacks) {
    this.callbacks = callbacks;
    this.initSocket();
  }

  private initSocket() {
    console.log('Connecting to', this.url);
    if (this.callbacks.onConnectionStatus) this.callbacks.onConnectionStatus(false);

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      console.error('WebSocket connection error:', err);
      this.handleReconnect();
      return;
    }

    this.ws.addEventListener('open', () => {
      console.log('WS Connection established');
      if (this.callbacks.onConnectionStatus) this.callbacks.onConnectionStatus(true);
    });

    this.ws.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (err) {
        console.error('Error parsing WS message:', err);
      }
    });

    this.ws.addEventListener('close', () => {
      console.log('WS Connection closed');
      this.myId = null;
      if (this.callbacks.onConnectionStatus) this.callbacks.onConnectionStatus(false);
      if (this.callbacks.onDisconnect) this.callbacks.onDisconnect();
      this.handleReconnect();
    });

    this.ws.addEventListener('error', (err) => {
      console.error('WebSocket error:', err);
    });
  }

  private handleReconnect() {
    setTimeout(() => {
      console.log('Reconnecting WS...');
      this.initSocket();
    }, 3000);
  }

  private handleMessage(data: any) {
    switch (data.type) {
      case 'welcome':
        this.myId = data.id;
        if (this.callbacks.onWelcome) {
          this.callbacks.onWelcome(data.id, data.peers);
        }
        break;
      case 'peerConnect':
        if (this.callbacks.onPeerConnect) {
          this.callbacks.onPeerConnect(data.id);
        }
        break;
      case 'peerDisconnect':
        if (this.callbacks.onPeerDisconnect) {
          this.callbacks.onPeerDisconnect(data.id);
        }
        break;
      case 'peerState':
        if (this.callbacks.onPeerState) {
          this.callbacks.onPeerState(data.id, data.payload);
        }
        break;
      case 'peerChat':
        if (this.callbacks.onPeerChat) {
          this.callbacks.onPeerChat(data.id, data.message);
        }
        break;
      case 'peerEmoji':
        if (this.callbacks.onPeerEmoji) {
          this.callbacks.onPeerEmoji(data.id, data.emoji);
        }
        break;
      default:
        console.warn('Unknown event type:', data.type);
    }
  }

  public sendState(state: Position) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'state', payload: state }));
    }
  }

  public sendChat(message: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'chat', message }));
    }
  }

  public sendEmoji(emoji: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'emoji', emoji }));
    }
  }
}

export function createNetwork(url: string): WebSocketNetwork {
  return new WebSocketNetwork(url);
}
