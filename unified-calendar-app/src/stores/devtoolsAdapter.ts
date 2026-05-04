/**
 * devtoolsAdapter
 *
 * Thin shim around zustand's `devtools` middleware that disables it where the
 * middleware cannot safely run.
 *
 * Background: zustand v5's devtools middleware reads `import.meta.env` at
 * module-evaluation time. When the JS bundle is served as a classic script
 * (Metro's default for Expo web in dev), `import.meta` is a parse-time syntax
 * error in Chromium — the containing try/catch cannot suppress it, and the
 * whole bundle fails to evaluate, leaving `#root` empty.
 *
 * On native, devtools is only useful when attached to the Redux DevTools
 * bridge (React Native Debugger), so it's fine to gate it there too.
 *
 * This adapter preserves the devtools API surface when enabled and is a
 * transparent pass-through otherwise, so call sites don't change.
 */

import { Platform } from 'react-native';
import { devtools as zustandDevtools } from 'zustand/middleware';

type AnyStateCreator = (set: any, get: any, api: any) => any;

/**
 * Returns true when it's safe to enable the zustand devtools middleware.
 *
 * - Disabled on web: devtools references `import.meta.env`, which errors in
 *   Metro's classic-script bundles.
 * - Disabled in production: per repo steering guidance.
 */
function isDevtoolsEnabled(): boolean {
  if (Platform.OS === 'web') return false;
  // __DEV__ is a global injected by React Native / Metro.
  // Treat anything other than a truthy __DEV__ as production.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const devFlag: unknown = (globalThis as any).__DEV__;
  return devFlag === true;
}

/**
 * Wrap a state creator with zustand's devtools when enabled; otherwise
 * return the state creator unchanged.
 */
export function devtools<T extends AnyStateCreator>(
  initializer: T,
  options?: Parameters<typeof zustandDevtools>[1]
): T {
  if (!isDevtoolsEnabled()) {
    return initializer;
  }
  // Cast back to T so call sites keep their existing typings.
  return zustandDevtools(initializer, options) as unknown as T;
}
