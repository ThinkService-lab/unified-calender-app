/**
 * Responsive layout type definitions.
 * Requirements: 9.5
 */

/** Named breakpoint identifiers */
export type BreakpointName = 'phone' | 'tablet' | 'desktop' | 'wide';

/** Breakpoint width thresholds in pixels */
export interface Breakpoints {
  readonly phone: 320;
  readonly tablet: 768;
  readonly desktop: 1024;
  readonly wide: 1440;
}

/** Navigation style for each breakpoint */
export type NavigationType = 'bottom-tabs' | 'collapsible-sidebar' | 'persistent-sidebar';

/** Default calendar view mode per breakpoint */
export type DefaultViewMode = 'agenda' | 'day' | 'week' | 'month';

/** Layout configuration derived from the current breakpoint */
export interface LayoutConfig {
  /** Current breakpoint name */
  readonly breakpoint: BreakpointName;
  /** Number of visible layout columns (1, 2, or 3) */
  readonly columns: 1 | 2 | 3;
  /** Whether the sidebar is visible */
  readonly showSidebar: boolean;
  /** Whether the sidebar can be collapsed (tablet only) */
  readonly sidebarCollapsible: boolean;
  /** Whether the detail panel is visible */
  readonly showDetailPanel: boolean;
  /** Navigation style */
  readonly navigationType: NavigationType;
  /** Default calendar view mode for this breakpoint */
  readonly defaultViewMode: DefaultViewMode;
  /** Current window width in pixels */
  readonly windowWidth: number;
}
