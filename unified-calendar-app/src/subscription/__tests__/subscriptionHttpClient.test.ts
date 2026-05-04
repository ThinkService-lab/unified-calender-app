/**
 * Unit tests for `createSubscriptionHttpClient`.
 *
 * Security Review 2026-05-02 (pass 3): Finding L4 follow-up — production
 * wiring for `subscriptionHttpClient`. These tests pin the factory's
 * contract so the bootstrap default wiring stays correct.
 */

import axios, { type AxiosInstance } from 'axios';
import {
  createSubscriptionHttpClient,
  SUBSCRIPTION_DEFAULT_TIMEOUT_MS,
  SUBSCRIPTION_MAX_TIMEOUT_MS,
  SUBSCRIPTION_MIN_TIMEOUT_MS,
} from '../subscriptionHttpClient';

// Lightweight stub — structural-typing lets us avoid actual axios network.
function createStubAxios(): {
  instance: AxiosInstance;
  get: jest.Mock;
  post: jest.Mock;
  requestInterceptors: Array<(config: unknown) => unknown>;
} {
  const requestInterceptors: Array<(config: unknown) => unknown> = [];
  const get = jest.fn();
  const post = jest.fn();

  const instance = {
    get,
    post,
    interceptors: {
      request: {
        use: (fn: (config: unknown) => unknown) => {
          requestInterceptors.push(fn);
          return requestInterceptors.length - 1;
        },
      },
    },
  } as unknown as AxiosInstance;

  return { instance, get, post, requestInterceptors };
}

// Run every interceptor in order against a request config and return the
// final config (or throw if any interceptor rejects).
async function runInterceptors(
  interceptors: Array<(config: unknown) => unknown>,
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let current: unknown = config;
  for (const interceptor of interceptors) {
    current = await interceptor(current);
  }
  return current as Record<string, unknown>;
}

describe('createSubscriptionHttpClient — construction', () => {
  it('rejects a missing base URL', () => {
    expect(() =>
      createSubscriptionHttpClient({ baseUrl: '' as unknown as string }),
    ).toThrow(/baseUrl is required/);
  });

  it('rejects a non-HTTPS base URL (plain http)', () => {
    expect(() =>
      createSubscriptionHttpClient({ baseUrl: 'http://api.example.com' }),
    ).toThrow(/must use HTTPS/);
  });

  it('rejects a non-HTTP protocol base URL', () => {
    expect(() =>
      createSubscriptionHttpClient({ baseUrl: 'ftp://api.example.com' }),
    ).toThrow(/must use HTTPS/);
  });

  it('accepts a valid HTTPS base URL', () => {
    expect(() =>
      createSubscriptionHttpClient({ baseUrl: 'https://api.example.com' }),
    ).not.toThrow();
  });
});

describe('createSubscriptionHttpClient — timeout clamping', () => {
  let createSpy: jest.SpyInstance;

  beforeEach(() => {
    createSpy = jest.spyOn(axios, 'create').mockReturnValue({
      interceptors: { request: { use: () => 0 } },
      get: jest.fn(),
      post: jest.fn(),
    } as unknown as AxiosInstance);
  });

  afterEach(() => {
    createSpy.mockRestore();
  });

  it('uses the default timeout when none is supplied', () => {
    createSubscriptionHttpClient({ baseUrl: 'https://api.example.com' });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: SUBSCRIPTION_DEFAULT_TIMEOUT_MS }),
    );
  });

  it('clamps timeouts below the 5-second floor up to the minimum', () => {
    createSubscriptionHttpClient({ baseUrl: 'https://api.example.com', timeoutMs: 1000 });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: SUBSCRIPTION_MIN_TIMEOUT_MS }),
    );
  });

  it('clamps timeouts above the 10-second ceiling down to the maximum', () => {
    createSubscriptionHttpClient({ baseUrl: 'https://api.example.com', timeoutMs: 30_000 });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: SUBSCRIPTION_MAX_TIMEOUT_MS }),
    );
  });

  it('treats non-finite timeouts as the default', () => {
    createSubscriptionHttpClient({
      baseUrl: 'https://api.example.com',
      timeoutMs: Number.NaN,
    });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: SUBSCRIPTION_DEFAULT_TIMEOUT_MS }),
    );
  });

  it('honors a timeout inside the allowed range exactly', () => {
    createSubscriptionHttpClient({ baseUrl: 'https://api.example.com', timeoutMs: 7500 });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 7500 }),
    );
  });
});

