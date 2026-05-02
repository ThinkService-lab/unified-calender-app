/**
 * WebSocket connection manager.
 * Implements the WebSocketManager interface from appLifecycleManager.ts.
 *
 * - Uses `wss://` only (enforces TLS)
 * - 30-second heartbeat ping to keep the connection alive
 * - Auto-reconnect with exponential backoff (initial: 1s, max: 60s, multiplier: 2x, jitter: 0.1)
 * - Subscribes via `{ type: 'subscribe', userId, deviceId }` on connect
 * - Handles inbound `{ type: 'event_changed', accountId, changeType, syncToken }` messages
 *   by forwarding to the sync engine's handleWebhookNotification
 * - Designed to close on background and reconnect on foreground (managed by appLifecycleManager)
 *
 * Requirements: 4.3, 16.2, 16.3
 */

import type { WebSocketManager } from './appLifecycleManager';
import type { SyncEngine, WebhookPayload } from '../sync/types';

/** Heartbeat interval: 30 seconds */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Initial reconnect delay: 1 second */
const INITIAL_RECONNECT_DELAY_MS = 1_000;

/** Maximum reconnect delay: 60 seconds */
const MAX_RECONNECT_DELAY_MS = 60_000;

/** Backoff multiplier */
const BACKOFF_MULTIPLIER = 2;

/** Jitter factor (±10%) */
const JITTER_FACTOR = 0.1;

/** Inbound message types */
interface EventChangedMessage {
  type: 'event_changed';
  accountId: string;
  changeType: 'created' | 'updated' | 'deleted' | 'sync';
  syncToken?: string;
}

/** Subscribe message sent on connection */
interface SubscribeMessage {
  type: 'subscribe';
  userId: string;
  deviceId: string;
}

/** Configuration for the WebSocket manager */
export interface WebSocketManagerConfig {
  /** WebSocket server URL (must use wss:// protocol) */
  url: string;
  /** User ID for subscription */
  userId: string;
  /** Device ID for subscription */
  deviceId: string;
  /** Sync engine to forward inbound event_changed messages to */
  syncEngine: SyncEngine;
  /**
   * Optional WebSocket factory for dependency injection (testing).
   * Defaults to the global WebSocket constructor.
   */
  createWebSocket?: (url: string) => WebSocket;
}

/**
 * Calculate reconnect delay with exponential backoff and jitter.
 * Reconnects indefinitely (no max retry count).
 */
export function calculateReconnectDelay(attempt: number): number {
  const baseDelay = Math.min(
    INITIAL_RECONNECT_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, attempt),
    MAX_RECONNECT_DELAY_MS,
  );
  const jitter = baseDelay * JITTER_FACTOR * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(baseDelay + jitter));
}

/**
 * Creates a WebSocketManager instance.
 */
