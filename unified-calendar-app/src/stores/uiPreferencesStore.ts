/**
 * UI Preferences Zustand store slice.
 *
 * Persists user UI preferences (colour scheme, shortcut overrides) across
 * app launches. Used by `useTokens()` to select the correct design-token
 * set based on the user's preferred colour scheme.
 *
 * The store also owns a single global subscription to
 * `Appearance.addChangeListener` so that the OS colour-scheme value lives
 * in exactly one place. Consumers read it via `useResolvedSystemScheme`
 * — they do NOT each create their own listener. This keeps Req 1.8 (OS
 * theme changes propagate within 500 ms) correct AND cheap.
 *
 * Requirements: 1.7, 1.8
 */

import { useEffect } from 'react';
import { Appearance, type ColorSchemeName, type EmitterSubscription } from 'react-native';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { devtools } from './devtoolsAdapter';
import { useShallow } from 'zustand/react/shallow';
import type { StateStorage } from 'zustand/middleware';

export type ColorScheme = 'light' | 'dark' | 'system';

/**
 * Resolved OS colour scheme. `null` means the OS did not report a value
 * (older RN / web without `prefers-color-scheme` support); treat as light.
 */
export type ResolvedSystemScheme = ColorSchemeName;

export interface UIPreferences {
  /** User's preferred colour scheme. `'system'` follows the OS setting. */
  colorScheme: ColorScheme;
  /** Custom keyboard shortcut overrides (future use, reserved). */
  shortcutOverrides: Record<string, string>;
  /**
   * The current OS-reported colour scheme. Updated by the global
   * `Appearance` listener installed inside this store. Consumers SHOULD
   * read this via `useResolvedSystemScheme` rather than calling
   * `Appearance.getColorScheme()` directly so updates flow through a
   * single source of truth.
   */
  resolvedSystemScheme: ResolvedSystemScheme;

  // Actions
  setColorScheme: (scheme: ColorScheme) => void;
  setShortcutOverride: (shortcutId: string, keys: string) => void;
  clearShortcutOverride: (shortcutId: string) => void;
  /**
   * Internal: update the mirrored OS colour scheme. Called by the
   * `Appearance` listener installed in `installAppearanceListener`.
   * Exposed as an action (not a plain setter) so devtools can trace
   * OS-theme changes and tests can simulate them.
   */
  setResolvedSystemScheme: (scheme: ResolvedSystemScheme) => void;
  reset: () => void;
}

export type UIPreferencesStore = UseBoundStore<StoreApi<UIPreferences>>;

const initialPersistedState: Pick<UIPreferences, 'colorScheme' | 'shortcutOverrides'> = {
  colorScheme: 'system',
  shortcutOverrides: {},
};

/**
 * Installs a single `Appearance.addChangeListener` that forwards OS theme
 * changes into the given store. Returns an `unsubscribe` function.
 *
 * Called once per store instance (either immediately on default-store
 * creation, or by `rebindDefaultUIPreferencesStore` when the SQLite-backed
 * store takes over at bootstrap). Safe to call multiple times — each
 * subscription is independent.
 */
export function installAppearanceListener(
  store: UIPreferencesStore,
): () => void {
  // Seed the store with the current OS value so the first render already
  // has the correct resolved scheme (important on app resume).
  store.getState().setResolvedSystemScheme(Appearance.getColorScheme());

  const subscription: EmitterSubscription | { remove?: () => void } | void =
    Appearance.addChangeListener(({ colorScheme }) => {
      store.getState().setResolvedSystemScheme(colorScheme);
    });

  return () => {
    if (subscription && typeof (subscription as { remove?: () => void }).remove === 'function') {
      (subscription as { remove: () => void }).remove();
    }
  };
}

/**
 * No-op StateStorage used when the store is created before the
 * SQLite-backed storage adapter is ready (e.g. at module import time,
 * or in a `testEnvironment: 'node'` jest suite). Prevents zustand from
 * emitting "the given storage is currently unavailable" warnings when
 * it tries to fall back to `window.localStorage` in non-browser
 * environments.
 */
const NOOP_STORAGE: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

