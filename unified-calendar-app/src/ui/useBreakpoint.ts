/**
 * useBreakpoint – React hook for responsive layout detection.
 * Requirements: 9.5
 *
 * Uses React Native's `useWindowDimensions` so the value updates
 * automatically on window resize (web) or orientation change (mobile).
 */

import { useWindowDimensions } from 'react-native';
import { useMemo } from 'react';
import { resolveBreakpoint, getLayoutConfig } from './breakpoints';
import type { BreakpointName, LayoutConfig } from './types';

/**
 * Returns the current breakpoint name and full layout configuration.
 *
 * The hook re-renders only when the window width changes, and the
 * layout config is memoised so downstream consumers can rely on
 * referential equality when the breakpoint hasn't changed.
 */
export function useBreakpoint(): LayoutConfig {
  const { width } = useWindowDimensions();

  const layout = useMemo(() => getLayoutConfig(width), [width]);

  return layout;
}

/**
 * Convenience hook that returns just the breakpoint name.
 */
export function useBreakpointName(): BreakpointName {
  const { width } = useWindowDimensions();
  return useMemo(() => resolveBreakpoint(width), [width]);
}
