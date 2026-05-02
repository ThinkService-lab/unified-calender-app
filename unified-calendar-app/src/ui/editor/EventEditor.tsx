/**
 * EventEditor — Main event creation/editing component.
 *
 * Features:
 * - Form fields: title, description, location, start/end time, all-day toggle
 * - Calendar account selector dropdown
 * - Recurrence rule selector (none, daily, weekly, monthly, yearly)
 * - Attendee management (add/remove)
 * - Real-time conflict detection as user changes time
 * - Recurring event edit prompt ("this event only" vs "all events")
 * - Delete with confirmation
 * - Save and Cancel buttons
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 7.2, 7.3
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  Animated,
} from 'react-native';
import type { CalendarEvent, CalendarAccount, Attendee, TimeSlot } from '../../types';
import { useTokens } from '../tokens/designTokens';
import { useAnimation } from '../animation/animationEngine';
import {
  RecurrenceSelector,
  defaultRecurrenceConfig,
  recurrenceConfigFromRule,
} from '../calendar/RecurrenceSelector';
import type { RecurrenceConfig } from '../calendar/RecurrenceSelector';
import { ConflictWarning } from '../calendar/ConflictWarning';
import { DeleteConfirmation } from '../calendar/DeleteConfirmation';
import { RecurringEventEditPrompt } from './RecurringEventEditPrompt';
import type { RecurringEditAction } from './RecurringEventEditPrompt';
import {
  validateEventForm,
  buildEventFromForm,
  buildExceptionEvent,
  detectFormConflicts,
  isRecurringEvent,
  getActiveAccounts,
  createDefaultForm,
  createFormFromEvent,
} from './eventEditorViewModel';
import type { EventFormData, FormConflictResult } from './eventEditorViewModel';

export type EditorMode = 'create' | 'edit';

export interface EventEditorProps {
  /** 'create' for new events, 'edit' for existing events */
  mode: EditorMode;
  /** The event being edited (required when mode is 'edit') */
  event?: CalendarEvent;
  /** All connected calendar accounts */
  accounts: CalendarAccount[];
  /** All existing events for conflict detection */
  existingEvents: CalendarEvent[];
  /** The specific occurrence date when editing a recurring event instance */
  occurrenceDate?: Date;
  /** Called when the user saves the event */
  onSave: (eventData: Partial<CalendarEvent>) => void;
  /** Called when the user deletes the event */
  onDelete?: (eventId: string, deleteAll: boolean) => void;
  /** Called when the user cancels */
  onCancel: () => void;
  /**
   * Partial form data to seed the editor in 'create' mode.
   * Shallow-merged over createDefaultForm defaults so provided fields win
   * but missing fields fall back to defaults.
   * Ignored when mode is 'edit'. (Req 5.8)
   */
  initialValues?: Partial<EventFormData>;
  /**
   * When true, visually highlights the recurrence section with a 400ms
   * border color transition from tokens.colors.warning to tokens.colors.border
   * (static border when reduced motion) and scrolls the recurrence section
   * into view on mount. (Req 17.8)
   */
  highlightRecurrenceSection?: boolean;
}

