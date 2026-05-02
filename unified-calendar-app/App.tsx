/**
 * Main App entry point - renders the Unified Calendar View with sample data
 * for demonstration and E2E testing purposes.
 *
 * Onboarding integration (Req 20.1, 20.7):
 * - On first launch, shows the OnboardingAnimator as a full-screen overlay.
 * - Uses OnboardingManager.isComplete(userId) as the single source of truth
 *   for whether onboarding has been completed or skipped.
 * - Does NOT store onboarding state in UIPreferences to avoid duplicated state.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, View, Text, SafeAreaView, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { UnifiedCalendarView } from './src/ui/calendar/UnifiedCalendarView';
import OnboardingAnimator from './src/ui/onboarding/OnboardingAnimator';
import { createOnboardingManager } from './src/onboarding/onboardingManager';
import type { OnboardingManager } from './src/onboarding/onboardingManager';
import type { DatabaseDriver } from './src/db/database';
import type { CalendarEvent, CalendarAccount } from './src/types/models';

/** The demo user ID used throughout the sample app. */
const DEMO_USER_ID = 'user-1';

// Sample accounts for demonstration
const SAMPLE_ACCOUNTS: CalendarAccount[] = [
  {
    id: 'acc-1',
    userId: 'user-1',
    providerId: 'google',
    displayName: 'Work Calendar',
    email: 'user@company.com',
    color: '#4285F4',
    visibility: 'public',
    syncToken: null,
    lastSyncedAt: new Date(),
    status: 'active',
    createdAt: new Date(),
  },
  {
    id: 'acc-2',
    userId: 'user-1',
    providerId: 'outlook',
    displayName: 'Personal Calendar',
    email: 'user@personal.com',
    color: '#34A853',
    visibility: 'public',
    syncToken: null,
    lastSyncedAt: new Date(),
    status: 'active',
    createdAt: new Date(),
  },
  {
    id: 'acc-3',
    userId: 'user-1',
    providerId: 'icloud',
    displayName: 'Family Calendar',
    email: 'user@icloud.com',
    color: '#EA4335',
    visibility: 'public',
    syncToken: null,
    lastSyncedAt: new Date(),
    status: 'active',
    createdAt: new Date(),
  },
];

