/**
 * RecurringEventEditPrompt — Modal for choosing how to edit a recurring event.
 * Options: "This event only" (creates exception) or "All events" (modifies series).
 *
 * "This event only" creates an exception with recurrenceExceptionDate and
 * parentRecurringEventId, leaving other occurrences unchanged.
 *
 * Requirements: 3.5
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
} from 'react-native';

export type RecurringEditAction = 'this_only' | 'all_events' | 'cancel';

export interface RecurringEventEditPromptProps {
  /** Whether the prompt is visible */
  visible: boolean;
  /** Title of the event being edited */
  eventTitle: string;
  /** Called with the user's chosen action */
  onAction: (action: RecurringEditAction) => void;
}

export function RecurringEventEditPrompt({
  visible,
  eventTitle,
  onAction,
}: RecurringEventEditPromptProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => onAction('cancel')}
      accessibilityViewIsModal
    >
      <View style={styles.overlay}>
        <View
          style={styles.dialog}
          accessibilityRole="alert"
          accessibilityLabel={`Edit recurring event: ${eventTitle}`}
        >
          <Text style={styles.title}>Edit recurring event</Text>
          <Text style={styles.message}>
            This is a recurring event. How would you like to edit it?
          </Text>

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => onAction('this_only')}
              accessibilityRole="button"
              accessibilityLabel="Edit this event only"
              testID="edit-this-only"
            >
              <Text style={styles.actionText}>This event only</Text>
              <Text style={styles.actionDescription}>
                Changes will only apply to this occurrence
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => onAction('all_events')}
              accessibilityRole="button"
              accessibilityLabel="Edit all events in the series"
              testID="edit-all-events"
            >
              <Text style={styles.actionText}>All events</Text>
              <Text style={styles.actionDescription}>
                Changes will apply to all occurrences in the series
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, styles.cancelButton]}
              onPress={() => onAction('cancel')}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              testID="edit-cancel"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialog: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#202124',
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    color: '#5F6368',
    lineHeight: 20,
    marginBottom: 20,
  },
  actions: {
    gap: 4,
  },
  actionButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DADCE0',
    marginBottom: 8,
  },
  actionText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1A73E8',
  },
  actionDescription: {
    fontSize: 12,
    color: '#5F6368',
    marginTop: 2,
  },
  cancelButton: {
    borderColor: 'transparent',
    alignItems: 'center',
    marginTop: 4,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#5F6368',
  },
});
