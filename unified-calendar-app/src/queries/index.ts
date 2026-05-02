/**
 * TanStack Query hooks module.
 * Provides React Query integration for calendar data with caching,
 * automatic refetching, and the isPending → isError → data pattern.
 *
 * Requirements: 2.1, 4.1
 */

export {
  calendarKeys,
  initCalendarQueries,
  useCalendarAccounts,
  useCalendarEvents,
  useAccountEvents,
  useSyncConflicts,
  useCreateEvent,
  useUpdateEvent,
  useDeleteEvent,
  useResolveConflict,
} from './calendarQueries';
export type { CalendarQueryDeps } from './calendarQueries';