// Generate sample events for the current week
function generateSampleEvents(): CalendarEvent[] {
  const today = new Date();
  const events: CalendarEvent[] = [];

  const baseEvent = {
    providerEventId: '',
    description: null,
    location: null,
    timeZone: 'UTC',
    isAllDay: false,
    recurrenceRule: null,
    recurrenceExceptionDate: null,
    parentRecurringEventId: null,
    organizer: null,
    attendees: [],
    sequence: 0,
    dtstamp: new Date(),
    status: 'confirmed' as const,
    visibility: null,
    opaqueFields: new Map<string, string>(),
    syncStatus: 'synced' as const,
    localVersion: 1,
    remoteEtag: null,
    modifiedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Today's events
  const todayStart = new Date(today);
  todayStart.setHours(9, 0, 0, 0);

  events.push({
    ...baseEvent,
    id: 'evt-1',
    providerEventId: 'prov-1',
    calendarAccountId: 'acc-1',
    title: 'Team Standup',
    description: 'Daily sync with the engineering team',
    location: 'Conference Room A',
    startTime: new Date(todayStart),
    endTime: new Date(todayStart.getTime() + 30 * 60 * 1000),
  });

  events.push({
    ...baseEvent,
    id: 'evt-2',
    providerEventId: 'prov-2',
    calendarAccountId: 'acc-1',
    title: 'Sprint Planning',
    description: 'Plan next sprint tasks and priorities',
    startTime: new Date(todayStart.getTime() + 2 * 60 * 60 * 1000),
    endTime: new Date(todayStart.getTime() + 3 * 60 * 60 * 1000),
  });

  events.push({
    ...baseEvent,
    id: 'evt-3',
    providerEventId: 'prov-3',
    calendarAccountId: 'acc-2',
    title: 'Lunch with Alex',
    location: 'Downtown Cafe',
    startTime: new Date(todayStart.getTime() + 3.5 * 60 * 60 * 1000),
    endTime: new Date(todayStart.getTime() + 4.5 * 60 * 60 * 1000),
  });

  events.push({
    ...baseEvent,
    id: 'evt-4',
    providerEventId: 'prov-4',
    calendarAccountId: 'acc-1',
    title: 'Code Review Session',
    description: 'Review PR #1234 - Calendar sync engine',
    startTime: new Date(todayStart.getTime() + 5 * 60 * 60 * 1000),
    endTime: new Date(todayStart.getTime() + 6 * 60 * 60 * 1000),
  });

  events.push({
    ...baseEvent,
    id: 'evt-5',
    providerEventId: 'prov-5',
    calendarAccountId: 'acc-3',
    title: 'Family Dinner',
    location: 'Home',
    startTime: new Date(todayStart.getTime() + 9 * 60 * 60 * 1000),
    endTime: new Date(todayStart.getTime() + 10.5 * 60 * 60 * 1000),
  });

  // Tomorrow's events
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);

  events.push({
    ...baseEvent,
    id: 'evt-6',
    providerEventId: 'prov-6',
    calendarAccountId: 'acc-1',
    title: '1:1 with Manager',
    description: 'Weekly check-in',
    startTime: new Date(tomorrow),
    endTime: new Date(tomorrow.getTime() + 45 * 60 * 1000),
  });

  events.push({
    ...baseEvent,
    id: 'evt-7',
    providerEventId: 'prov-7',
    calendarAccountId: 'acc-2',
    title: 'Dentist Appointment',
    location: 'City Dental Clinic',
    startTime: new Date(tomorrow.getTime() + 4 * 60 * 60 * 1000),
    endTime: new Date(tomorrow.getTime() + 5 * 60 * 60 * 1000),
  });

  // Day after tomorrow - overlapping events
  const dayAfter = new Date(today);
  dayAfter.setDate(dayAfter.getDate() + 2);
  dayAfter.setHours(14, 0, 0, 0);

  events.push({
    ...baseEvent,
    id: 'evt-8',
    providerEventId: 'prov-8',
    calendarAccountId: 'acc-1',
    title: 'Design Review',
    description: 'Review new calendar UI mockups',
    startTime: new Date(dayAfter),
    endTime: new Date(dayAfter.getTime() + 60 * 60 * 1000),
  });

  events.push({
    ...baseEvent,
    id: 'evt-9',
    providerEventId: 'prov-9',
    calendarAccountId: 'acc-2',
    title: 'Yoga Class',
    location: 'Fitness Center',
    startTime: new Date(dayAfter.getTime() + 30 * 60 * 1000),
    endTime: new Date(dayAfter.getTime() + 90 * 60 * 1000),
  });

  // All-day event
  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 5);
  nextWeek.setHours(0, 0, 0, 0);

  events.push({
    ...baseEvent,
    id: 'evt-10',
    providerEventId: 'prov-10',
    calendarAccountId: 'acc-3',
    title: 'Family Vacation',
    isAllDay: true,
    startTime: new Date(nextWeek),
    endTime: new Date(nextWeek.getTime() + 3 * 24 * 60 * 60 * 1000),
  });

  return events;
}

/**
 * Creates a lightweight in-memory database driver for the demo app.
 * In production, this would be replaced by the platform-specific SQLite driver
 * initialized during the full app bootstrap.
 */
