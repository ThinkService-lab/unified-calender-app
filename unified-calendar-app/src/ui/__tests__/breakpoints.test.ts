/**
 * Unit tests for breakpoint resolution and layout configuration.
 * Requirements: 9.5
 */

import {
  BREAKPOINTS,
  resolveBreakpoint,
  getLayoutConfig,
} from '../breakpoints';
import type { BreakpointName, LayoutConfig } from '../types';

describe('BREAKPOINTS constants', () => {
  it('defines the four required breakpoint thresholds', () => {
    expect(BREAKPOINTS.phone).toBe(320);
    expect(BREAKPOINTS.tablet).toBe(768);
    expect(BREAKPOINTS.desktop).toBe(1024);
    expect(BREAKPOINTS.wide).toBe(1440);
  });
});

describe('resolveBreakpoint', () => {
  const cases: [number, BreakpointName][] = [
    // Phone range
    [0, 'phone'],
    [319, 'phone'],
    [320, 'phone'],
    [500, 'phone'],
    [767, 'phone'],
    // Tablet range
    [768, 'tablet'],
    [800, 'tablet'],
    [1023, 'tablet'],
    // Desktop range
    [1024, 'desktop'],
    [1200, 'desktop'],
    [1439, 'desktop'],
    // Wide range
    [1440, 'wide'],
    [1920, 'wide'],
    [2560, 'wide'],
  ];

  it.each(cases)('width %d → %s', (width, expected) => {
    expect(resolveBreakpoint(width)).toBe(expected);
  });
});

describe('getLayoutConfig', () => {
  describe('phone layout (< 768)', () => {
    const layout = getLayoutConfig(375);

    it('returns phone breakpoint', () => {
      expect(layout.breakpoint).toBe('phone');
    });

    it('uses single column', () => {
      expect(layout.columns).toBe(1);
    });

    it('hides sidebar', () => {
      expect(layout.showSidebar).toBe(false);
    });

    it('hides detail panel', () => {
      expect(layout.showDetailPanel).toBe(false);
    });

    it('uses bottom-tabs navigation', () => {
      expect(layout.navigationType).toBe('bottom-tabs');
    });

    it('defaults to agenda view', () => {
      expect(layout.defaultViewMode).toBe('agenda');
    });

    it('includes the window width', () => {
      expect(layout.windowWidth).toBe(375);
    });
  });

  describe('tablet layout (768–1023)', () => {
    const layout = getLayoutConfig(800);

    it('returns tablet breakpoint', () => {
      expect(layout.breakpoint).toBe('tablet');
    });

    it('uses two columns', () => {
      expect(layout.columns).toBe(2);
    });

    it('shows sidebar', () => {
      expect(layout.showSidebar).toBe(true);
    });

    it('sidebar is collapsible', () => {
      expect(layout.sidebarCollapsible).toBe(true);
    });

    it('hides detail panel', () => {
      expect(layout.showDetailPanel).toBe(false);
    });

    it('uses collapsible-sidebar navigation', () => {
      expect(layout.navigationType).toBe('collapsible-sidebar');
    });

    it('defaults to week view', () => {
      expect(layout.defaultViewMode).toBe('week');
    });
  });

  describe('desktop layout (1024–1439)', () => {
    const layout = getLayoutConfig(1280);

    it('returns desktop breakpoint', () => {
      expect(layout.breakpoint).toBe('desktop');
    });

    it('uses three columns', () => {
      expect(layout.columns).toBe(3);
    });

    it('shows sidebar (not collapsible)', () => {
      expect(layout.showSidebar).toBe(true);
      expect(layout.sidebarCollapsible).toBe(false);
    });

    it('shows detail panel', () => {
      expect(layout.showDetailPanel).toBe(true);
    });

    it('uses persistent-sidebar navigation', () => {
      expect(layout.navigationType).toBe('persistent-sidebar');
    });

    it('defaults to week view', () => {
      expect(layout.defaultViewMode).toBe('week');
    });
  });

  describe('wide layout (≥ 1440)', () => {
    const layout = getLayoutConfig(1920);

    it('returns wide breakpoint', () => {
      expect(layout.breakpoint).toBe('wide');
    });

    it('uses three columns', () => {
      expect(layout.columns).toBe(3);
    });

    it('shows sidebar (not collapsible)', () => {
      expect(layout.showSidebar).toBe(true);
      expect(layout.sidebarCollapsible).toBe(false);
    });

    it('shows detail panel', () => {
      expect(layout.showDetailPanel).toBe(true);
    });

    it('uses persistent-sidebar navigation', () => {
      expect(layout.navigationType).toBe('persistent-sidebar');
    });

    it('defaults to month view', () => {
      expect(layout.defaultViewMode).toBe('month');
    });
  });

  describe('boundary values', () => {
    it('767 is phone', () => {
      expect(getLayoutConfig(767).breakpoint).toBe('phone');
    });

    it('768 is tablet', () => {
      expect(getLayoutConfig(768).breakpoint).toBe('tablet');
    });

    it('1023 is tablet', () => {
      expect(getLayoutConfig(1023).breakpoint).toBe('tablet');
    });

    it('1024 is desktop', () => {
      expect(getLayoutConfig(1024).breakpoint).toBe('desktop');
    });

    it('1439 is desktop', () => {
      expect(getLayoutConfig(1439).breakpoint).toBe('desktop');
    });

    it('1440 is wide', () => {
      expect(getLayoutConfig(1440).breakpoint).toBe('wide');
    });
  });

  describe('extreme widths', () => {
    it('very small width (0) maps to phone', () => {
      const layout = getLayoutConfig(0);
      expect(layout.breakpoint).toBe('phone');
      expect(layout.columns).toBe(1);
    });

    it('very large width (4000) maps to wide', () => {
      const layout = getLayoutConfig(4000);
      expect(layout.breakpoint).toBe('wide');
      expect(layout.columns).toBe(3);
    });
  });
});