export function EventEditor({
  mode,
  event,
  accounts,
  existingEvents,
  occurrenceDate,
  onSave,
  onDelete,
  onCancel,
  initialValues,
  highlightRecurrenceSection,
}: EventEditorProps) {
  const activeAccounts = useMemo(() => getActiveAccounts(accounts), [accounts]);
  const tokens = useTokens();
  const { shouldAnimate } = useAnimation();

  // Ref for the recurrence section — used to scroll into view
  const recurrenceSectionRef = useRef<View>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  // Animated border color for recurrence highlight
  const highlightAnim = useRef(new Animated.Value(0)).current;

  // Initialize form data
  const [form, setForm] = useState<EventFormData>(() => {
    if (mode === 'edit' && event) {
      return createFormFromEvent(event);
    }
    const defaults = createDefaultForm(activeAccounts[0]?.id);
    if (mode === 'create' && initialValues) {
      return { ...defaults, ...initialValues };
    }
    return defaults;
  });

  // Recurrence config (synced with form)
  const [recurrenceConfig, setRecurrenceConfig] = useState<RecurrenceConfig>(() => {
    if (mode === 'edit' && event?.recurrenceRule) {
      return recurrenceConfigFromRule(event.recurrenceRule);
    }
    // When initialValues provides recurrence fields, sync the config
    if (mode === 'create' && initialValues?.recurrenceFrequency && initialValues.recurrenceFrequency !== 'none') {
      return {
        frequency: initialValues.recurrenceFrequency,
        interval: initialValues.recurrenceInterval ?? 1,
        endCondition: initialValues.recurrenceEndCondition ?? 'never',
        count: initialValues.recurrenceCount ?? null,
        until: initialValues.recurrenceUntil ?? null,
      };
    }
    return defaultRecurrenceConfig();
  });

  // UI state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRecurringPrompt, setShowRecurringPrompt] = useState(false);
  const [conflictResult, setConflictResult] = useState<FormConflictResult>({
    conflicts: [],
    alternatives: [],
  });
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [attendeeInput, setAttendeeInput] = useState('');
  const [showAccountPicker, setShowAccountPicker] = useState(false);

  // Detect conflicts when time changes
  useEffect(() => {
    if (form.startTime && form.endTime && form.endTime > form.startTime) {
      const result = detectFormConflicts(
        form,
        existingEvents,
        mode === 'edit' ? event?.id : undefined,
      );
      setConflictResult(result);
    }
  }, [form.startTime, form.endTime, existingEvents, mode, event?.id, form]);

  // Highlight recurrence section on mount when requested
  useEffect(() => {
    if (!highlightRecurrenceSection) return;

    // Scroll the recurrence section into view
    if (recurrenceSectionRef.current && scrollViewRef.current) {
      // Small delay to ensure layout is complete
      const timer = setTimeout(() => {
        recurrenceSectionRef.current?.measureLayout(
          scrollViewRef.current?.getInnerViewNode?.() ?? (scrollViewRef.current as any),
          (_x: number, y: number) => {
            scrollViewRef.current?.scrollTo({ y, animated: shouldAnimate });
          },
          () => {
            // Fallback: just scroll to end if measurement fails
          },
        );
      }, 100);

      // Animate border color: warning → border over 400ms
      if (shouldAnimate) {
        Animated.timing(highlightAnim, {
          toValue: 1,
          duration: 400,
          useNativeDriver: false,
        }).start();
      } else {
        // Reduced motion: set to final state immediately
        highlightAnim.setValue(1);
      }

      return () => clearTimeout(timer);
    }
  }, [highlightRecurrenceSection, shouldAnimate, highlightAnim]);

  // Interpolated border color for recurrence highlight
  const recurrenceHighlightBorderColor = highlightAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [tokens.colors.warning, tokens.colors.border],
  });

  // Update form field helper
  const updateField = useCallback(
    <K extends keyof EventFormData>(field: K, value: EventFormData[K]) => {
      setForm((prev) => ({ ...prev, [field]: value }));
      // Clear validation error for this field
      setValidationErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    },
    [],
  );

  // Handle recurrence config change
  const handleRecurrenceChange = useCallback(
    (config: RecurrenceConfig) => {
      setRecurrenceConfig(config);
      setForm((prev) => ({
        ...prev,
        recurrenceFrequency: config.frequency,
        recurrenceInterval: config.interval,
        recurrenceEndCondition: config.endCondition,
        recurrenceCount: config.count,
        recurrenceUntil: config.until,
      }));
    },
    [],
  );

  // Handle save
  const handleSave = useCallback(() => {
    const validation = validateEventForm(form);
    if (!validation.valid) {
      setValidationErrors(validation.errors);
      return;
    }

    // If editing a recurring event, show the recurring edit prompt
    if (mode === 'edit' && event && isRecurringEvent(event)) {
      setShowRecurringPrompt(true);
      return;
    }

    const eventData = buildEventFromForm(form, event);
    onSave(eventData);
  }, [form, mode, event, onSave]);

  // Handle recurring edit action
  const handleRecurringEditAction = useCallback(
    (action: RecurringEditAction) => {
      setShowRecurringPrompt(false);
      if (action === 'cancel') return;

      if (action === 'this_only' && event && occurrenceDate) {
        // Create exception for this instance only (Req 3.5)
        const exceptionData = buildExceptionEvent(form, event, occurrenceDate);
        onSave(exceptionData);
      } else {
        // Edit all events in the series
        const eventData = buildEventFromForm(form, event);
        onSave(eventData);
      }
    },
    [form, event, occurrenceDate, onSave],
  );

  // Handle delete
  const handleDeleteAction = useCallback(
    (action: 'this_only' | 'all_future' | 'cancel') => {
      setShowDeleteConfirm(false);
      if (action === 'cancel' || !event || !onDelete) return;
      onDelete(event.id, action === 'all_future');
    },
    [event, onDelete],
  );

  // Handle alternative time selection from conflict warning
  const handleSelectAlternative = useCallback(
    (slot: TimeSlot) => {
      updateField('startTime', slot.start);
      updateField('endTime', slot.end);
    },
    [updateField],
  );

  // Add attendee
  const handleAddAttendee = useCallback(() => {
    const email = attendeeInput.trim();
    if (!email || !email.includes('@')) return;
    if (form.attendees.some((a) => a.email === email)) return;

    const newAttendee: Attendee = {
      email,
      displayName: null,
      status: 'needs-action',
      role: 'required',
    };
    updateField('attendees', [...form.attendees, newAttendee]);
    setAttendeeInput('');
  }, [attendeeInput, form.attendees, updateField]);

  // Remove attendee
  const handleRemoveAttendee = useCallback(
    (email: string) => {
      updateField(
        'attendees',
        form.attendees.filter((a) => a.email !== email),
      );
    },
    [form.attendees, updateField],
  );

  // Format date for display
  const formatDateForInput = (date: Date): string => {
    return date.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
  };

  const selectedAccount = activeAccounts.find(
    (a) => a.id === form.calendarAccountId,
  );

  return (
    <ScrollView
      ref={scrollViewRef}
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle} accessibilityRole="header">
          {mode === 'create' ? 'New Event' : 'Edit Event'}
        </Text>
      </View>

      {/* Title */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Title</Text>
        <TextInput
          style={[styles.textInput, validationErrors.title && styles.inputError]}
          value={form.title}
          onChangeText={(text) => updateField('title', text)}
          placeholder="Add title"
          accessibilityLabel="Event title"
          testID="event-title-input"
        />
        {validationErrors.title && (
          <Text style={styles.errorText}>{validationErrors.title}</Text>
        )}
      </View>

      {/* Calendar Account Selector */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Calendar</Text>
        <TouchableOpacity
          style={[
            styles.selectorButton,
            validationErrors.calendarAccountId && styles.inputError,
          ]}
          onPress={() => setShowAccountPicker(!showAccountPicker)}
          accessibilityRole="button"
          accessibilityLabel={`Calendar: ${selectedAccount?.displayName ?? 'Select calendar'}`}
          testID="calendar-account-selector"
        >
          {selectedAccount && (
            <View
              style={[styles.accountColorDot, { backgroundColor: selectedAccount.color }]}
            />
          )}
          <Text style={styles.selectorText}>
            {selectedAccount?.displayName ?? 'Select calendar'}
          </Text>
          <Text style={styles.chevron}>▾</Text>
        </TouchableOpacity>
        {validationErrors.calendarAccountId && (
          <Text style={styles.errorText}>{validationErrors.calendarAccountId}</Text>
        )}
        {showAccountPicker && (
          <View style={styles.dropdown}>
            {activeAccounts.map((account) => (
              <TouchableOpacity
                key={account.id}
                style={[
                  styles.dropdownItem,
                  account.id === form.calendarAccountId && styles.dropdownItemSelected,
                ]}
                onPress={() => {
                  updateField('calendarAccountId', account.id);
                  setShowAccountPicker(false);
                }}
                accessibilityRole="menuitem"
                accessibilityLabel={`${account.displayName} (${account.email})`}
                testID={`account-option-${account.id}`}
              >
                <View
                  style={[styles.accountColorDot, { backgroundColor: account.color }]}
                />
                <View style={styles.accountInfo}>
                  <Text style={styles.accountName}>{account.displayName}</Text>
                  <Text style={styles.accountEmail}>{account.email}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* All-day toggle */}
      <View style={styles.switchRow}>
        <Text style={styles.fieldLabel}>All-day</Text>
        <Switch
          value={form.isAllDay}
          onValueChange={(value) => updateField('isAllDay', value)}
          accessibilityLabel="All-day event"
          testID="all-day-toggle"
        />
      </View>

      {/* Start Time */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          {form.isAllDay ? 'Start Date' : 'Start'}
        </Text>
        <TextInput
          style={[styles.textInput, validationErrors.startTime && styles.inputError]}
          value={formatDateForInput(form.startTime)}
          onChangeText={(text) => {
            const date = new Date(text);
            if (!isNaN(date.getTime())) updateField('startTime', date);
          }}
          placeholder={form.isAllDay ? 'YYYY-MM-DD' : 'YYYY-MM-DDTHH:mm'}
          accessibilityLabel="Start time"
          testID="start-time-input"
        />
      </View>

      {/* End Time */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>
          {form.isAllDay ? 'End Date' : 'End'}
        </Text>
        <TextInput
          style={[styles.textInput, validationErrors.endTime && styles.inputError]}
          value={formatDateForInput(form.endTime)}
          onChangeText={(text) => {
            const date = new Date(text);
            if (!isNaN(date.getTime())) updateField('endTime', date);
          }}
          placeholder={form.isAllDay ? 'YYYY-MM-DD' : 'YYYY-MM-DDTHH:mm'}
          accessibilityLabel="End time"
          testID="end-time-input"
        />
        {validationErrors.endTime && (
          <Text style={styles.errorText}>{validationErrors.endTime}</Text>
        )}
      </View>

      {/* Conflict Warning */}
      {conflictResult.conflicts.length > 0 && (
        <ConflictWarning
          conflicts={conflictResult.conflicts}
          alternatives={conflictResult.alternatives}
          onSelectAlternative={handleSelectAlternative}
          onKeepOriginal={() => {
            /* user acknowledged, keep current time */
          }}
        />
      )}

      {/* Location */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Location</Text>
        <TextInput
          style={styles.textInput}
          value={form.location}
          onChangeText={(text) => updateField('location', text)}
          placeholder="Add location"
          accessibilityLabel="Event location"
          testID="event-location-input"
        />
      </View>

      {/* Description */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Description</Text>
        <TextInput
          style={[styles.textInput, styles.multilineInput]}
          value={form.description}
          onChangeText={(text) => updateField('description', text)}
          placeholder="Add description"
          multiline
          numberOfLines={3}
          accessibilityLabel="Event description"
          testID="event-description-input"
        />
      </View>

      {/* Recurrence Selector */}
      {highlightRecurrenceSection ? (
        <Animated.View
          ref={recurrenceSectionRef as any}
          style={[
            styles.recurrenceHighlight,
            {
              borderColor: shouldAnimate
                ? recurrenceHighlightBorderColor
                : tokens.colors.warning,
            },
          ]}
          testID="recurrence-section-highlight"
        >
          <RecurrenceSelector
            value={recurrenceConfig}
            onChange={handleRecurrenceChange}
          />
        </Animated.View>
      ) : (
        <View ref={recurrenceSectionRef}>
          <RecurrenceSelector
            value={recurrenceConfig}
            onChange={handleRecurrenceChange}
          />
        </View>
      )}

      {/* Attendees */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Attendees</Text>
        <View style={styles.attendeeInputRow}>
          <TextInput
            style={[styles.textInput, styles.attendeeInput]}
            value={attendeeInput}
            onChangeText={setAttendeeInput}
            placeholder="Add email address"
            keyboardType="email-address"
            autoCapitalize="none"
            onSubmitEditing={handleAddAttendee}
            accessibilityLabel="Attendee email"
            testID="attendee-email-input"
          />
          <TouchableOpacity
            style={styles.addAttendeeButton}
            onPress={handleAddAttendee}
            accessibilityRole="button"
            accessibilityLabel="Add attendee"
            testID="add-attendee-button"
          >
            <Text style={styles.addAttendeeText}>Add</Text>
          </TouchableOpacity>
        </View>
        {form.attendees.length > 0 && (
          <View style={styles.attendeeList}>
            {form.attendees.map((attendee) => (
              <View key={attendee.email} style={styles.attendeeChip}>
                <Text style={styles.attendeeEmail} numberOfLines={1}>
                  {attendee.displayName ?? attendee.email}
                </Text>
                <TouchableOpacity
                  onPress={() => handleRemoveAttendee(attendee.email)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${attendee.email}`}
                  testID={`remove-attendee-${attendee.email}`}
                >
                  <Text style={styles.removeAttendeeText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Action Buttons */}
      <View style={styles.actionBar}>
        {mode === 'edit' && onDelete && event && (
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => setShowDeleteConfirm(true)}
            accessibilityRole="button"
            accessibilityLabel="Delete event"
            testID="delete-event-button"
          >
            <Text style={styles.deleteButtonText}>Delete</Text>
          </TouchableOpacity>
        )}
        <View style={styles.actionBarRight}>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            testID="cancel-button"
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.saveButton}
            onPress={handleSave}
            accessibilityRole="button"
            accessibilityLabel={mode === 'create' ? 'Create event' : 'Save changes'}
            testID="save-event-button"
          >
            <Text style={styles.saveButtonText}>
              {mode === 'create' ? 'Create' : 'Save'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Delete Confirmation Modal */}
      <DeleteConfirmation
        visible={showDeleteConfirm}
        eventTitle={event?.title ?? ''}
        isRecurring={event ? isRecurringEvent(event) : false}
        onAction={handleDeleteAction}
      />

      {/* Recurring Event Edit Prompt */}
      <RecurringEventEditPrompt
        visible={showRecurringPrompt}
        eventTitle={event?.title ?? ''}
        onAction={handleRecurringEditAction}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: '#202124',
  },
  fieldGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#5F6368',
    marginBottom: 6,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#DADCE0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#202124',
    backgroundColor: '#FFFFFF',
  },
  multilineInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  inputError: {
    borderColor: '#D93025',
  },
  errorText: {
    fontSize: 12,
    color: '#D93025',
    marginTop: 4,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingVertical: 4,
  },
  selectorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#DADCE0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  accountColorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  selectorText: {
    flex: 1,
    fontSize: 15,
    color: '#202124',
  },
  chevron: {
    fontSize: 14,
    color: '#5F6368',
  },
  dropdown: {
    borderWidth: 1,
    borderColor: '#DADCE0',
    borderRadius: 8,
    marginTop: 4,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
  },
  dropdownItemSelected: {
    backgroundColor: '#E8F0FE',
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#202124',
  },
  accountEmail: {
    fontSize: 12,
    color: '#5F6368',
    marginTop: 1,
  },
  attendeeInputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  attendeeInput: {
    flex: 1,
  },
  addAttendeeButton: {
    backgroundColor: '#1A73E8',
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  addAttendeeText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },
  attendeeList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  attendeeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F0FE',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6,
  },
  attendeeEmail: {
    fontSize: 13,
    color: '#1A73E8',
    maxWidth: 200,
  },
  removeAttendeeText: {
    fontSize: 12,
    color: '#5F6368',
    fontWeight: '600',
  },
  actionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E0E0E0',
  },
  actionBarRight: {
    flexDirection: 'row',
    gap: 8,
    marginLeft: 'auto',
  },
  cancelButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DADCE0',
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#5F6368',
  },
  saveButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#1A73E8',
  },
  saveButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  deleteButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  deleteButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#D93025',
  },
  recurrenceHighlight: {
    borderWidth: 2,
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
  },
});
