/**
 * Keyboard Shortcut Manager — registers, resolves, and dispatches keyboard
 * shortcuts on web and desktop platforms.
 *
 * Maps single-key and modifier-key combinations to calendar actions.
 * Suppresses shortcuts when a text input has focus. Announces each action
 * to screen readers via ARIA live regions.
 *
 * No-op on mobile (iOS / Android).
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8
 */

import { useEffect, useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useScreenReaderAnnouncement } from '../accessibility/useAccessibility';
import type { DefaultViewMode } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ShortcutDefinition {
  key: string;
  modifiers?: ('ctrl' | 'shift' | 'alt' | 'meta')[];
  action: () => void;
  label: string;
  category: 'navigation' | 'creation' | 'view-switching';
}

export interface KeyboardShortcutManager {
  /** Register a shortcut. */
  register(shortcut: ShortcutDefinition): void;
  /** Unregister a shortcut by key. */
  unregister(key: string): void;
  /** Get all registered shortcuts grouped by category. */
  getShortcuts(): Record<string, ShortcutDefinition[]>;
  /** Whether shortcuts are currently suppressed (text input focused). */
  isSuppressed: boolean;
  /** Suppress / unsuppress shortcuts manually. */
  setSuppressed(suppressed: boolean): void;
}

export interface UseKeyboardShortcutsConfig {
  onOpenQuickCreate: () => void;
  onNavigateToday: () => void;
  onSwitchView: (mode: DefaultViewMode) => void;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
  onShowHelp: () => void;
  /** Called when Escape is pressed. Typically dismisses the help overlay. */
  onDismissHelp?: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns `true` when the event target is a text-entry element. */
function isTextInputFocused(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;

  const tagName = target.tagName?.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea') return true;
  if (target.isContentEditable) return true;

  return false;
}

/** Check whether the required modifier keys match the event. */
function modifiersMatch(
  event: KeyboardEvent,
  modifiers?: ('ctrl' | 'shift' | 'alt' | 'meta')[],
): boolean {
  const required = modifiers ?? [];
  const ctrl = required.includes('ctrl');
  const shift = required.includes('shift');
  const alt = required.includes('alt');
  const meta = required.includes('meta');

  // For single-character keys produced by Shift (like '?', '!', '+'),
  // the browser sets event.shiftKey = true even though the user's intent
  // is to type that character, not to use Shift as a modifier. We skip
  // the Shift check when the registered shortcut has no explicit 'shift'
  // modifier AND the key is a non-alphanumeric printable character that
  // inherently requires Shift on standard keyboard layouts.
  const isShiftedCharacter =
    !shift && event.key.length === 1 && /[^a-zA-Z0-9]/.test(event.key);

  return (
    event.ctrlKey === ctrl &&
    (isShiftedCharacter || event.shiftKey === shift) &&
    event.altKey === alt &&
    event.metaKey === meta
  );
}

// ─── No-op manager for mobile ────────────────────────────────────────────────

const NOOP_MANAGER: KeyboardShortcutManager = {
  register: () => {},
  unregister: () => {},
  getShortcuts: () => ({}),
  isSuppressed: false,
  setSuppressed: () => {},
};

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Hook that creates and manages keyboard shortcuts for web / desktop.
 * Returns a no-op manager on mobile platforms.
 */
export function useKeyboardShortcuts(
  config: UseKeyboardShortcutsConfig,
): KeyboardShortcutManager {
  // No-op on mobile
  if (Platform.OS !== 'web') {
    return NOOP_MANAGER;
  }

  return useKeyboardShortcutsWeb(config);
}

/**
 * Internal web-only implementation. Extracted so the mobile early-return
 * above doesn't violate the rules-of-hooks (the call is always reached on
 * web and never reached on mobile).
 */
function useKeyboardShortcutsWeb(
  config: UseKeyboardShortcutsConfig,
): KeyboardShortcutManager {
  const { announce } = useScreenReaderAnnouncement();

  // Stable refs so the keydown handler always sees the latest callbacks
  // without needing to re-register the listener.
  const configRef = useRef(config);
  configRef.current = config;

  const announceRef = useRef(announce);
  announceRef.current = announce;

  // Shortcut registry — mutable map keyed by `key` string.
  const registryRef = useRef<Map<string, ShortcutDefinition>>(new Map());

  // Suppression state
  const [suppressed, setSuppressedState] = useState(false);
  const suppressedRef = useRef(suppressed);
  suppressedRef.current = suppressed;

  // ── Build default shortcuts (once) ──────────────────────────────────────

  useEffect(() => {
    const cfg = configRef.current;
    const ann = announceRef.current;

    const defaults: ShortcutDefinition[] = [
      {
        key: 'c',
        action: () => {
          configRef.current.onOpenQuickCreate();
          announceRef.current('Quick create opened', 'polite');
        },
        label: 'Open Quick Create',
        category: 'creation',
      },
      {
        key: 't',
        action: () => {
          configRef.current.onNavigateToday();
          announceRef.current('Navigated to today', 'polite');
        },
        label: 'Navigate to today',
        category: 'navigation',
      },
      {
        key: '1',
        action: () => {
          configRef.current.onSwitchView('day');
          announceRef.current('Switched to day view', 'polite');
        },
        label: 'Switch to Day view',
        category: 'view-switching',
      },
      {
        key: '2',
        action: () => {
          configRef.current.onSwitchView('week');
          announceRef.current('Switched to week view', 'polite');
        },
        label: 'Switch to Week view',
        category: 'view-switching',
      },
      {
        key: '3',
        action: () => {
          configRef.current.onSwitchView('month');
          announceRef.current('Switched to month view', 'polite');
        },
        label: 'Switch to Month view',
        category: 'view-switching',
      },
      {
        key: '4',
        action: () => {
          configRef.current.onSwitchView('agenda');
          announceRef.current('Switched to agenda view', 'polite');
        },
        label: 'Switch to Agenda view',
        category: 'view-switching',
      },
      {
        key: 'ArrowLeft',
        action: () => {
          configRef.current.onNavigateBack();
          announceRef.current('Navigated backward', 'polite');
        },
        label: 'Navigate backward',
        category: 'navigation',
      },
      {
        key: 'ArrowRight',
        action: () => {
          configRef.current.onNavigateForward();
          announceRef.current('Navigated forward', 'polite');
        },
        label: 'Navigate forward',
        category: 'navigation',
      },
      {
        key: '?',
        action: () => {
          configRef.current.onShowHelp();
          announceRef.current('Shortcut help overlay opened', 'polite');
        },
        label: 'Show keyboard shortcuts',
        category: 'navigation',
      },
      {
        key: 'Escape',
        action: () => {
          const dismiss = configRef.current.onDismissHelp ?? configRef.current.onShowHelp;
          dismiss();
          announceRef.current('Shortcut help overlay dismissed', 'polite');
        },
        label: 'Dismiss overlay',
        category: 'navigation',
      },
    ];

    const registry = registryRef.current;
    for (const shortcut of defaults) {
      registry.set(shortcut.key, shortcut);
    }
  }, []); // run once on mount

  // ── Keydown listener ────────────────────────────────────────────────────

  useEffect(() => {
    if (typeof document === 'undefined') return;

    function handleKeyDown(event: KeyboardEvent) {
      // Auto-suppress when a text input has focus
      if (isTextInputFocused(event)) return;

      // Manual suppression
      if (suppressedRef.current) return;

      const shortcut = registryRef.current.get(event.key);
      if (!shortcut) return;

      // Check modifiers
      if (!modifiersMatch(event, shortcut.modifiers)) return;

      event.preventDefault();
      shortcut.action();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // ── Manager API ─────────────────────────────────────────────────────────

  const register = useCallback((shortcut: ShortcutDefinition) => {
    registryRef.current.set(shortcut.key, shortcut);
  }, []);

  const unregister = useCallback((key: string) => {
    registryRef.current.delete(key);
  }, []);

  const getShortcuts = useCallback((): Record<string, ShortcutDefinition[]> => {
    const grouped: Record<string, ShortcutDefinition[]> = {};
    for (const shortcut of registryRef.current.values()) {
      const cat = shortcut.category;
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(shortcut);
    }
    return grouped;
  }, []);

  const setSuppressed = useCallback((value: boolean) => {
    setSuppressedState(value);
    suppressedRef.current = value;
  }, []);

  return {
    register,
    unregister,
    getShortcuts,
    isSuppressed: suppressed,
    setSuppressed,
  };
}
