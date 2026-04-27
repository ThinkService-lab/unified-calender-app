# Networking - Axios + WebSocket

Sources:
- https://axios-http.com/docs/intro
- React Native WebSocket API (built-in)

## Axios - HTTP Client

### Overview
Promise-based HTTP client for browser and Node.js. Used for all REST API calls to calendar providers and backend services.

### Installation
```bash
npm install axios
```

### Basic Usage
```typescript
import axios from 'axios';

// GET request
const response = await axios.get('https://api.example.com/events', {
  timeout: 5000, // always set timeout in production
});

// POST request
const response = await axios.post('https://api.example.com/events', {
  title: 'Meeting',
  startTime: '2026-01-15T10:00:00Z',
});
```

### Best Practices for This Project
1. Always set `timeout` on every request (5-10 seconds for provider APIs)
2. Create per-provider Axios instances with base URLs and default headers:
   ```typescript
   const googleApi = axios.create({
     baseURL: 'https://www.googleapis.com/calendar/v3',
     timeout: 10000,
     headers: { 'Content-Type': 'application/json' },
   });
   ```
3. Use request interceptors for auth token injection:
   ```typescript
   googleApi.interceptors.request.use(async (config) => {
     const token = await getAccessToken(accountId);
     config.headers.Authorization = `Bearer ${token}`;
     return config;
   });
   ```
4. Use response interceptors for 401 auto-refresh:
   ```typescript
   googleApi.interceptors.response.use(
     (response) => response,
     async (error) => {
       if (error.response?.status === 401) {
         await refreshToken(accountId);
         return googleApi.request(error.config);
       }
       throw error;
     }
   );
   ```
5. Respect `Retry-After` headers on 429 responses
6. Use `axios.CancelToken` or `AbortController` for cancellable requests

## WebSocket - Real-Time Push

### Overview
React Native includes built-in WebSocket support. Used for receiving real-time push notifications from the backend webhook relay.

### Usage
```typescript
const ws = new WebSocket('wss://api.unifiedcal.com/ws');

ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'subscribe', userId: 'user-123' }));
};

ws.onmessage = (event) => {
  const notification = JSON.parse(event.data);
  // Handle webhook relay notification
  syncEngine.handleWebhookNotification(notification);
};

ws.onclose = (event) => {
  // Reconnect with exponential backoff
  scheduleReconnect();
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};
```

### Best Practices
1. Implement automatic reconnection with exponential backoff
2. Use heartbeat/ping-pong to detect stale connections (30-second interval)
3. Buffer messages during reconnection, replay on reconnect
4. Fall back to polling if WebSocket connection fails persistently
5. Close WebSocket when app goes to background (mobile), reopen on foreground
6. Use `wss://` (TLS) exclusively — never `ws://`
7. Authenticate WebSocket connection with JWT token in initial message

### Connection Lifecycle
```
App Launch → Connect WebSocket → Authenticate → Subscribe to user events
App Background → Close WebSocket → Switch to polling (if needed)
App Foreground → Reconnect WebSocket → Resync missed events
Network Lost → WebSocket closes → Queue local changes → Reconnect on restore
```