/**
 * Creates the UI preferences store.
 * Accepts an optional custom storage for the persist middleware. When
 * omitted, a no-op storage is used so the store's state lives only in
 * memory — this matches the expected lifecycle: the default singleton
 * is created in-memory at module load, then `initializeStores()` creates
 * a SQLite-backed instance at bootstrap and swaps it in via
 * `rebindDefaultUIPreferencesStore`.
 */
export function createUIPreferencesStore(storage?: StateStorage): UIPreferencesStore {
  const effectiveStorage = storage ?? NOOP_STORAGE;
  return create<UIPreferences>()(
    devtools(
      persist(
        immer((set) => ({
          ...initialPersistedState,
          resolvedSystemScheme: null as ResolvedSystemScheme,

          setColorScheme: (scheme: ColorScheme) =>
            set((state) => {
              state.colorScheme = scheme;
            }),

          setShortcutOverride: (shortcutId: string, keys: string) =>
            set((state) => {
              state.shortcutOverrides[shortcutId] = keys;
            }),

          clearShortcutOverride: (shortcutId: string) =>
            set((state) => {
              delete state.shortcutOverrides[shortcutId];
            }),

          setResolvedSystemScheme: (scheme: ResolvedSystemScheme) =>
            set((state) => {
              state.resolvedSystemScheme = scheme;
            }),

          reset: () =>
            set((state) => {
              state.colorScheme = initialPersistedState.colorScheme;
              state.shortcutOverrides = { ...initialPersistedState.shortcutOverrides };
              // Deliberately do NOT reset `resolvedSystemScheme` — it
              // mirrors the OS and is not user-configurable.
            }),
        })),
        {
          name: 'ui-preferences-storage',
          storage: createJSONStorage(() => effectiveStorage),
          // Only persist the user-configurable fields. `resolvedSystemScheme`
          // is a mirror of the OS and must be re-seeded from `Appearance`
          // on every launch, not replayed from disk.
          partialize: (state) => ({
            colorScheme: state.colorScheme,
            shortcutOverrides: state.shortcutOverrides,
          }),
        },
      ),
      { name: 'UIPreferencesStore', enabled: process.env.NODE_ENV !== 'production' },
    ),
  );
}

// ─── Default singleton + late-rebinding ─────────────────────────────────────
//
// Consumers (e.g. `useTokens()`) import `useUIPreferencesStore` directly
// so they don't have to thread an `InitializedStores` reference through
// component props. The default singleton is created at import time with
// the in-memory persistence fallback. At app bootstrap, `initializeStores`
// creates a SQLite-backed store and calls `rebindDefaultUIPreferencesStore`
// to swap the singleton's internals, so the same hook now reads from /
// writes to SQLite.
//
// This is a deliberate one-time handoff: the rebind copies the new store's
// state into the existing hook so currently-mounted components don't lose
// their subscription, then routes all subsequent reads/writes through the
// new store.

let _defaultStore: UIPreferencesStore = createUIPreferencesStore();
let _defaultAppearanceUnsubscribe: (() => void) | null =
  installAppearanceListener(_defaultStore);

/** Proxy hook — delegates to the current default store. */
export const useUIPreferencesStore: UIPreferencesStore = ((selector?: unknown) =>
  // Cast is safe: zustand stores are callable as either bare `(selector)` or
  // with no args (returns the full state via subscriptions inside React).
  (_defaultStore as unknown as (s?: unknown) => unknown)(selector)) as UIPreferencesStore;

// Copy non-hook methods (`getState`, `setState`, `subscribe`, `destroy`)
// from the current store onto the proxy so non-React callers keep working.
// These are re-installed by `rebindDefaultUIPreferencesStore` on every swap.
function mirrorStoreMethods(target: UIPreferencesStore, source: UIPreferencesStore): void {
  (target as unknown as { getState: StoreApi<UIPreferences>['getState'] }).getState =
    source.getState.bind(source);
  (target as unknown as { setState: StoreApi<UIPreferences>['setState'] }).setState =
    source.setState.bind(source);
  (target as unknown as { subscribe: StoreApi<UIPreferences>['subscribe'] }).subscribe =
    source.subscribe.bind(source);
  const destroy = (source as unknown as { destroy?: () => void }).destroy;
  if (typeof destroy === 'function') {
    (target as unknown as { destroy: () => void }).destroy = destroy.bind(source);
  }
}
mirrorStoreMethods(useUIPreferencesStore, _defaultStore);

