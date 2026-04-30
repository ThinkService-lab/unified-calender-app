/**
 * ResponsiveLayout – Adaptive container that renders the appropriate
 * layout structure based on the current breakpoint.
 *
 * Requirements: 9.5
 *
 * Layout variants:
 *   phone   → single column with bottom tab navigation
 *   tablet  → sidebar (collapsible) + main content area
 *   desktop → sidebar + main content + detail panel
 *   wide    → full three-column layout (sidebar | main | detail)
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Platform,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { useBreakpoint } from './useBreakpoint';
import type { LayoutConfig } from './types';

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export interface ResponsiveLayoutProps {
  /** Sidebar / calendar list content */
  sidebar?: React.ReactNode;
  /** Primary content area (calendar view) */
  children: React.ReactNode;
  /** Detail panel content (event detail) */
  detailPanel?: React.ReactNode;
  /** Bottom tab navigation (phone only) */
  bottomNav?: React.ReactNode;
  /** Optional style override for the root container */
  style?: StyleProp<ViewStyle>;
}

export interface ResponsiveLayoutRef {
  /** Toggle the sidebar on tablet (no-op on other breakpoints) */
  toggleSidebar: () => void;
  /** Current layout configuration */
  layout: LayoutConfig;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SIDEBAR_WIDTH = 260;
const SIDEBAR_COLLAPSED_WIDTH = 0;
const DETAIL_PANEL_WIDTH = 340;
const BOTTOM_NAV_HEIGHT = 56;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ResponsiveLayout({
  sidebar,
  children,
  detailPanel,
  bottomNav,
  style,
}: ResponsiveLayoutProps) {
  const layout = useBreakpoint();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const toggleSidebar = useCallback(() => {
    if (layout.sidebarCollapsible) {
      setSidebarCollapsed((prev) => !prev);
    }
  }, [layout.sidebarCollapsible]);

  /* ---- Phone layout ---- */
  if (layout.breakpoint === 'phone') {
    return (
      <View style={[styles.root, style]}>
        <View style={styles.mainFull}>{children}</View>
        {bottomNav && (
          <View style={styles.bottomNav}>{bottomNav}</View>
        )}
      </View>
    );
  }

  /* ---- Tablet layout ---- */
  if (layout.breakpoint === 'tablet') {
    const sidebarWidth = sidebarCollapsed
      ? SIDEBAR_COLLAPSED_WIDTH
      : SIDEBAR_WIDTH;

    return (
      <View style={[styles.root, style]}>
        <View style={styles.row}>
          {layout.showSidebar && !sidebarCollapsed && (
            <View style={[styles.sidebar, { width: sidebarWidth }]}>
              {sidebar}
            </View>
          )}
          <View style={styles.mainFlex}>{children}</View>
        </View>
      </View>
    );
  }

  /* ---- Desktop / Wide layout ---- */
  return (
    <View style={[styles.root, style]}>
      <View style={styles.row}>
        {layout.showSidebar && (
          <View style={[styles.sidebar, { width: SIDEBAR_WIDTH }]}>
            {sidebar}
          </View>
        )}
        <View style={styles.mainFlex}>{children}</View>
        {layout.showDetailPanel && detailPanel && (
          <View style={[styles.detailPanel, { width: DETAIL_PANEL_WIDTH }]}>
            {detailPanel}
          </View>
        )}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  row: {
    flex: 1,
    flexDirection: 'row',
  },
  mainFull: {
    flex: 1,
  },
  mainFlex: {
    flex: 1,
  },
  sidebar: {
    backgroundColor: '#FFFFFF',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#E0E0E0',
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '1px 0 4px rgba(0,0,0,0.04)' } as any)
      : {}),
  },
  detailPanel: {
    backgroundColor: '#FFFFFF',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: '#E0E0E0',
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '-1px 0 4px rgba(0,0,0,0.04)' } as any)
      : {}),
  },
  bottomNav: {
    height: BOTTOM_NAV_HEIGHT,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E0E0E0',
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '0 -1px 4px rgba(0,0,0,0.06)' } as any)
      : {}),
  },
});
