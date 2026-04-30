/**
 * ViewModeSwitcher – UI control to switch between calendar display modes.
 * Requirements: 2.2
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import type { DefaultViewMode } from '../types';

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
  return (
    <View
      style={styles.container}
      accessibilityRole="tablist"
      accessibilityLabel="Calendar view mode"
    >
      {VIEW_MODES.map(({ key, label }) => {
        const isActive = currentMode === key;
        return (
          <TouchableOpacity
            key={key}
            style={[styles.tab, isActive && styles.tabActive]}
            onPress={() => onModeChange(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`${label} view`}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
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
    backgroundColor: '#F1F3F4',
    borderRadius: 8,
    padding: 2,
    alignSelf: 'center',
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    minWidth: 56,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: '#FFFFFF',
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '0 1px 3px rgba(0,0,0,0.12)' } as any)
      : { elevation: 2 }),
  },
  tabText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#5F6368',
  },
  tabTextActive: {
    color: '#1A73E8',
    fontWeight: '600',
  },
});