/**
 * Swap the default store singleton for a new instance. Called once by
 * `initializeStores()` after the SQLite-backed storage adapter is ready.
 *
 * - Copies the current in-memory state into the new store so users who
 *   already interacted with the app pre-bootstrap don't lose their choice.
 * - Tears down the previous `Appearance` listener and installs a new one
 *   bound to the incoming store.
 * - Re-mirrors `getState`/`setState`/`subscribe` onto the proxy so the
 *   exported `useUIPreferencesStore` now points at the new backing store.
 */
export function rebindDefaultUIPreferencesStore(next: UIPreferencesStore): void {
  if (next === _defaultStore) return;

  // Carry forward current state (so the user's pre-hydration choice isn't
  // wiped). The new store will overwrite with SQLite-persisted state once
  // its async `persist` hydration completes — that's the desired final
  // state.
  const prev = _defaultStore.getState();
  next.setState({
    colorScheme: prev.colorScheme,
    shortcutOverrides: { ...prev.shortcutOverrides },
    resolvedSystemScheme: prev.resolvedSystemScheme,
  });

  if (_defaultAppearanceUnsubscribe) {
    _defaultAppearanceUnsubscribe();
    _defaultAppearanceUnsubscribe = null;
  }
  _defaultAppearanceUnsubscribe = installAppearanceListener(next);

  _defaultStore = next;
  mirrorStoreMethods(useUIPreferencesStore, next);
}

// ─── Atomic selectors ────────────────────────────────────────────────────────

/** Atomic selector: current colour-scheme preference. */
export const useColorSchemePreference = (): ColorScheme =>
  useUIPreferencesStore((s) => s.colorScheme);

/** Atomic selector: shortcut overrides map. */
export const useShortcutOverrides = (): Record<string, string> =>
  useUIPreferencesStore((s) => s.shortcutOverrides);

/**
 * Atomic selector: the store's mirror of the OS colour scheme.
 * Consumers (e.g. `useTokens()`) SHOULD use this rather than
 * `Appearance.getColorScheme()` so every view re-renders from a single
 * source of truth.
 */
export const useResolvedSystemScheme = (): ResolvedSystemScheme =>
  useUIPreferencesStore((s) => s.resolvedSystemScheme);

/**
 * Multi-field selector with `useShallow` — returns the full preference
 * snapshot plus the mutator actions. Useful for settings screens.
 */
export const useUIPreferences = () =>
  useUIPreferencesStore(
    useShallow((s) => ({
      colorScheme: s.colorScheme,
      shortcutOverrides: s.shortcutOverrides,
      setColorScheme: s.setColorScheme,
      setShortcutOverride: s.setShortcutOverride,
      clearShortcutOverride: s.clearShortcutOverride,
    })),
  );

/**
 * Test-only escape hatch — tears down the default store's `Appearance`
 * listener. Call this at the end of any test that mounts components using
 * `useTokens()` or `useResolvedSystemScheme` so lingering subscriptions
 * don't leak across test files.
 */
export function __destroyDefaultUIPreferencesStoreListener(): void {
  if (_defaultAppearanceUnsubscribe) {
    _defaultAppearanceUnsubscribe();
    _defaultAppearanceUnsubscribe = null;
  }
}

/**
 * React hook: installs the default store's `Appearance` listener on mount
 * if it was previously torn down (e.g. by a previous test). No-op in normal
 * app runtime where the listener is already installed at module load.
 * Exported for test-harness use.
 */
export function useEnsureDefaultAppearanceListener(): void {
  useEffect(() => {
    if (!_defaultAppearanceUnsubscribe) {
      _defaultAppearanceUnsubscribe = installAppearanceListener(_defaultStore);
    }
  }, []);
}
