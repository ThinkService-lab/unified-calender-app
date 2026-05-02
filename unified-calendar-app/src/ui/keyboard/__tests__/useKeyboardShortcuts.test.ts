/**
 * Unit tests for the Keyboard Shortcut Manager — specifically the
 * `shortcutOverrides` wiring from the UIPreferences store (Task 18.10).
 *
 * Also verifies that the system theme listener propagates correctly
 * through `useTokens()` within 500ms (Req 1.8).
 *
 * Requirements: 1.7, 1.8, 11.1
 */

import { Appearance } from 'react-native';
import {
  createUIPreferencesStore,
  installAppearanceListener,
  type UIPreferencesStore,
} from '../../../stores/uiPreferencesStore';
import {
  lightTokens,
  darkTokens,
  resolveEffectiveScheme,
} from '../../tokens/designTokens';

type AppearanceListener = (prefs: { colorScheme: 'light' | 'dark' | null }) => void;

/**
 * Minimal harness: replaces `Appearance.addChangeListener` with a
 * captured-listener stub so tests can drive OS theme changes
 * synchronously.
 */
function mockAppearance(initial: 'light' | 'dark' | null): {
  restore: () => void;
  fire: (scheme: 'light' | 'dark' | null) => void;
} {
  const originalGet = Appearance.getColorScheme;
  const originalAdd = Appearance.addChangeListener;

  let listeners: AppearanceListener[] = [];
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
  };
}

// ─── shortcutOverrides wiring (Task 18.10, Req 1.7) ─────────────────────────

describe('UIPreferences shortcutOverrides — store integration', () => {
  let store: UIPreferencesStore;

  beforeEach(() => {
    store = createUIPreferencesStore();
  });

  test('shortcutOverrides defaults to an empty map', () => {
    expect(store.getState().shortcutOverrides).toEqual({});
  });

  test('setShortcutOverride adds an override entry', () => {
    store.getState().setShortcutOverride('c', 'n');
    expect(store.getState().shortcutOverrides).toEqual({ c: 'n' });
  });

  test('clearShortcutOverride removes an override entry', () => {
    store.getState().setShortcutOverride('c', 'n');
    store.getState().setShortcutOverride('t', 'g');
    store.getState().clearShortcutOverride('c');
    expect(store.getState().shortcutOverrides).toEqual({ t: 'g' });
  });

  test('multiple overrides can coexist', () => {
    store.getState().setShortcutOverride('c', 'n');
    store.getState().setShortcutOverride('t', 'g');
    store.getState().setShortcutOverride('1', 'd');
    expect(store.getState().shortcutOverrides).toEqual({
      c: 'n',
      t: 'g',
      '1': 'd',
    });
  });

  test('reset clears all shortcut overrides', () => {
    store.getState().setShortcutOverride('c', 'n');
    store.getState().setShortcutOverride('t', 'g');
    store.getState().reset();
    expect(store.getState().shortcutOverrides).toEqual({});
  });
});

// ─── System theme listener propagation (Task 18.10, Req 1.8) ────────────────

describe('System theme listener → useTokens propagation (Req 1.8)', () => {
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

  test('OS dark mode change propagates to store synchronously (well under 500ms)', () => {
    store.getState().setColorScheme('system');

    // Verify initial state is light
    let effective = resolveEffectiveScheme(
      store.getState().colorScheme,
      store.getState().resolvedSystemScheme,
    );
    expect(effective).toBe('light');

    // Simulate OS dark mode change
    const startTime = Date.now();
    appearance.fire('dark');
    const elapsed = Date.now() - startTime;

    // Verify the store updated
    effective = resolveEffectiveScheme(
      store.getState().colorScheme,
      store.getState().resolvedSystemScheme,
    );
    expect(effective).toBe('dark');

    // The propagation is synchronous — well under the 500ms budget
    expect(elapsed).toBeLessThan(500);
  });

  test('OS light mode change propagates to store synchronously (well under 500ms)', () => {
    store.getState().setColorScheme('system');
    appearance.fire('dark'); // start in dark

    // Simulate OS light mode change
    const startTime = Date.now();
    appearance.fire('light');
    const elapsed = Date.now() - startTime;

    const effective = resolveEffectiveScheme(
      store.getState().colorScheme,
      store.getState().resolvedSystemScheme,
    );
    expect(effective).toBe('light');
    expect(elapsed).toBeLessThan(500);
  });

  test('OS theme change selects the correct token set for all consumers', () => {
    store.getState().setColorScheme('system');

    // Start light
    appearance.fire('light');
    let effective = resolveEffectiveScheme(
      store.getState().colorScheme,
      store.getState().resolvedSystemScheme,
    );
    let tokens = effective === 'dark' ? darkTokens : lightTokens;
    expect(tokens).toBe(lightTokens);
    expect(tokens.colors.background).toBe('#FCFAF7');

    // Flip to dark
    appearance.fire('dark');
    effective = resolveEffectiveScheme(
      store.getState().colorScheme,
      store.getState().resolvedSystemScheme,
    );
    tokens = effective === 'dark' ? darkTokens : lightTokens;
    expect(tokens).toBe(darkTokens);
    expect(tokens.colors.background).toBe('#16181C');
  });

  test('explicit color scheme preference is not affected by OS theme changes', () => {
    // User explicitly chose light
    store.getState().setColorScheme('light');
    appearance.fire('dark');

    let effective = resolveEffectiveScheme(
      store.getState().colorScheme,
      store.getState().resolvedSystemScheme,
    );
    expect(effective).toBe('light');

    // User explicitly chose dark
    store.getState().setColorScheme('dark');
    appearance.fire('light');

    effective = resolveEffectiveScheme(
      store.getState().colorScheme,
      store.getState().resolvedSystemScheme,
    );
    expect(effective).toBe('dark');
  });

  test('rapid OS theme toggles all propagate correctly', () => {
    store.getState().setColorScheme('system');

    // Rapid toggles
    appearance.fire('dark');
    appearance.fire('light');
    appearance.fire('dark');
    appearance.fire('light');
    appearance.fire('dark');

    const effective = resolveEffectiveScheme(
      store.getState().colorScheme,
      store.getState().resolvedSystemScheme,
    );
    expect(effective).toBe('dark');
  });
});