function createInMemoryDb(): DatabaseDriver {
  const tables = new Map<string, Array<Record<string, unknown>>>();

  return {
    async execute(sql: string, params?: unknown[]): Promise<void> {
      // Minimal in-memory implementation for onboarding_state table
      if (sql.includes('CREATE TABLE') || sql.includes('PRAGMA')) return;

      if (sql.includes('INSERT INTO onboarding_state')) {
        const rows = tables.get('onboarding_state') ?? [];
        rows.push({
          user_id: params?.[0],
          current_step: params?.[1],
          completed_steps: params?.[2],
          skipped: params?.[3],
          first_opened_at: params?.[4],
          tooltips_dismissed: params?.[5],
        });
        tables.set('onboarding_state', rows);
        return;
      }

      if (sql.includes('UPDATE onboarding_state')) {
        const rows = tables.get('onboarding_state') ?? [];
        const userId = params?.[5];
        const idx = rows.findIndex((r) => r.user_id === userId);
        if (idx >= 0) {
          rows[idx] = {
            user_id: userId,
            current_step: params?.[0],
            completed_steps: params?.[1],
            skipped: params?.[2],
            first_opened_at: params?.[3],
            tooltips_dismissed: params?.[4],
          };
        }
        return;
      }
    },

    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      if (sql.includes('FROM onboarding_state')) {
        const rows = tables.get('onboarding_state') ?? [];
        const userId = params?.[0];
        const matches = rows.filter((r) => r.user_id === userId);
        return matches as T[];
      }
      return [];
    },

    async close(): Promise<void> {},
    isOpen(): boolean { return true; },
    // Security Review 2026-05-02: Finding H8 — DatabaseDriver now requires
    // transaction support. The demo in-memory driver has no real atomicity,
    // so transaction() simply invokes the callback directly. Marked
    // supportsTransactions = false so any production code that depends on
    // atomicity can choose to fall back.
    supportsTransactions: false,
    async transaction<T>(fn: (tx: { execute: (sql: string, params?: unknown[]) => Promise<void>; query: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]> }) => Promise<T>): Promise<T> {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      return fn({ execute: this.execute.bind(this), query: this.query.bind(this) });
    },
  };
}

export default function App() {
  const events = React.useMemo(() => generateSampleEvents(), []);

  // Onboarding state — null means "still loading", true/false once resolved
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const onboardingManagerRef = useRef<OnboardingManager | null>(null);

  // Initialize OnboardingManager and check completion state on mount
  useEffect(() => {
    const db = createInMemoryDb();
    const manager = createOnboardingManager({ db });
    onboardingManagerRef.current = manager;

    manager.isComplete(DEMO_USER_ID).then((complete) => {
      setShowOnboarding(!complete);
    }).catch(() => {
      // If we can't determine onboarding state, skip to main view
      setShowOnboarding(false);
    });
  }, []);

  // Callback when onboarding completes or is skipped — dismiss the overlay
  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false);
  }, []);

  // While loading onboarding state, render the main app shell without the overlay
  // to avoid a flash of empty content
  const isLoading = showOnboarding === null;

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <View style={styles.appHeader}>
            <Text style={styles.appTitle} testID="app-title">Unified Calendar</Text>
            <Text style={styles.appSubtitle}>All your calendars in one place</Text>
          </View>
          <View style={styles.calendarContainer}>
            <UnifiedCalendarView
              events={events}
              accounts={SAMPLE_ACCOUNTS}
              initialViewMode="week"
            />
          </View>
        </View>
        {/* Onboarding overlay — renders on top of the main calendar content */}
        {!isLoading && showOnboarding && onboardingManagerRef.current && (
          <View style={styles.onboardingOverlay} testID="onboarding-overlay">
            <OnboardingAnimator
              onComplete={handleOnboardingComplete}
              onboardingManager={onboardingManagerRef.current}
              userId={DEMO_USER_ID}
            />
          </View>
        )}
        <StatusBar style="auto" />
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  container: {
    flex: 1,
  },
  appHeader: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'web' ? 16 : 8,
    paddingBottom: 8,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
  },
  appTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#202124',
  },
  appSubtitle: {
    fontSize: 13,
    color: '#5F6368',
    marginTop: 2,
  },
  calendarContainer: {
    flex: 1,
  },
  onboardingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
});
