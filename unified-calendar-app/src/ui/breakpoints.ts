/**
 * Breakpoint constants and resolution logic.
 * Requirements: 9.5
 *
 * Breakpoint thresholds:
 *   phone:   320 – 767 px   → single column, bottom tab nav, agenda/day default
 *   tablet:  768 – 1023 px  → sidebar + main, collapsible nav, week default
 *   desktop: 1024 – 1439 px → sidebar + main + detail panel, week/month default
 *   wide:    ≥ 1440 px      → full three-column layout, month default
 */

import type { Breakpoints, BreakpointName, LayoutConfig } from './types';

/** Pixel thresholds for each breakpoint */
export const BREAKPOINTS: Breakpoints = {
  phone: 320,
  tablet: 768,
  desktop: 1024,
  wide: 1440,
} as const;

/**
 * Resolve a pixel width to its breakpoint name.
 *
 * Widths below the phone threshold (320) still map to 'phone' so the app
 * remains usable on very small screens.
 */
export function resolveBreakpoint(width: number): BreakpointName {
  if (width >= BREAKPOINTS.wide) return 'wide';
  if (width >= BREAKPOINTS.desktop) return 'desktop';
  if (width >= BREAKPOINTS.tablet) return 'tablet';
  return 'phone';
}

/**
 * Build the full layout configuration for a given window width.
 */
export function getLayoutConfig(width: number): LayoutConfig {
  const breakpoint = resolveBreakpoint(width);

  switch (breakpoint) {
    case 'phone':
      return {
        breakpoint: 'phone',
        columns: 1,
        showSidebar: false,
        sidebarCollapsible: false,
        showDetailPanel: false,
        navigationType: 'bottom-tabs',
        defaultViewMode: 'agenda',
        windowWidth: width,
      };

    case 'tablet':
      return {
        breakpoint: 'tablet',
        columns: 2,
        showSidebar: true,
        sidebarCollapsible: true,
        showDetailPanel: false,
        navigationType: 'collapsible-sidebar',
        defaultViewMode: 'week',
        windowWidth: width,
      };

    case 'desktop':
      return {
        breakpoint: 'desktop',
        columns: 3,
        showSidebar: true,
        sidebarCollapsible: false,
        showDetailPanel: true,
        navigationType: 'persistent-sidebar',
        defaultViewMode: 'week',
        windowWidth: width,
      };

    case 'wide':
      return {
        breakpoint: 'wide',
        columns: 3,
        showSidebar: true,
        sidebarCollapsible: false,
        showDetailPanel: true,
        navigationType: 'persistent-sidebar',
        defaultViewMode: 'month',
        windowWidth: width,
      };
  }
}
