/**
 * Unit tests for ResponsiveLayout component module.
 * Requirements: 9.5
 *
 * Tests verify the layout system's structural contracts and configuration.
 * The component renders different layouts per breakpoint:
 *   - Phone: single column with bottom tab navigation
 *   - Tablet: sidebar + main content, collapsible navigation
 *   - Desktop: sidebar + main + detail panel
 *   - Wide: full three-column layout
 *
 * Since the project uses a node test environment without a React renderer
 * or JSX transform, we test the layout logic through the pure functions
 * in breakpoints.ts and verify the component's behavioral contracts.
 */

import {
  BREAKPOINTS,
  resolveBreakpoint,
  getLayoutConfig,
} from '../breakpoints';
import type { LayoutConfig, BreakpointName } from '../types';

describe('ResponsiveLayout behavioral contracts', () => {
  describe('phone layout (320–767px)', () => {
    it('renders single column layout', () => {
      const config = getLayoutConfig(375);
      expect(config.columns).toBe(1);
    });

    it('does not show sidebar', () => {
      const config = getLayoutConfig(375);
      expect(config.showSidebar).toBe(false);
    });

    it('does not show detail panel', () => {
      const config = getLayoutConfig(375);
      expect(config.showDetailPanel).toBe(false);
    });

    it('uses bottom tab navigation', () => {
      const config = getLayoutConfig(375);
      expect(config.navigationType).toBe('bottom-tabs');
    });

    it('defaults to agenda/day view', () => {
      const config = getLayoutConfig(375);
      expect(['agenda', 'day']).toContain(config.defaultViewMode);
    });
  });

  describe('tablet layout (768–1023px)', () => {
    it('renders two-column layout (sidebar + main)', () => {
      const config = getLayoutConfig(800);
      expect(config.columns).toBe(2);
    });

    it('shows sidebar', () => {
      const config = getLayoutConfig(800);
      expect(config.showSidebar).toBe(true);
    });

    it('sidebar is collapsible', () => {
      const config = getLayoutConfig(800);
      expect(config.sidebarCollapsible).toBe(true);
    });

    it('does not show detail panel', () => {
      const config = getLayoutConfig(800);
      expect(config.showDetailPanel).toBe(false);
    });

    it('defaults to week view', () => {
      const config = getLayoutConfig(800);
      expect(config.defaultViewMode).toBe('week');
    });
  });

  describe('desktop layout (1024–1439px)', () => {
    it('renders three-column layout (sidebar + main + detail)', () => {
      const config = getLayoutConfig(1280);
      expect(config.columns).toBe(3);
    });

    it('shows sidebar (not collapsible)', () => {
      const config = getLayoutConfig(1280);
      expect(config.showSidebar).toBe(true);
      expect(config.sidebarCollapsible).toBe(false);
    });

    it('shows detail panel', () => {
      const config = getLayoutConfig(1280);
      expect(config.showDetailPanel).toBe(true);
    });

    it('defaults to week or month view', () => {
      const config = getLayoutConfig(1280);
      expect(['week', 'month']).toContain(config.defaultViewMode);
    });
  });

  describe('wide layout (≥1440px)', () => {
    it('renders full three-column layout', () => {
      const config = getLayoutConfig(1920);
      expect(config.columns).toBe(3);
    });

    it('shows sidebar (not collapsible)', () => {
      const config = getLayoutConfig(1920);
      expect(config.showSidebar).toBe(true);
      expect(config.sidebarCollapsible).toBe(false);
    });

    it('shows detail panel', () => {
      const config = getLayoutConfig(1920);
      expect(config.showDetailPanel).toBe(true);
    });

    it('defaults to month view', () => {
      const config = getLayoutConfig(1920);
      expect(config.defaultViewMode).toBe('month');
    });
  });

  describe('layout progression', () => {
    it('columns increase from phone to desktop', () => {
      const phone = getLayoutConfig(375);
      const tablet = getLayoutConfig(800);
      const desktop = getLayoutConfig(1280);
      expect(phone.columns).toBeLessThan(tablet.columns);
      expect(tablet.columns).toBeLessThanOrEqual(desktop.columns);
    });

    it('sidebar becomes visible at tablet breakpoint', () => {
      const phone = getLayoutConfig(375);
      const tablet = getLayoutConfig(800);
      expect(phone.showSidebar).toBe(false);
      expect(tablet.showSidebar).toBe(true);
    });

    it('detail panel becomes visible at desktop breakpoint', () => {
      const tablet = getLayoutConfig(800);
      const desktop = getLayoutConfig(1280);
      expect(tablet.showDetailPanel).toBe(false);
      expect(desktop.showDetailPanel).toBe(true);
    });

    it('sidebar collapsibility is only on tablet', () => {
      const phone = getLayoutConfig(375);
      const tablet = getLayoutConfig(800);
      const desktop = getLayoutConfig(1280);
      const wide = getLayoutConfig(1920);
      expect(phone.sidebarCollapsible).toBe(false);
      expect(tablet.sidebarCollapsible).toBe(true);
      expect(desktop.sidebarCollapsible).toBe(false);
      expect(wide.sidebarCollapsible).toBe(false);
    });
  });

  describe('all breakpoints have valid layout configs', () => {
    const breakpointWidths: [BreakpointName, number][] = [
      ['phone', 375],
      ['tablet', 800],
      ['desktop', 1280],
      ['wide', 1920],
    ];

    it.each(breakpointWidths)(
      '%s layout has all required fields',
      (name, width) => {
        const config = getLayoutConfig(width);
        expect(config.breakpoint).toBe(name);
        expect(typeof config.columns).toBe('number');
        expect(typeof config.showSidebar).toBe('boolean');
        expect(typeof config.sidebarCollapsible).toBe('boolean');
        expect(typeof config.showDetailPanel).toBe('boolean');
        expect(typeof config.navigationType).toBe('string');
        expect(typeof config.defaultViewMode).toBe('string');
        expect(typeof config.windowWidth).toBe('number');
      },
    );

    it.each(breakpointWidths)(
      '%s layout has valid navigation type',
      (name, width) => {
        const config = getLayoutConfig(width);
        expect(['bottom-tabs', 'collapsible-sidebar', 'persistent-sidebar']).toContain(
          config.navigationType,
        );
      },
    );

    it.each(breakpointWidths)(
      '%s layout has valid default view mode',
      (name, width) => {
        const config = getLayoutConfig(width);
        expect(['agenda', 'day', 'week', 'month']).toContain(
          config.defaultViewMode,
        );
      },
    );
  });
});
