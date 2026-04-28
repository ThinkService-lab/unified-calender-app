/**
 * TanStack Query configuration and hooks - central export.
 * Requirements: 4.1, 4.2
 */

// Query client
export { createAppQueryClient, appQueryClient, STALE_TIMES, GC_TIME } from './queryClient';

// Query keys
export { queryKeys } from './queryKeys';

// Query hooks
export { useCalendars, type UseCalendarsOptions } from './useCalendars';
export { useEvents, type UseEventsOptions } from './useEvents';

// Mutation hooks
export { useCreateEvent, type CreateEventInput, type UseCreateEventOptions } from './useCreateEvent';
export { useUpdateEvent, type UpdateEventInput, type UseUpdateEventOptions } from './useUpdateEvent';
export { useDeleteEvent, type DeleteEventInput, type UseDeleteEventOptions } from './useDeleteEvent';

// Online manager
export { configureOnlineManager, setOnlineStatus, getOnlineStatus } from './onlineManager';
