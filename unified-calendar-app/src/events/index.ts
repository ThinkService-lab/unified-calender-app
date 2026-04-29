/**
 * Event CRUD operations module.
 * Requirements: 3.1, 3.2, 3.3, 3.6
 */

export {
  createEventCRUDService,
} from './eventCRUDService';

export type {
  EventCRUDService,
  EventCRUDServiceConfig,
  EventsStoreAdapter,
  CreateEventInput,
  UpdateEventInput,
  CRUDResult,
  EventNotificationCallback,
} from './eventCRUDService';
