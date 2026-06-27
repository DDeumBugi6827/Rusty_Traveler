import type { WebSocketNetwork } from './network';

export class GameUI {
  private network: WebSocketNetwork;
  private chatMessagesContainer: HTMLElement;
  private chatForm: HTMLFormElement;
  private chatInput: HTMLInputElement;
  private userListContainer: HTMLElement;
  private userCountContainer: HTMLElement;
  private connectionStatusContainer: HTMLElement;
  
  private onLocalEmojiCallback: (emoji: string) => void = () => {};

  constructor(network: WebSocketNetwork) {
    this.network = network;

    this.chatMessagesContainer = document.getElementById('chat-messages')!;
    this.chatForm = document.getElementById('chat-form') as HTMLFormElement;
    this.chatInput = document.getElementById('chat-input') as HTMLInputElement;
    this.userListContainer = document.getElementById('user-list')!;
    this.userCountContainer = document.getElementById('user-count')!;
    this.connectionStatusContainer = document.getElementById('connection-status')!;

    this.init();
  }

  private init() {
    // Chat submission
    this.chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.chatInput.value.trim();
      if (!text) return;

      this.network.sendChat(text);
      
      // Append local chat immediately
      const myId = this.network.myId || 'You';
      this.addChatMessage(myId, 'You', text, 'local');
      
      this.chatInput.value = '';
      this.chatInput.blur();
    });

    // Emoji button bindings
    const emojiButtons = document.querySelectorAll('.emoji-btn');
    emojiButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const emoji = btn.getAttribute('data-emoji');
        if (emoji) {
          this.network.sendEmoji(emoji);
          this.onLocalEmojiCallback(emoji);
        }
      });
    });
  }

  public setOnLocalEmoji(callback: (emoji: string) => void) {
    this.onLocalEmojiCallback = callback;
  }

  public setConnectionStatus(connected: boolean) {
    const dot = this.connectionStatusContainer.querySelector('.status-dot')!;
    const text = this.connectionStatusContainer.querySelector('.status-text')!;
    
    if (connected) {
      this.connectionStatusContainer.classList.remove('disconnected');
      text.textContent = 'Connected';
    } else {
      this.connectionStatusContainer.classList.add('disconnected');
      text.textContent = 'Disconnected';
      this.clearUserList();
    }
  }

  public updateUserList(myId: string | null, peers: string[]) {
    this.userListContainer.innerHTML = '';
    
    let totalCount = 0;
    
    // Add local player
    if (myId) {
      totalCount++;
      const item = document.createElement('li');
      item.className = 'user-item local';
      
      // Generate a color based on ID hash
      const color = this.getColorForId(myId);
      
      item.innerHTML = `
        <div class="avatar" style="background-color: ${color}">You</div>
        <span style="font-weight: 600;">You (${myId.substring(0, 5)})</span>
      `;
      this.userListContainer.appendChild(item);
    }

    // Add peers
    peers.forEach((peerId) => {
      totalCount++;
      const item = document.createElement('li');
      item.className = 'user-item';
      
      const color = this.getColorForId(peerId);
      const shortId = peerId.substring(0, 5);
      
      item.innerHTML = `
        <div class="avatar" style="background-color: ${color}">${shortId.substring(0, 2).toUpperCase()}</div>
        <span>Player ${shortId}</span>
      `;
      this.userListContainer.appendChild(item);
    });

    this.userCountContainer.textContent = totalCount.toString();
  }

  private clearUserList() {
    this.userListContainer.innerHTML = '';
    this.userCountContainer.textContent = '0';
  }

  public addChatMessage(senderId: string, senderName: string, text: string, type: 'local' | 'peer' | 'system') {
    const msgElement = document.createElement('div');
    msgElement.className = `message ${type}`;

    const shortName = senderName.length > 8 ? senderName.substring(0, 6) : senderName;
    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    if (type === 'system') {
      msgElement.innerHTML = `
        <div class="message-body">${text}</div>
      `;
    } else {
      msgElement.innerHTML = `
        <div class="message-meta">
          <span class="message-sender" style="color: ${this.getColorForId(senderId)}">${shortName}</span>
          <span class="message-time">${timeString}</span>
        </div>
        <div class="message-body">${text}</div>
      `;
    }

    this.chatMessagesContainer.appendChild(msgElement);
    
    // Auto scroll to bottom
    this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;

    // Limit messages displayed to keep memory low
    while (this.chatMessagesContainer.children.length > 50) {
      this.chatMessagesContainer.removeChild(this.chatMessagesContainer.firstChild!);
    }
  }

  // Hash helper to generate nice matching HSL colors for users
  private getColorForId(id: string): string {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return `hsl(${h}, 70%, 60%)`;
  }
}
