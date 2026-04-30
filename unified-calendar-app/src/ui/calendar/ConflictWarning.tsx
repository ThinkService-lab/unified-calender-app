/**
 * ConflictWarning – Displays scheduling conflicts and alternative time suggestions.
 * Shows conflicting event details and up to 3 alternative time slots from the conflict detector.
 * Requirements: 7.2, 7.3
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import type { Conflict, TimeSlot } from '../../types/scheduling';

export interface ConflictWarningProps {
  /** Detected conflicts for the current event */
  conflicts: Conflict[];
  /** Alternative time suggestions (up to 3) */
  alternatives: TimeSlot[];
  /** Called when user selects an alternative time */
  onSelectAlternative: (slot: TimeSlot) => void;
  /** Called when user dismisses the warning and keeps original time */
  onKeepOriginal: () => void;
}

/** Format a Date to a readable time string (e.g., "2:30 PM") */
function formatDisplayTime(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  const displayMinutes = minutes.toString().padStart(2, '0');
  return `${displayHour}:${displayMinutes} ${ampm}`;
}

/** Format a Date to a short date string (e.g., "Mon Jan 15") */
function formatDisplayDate(date: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[date.getDay()]} ${months[date.getMonth()]} ${date.getDate()}`;
}

/** Format a time slot as a readable range */
export function formatTimeSlot(slot: TimeSlot): string {
  const sameDay =
    slot.start.getFullYear() === slot.end.getFullYear() &&
    slot.start.getMonth() === slot.end.getMonth() &&
    slot.start.getDate() === slot.end.getDate();

  if (sameDay) {
    return `${formatDisplayDate(slot.start)}, ${formatDisplayTime(slot.start)} – ${formatDisplayTime(slot.end)}`;
  }
  return `${formatDisplayDate(slot.start)} ${formatDisplayTime(slot.start)} – ${formatDisplayDate(slot.end)} ${formatDisplayTime(slot.end)}`;
}

export function ConflictWarning({
  conflicts,
  alternatives,
  onSelectAlternative,
  onKeepOriginal,
}: ConflictWarningProps) {
  if (conflicts.length === 0) return null;

  const displayAlternatives = alternatives.slice(0, 3);

  return (
    <View
      style={styles.container}
      accessibilityRole="alert"
      accessibilityLabel={`Scheduling conflict detected with ${conflicts.length} event${conflicts.length > 1 ? 's' : ''}`}
    >
      {/* Warning header */}
      <View style={styles.header}>
        <Text style={styles.warningIcon}>⚠</Text>
        <Text style={styles.headerText}>
          Scheduling conflict{conflicts.length > 1 ? 's' : ''} detected
        </Text>
      </View>

      {/* Conflicting events list */}
      <View style={styles.conflictList}>
        {conflicts.map((conflict) => {
          const otherEvent = conflict.eventB;
          return (
            <View key={conflict.id} style={styles.conflictItem}>
              <Text style={styles.conflictTitle} numberOfLines={1}>
                {otherEvent.title}
              </Text>
              <Text style={styles.conflictTime}>
                {formatDisplayTime(otherEvent.startTime)} – {formatDisplayTime(otherEvent.endTime)}
                {conflict.overlapMinutes > 0 && ` (${conflict.overlapMinutes} min overlap)`}
                {conflict.travelTimeConflict && ' (travel time conflict)'}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Alternative suggestions */}
      {displayAlternatives.length > 0 && (
        <View style={styles.alternativesSection}>
          <Text style={styles.alternativesLabel}>Suggested alternatives:</Text>
          {displayAlternatives.map((slot, index) => (
            <TouchableOpacity
              key={index}
              style={styles.alternativeButton}
              onPress={() => onSelectAlternative(slot)}
              accessibilityRole="button"
              accessibilityLabel={`Use suggested time: ${formatTimeSlot(slot)}`}
              testID={`alternative-slot-${index}`}
            >
              <Text style={styles.alternativeText}>{formatTimeSlot(slot)}</Text>
              <Text style={styles.useText}>Use this time</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Keep original button */}
      <TouchableOpacity
        style={styles.keepButton}
        onPress={onKeepOriginal}
        accessibilityRole="button"
        accessibilityLabel="Keep original time"
        testID="keep-original-time"
      >
        <Text style={styles.keepButtonText}>Keep original time</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFF8E1',
    borderWidth: 1,
    borderColor: '#FFE082',
    borderRadius: 8,
    padding: 12,
    marginVertical: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  warningIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  headerText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E65100',
  },
  conflictList: {
    marginBottom: 8,
  },
  conflictItem: {
    paddingVertical: 4,
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: '#FF9800',
    marginBottom: 4,
  },
  conflictTitle: {
    fontSize: 13,
    fontWeight: '500',
    color: '#3E2723',
  },
  conflictTime: {
    fontSize: 12,
    color: '#5D4037',
    marginTop: 2,
  },
  alternativesSection: {
    marginTop: 4,
    marginBottom: 8,
  },
  alternativesLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#5D4037',
    marginBottom: 6,
  },
  alternativeButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 4,
  },
  alternativeText: {
    fontSize: 13,
    color: '#202124',
    flex: 1,
  },
  useText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#1A73E8',
    marginLeft: 8,
  },
  keepButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  keepButtonText: {
    fontSize: 13,
    color: '#5F6368',
    fontWeight: '500',
  },
});
