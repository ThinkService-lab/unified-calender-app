/**
 * Unit tests for useBreakpoint and useBreakpointName hooks.
 * Requirements: 9.5
 *
 * Since the project uses a node test environment without a React renderer,
 * we mock both react-native's useWindowDimensions and React's useMemo
 * to test the hook logic in isolation. The underlying breakpoint resolution
 * and layout config generation are thoroughly tested in breakpoints.test.ts.
 */

let mockWidth = 1024;

// Mock react-native
jest.mock('react-native', () => ({
  useWindowDimensions: () => ({ width: mockWidth, height: 768 }),
  Platform: { OS: 'web' },
  StyleSheet: {
    create: (styles: Record<string, any>) => styles,
    hairlineWidth: 1,
  },
}));

// Mock React's useMemo to just execute the factory (no memoization needed in tests)
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useMemo: (factory: () => any, _deps: any[]) => factory(),
}));

import { useBreakpoint, useBreakpointName } from '../useBreakpoint';

describe('useBreakpoint', () => {
  beforeEach(() => {
    mockWidth = 1024;
  });

  it('returns a LayoutConfig object with all required fields', () => {
    const result = useBreakpoint();
    expect(result).toHaveProperty('breakpoint');
    expect(result).toHaveProperty('columns');
    expect(result).toHaveProperty('showSidebar');
    expect(result).toHaveProperty('sidebarCollapsible');
    expect(result).toHaveProperty('showDetailPanel');
    expect(result).toHaveProperty('navigationType');
    expect(result).toHaveProperty('defaultViewMode');
    expect(result).toHaveProperty('windowWidth');
  });

  it('returns phone layout for small widths', () => {
    mockWidth = 375;
    const result = useBreakpoint();
    expect(result.breakpoint).toBe('phone');
    expect(result.columns).toBe(1);
    expect(result.showSidebar).toBe(false);
    expect(result.showDetailPanel).toBe(false);
    expect(result.navigationType).toBe('bottom-tabs');
    expect(result.defaultViewMode).toBe('agenda');
  });

  it('returns tablet layout for medium widths', () => {
    mockWidth = 800;
    const result = useBreakpoint();
    expect(result.breakpoint).toBe('tablet');
    expect(result.columns).toBe(2);
    expect(result.showSidebar).toBe(true);
    expect(result.sidebarCollapsible).toBe(true);
    expect(result.defaultViewMode).toBe('week');
  });

  it('returns desktop layout for large widths', () => {
    mockWidth = 1280;
    const result = useBreakpoint();
    expect(result.breakpoint).toBe('desktop');
    expect(result.columns).toBe(3);
    expect(result.showSidebar).toBe(true);
    expect(result.showDetailPanel).toBe(true);
    expect(result.defaultViewMode).toBe('week');
  });

  it('returns wide layout for very large widths', () => {
    mockWidth = 1920;
    const result = useBreakpoint();
    expect(result.breakpoint).toBe('wide');
    expect(result.columns).toBe(3);
    expect(result.showDetailPanel).toBe(true);
    expect(result.defaultViewMode).toBe('month');
  });

  it('includes the current window width in the result', () => {
    mockWidth = 1024;
    const result = useBreakpoint();
    expect(result.windowWidth).toBe(1024);
  });

  it('phone layout uses bottom-tabs navigation', () => {
    mockWidth = 320;
    const result = useBreakpoint();
    expect(result.navigationType).toBe('bottom-tabs');
  });

  it('tablet layout uses collapsible-sidebar navigation', () => {
    mockWidth = 768;
    const result = useBreakpoint();
    expect(result.navigationType).toBe('collapsible-sidebar');
  });

  it('desktop layout uses persistent-sidebar navigation', () => {
    mockWidth = 1024;
    const result = useBreakpoint();
    expect(result.navigationType).toBe('persistent-sidebar');
  });

  it('wide layout uses persistent-sidebar navigation', () => {
    mockWidth = 1440;
    const result = useBreakpoint();
    expect(result.navigationType).toBe('persistent-sidebar');
  });
});

describe('useBreakpointName', () => {
  it('returns just the breakpoint name string for phone', () => {
    mockWidth = 375;
    expect(useBreakpointName()).toBe('phone');
  });

  it('returns tablet for tablet-range widths', () => {
    mockWidth = 900;
    expect(useBreakpointName()).toBe('tablet');
  });

  it('returns desktop for desktop-range widths', () => {
    mockWidth = 1200;
    expect(useBreakpointName()).toBe('desktop');
  });

  it('returns wide for wide-range widths', () => {
    mockWidth = 2560;
    expect(useBreakpointName()).toBe('wide');
  });

  it('returns phone for very small widths', () => {
    mockWidth = 0;
    expect(useBreakpointName()).toBe('phone');
  });
});
