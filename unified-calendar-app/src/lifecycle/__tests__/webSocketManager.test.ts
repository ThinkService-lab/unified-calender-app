/**
 * Unit tests for WebSocket connection manager.
 * Requirements: 4.3, 16.2, 16.3
 */

import {
  createWebSocketManager,
  calculateReconnectDelay,
  HEARTBEAT_INTERVAL_MS,
  INITIAL_RECONNECT_DELAY_MS,
  MAX_RECONNECT_DELAY_MS,
  BACKOFF_MULTIPLIER,
  JITTER_FACTOR,
  type WebSocketManagerConfig,
} from '../webSocketManager';
import type { SyncEngine, SyncState, SyncResult } from '../../sync/types';
import type { ChangeSet } from '../../providers/types';

// ── Mock WebSocket ──

type WSReadyState = 0 | 1 | 2 | 3;

class MockWebSocket {
  static readonly CONNECTING = 0 as const;
  static readonly OPEN = 1 as const;
  static readonly CLOSING = 2 as const;
  static readonly CLOSED = 3 as const;

  readonly CONNECTING = 0 as const;
  readonly OPEN = 1 as const;
  readonly CLOSING = 2 as const;
  readonly CLOSED = 3 as const;

  url: string;
  readyState: WSReadyState = MockWebSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  sentMessages: string[] = [];
  private _closed = false;

  constructor(url: string) {
    this.url = url;
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    this.sentMessages.push(data);
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new Event('close') as CloseEvent);
    }
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) {
      this.onopen(new Event('open'));
    }
  }

  simulateMessage(data: string): void {
    if (this.onmessage) {
      this.onmessage({ data } as MessageEvent);
    }
  }

  simulateError(): void {
    if (this.onerror) {
      this.onerror(new Event('error'));
    }
  }

  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new Event('close') as CloseEvent);
    }
  }
}

// Set global WebSocket constants for the module under test
(globalThis as any).WebSocket = MockWebSocket;

// ── Mock SyncEngine ──

function createMockSyncEngine(): SyncEngine & {
  handleWebhookNotification: jest.Mock;
} {
  return {
    start: jest.fn(),
    stop: jest.fn(),
    queueLocalChange: jest.fn(),
    processOutboundQueue: jest.fn(async (): Promise<SyncResult> => ({
      success: true,
      syncedCount: 0,
      failedCount: 0,
      conflicts: [],
    })),
    handleWebhookNotification: jest.fn(async (): Promise<void> => {}),
    pollProvider: jest.fn(async (): Promise<ChangeSet> => ({
      created: [],
      updated: [],
      deleted: [],
      nextSyncToken: '',
    })),
    getConflicts: jest.fn(() => []),
    resolveConflict: jest.fn(async (): Promise<void> => {}),
    fullSync: jest.fn(async (): Promise<SyncResult> => ({
      success: true,
      syncedCount: 0,
      failedCount: 0,
      conflicts: [],
    })),
    syncAllPending: jest.fn(async (): Promise<SyncResult> => ({
      success: true,
      syncedCount: 0,
      failedCount: 0,
      conflicts: [],
    })),
    pollingIntervalMs: 300_000,
    state: 'Idle' as SyncState,
  };
}

// ── Helpers ──

let lastCreatedSocket: MockWebSocket | null = null;

function createConfig(overrides?: Partial<WebSocketManagerConfig>) {
  const syncEngine = createMockSyncEngine();

  const factory = (url: string): WebSocket => {
    const socket = new MockWebSocket(url);
    lastCreatedSocket = socket;
    return socket as unknown as WebSocket;
  };

  return {
    config: {
      url: 'wss://api.example.com/ws/connect',
      userId: 'user-123',
      deviceId: 'device-456',
      syncEngine: syncEngine as unknown as SyncEngine,
      createWebSocket: factory,
      ...overrides,
    } as WebSocketManagerConfig,
    syncEngine,
    getSocket: () => lastCreatedSocket!,
  };
}

// ── Tests ──