export function createWebSocketManager(
  config: WebSocketManagerConfig,
): WebSocketManager {
  const { url, userId, deviceId, syncEngine } = config;
  const createWs = config.createWebSocket ?? ((wsUrl: string) => new WebSocket(wsUrl));

  let _socket: WebSocket | null = null;
  let _connected = false;
  let _intentionalClose = false;
  let _reconnectAttempt = 0;
  let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Validate that the URL uses the wss:// protocol.
   * Throws if the URL does not use TLS.
   */
  function validateUrl(wsUrl: string): void {
    if (!wsUrl.startsWith('wss://')) {
      throw new Error(
        'WebSocket URL must use wss:// protocol. Insecure ws:// connections are not allowed.',
      );
    }
  }

  /**
   * Start the heartbeat ping interval.
   */
  function startHeartbeat(): void {
    stopHeartbeat();
    _heartbeatTimer = setInterval(() => {
      if (_socket && _socket.readyState === WebSocket.OPEN) {
        try {
          _socket.send(JSON.stringify({ type: 'ping' }));
        } catch {
          // If sending fails, the socket error/close handlers will trigger reconnect
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Stop the heartbeat ping interval.
   */
  function stopHeartbeat(): void {
    if (_heartbeatTimer !== null) {
      clearInterval(_heartbeatTimer);
      _heartbeatTimer = null;
    }
  }

  /**
   * Cancel any pending reconnect timer.
   */
  function cancelReconnect(): void {
    if (_reconnectTimer !== null) {
      clearTimeout(_reconnectTimer);
      _reconnectTimer = null;
    }
  }

  /**
   * Schedule a reconnect attempt with exponential backoff.
   * Reconnects indefinitely (no max retry count).
   */
  function scheduleReconnect(): void {
    if (_intentionalClose) return;
    cancelReconnect();

    const delay = calculateReconnectDelay(_reconnectAttempt);
    _reconnectAttempt++;

    _reconnectTimer = setTimeout(async () => {
      _reconnectTimer = null;
      if (!_intentionalClose) {
        try {
          await connectInternal();
        } catch {
          // connectInternal failure will trigger onclose → scheduleReconnect again
        }
      }
    }, delay);
  }

  /**
   * Send the subscribe message after connection is established.
   */
  function sendSubscribe(): void {
    if (_socket && _socket.readyState === WebSocket.OPEN) {
      const msg: SubscribeMessage = { type: 'subscribe', userId, deviceId };
      _socket.send(JSON.stringify(msg));
    }
  }

  /**
   * Validate that a parsed message is a valid EventChangedMessage.
   * Security Review 2026-05-01: Finding M2
   */
  function isValidEventChangedMessage(message: unknown): message is EventChangedMessage {
    if (typeof message !== 'object' || message === null) return false;
    const msg = message as Record<string, unknown>;
    return (
      msg.type === 'event_changed' &&
      typeof msg.accountId === 'string' &&
      msg.accountId.length > 0 &&
      typeof msg.changeType === 'string' &&
      ['created', 'updated', 'deleted', 'sync'].includes(msg.changeType as string) &&
      (msg.syncToken === undefined || typeof msg.syncToken === 'string')
    );
  }

  /**
   * Handle an inbound message from the WebSocket server.
   * Security Review 2026-05-01: Finding M2 — validates message structure before processing.
   */
  function handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      if (isValidEventChangedMessage(message)) {
        const payload: WebhookPayload = {
          accountId: message.accountId,
          changeType: message.changeType,
          syncToken: message.syncToken,
        };
        // Fire-and-forget: sync engine handles errors internally
        syncEngine.handleWebhookNotification(payload).catch(() => {
          // Non-fatal: sync engine will retry on next poll/notification
        });
      }
      // Other message types (pong, ack, etc.) and invalid messages are silently ignored
    } catch {
      // Malformed JSON — ignore silently
    }
  }

  /**
   * Internal connect logic. Sets up the WebSocket and its event handlers.
   */
  function connectInternal(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        validateUrl(url);

        // Clean up any existing socket
        cleanupSocket();

        const socket = createWs(url);
        _socket = socket;

        socket.onopen = () => {
          _connected = true;
          _reconnectAttempt = 0;
          sendSubscribe();
          startHeartbeat();
          resolve();
        };

        socket.onmessage = (event: MessageEvent) => {
          const data = typeof event.data === 'string' ? event.data : String(event.data);
          handleMessage(data);
        };

        socket.onerror = () => {
          // The close event will fire after error, which handles reconnect
        };

        socket.onclose = () => {
          _connected = false;
          stopHeartbeat();

          if (!_intentionalClose) {
            scheduleReconnect();
          }

          // If we haven't resolved yet (connection failed before open), reject
          reject(new Error('WebSocket connection closed'));
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Clean up the current socket without triggering reconnect.
   */
  function cleanupSocket(): void {
    if (_socket) {
      // Remove handlers to prevent triggering reconnect during cleanup
      _socket.onopen = null;
      _socket.onmessage = null;
      _socket.onerror = null;
      _socket.onclose = null;

      if (
        _socket.readyState === WebSocket.OPEN ||
        _socket.readyState === WebSocket.CONNECTING
      ) {
        try {
          _socket.close();
        } catch {
          // Best-effort close
        }
      }
      _socket = null;
    }
  }

  // ── Public interface (WebSocketManager) ──

  /**
   * Connect/reconnect the WebSocket.
   * Validates wss:// protocol, establishes connection, sends subscribe message.
   */
  async function connect(): Promise<void> {
    _intentionalClose = false;
    cancelReconnect();

    try {
      await connectInternal();
    } catch {
      // Connection failed — auto-reconnect is already scheduled by onclose handler
      // Swallow the error so callers (e.g., handleForeground) don't need to handle it
    }
  }

  /**
   * Gracefully close the WebSocket connection.
   * Stops heartbeat, cancels reconnect, and closes the socket.
   */
  async function disconnect(): Promise<void> {
    _intentionalClose = true;
    cancelReconnect();
    stopHeartbeat();
    cleanupSocket();
    _connected = false;
    _reconnectAttempt = 0;
  }

  /**
   * Whether the WebSocket is currently connected.
   */
  function isConnected(): boolean {
    return _connected;
  }

  return {
    connect,
    disconnect,
    isConnected,
  };
}

export {
  HEARTBEAT_INTERVAL_MS,
  INITIAL_RECONNECT_DELAY_MS,
  MAX_RECONNECT_DELAY_MS,
  BACKOFF_MULTIPLIER,
  JITTER_FACTOR,
};
export type { EventChangedMessage, SubscribeMessage };
