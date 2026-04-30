/**
 * Event editor module public API.
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 7.2, 7.3
 */

// Main editor component
export { EventEditor } from './EventEditor';
export type { EventEditorProps, EditorMode } from './EventEditor';

// Recurring event edit prompt
export { RecurringEventEditPrompt } from './RecurringEventEditPrompt';
export type {
  RecurringEventEditPromptProps,
  RecurringEditAction,
} from './RecurringEventEditPrompt';

// View model (pure logic, testable without React)
export {
  validateEventForm,
  buildEventFromForm,
  buildRecurrenceRule,
  buildExceptionEvent,
  detectFormConflicts,
  isRecurringEvent,
  getActiveAccounts,
  createDefaultForm,
  createFormFromEvent,
} from './eventEditorViewModel';
export type {
  EventFormData,
  ValidationErrors,
  ValidationResult,
  FormConflictResult,
} from './eventEditorViewModel';
