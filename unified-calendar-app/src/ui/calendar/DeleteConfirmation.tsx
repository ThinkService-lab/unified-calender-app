/**
 * DeleteConfirmation – Modal dialog for confirming event deletion.
 * For recurring events, offers "Delete this event only" / "Delete all future events" / "Cancel".
 * For single events, offers "Delete" / "Cancel".
 * Requirements: 3.3, 3.5
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
} from 'react-native';

export type DeleteAction = 'this_only' | 'all_future' | 'cancel';

export interface DeleteConfirmationProps {
  /** Whether the dialog is visible */
  visible: boolean;
  /** Title of the event being deleted */
  eventTitle: string;
  /** Whether this is a recurring event */
  isRecurring: boolean;
  /** Called with the user's chosen action */
  onAction: (action: DeleteAction) => void;
}

export function DeleteConfirmation({
  visible,
  eventTitle,
  isRecurring,
  onAction,
}: DeleteConfirmationProps) {
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
          accessibilityLabel={`Delete event: ${eventTitle}`}
        >
          <Text style={styles.title}>Delete this event?</Text>
          <Text style={styles.message} numberOfLines={2}>
            &quot;{eventTitle}&quot; will be permanently removed.
          </Text>

          {isRecurring ? (
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => onAction('this_only')}
                accessibilityRole="button"
                accessibilityLabel="Delete this event only"
                testID="delete-this-only"
              >
                <Text style={styles.actionText}>Delete this event only</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => onAction('all_future')}
                accessibilityRole="button"
                accessibilityLabel="Delete all future events"
                testID="delete-all-future"
              >
                <Text style={[styles.actionText, styles.destructiveText]}>
                  Delete all future events
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionButton, styles.cancelButton]}
                onPress={() => onAction('cancel')}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                testID="delete-cancel"
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => onAction('this_only')}
                accessibilityRole="button"
                accessibilityLabel="Delete event"
                testID="delete-confirm"
              >
                <Text style={[styles.actionText, styles.destructiveText]}>Delete</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionButton, styles.cancelButton]}
                onPress={() => onAction('cancel')}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                testID="delete-cancel"
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}
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
    alignItems: 'center',
  },
  actionText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1A73E8',
  },
  destructiveText: {
    color: '#D93025',
  },
  cancelButton: {
    marginTop: 4,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#5F6368',
  },
});
