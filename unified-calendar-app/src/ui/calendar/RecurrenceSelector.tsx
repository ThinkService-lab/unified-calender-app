/**
 * RecurrenceSelector – Recurrence pattern picker for event creation/editing.
 * Supports: None, Daily, Weekly, Monthly, Yearly with interval and end condition.
 * Requirements: 3.4, 3.5
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import type { RecurrenceRule } from '../../types/models';

export type RecurrenceFrequency = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type EndConditionType = 'never' | 'count' | 'until';

export interface RecurrenceConfig {
  frequency: RecurrenceFrequency;
  interval: number;
  endCondition: EndConditionType;
  count: number | null;
  until: Date | null;
}

export interface RecurrenceSelectorProps {
  /** Current recurrence configuration */
  value: RecurrenceConfig;
  /** Called when the recurrence configuration changes */
  onChange: (config: RecurrenceConfig) => void;
}

const FREQUENCY_OPTIONS: { value: RecurrenceFrequency; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

const END_CONDITION_OPTIONS: { value: EndConditionType; label: string }[] = [
  { value: 'never', label: 'Never' },
  { value: 'count', label: 'After N occurrences' },
  { value: 'until', label: 'On date' },
];

/** Get the unit label for a frequency */
export function getFrequencyUnit(frequency: RecurrenceFrequency): string {
  switch (frequency) {
    case 'daily': return 'day(s)';
    case 'weekly': return 'week(s)';
    case 'monthly': return 'month(s)';
    case 'yearly': return 'year(s)';
    default: return '';
  }
}

/** Build a RecurrenceRule from a RecurrenceConfig */
export function buildRecurrenceRule(config: RecurrenceConfig): RecurrenceRule | null {
  if (config.frequency === 'none') return null;

  return {
    frequency: config.frequency,
    interval: Math.max(1, config.interval),
    count: config.endCondition === 'count' ? (config.count ?? 1) : null,
    until: config.endCondition === 'until' ? config.until : null,
    bySecond: null,
    byMinute: null,
    byHour: null,
    byDay: null,
    byMonthDay: null,
    byYearDay: null,
    byWeekNo: null,
    byMonth: null,
    bySetPos: null,
    wkst: 'MO',
    exceptions: [],
  };
}

/** Create a default RecurrenceConfig */
export function defaultRecurrenceConfig(): RecurrenceConfig {
  return {
    frequency: 'none',
    interval: 1,
    endCondition: 'never',
    count: null,
    until: null,
  };
}

/** Create a RecurrenceConfig from an existing RecurrenceRule */
export function recurrenceConfigFromRule(rule: RecurrenceRule | null): RecurrenceConfig {
  if (!rule) return defaultRecurrenceConfig();

  let endCondition: EndConditionType = 'never';
  if (rule.count !== null && rule.count > 0) endCondition = 'count';
  else if (rule.until !== null) endCondition = 'until';

  return {
    frequency: rule.frequency,
    interval: rule.interval,
    endCondition,
    count: rule.count,
    until: rule.until,
  };
}

export function RecurrenceSelector({ value, onChange }: RecurrenceSelectorProps) {
  const handleFrequencyChange = useCallback(
    (frequency: RecurrenceFrequency) => {
      onChange({
        ...value,
        frequency,
        interval: frequency === 'none' ? 1 : value.interval,
        endCondition: frequency === 'none' ? 'never' : value.endCondition,
      });
    },
    [value, onChange],
  );

  const handleIntervalChange = useCallback(
    (text: string) => {
      const parsed = parseInt(text, 10);
      const interval = isNaN(parsed) || parsed < 1 ? 1 : parsed;
      onChange({ ...value, interval });
    },
    [value, onChange],
  );

  const handleEndConditionChange = useCallback(
    (endCondition: EndConditionType) => {
      onChange({
        ...value,
        endCondition,
        count: endCondition === 'count' ? (value.count ?? 10) : value.count,
      });
    },
    [value, onChange],
  );

  const handleCountChange = useCallback(
    (text: string) => {
      const parsed = parseInt(text, 10);
      const count = isNaN(parsed) || parsed < 1 ? 1 : parsed;
      onChange({ ...value, count });
    },
    [value, onChange],
  );

  const handleUntilChange = useCallback(
    (text: string) => {
      const date = new Date(text);
      if (!isNaN(date.getTime())) {
        onChange({ ...value, until: date });
      }
    },
    [value, onChange],
  );

  const showDetails = value.frequency !== 'none';

  return (
    <View style={styles.container}>
      <Text style={styles.label} accessibilityRole="header">
        Recurrence
      </Text>

      {/* Frequency selector */}
      <View style={styles.optionGroup} accessibilityRole="radiogroup" accessibilityLabel="Recurrence frequency">
        {FREQUENCY_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.value}
            style={[
              styles.optionButton,
              value.frequency === option.value && styles.optionButtonSelected,
            ]}
            onPress={() => handleFrequencyChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: value.frequency === option.value }}
            accessibilityLabel={option.label}
          >
            <Text
              style={[
                styles.optionText,
                value.frequency === option.value && styles.optionTextSelected,
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {showDetails && (
        <>
          {/* Interval input */}
          <View style={styles.intervalRow}>
            <Text style={styles.intervalLabel}>Every</Text>
            <TextInput
              style={styles.intervalInput}
              value={String(value.interval)}
              onChangeText={handleIntervalChange}
              keyboardType="number-pad"
              accessibilityLabel={`Repeat every ${value.interval} ${getFrequencyUnit(value.frequency)}`}
              testID="recurrence-interval-input"
            />
            <Text style={styles.intervalUnit}>{getFrequencyUnit(value.frequency)}</Text>
          </View>

          {/* End condition */}
          <Text style={styles.subLabel}>Ends</Text>
          <View style={styles.optionGroup} accessibilityRole="radiogroup" accessibilityLabel="Recurrence end condition">
            {END_CONDITION_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.optionButton,
                  value.endCondition === option.value && styles.optionButtonSelected,
                ]}
                onPress={() => handleEndConditionChange(option.value)}
                accessibilityRole="radio"
                accessibilityState={{ checked: value.endCondition === option.value }}
                accessibilityLabel={option.label}
              >
                <Text
                  style={[
                    styles.optionText,
                    value.endCondition === option.value && styles.optionTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Count input */}
          {value.endCondition === 'count' && (
            <View style={styles.intervalRow}>
              <Text style={styles.intervalLabel}>After</Text>
              <TextInput
                style={styles.intervalInput}
                value={String(value.count ?? 10)}
                onChangeText={handleCountChange}
                keyboardType="number-pad"
                accessibilityLabel={`After ${value.count ?? 10} occurrences`}
                testID="recurrence-count-input"
              />
              <Text style={styles.intervalUnit}>occurrences</Text>
            </View>
          )}

          {/* Until date input */}
          {value.endCondition === 'until' && (
            <View style={styles.intervalRow}>
              <Text style={styles.intervalLabel}>Until</Text>
              <TextInput
                style={[styles.intervalInput, styles.dateInput]}
                value={value.until ? value.until.toISOString().split('T')[0] : ''}
                onChangeText={handleUntilChange}
                placeholder="YYYY-MM-DD"
                accessibilityLabel="End date for recurrence"
                testID="recurrence-until-input"
              />
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#202124',
    marginBottom: 8,
  },
  subLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#5F6368',
    marginTop: 12,
    marginBottom: 6,
  },
  optionGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  optionButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#DADCE0',
    backgroundColor: '#FFFFFF',
  },
  optionButtonSelected: {
    borderColor: '#1A73E8',
    backgroundColor: '#E8F0FE',
  },
  optionText: {
    fontSize: 13,
    color: '#5F6368',
  },
  optionTextSelected: {
    color: '#1A73E8',
    fontWeight: '500',
  },
  intervalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
  },
  intervalLabel: {
    fontSize: 13,
    color: '#5F6368',
  },
  intervalInput: {
    width: 56,
    height: 36,
    borderWidth: 1,
    borderColor: '#DADCE0',
    borderRadius: 6,
    paddingHorizontal: 8,
    fontSize: 14,
    color: '#202124',
    textAlign: 'center',
  },
  dateInput: {
    width: 120,
    textAlign: 'left',
  },
  intervalUnit: {
    fontSize: 13,
    color: '#5F6368',
  },
});
