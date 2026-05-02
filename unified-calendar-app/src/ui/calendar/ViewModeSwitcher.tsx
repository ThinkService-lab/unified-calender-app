/**
 * ViewModeSwitcher – UI control to switch between calendar display modes.
 * Uses Design Token System for consistent theming.
 * Requirements: 1.5, 2.2
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import type { DefaultViewMode } from '../types';
import { useTokens } from '../tokens/designTokens';

export interface ViewModeSwitcherProps {
  currentMode: DefaultViewMode;
  onModeChange: (mode: DefaultViewMode) => void;
}

const VIEW_MODES: { key: DefaultViewMode; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'agenda', label: 'Agenda' },
];

export function ViewModeSwitcher({ currentMode, onModeChange }: ViewModeSwitcherProps) {
  const tokens = useTokens();

  return (
    <View
      style={[styles.container, { backgroundColor: tokens.colors.borderLight, borderRadius: tokens.radii.md }]}
      accessibilityRole="tablist"
      accessibilityLabel="Calendar view mode"
    >
      {VIEW_MODES.map(({ key, label }) => {
        const isActive = currentMode === key;
        return (
          <TouchableOpacity
            key={key}
            style={[
              styles.tab,
              { borderRadius: tokens.radii.md - 2 },
              isActive && [
                styles.tabActive,
                {
                  backgroundColor: tokens.colors.surface,
                  ...(Platform.OS === 'web'
                    ? ({ boxShadow: `0 1px 3px ${tokens.shadows.sm.shadowColor}` } as any)
                    : { elevation: tokens.shadows.sm.elevation }),
                },
              ],
            ]}
            onPress={() => onModeChange(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`${label} view`}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.tabText,
                {
                  color: isActive ? tokens.colors.primary : tokens.colors.textSecondary,
                  fontWeight: isActive
                    ? tokens.typography.weights.semibold
                    : tokens.typography.weights.medium,
                },
              ]}
            >
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    padding: 2,
    alignSelf: 'center',
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 56,
    alignItems: 'center',
  },
  tabActive: {},
  tabText: {
    fontSize: 13,
  },
});
