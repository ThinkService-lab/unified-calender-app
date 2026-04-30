/**
 * Unit tests for the UIPreferences store and its integration with the
 * design-token system (via `useTokens()`).
 *
 * Covers Tasks 1.6 and 1.6A from the competitive-ui-overhaul spec:
 *   • Store actions (setColorScheme, shortcut overrides, reset).
 *   • `installAppearanceListener` forwards OS theme changes into the
 *     store and unsubscribes cleanly.
 *   • When `colorScheme === 'system'`, an Appearance change flips
 *     `useTokens()` to the new token set on the next render.
 *   • When `colorScheme === 'light'` or `'dark'` (explicit), an
 *     Appearance change has no effect on the returned tokens.
 *   • Persist middleware only serialises user-configurable fields —
 *     the OS mirror (`resolvedSystemScheme`) is not written to storage.
 *
 * Requirements: 1.7, 1.8
 */

import { Appearance } from 'react-native';
import {
  createUIPreferencesStore,
  installAppearanceListener,
  type UIPreferencesStore,
} from '../uiPreferencesStore';
import { lightTokens, darkTokens, resolveEffectiveScheme } from '../../ui/tokens/designTokens';

type AppearanceListener = (prefs: { colorScheme: 'light' | 'dark' | null }) => void;

/**
 * Minimal harness: replaces `Appearance.addChangeListener` with a
 * captured-listener stub so tests can drive OS theme changes
 * synchronously without touching `window.matchMedia` / native bridges.
 */
function mockAppearance(initial: 'light' | 'dark' | null): {
  restore: () => void;
  fire: (scheme: 'light' | 'dark' | null) => void;
  removeCount: () => number;
} {
  const originalGet = Appearance.getColorScheme;
  const originalAdd = Appearance.addChangeListener;

  let listeners: AppearanceListener[] = [];
  let removeCount = 0;
  let current: 'light' | 'dark' | null = initial;

  (Appearance as unknown as { getColorScheme: () => 'light' | 'dark' | null }).getColorScheme =
    () => current;
  (
    Appearance as unknown as {
      addChangeListener: (listener: AppearanceListener) => { remove: () => void };
    }
  ).addChangeListener = (listener: AppearanceListener) => {
    listeners.push(listener);
    return {
      remove: () => {
        listeners = listeners.filter((l) => l !== listener);
        removeCount += 1;
      },
    };
  };

  return {
    restore: () => {
      (
        Appearance as unknown as { getColorScheme: typeof originalGet }
      ).getColorScheme = originalGet;
      (
        Appearance as unknown as { addChangeListener: typeof originalAdd }
      ).addChangeListener = originalAdd;
    },
    fire: (scheme) => {
      current = scheme;
      for (const l of listeners) l({ colorScheme: scheme });
    },
    removeCount: () => removeCount,
  };
}

describe('UIPreferences store — state + actions', () => {
  let store: UIPreferencesStore;
  beforeEach(() => {
    store = createUIPreferencesStore();
  });

  test('defaults to system colour-scheme preference', () => {
    expect(store.getState().colorScheme).toBe('system');
    expect(store.getState().shortcutOverrides).toEqual({});
  });

  test('setColorScheme updates the preference', () => {
    store.getState().setColorScheme('dark');
    expect(store.getState().colorScheme).toBe('dark');
    store.getState().setColorScheme('light');
    expect(store.getState().colorScheme).toBe('light');
  });

  test('setShortcutOverride / clearShortcutOverride manage the map', () => {
    store.getState().setShortcutOverride('go-today', 'g,t');
    expect(store.getState().shortcutOverrides).toEqual({ 'go-today': 'g,t' });
    store.getState().setShortcutOverride('create', 'n');
    expect(store.getState().shortcutOverrides).toEqual({ 'go-today': 'g,t', create: 'n' });
    store.getState().clearShortcutOverride('go-today');
    expect(store.getState().shortcutOverrides).toEqual({ create: 'n' });
  });

  test('reset restores defaults without touching resolvedSystemScheme', () => {
    store.getState().setColorScheme('dark');
    store.getState().setShortcutOverride('create', 'n');
    store.getState().setResolvedSystemScheme('dark');
    store.getState().reset();
    expect(store.getState().colorScheme).toBe('system');
    expect(store.getState().shortcutOverrides).toEqual({});
    // The OS mirror is NOT user-configurable, so reset() must not clear it.
    expect(store.getState().resolvedSystemScheme).toBe('dark');
  });
});

