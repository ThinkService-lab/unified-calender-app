/**
 * Production App entry point.
 *
 * Responsibilities:
 *   1. Retrieve or generate the persistent userId and deviceId from SecureStore.
 *   2. Open the platform SQLite driver and run forward-only migrations.
 *   3. Wire the real AppState listener, platform notification handler, and
 *      subscription HTTP client, then call bootstrapApp.
 *   4. Show the onboarding flow on first launch; show the calendar shell once
 *      onboarding is complete.
 *
 * All domain services (SyncEngine, ConflictDetector, SubscriptionManager, …)
 * are constructed inside bootstrapApp. This file owns only the platform wiring.
 *
 * Requirements: 6.1, 13.1, 15.1, 20.1, 20.7
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  SafeAreaView,
  Platform,
  AppState as RNAppState,
  ActivityIndicator,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import * as Crypto from 'expo-crypto';

import { UnifiedCalendarView } from './src/ui/calendar/UnifiedCalendarView';
import OnboardingAnimator from './src/ui/onboarding/OnboardingAnimator';
import { LoginScreen } from './src/ui/auth/LoginScreen';
import { bootstrapApp } from './src/bootstrap/appBootstrap';
import type { AppContext } from './src/bootstrap/appBootstrap';
import type { OnboardingManager } from './src/onboarding/onboardingManager';
import type { AppStateListener } from './src/lifecycle/appLifecycleManager';
import { createSubscriptionHttpClient } from './src/subscription/subscriptionHttpClient';
import { createIOSNotificationHandler } from './src/notifications/notificationHandler.ios';
import { createAndroidNotificationHandler } from './src/notifications/notificationHandler.android';
import { createWebNotificationHandler } from './src/notifications/notificationHandler.web';
import type { PlatformNotificationHandler } from './src/notifications/types';

// ── Secure-stored keys ────────────────────────────────────────────────────────

const SECURE_KEY_USER_ID = 'app_user_id';
const SECURE_KEY_DEVICE_ID = 'app_device_id';

// ── SecureStore helpers (web falls back to a memory map) ─────────────────────

async function getOrCreate(key: string): Promise<string> {
  if (Platform.OS === 'web') {
    return webMemoryStore[key] ?? (webMemoryStore[key] = Crypto.randomUUID());
  }
  const existing = await SecureStore.getItemAsync(key);
  if (existing) return existing;
  const newValue = Crypto.randomUUID();
  await SecureStore.setItemAsync(key, newValue);
  return newValue;
}

// Minimal in-memory fallback for web (SecureStore is iOS/Android only).
const webMemoryStore: Record<string, string> = {};

// ── AppStateListener backed by react-native AppState ─────────────────────────

function buildAppStateListener(): AppStateListener {
  return {
    addEventListener(callback) {
      const subscription = RNAppState.addEventListener('change', callback);
      return () => subscription.remove();
    },
    currentState() {
      const state = RNAppState.currentState;
      // AppLifecycleState only has 'active' | 'background' | 'inactive'
      if (state === 'active') return 'active';
      if (state === 'background') return 'background';
      return 'inactive';
    },
  };
}

// ── Platform notification handler factory ────────────────────────────────────

function buildNotificationHandler(): PlatformNotificationHandler {
  if (Platform.OS === 'ios') {
    return createIOSNotificationHandler({
      requestPermissions: () =>
        Notifications.requestPermissionsAsync().then((r) => ({ status: r.status })),
      getPermissionStatus: () =>
        Notifications.getPermissionsAsync().then((r) => ({ status: r.status })),
      getDevicePushToken: () =>
        Notifications.getDevicePushTokenAsync().then((t) => ({ data: t.data as string })),
      scheduleNotification: (content) =>
        Notifications.scheduleNotificationAsync({
          content: { title: content.title, body: content.body, data: content.data },
          trigger: content.trigger ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: content.trigger.date } : null,
        }),
      setNotificationHandler: Notifications.setNotificationHandler,
      addNotificationReceivedListener: Notifications.addNotificationReceivedListener,
    });
  }

  if (Platform.OS === 'android') {
    return createAndroidNotificationHandler({
      requestPermissions: () =>
        Notifications.requestPermissionsAsync().then((r) => ({ status: r.status })),
      getPermissionStatus: () =>
        Notifications.getPermissionsAsync().then((r) => ({ status: r.status })),
      getDevicePushToken: () =>
        Notifications.getDevicePushTokenAsync().then((t) => ({ data: t.data as string })),
      scheduleNotification: (content) =>
        Notifications.scheduleNotificationAsync({
          content: {
            title: content.title,
            body: content.body,
            data: content.data,
            ...(content.channelId ? { android: { channelId: content.channelId } } : {}),
          },
          trigger: content.trigger ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: content.trigger.date } : null,
        }),
      setNotificationHandler: Notifications.setNotificationHandler,
      addNotificationReceivedListener: Notifications.addNotificationReceivedListener,
    });
  }

  // Web — uses browser Notification API
  return createWebNotificationHandler({
    requestPermission: () => Notification.requestPermission(),
    getPermission: () => Notification.permission,
    getServiceWorkerRegistration: () =>
      'serviceWorker' in navigator
        ? navigator.serviceWorker.ready.then((r) => r).catch(() => null)
        : Promise.resolve(null),
    showNotification: (title, options) => {
      if (Notification.permission === 'granted') {
        new Notification(title, options);
      }
    },
  });
}

// ── Bootstrap state ───────────────────────────────────────────────────────────

type BootstrapPhase =
  | { phase: 'loading' }
  | { phase: 'login' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; context: AppContext; userId: string };

// ── App component ─────────────────────────────────────────────────────────────

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapPhase>({ phase: 'loading' });
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const onboardingManagerRef = useRef<OnboardingManager | null>(null);

  const runBootstrap = useCallback(async (userId: string, cancelled: { value: boolean }) => {
    try {
      const deviceId = await getOrCreate(SECURE_KEY_DEVICE_ID);

      const { createDatabaseDriver } = await import('@/db/db');
      const db = await Promise.resolve(
        createDatabaseDriver({ name: 'unified_calendar.db' })
      );

      const { MigrationRunner } = await import('@/db/migration');
      const runner = new MigrationRunner(db);
      await runner.run();

      const platformNotificationHandler = buildNotificationHandler();
      const appStateListener = buildAppStateListener();

      const subscriptionApiUrl = process.env.EXPO_PUBLIC_SUBSCRIPTION_API_URL;
      const subscriptionHttpClient = subscriptionApiUrl
        ? createSubscriptionHttpClient({ baseUrl: subscriptionApiUrl })
        : undefined;

      const wsUrl =
        process.env.EXPO_PUBLIC_WS_URL ?? 'wss://sync.unifiedcalendar.app/ws';

      const context = await bootstrapApp({
        db,
        userId,
        deviceId,
        webSocketUrl: wsUrl,
        platformNotificationHandler,
        appStateListener,
        subscriptionHttpClient,
      });

      if (cancelled.value) return;

      onboardingManagerRef.current = context.onboardingManager;
      const complete = await context.onboardingManager.isComplete(userId);

      setBootstrap({ phase: 'ready', context, userId });
      setShowOnboarding(!complete);
    } catch (err) {
      if (!cancelled.value) {
        const message = err instanceof Error ? err.message : 'Startup failed';
        setBootstrap({ phase: 'error', message });
      }
    }
  }, []);

  const handleAppleSignedIn = useCallback((userId: string) => {
    // Persist the Apple sub-identifier so future launches skip the login screen
    SecureStore.setItemAsync(SECURE_KEY_USER_ID, userId).catch(() => {});
    setBootstrap({ phase: 'loading' });
    const cancelled = { value: false };
    runBootstrap(userId, cancelled);
  }, [runBootstrap]);

  useEffect(() => {
    let cancelled = { value: false };

    async function init() {
      try {
        // On iOS first launch, if no userId is stored yet, show the login screen
        // so the user can Sign in with Apple (required by App Store Guideline 4.8).
        // Android/web use a device-generated UUID and skip the login screen.
        const existingUserId = Platform.OS === 'ios'
          ? await SecureStore.getItemAsync(SECURE_KEY_USER_ID)
          : null;

        if (Platform.OS === 'ios' && !existingUserId) {
          if (!cancelled.value) setBootstrap({ phase: 'login' });
          return;
        }

        const userId = existingUserId ?? await getOrCreate(SECURE_KEY_USER_ID);
        await runBootstrap(userId, cancelled);
      } catch (err) {
        if (!cancelled.value) {
          const message = err instanceof Error ? err.message : 'Startup failed';
          setBootstrap({ phase: 'error', message });
        }
      }
    }

    init();
    return () => { cancelled.value = true; };
  }, [runBootstrap]);

  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false);
  }, []);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (bootstrap.phase === 'loading') {
    return (
      <GestureHandlerRootView style={styles.gestureRoot}>
        <SafeAreaView style={[styles.safeArea, styles.centered]}>
          <ActivityIndicator size="large" color="#1F4E79" />
          <Text style={styles.loadingText}>Starting up…</Text>
        </SafeAreaView>
      </GestureHandlerRootView>
    );
  }

  // ── Login state (iOS first launch — Sign in with Apple required) ───────────
  if (bootstrap.phase === 'login') {
    return (
      <GestureHandlerRootView style={styles.gestureRoot}>
        <LoginScreen onSignedIn={handleAppleSignedIn} />
      </GestureHandlerRootView>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (bootstrap.phase === 'error') {
    return (
      <GestureHandlerRootView style={styles.gestureRoot}>
        <SafeAreaView style={[styles.safeArea, styles.centered]}>
          <Text style={styles.errorTitle}>Unable to start</Text>
          <Text style={styles.errorMessage}>{bootstrap.message}</Text>
        </SafeAreaView>
      </GestureHandlerRootView>
    );
  }

  // ── Ready state ────────────────────────────────────────────────────────────
  const { context, userId } = bootstrap;
  const isOnboardingLoading = showOnboarding === null;

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
              events={[]}
              accounts={[]}
              initialViewMode="week"
            />
          </View>
        </View>
        {!isOnboardingLoading && showOnboarding && onboardingManagerRef.current && (
          <View style={styles.onboardingOverlay} testID="onboarding-overlay">
            <OnboardingAnimator
              onComplete={handleOnboardingComplete}
              onboardingManager={onboardingManagerRef.current}
              userId={userId}
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
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
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
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#5F6368',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#D93025',
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    color: '#5F6368',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