describe('createSubscriptionHttpClient — request interceptors', () => {
  it('attaches Bearer token from the getSessionToken getter', async () => {
    const { instance, requestInterceptors } = createStubAxios();
    const getSessionToken = jest.fn().mockResolvedValue('sess_123');

    createSubscriptionHttpClient({
      baseUrl: 'https://api.example.com',
      getSessionToken,
      axiosInstance: instance,
    });

    const config = await runInterceptors(requestInterceptors, {
      url: '/subscriptions/me',
      headers: {},
    });

    expect(getSessionToken).toHaveBeenCalledTimes(1);
    expect((config.headers as Record<string, string>).Authorization).toBe('Bearer sess_123');
  });

  it('omits Authorization when the session getter returns null', async () => {
    const { instance, requestInterceptors } = createStubAxios();
    const getSessionToken = jest.fn().mockResolvedValue(null);

    createSubscriptionHttpClient({
      baseUrl: 'https://api.example.com',
      getSessionToken,
      axiosInstance: instance,
    });

    const config = await runInterceptors(requestInterceptors, {
      url: '/subscriptions/offerings',
      headers: {},
    });

    expect((config.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('falls through without Authorization when the getter throws', async () => {
    const { instance, requestInterceptors } = createStubAxios();
    const getSessionToken = jest.fn().mockRejectedValue(new Error('token store down'));

    createSubscriptionHttpClient({
      baseUrl: 'https://api.example.com',
      getSessionToken,
      axiosInstance: instance,
    });

    const config = await runInterceptors(requestInterceptors, {
      url: '/subscriptions/me',
      headers: {},
    });

    expect((config.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('reads a fresh token on each request', async () => {
    const { instance, requestInterceptors } = createStubAxios();
    const getSessionToken = jest
      .fn()
      .mockResolvedValueOnce('token_a')
      .mockResolvedValueOnce('token_b');

    createSubscriptionHttpClient({
      baseUrl: 'https://api.example.com',
      getSessionToken,
      axiosInstance: instance,
    });

    const first = await runInterceptors(requestInterceptors, {
      url: '/subscriptions/me',
      headers: {},
    });
    const second = await runInterceptors(requestInterceptors, {
      url: '/subscriptions/me',
      headers: {},
    });

    expect((first.headers as Record<string, string>).Authorization).toBe('Bearer token_a');
    expect((second.headers as Record<string, string>).Authorization).toBe('Bearer token_b');
  });

  it('blocks an absolute http:// URL at the per-request HTTPS interceptor', async () => {
    const { instance, requestInterceptors } = createStubAxios();
    createSubscriptionHttpClient({
      baseUrl: 'https://api.example.com',
      axiosInstance: instance,
    });

    await expect(
      runInterceptors(requestInterceptors, {
        url: 'http://evil.example/subscriptions/me',
        headers: {},
      }),
    ).rejects.toThrow(/HTTPS required/);
  });

  it('allows a relative URL through (resolved against HTTPS baseURL)', async () => {
    const { instance, requestInterceptors } = createStubAxios();
    createSubscriptionHttpClient({
      baseUrl: 'https://api.example.com',
      axiosInstance: instance,
    });

    const config = await runInterceptors(requestInterceptors, {
      url: '/subscriptions/offerings',
      headers: {},
    });
    expect(config.url).toBe('/subscriptions/offerings');
  });
});

describe('createSubscriptionHttpClient — get / post surface', () => {
  it('forwards the request and returns { data }', async () => {
    const { instance, get, post } = createStubAxios();
    get.mockResolvedValue({ data: { tier: 'pro' } });
    post.mockResolvedValue({ data: { sessionId: 'sess_1', tier: 'pro' } });

    const client = createSubscriptionHttpClient({
      baseUrl: 'https://api.example.com',
      axiosInstance: instance,
    });

    const getRes = await client.get<{ tier: string }>('/subscriptions/u1');
    expect(getRes).toEqual({ data: { tier: 'pro' } });
    expect(get).toHaveBeenCalledWith('/subscriptions/u1', undefined);

    const postRes = await client.post<{ sessionId: string; tier: string }>(
      '/subscriptions/checkout',
      { productId: 'p', userId: 'u1' },
    );
    expect(postRes).toEqual({ data: { sessionId: 'sess_1', tier: 'pro' } });
    expect(post).toHaveBeenCalledWith(
      '/subscriptions/checkout',
      { productId: 'p', userId: 'u1' },
      undefined,
    );
  });

  it('normalises server-reported errors with status / statusText', async () => {
    const { instance, get } = createStubAxios();
    const axiosErr = Object.assign(new Error('Request failed with status code 402'), {
      isAxiosError: true,
      response: { status: 402, statusText: 'Payment Required' },
    });
    get.mockRejectedValue(axiosErr);

    const client = createSubscriptionHttpClient({
      baseUrl: 'https://api.example.com',
      axiosInstance: instance,
    });

    await expect(client.get('/subscriptions/u1')).rejects.toThrow(
      /GET \/subscriptions\/u1 failed with 402 Payment Required/,
    );
  });

  it('normalises network errors (no response) without leaking axios internals', async () => {
    const { instance, post } = createStubAxios();
    post.mockRejectedValue(new Error('ECONNRESET'));

    const client = createSubscriptionHttpClient({
      baseUrl: 'https://api.example.com',
      axiosInstance: instance,
    });

    await expect(client.post('/subscriptions/checkout', {})).rejects.toThrow(/ECONNRESET/);
  });
});

describe('createSubscriptionHttpClient — structural compatibility', () => {
  it('satisfies the bootstrap SubscriptionHttpClient type and the narrower post-only SubscriptionManager.HttpClient', () => {
    // This is a compile-time check that doubles as a runtime smoke test.
    const client = createSubscriptionHttpClient({
      baseUrl: 'https://api.example.com',
    });

    // SubscriptionManager.HttpClient — post-only
    const httpClientPostOnly: {
      post<T>(url: string, body: unknown): Promise<{ data: T }>;
    } = client;
    expect(typeof httpClientPostOnly.post).toBe('function');

    // featureUnlockPoller deps — get-only
    const httpClientGetOnly: {
      get<T>(url: string): Promise<{ data: T }>;
    } = client;
    expect(typeof httpClientGetOnly.get).toBe('function');
  });
});
