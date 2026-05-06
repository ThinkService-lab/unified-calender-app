/**
 * LoginScreen — shown on iOS first launch when no userId is persisted.
 *
 * Sign in with Apple is required whenever the app offers any third-party
 * OAuth login (Google Calendar, Microsoft Outlook) — App Store Review
 * Guideline 4.8. The credential.user string returned by Apple is a stable
 * opaque sub-identifier scoped to this app; we persist it as the userId so
 * it survives reinstalls on the same Apple ID.
 *
 * Requirements: CRIT-5, 5.1
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';

interface LoginScreenProps {
  onSignedIn: (userId: string) => void;
}

export function LoginScreen({ onSignedIn }: LoginScreenProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAppleSignIn = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      // credential.user is the stable per-app sub-identifier
      onSignedIn(credential.user);
    } catch (err: unknown) {
      // ERR_REQUEST_CANCELED: user tapped Cancel — not an error worth surfacing
      if (
        err instanceof Error &&
        (err as { code?: string }).code === 'ERR_REQUEST_CANCELED'
      ) {
        setLoading(false);
        return;
      }
      setError('Sign in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [onSignedIn]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.appName}>Unified Calendar</Text>
          <Text style={styles.tagline}>All your calendars in one place</Text>
        </View>

        <View style={styles.body}>
          <Text style={styles.welcomeTitle}>Welcome</Text>
          <Text style={styles.welcomeSubtitle}>
            Sign in to sync your calendars across devices.
          </Text>
        </View>

        <View style={styles.footer}>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {loading ? (
            <ActivityIndicator size="small" color="#1F4E79" style={styles.spinner} />
          ) : (
            Platform.OS === 'ios' && (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={8}
                style={styles.appleButton}
                onPress={handleAppleSignIn}
              />
            )
          )}

          <Text style={styles.privacyNote}>
            Your calendar data stays on your device. Unified Calendar never
            uploads your events to our servers.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  container: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: 'space-between',
  },
  header: {
    marginTop: 64,
    alignItems: 'center',
  },
  appName: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1F4E79',
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 15,
    color: '#5F6368',
    marginTop: 6,
  },
  body: {
    alignItems: 'center',
  },
  welcomeTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: '#202124',
    marginBottom: 10,
  },
  welcomeSubtitle: {
    fontSize: 15,
    color: '#5F6368',
    textAlign: 'center',
    lineHeight: 22,
  },
  footer: {
    marginBottom: 40,
    alignItems: 'center',
  },
  appleButton: {
    width: '100%',
    height: 50,
    marginBottom: 20,
  },
  spinner: {
    height: 50,
    marginBottom: 20,
  },
  errorText: {
    fontSize: 13,
    color: '#D93025',
    marginBottom: 12,
    textAlign: 'center',
  },
  privacyNote: {
    fontSize: 12,
    color: '#9AA0A6',
    textAlign: 'center',
    lineHeight: 18,
  },
});