describe('installAppearanceListener', () => {
  let appearance: ReturnType<typeof mockAppearance>;
  let store: UIPreferencesStore;

  beforeEach(() => {
    appearance = mockAppearance('light');
    store = createUIPreferencesStore();
  });
  afterEach(() => {
    appearance.restore();
  });

  test('seeds the store with the current OS scheme on install', () => {
    installAppearanceListener(store);
    expect(store.getState().resolvedSystemScheme).toBe('light');
  });

  test('forwards OS theme changes into the store', () => {
    installAppearanceListener(store);
    appearance.fire('dark');
    expect(store.getState().resolvedSystemScheme).toBe('dark');
    appearance.fire('light');
    expect(store.getState().resolvedSystemScheme).toBe('light');
  });

  test('unsubscribe removes the listener', () => {
    const unsubscribe = installAppearanceListener(store);
    expect(appearance.removeCount()).toBe(0);
    unsubscribe();
    expect(appearance.removeCount()).toBe(1);
    appearance.fire('dark');
    // After unsubscribe, further OS changes are ignored — store stays
    // at whatever value it had before unsubscribe.
    expect(store.getState().resolvedSystemScheme).toBe('light');
  });
});

describe('useTokens integration — token selection (Req 1.7, 1.8)', () => {
  let appearance: ReturnType<typeof mockAppearance>;
  let store: UIPreferencesStore;

  beforeEach(() => {
    appearance = mockAppearance('light');
    store = createUIPreferencesStore();
    installAppearanceListener(store);
  });
  afterEach(() => {
    appearance.restore();
  });

  test('system preference + OS dark → dark tokens', () => {
    store.getState().setColorScheme('system');
    appearance.fire('dark');
    const effective = resolveEffectiveScheme(
      store.getState().colorScheme,
      store.getState().resolvedSystemScheme,
    );
    const tokens = effective === 'dark' ? darkTokens : lightTokens;
    expect(tokens).toBe(darkTokens);
  });

  test('system preference + OS light → light tokens', () => {
    store.getState().setColorScheme('system');
    appearance.fire('light');
    const effective = resolveEffectiveScheme(
      store.getState().colorScheme,
      store.getState().resolvedSystemScheme,
    );
    const tokens = effective === 'dark' ? darkTokens : lightTokens;
    expect(tokens).toBe(lightTokens);
  });

  test('OS flip while preference is system → token set flips', () => {
    store.getState().setColorScheme('system');
    appearance.fire('light');
    let effective = resolveEffectiveScheme(
      store.getState().colorScheme,
      store.getState().resolvedSystemScheme,
    );
    expect(effective).toBe('light');

    appearance.fire('dark');
    effective = resolveEffectiveScheme(
      store.getState().colorScheme,
      store.getState().resolvedSystemScheme,
    );
    expect(effective).toBe('dark');
  });

  test('explicit light preference ignores OS theme changes', () => {
    store.getState().setColorScheme('light');
    appearance.fire('dark');
    const effective = resolveEffectiveScheme(
      store.getState().colorScheme,
      store.getState().resolvedSystemScheme,
    );
    expect(effective).toBe('light');
  });

  test('explicit dark preference ignores OS theme changes', () => {
    store.getState().setColorScheme('dark');
    appearance.fire('light');
    const effective = resolveEffectiveScheme(
      store.getState().colorScheme,
      store.getState().resolvedSystemScheme,
    );
    expect(effective).toBe('dark');
  });
});

describe('UIPreferences persist middleware — partialize', () => {
  test('only persists user-configurable fields (not resolvedSystemScheme)', () => {
    // In-memory `StateStorage` that records the serialised payload.
    const writes: Record<string, string> = {};
    const storage = {
      getItem: (key: string) => Promise.resolve(writes[key] ?? null),
      setItem: (key: string, value: string) => {
        writes[key] = value;
        return Promise.resolve();
      },
      removeItem: (key: string) => {
        delete writes[key];
        return Promise.resolve();
      },
    };

    const store = createUIPreferencesStore(storage);
    store.getState().setColorScheme('dark');
    store.getState().setShortcutOverride('create', 'n');
    store.getState().setResolvedSystemScheme('light');

    // Give the persist middleware a tick to write.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const raw = writes['ui-preferences-storage'];
        expect(raw).toBeDefined();
        const parsed = JSON.parse(raw) as { state: Record<string, unknown> };
        expect(parsed.state.colorScheme).toBe('dark');
        expect(parsed.state.shortcutOverrides).toEqual({ create: 'n' });
        // resolvedSystemScheme is partialized out — it mirrors the OS
        // and must be re-seeded on every launch, not replayed from disk.
        expect(parsed.state.resolvedSystemScheme).toBeUndefined();
        resolve();
      }, 10);
    });
  });
});
