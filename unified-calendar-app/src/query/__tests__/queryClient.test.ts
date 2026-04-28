/**
 * Unit tests for TanStack Query client configuration.
 */

import { createAppQueryClient, STALE_TIMES, GC_TIME } from '../queryClient';

describe('createAppQueryClient', () => {
  it('creates a QueryClient instance', () => {
    const client = createAppQueryClient();
    expect(client).toBeDefined();
    expect(typeof client.getQueryCache).toBe('function');
    expect(typeof client.getMutationCache).toBe('function');
  });

  it('configures default query options', () => {
    const client = createAppQueryClient();
    const defaults = client.getDefaultOptions();

    expect(defaults.queries?.staleTime).toBe(STALE_TIMES.events);
    expect(defaults.queries?.gcTime).toBe(GC_TIME);
    expect(defaults.queries?.retry).toBe(3);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(true);
    expect(defaults.queries?.refetchOnReconnect).toBe(true);
  });

  it('configures default mutation options', () => {
    const client = createAppQueryClient();
    const defaults = client.getDefaultOptions();

    expect(defaults.mutations?.retry).toBe(1);
  });

  it('has correct stale time constants', () => {
    expect(STALE_TIMES.calendars).toBe(30_000);
    expect(STALE_TIMES.events).toBe(10_000);
  });

  it('has correct gc time constant', () => {
    expect(GC_TIME).toBe(300_000); // 5 minutes
  });

  it('configures exponential retry delay', () => {
    const client = createAppQueryClient();
    const retryDelay = client.getDefaultOptions().queries?.retryDelay;

    expect(typeof retryDelay).toBe('function');
    if (typeof retryDelay === 'function') {
      // Exponential backoff: 1s, 2s, 4s, capped at 30s
      expect(retryDelay(0, new Error())).toBe(1000);
      expect(retryDelay(1, new Error())).toBe(2000);
      expect(retryDelay(2, new Error())).toBe(4000);
      expect(retryDelay(5, new Error())).toBe(30000); // capped
    }
  });
});
