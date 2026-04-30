/**
 * App lifecycle module.
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6
 */

export { createAppLifecycleManager } from './appLifecycleManager';
export type {
  AppLifecycleManager,
  AppLifecycleManagerConfig,
  AppLifecycleState,
  WebSocketManager,
  AppStateListener,
} from './appLifecycleManager';

// WebSocket connection management (Req 4.3, 16.2, 16.3)
export { createWebSocketManager, calculateReconnectDelay } from './webSocketManager';
export type { WebSocketManagerConfig } from './webSocketManager';

// Background sync shared types
export type {
  BackgroundSyncManager,
  BackgroundSyncConfig,
  BackgroundSyncResult,
} from './backgroundSync';
export {
  BACKGROUND_SYNC_INTERVAL_SECONDS,
  BACKGROUND_SYNC_TASK_NAME,
} from './backgroundSync';