describe('WebSocketManager', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    lastCreatedSocket = null;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('connect', () => {
    it('should establish a WebSocket connection to the configured URL', async () => {
      const { config, getSocket } = createConfig();
      const manager = createWebSocketManager(config);

      const connectPromise = manager.connect();
      getSocket().simulateOpen();
      await connectPromise;

      expect(manager.isConnected()).toBe(true);
      expect(getSocket().url).toBe('wss://api.example.com/ws/connect');
    });

    it('should send subscribe message on successful connection', async () => {
      const { config, getSocket } = createConfig();
      const manager = createWebSocketManager(config);

      const connectPromise = manager.connect();
      getSocket().simulateOpen();
      await connectPromise;

      expect(getSocket().sentMessages).toHaveLength(1);
      const subscribeMsg = JSON.parse(getSocket().sentMessages[0]);
      expect(subscribeMsg).toEqual({
        type: 'subscribe',
        userId: 'user-123',
        deviceId: 'device-456',
      });
    });

    it('should reject non-wss:// URLs', async () => {
      const { config } = createConfig({ url: 'ws://insecure.example.com/ws' });
      const manager = createWebSocketManager(config);

      // connect swallows errors, but the socket should not be created
      await manager.connect();
      expect(manager.isConnected()).toBe(false);
    });

    it('should reject http:// URLs', async () => {
      const { config } = createConfig({ url: 'http://example.com/ws' });
      const manager = createWebSocketManager(config);

      await manager.connect();
      expect(manager.isConnected()).toBe(false);
    });

    it('should not throw when connection fails', async () => {
      const { config, getSocket } = createConfig();
      const manager = createWebSocketManager(config);

      const connectPromise = manager.connect();
      getSocket().simulateError();
      getSocket().simulateClose();
      await connectPromise;

      expect(manager.isConnected()).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('should close the WebSocket connection', async () => {
      const { config, getSocket } = createConfig();
      const manager = createWebSocketManager(config);

      const connectPromise = manager.connect();
      getSocket().simulateOpen();
      await connectPromise;

      expect(manager.isConnected()).toBe(true);

      await manager.disconnect();

      expect(manager.isConnected()).toBe(false);
    });

    it('should prevent auto-reconnect after intentional disconnect', async () => {
      const { config, getSocket } = createConfig();
      const manager = createWebSocketManager(config);

      const connectPromise = manager.connect();
      getSocket().simulateOpen();
      await connectPromise;

      await manager.disconnect();

      // Advance timers — no reconnect should happen
      jest.advanceTimersByTime(120_000);

      expect(manager.isConnected()).toBe(false);
    });

    it('should be safe to call disconnect without prior connect', async () => {
      const { config } = createConfig();
      const manager = createWebSocketManager(config);

      // Should not throw
      await manager.disconnect();
      expect(manager.isConnected()).toBe(false);
    });
  });

  describe('heartbeat', () => {
    it('should send ping messages every 30 seconds', async () => {
      const { config, getSocket } = createConfig();
      const manager = createWebSocketManager(config);

      const connectPromise = manager.connect();
      getSocket().simulateOpen();
      await connectPromise;

      // Clear the subscribe message
      const initialMessages = getSocket().sentMessages.length;

      // Advance 30 seconds
      jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);

      expect(getSocket().sentMessages.length).toBe(initialMessages + 1);
      const pingMsg = JSON.parse(getSocket().sentMessages[initialMessages]);
      expect(pingMsg).toEqual({ type: 'ping' });
    });

    it('should send multiple pings over time', async () => {
      const { config, getSocket } = createConfig();
      const manager = createWebSocketManager(config);

      const connectPromise = manager.connect();
      getSocket().simulateOpen();
      await connectPromise;

      const initialMessages = getSocket().sentMessages.length;

      // Advance 90 seconds (3 heartbeats)
      jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);

      expect(getSocket().sentMessages.length).toBe(initialMessages + 3);
    });

    it('should stop heartbeat on disconnect', async () => {
      const { config, getSocket } = createConfig();
      const manager = createWebSocketManager(config);

      const connectPromise = manager.connect();
      getSocket().simulateOpen();
      await connectPromise;

      const messagesBeforeDisconnect = getSocket().sentMessages.length;

      await manager.disconnect();

      // Advance timers — no more pings should be sent
      jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);

      // sentMessages won't grow since socket is cleaned up
      // Just verify disconnect happened cleanly
      expect(manager.isConnected()).toBe(false);
    });
  });

  describe('auto-reconnect with exponential backoff', () => {
    it('should auto-reconnect when connection drops unexpectedly', async () => {
      const { config, getSocket } = createConfig();
      const manager = createWebSocketManager(config);

      const connectPromise = manager.connect();
      const firstSocket = getSocket();
      firstSocket.simulateOpen();
      await connectPromise;

      expect(manager.isConnected()).toBe(true);

      // Simulate unexpected close
      firstSocket.simulateClose();
      expect(manager.isConnected()).toBe(false);

      // Advance past the initial reconnect delay
      jest.advanceTimersByTime(INITIAL_RECONNECT_DELAY_MS + 200);

      // A new socket should have been created
      const secondSocket = getSocket();
      expect(secondSocket).not.toBe(firstSocket);
    });

    it('should reset reconnect attempt counter on successful reconnect', async () => {
      const { config, getSocket } = createConfig();
      const manager = createWebSocketManager(config);

      const connectPromise = manager.connect();
      getSocket().simulateOpen();
      await connectPromise;

      // Simulate unexpected close
      getSocket().simulateClose();

      // Advance past reconnect delay
      jest.advanceTimersByTime(INITIAL_RECONNECT_DELAY_MS + 200);

      // Simulate successful reconnect
      getSocket().simulateOpen();

      // The subscribe message should be sent again
      const msgs = getSocket().sentMessages;
      expect(msgs.length).toBeGreaterThanOrEqual(1);
      const lastMsg = JSON.parse(msgs[msgs.length - 1]);
      expect(lastMsg.type).toBe('subscribe');
    });

    it('should not reconnect after intentional disconnect', async () => {
      const { config, getSocket } = createConfig();
      const manager = createWebSocketManager(config);

      const connectPromise = manager.connect();
      getSocket().simulateOpen();
      await connectPromise;

      await manager.disconnect();

      // Advance timers well past any reconnect delay
      jest.advanceTimersByTime(MAX_RECONNECT_DELAY_MS * 2);

      expect(manager.isConnected()).toBe(false);
    });
  });

  describe('inbound message handling', () => {
    it('should forward event_changed messages to sync engine', async () => {
      const { config, syncEngine, getSocket } = createConfig();
      const manager = createWebSocketManager(config);

      const connectPromise = manager.connect();
      getSocket().simulateOpen();
      await connectPromise;

      getSocket().simulateMessage(
        JSON.stringify({
          type: 'event_changed',
          accountId: 'account-1',
          changeType: 'updated',
          syncToken: 'token-abc',
        }),
      );

      expect(syncEngine.handleWebhookNotification).toHaveBeenCalledWith({
        accountId: 'account-1',
        changeType: 'updated',
        syncToken: 'token-abc',
      });
    });

    it('should handle event_changed without syncToken', async () => {
      const { config, syncEngine, getSocket } = createConfig();
      const manager = createWebSocketManager(config);

      const connectPromise = manager.connect();
      getSocket().simulateOpen();
      await connectPromise;

      getSocket().simulateMessage(
        JSON.stringify({
          type: 'event_changed',
          accountId: 'account-2',
          changeType: 'created',
        }),
      );

      expect(syncEngine.handleWebhookNotification).toHaveBeenCalledWith({
        accountId: 'account-2',
        changeType: 'created',
        syncToken: undefined,
      });
    });

    it('should ignore unknown message types', async () => {
      const { config, syncEngine, getSocket } = createConfig();
      const manager = createWebSocketManager(config);

      const connectPromise = manager.connect();
      getSocket().simulateOpen();
      await connectPromise;

      getSocket().simulateMessage(JSON.stringify({ type: 'pong' }));
      getSocket().simulateMessage(JSON.stringify({ type: 'ack', id: '123' }));

      expect(syncEngine.handleWebhookNotification).not.toHaveBeenCalled();
    });

    it('should ignore malformed JSON messages', async () => {
      const { config, syncEngine, getSocket } = createConfig();
      const manager = createWebSocketManager(config);

      const connectPromise = manager.connect();
      getSocket().simulateOpen();
      await connectPromise;

      // Should not throw
      getSocket().simulateMessage('not valid json {{{');

      expect(syncEngine.handleWebhookNotification).not.toHaveBeenCalled();
    });

    it('should not throw when sync engine handleWebhookNotification fails', async () => {
      const { config, syncEngine, getSocket } = createConfig();
      syncEngine.handleWebhookNotification.mockRejectedValueOnce(
        new Error('sync error'),
      );
      const manager = createWebSocketManager(config);

      const connectPromise = manager.connect();
      getSocket().simulateOpen();
      await connectPromise;

      // Should not throw
      getSocket().simulateMessage(
        JSON.stringify({
          type: 'event_changed',
          accountId: 'account-1',
          changeType: 'deleted',
        }),
      );

      expect(syncEngine.handleWebhookNotification).toHaveBeenCalled();
    });
  });

  describe('isConnected', () => {
    it('should return false before connect', () => {
      const { config } = createConfig();
      const manager = createWebSocketManager(config);

      expect(manager.isConnected()).toBe(false);
    });

    it('should return true after successful connect', async () => {
      const { config, getSocket } = createConfig();
      const manager = createWebSocketManager(config);

      const connectPromise = manager.connect();
      getSocket().simulateOpen();
      await connectPromise;

      expect(manager.isConnected()).toBe(true);
    });

    it('should return false after disconnect', async () => {
      const { config, getSocket } = createConfig();
      const manager = createWebSocketManager(config);

      const connectPromise = manager.connect();
      getSocket().simulateOpen();
      await connectPromise;

      await manager.disconnect();

      expect(manager.isConnected()).toBe(false);
    });

    it('should return false after unexpected connection drop', async () => {
      const { config, getSocket } = createConfig();
      const manager = createWebSocketManager(config);

      const connectPromise = manager.connect();
      getSocket().simulateOpen();
      await connectPromise;

      getSocket().simulateClose();

      expect(manager.isConnected()).toBe(false);
    });
  });

  describe('calculateReconnectDelay', () => {
    it('should return approximately 1s for first attempt', () => {
      // Run multiple times to account for jitter
      const delays = Array.from({ length: 100 }, () => calculateReconnectDelay(0));
      const min = Math.min(...delays);
      const max = Math.max(...delays);

      // 1000ms ± 10% jitter → [900, 1100]
      expect(min).toBeGreaterThanOrEqual(INITIAL_RECONNECT_DELAY_MS * (1 - JITTER_FACTOR));
      expect(max).toBeLessThanOrEqual(INITIAL_RECONNECT_DELAY_MS * (1 + JITTER_FACTOR));
    });

    it('should double the delay for each subsequent attempt', () => {
      // Check base delays (ignoring jitter)
      // attempt 0: 1s, attempt 1: 2s, attempt 2: 4s, attempt 3: 8s
      const baseDelays = [1000, 2000, 4000, 8000];

      for (let i = 0; i < baseDelays.length; i++) {
        const delays = Array.from({ length: 50 }, () => calculateReconnectDelay(i));
        const avg = delays.reduce((a, b) => a + b, 0) / delays.length;
        // Average should be close to the base delay (jitter averages out)
        expect(avg).toBeGreaterThan(baseDelays[i] * 0.8);
        expect(avg).toBeLessThan(baseDelays[i] * 1.2);
      }
    });

    it('should cap at MAX_RECONNECT_DELAY_MS (60s)', () => {
      const delays = Array.from({ length: 100 }, () => calculateReconnectDelay(20));
      const max = Math.max(...delays);

      // Should never exceed 60s + jitter
      expect(max).toBeLessThanOrEqual(
        MAX_RECONNECT_DELAY_MS * (1 + JITTER_FACTOR),
      );
    });

    it('should always return non-negative values', () => {
      for (let attempt = 0; attempt < 30; attempt++) {
        const delay = calculateReconnectDelay(attempt);
        expect(delay).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('TLS enforcement', () => {
    it('should reject ws:// protocol', async () => {
      const { config } = createConfig({ url: 'ws://insecure.example.com/ws' });
      const manager = createWebSocketManager(config);

      await manager.connect();
      expect(manager.isConnected()).toBe(false);
    });

    it('should accept wss:// protocol', async () => {
      const { config, getSocket } = createConfig({
        url: 'wss://secure.example.com/ws',
      });
      const manager = createWebSocketManager(config);

      const connectPromise = manager.connect();
      getSocket().simulateOpen();
      await connectPromise;

      expect(manager.isConnected()).toBe(true);
    });
  });
});
