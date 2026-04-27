# React Native - Getting Started & Best Practices

Source: https://reactnative.dev/docs/getting-started

## Overview
React Native lets you build mobile apps using JavaScript and React. It provides native components for iOS and Android.

## Performance Best Practices
Source: https://reactnative.dev/docs/performance

- Target 60fps minimum on both JS thread and UI thread
- Remove `console.log` in production (use `babel-plugin-transform-remove-console`)
- Use `FlatList` with `getItemLayout` for long lists; consider FlashList or Legend List for better perf
- Use `useNativeDriver: true` for Animated API to offload animations to native thread
- Use `InteractionManager` to defer expensive work until after animations
- Use `LayoutAnimation` for fire-and-forget animations (unaffected by JS thread drops)
- Avoid animating image size directly — use `transform: [{scale}]` instead
- Use `renderToHardwareTextureAndroid` / `shouldRasterizeIOS` for views that move frequently
- Wrap expensive `onPress` handlers in `requestAnimationFrame`
- Always test performance in release builds (dev mode adds significant overhead)

## Security Best Practices
Source: https://reactnative.dev/docs/security

### Storing Sensitive Info
- Never store API keys in app code — use a server-side orchestration layer
- Use platform-specific secure storage:
  - iOS: Keychain Services
  - Android: Encrypted Shared Preferences / Android Keystore
- Libraries: `expo-secure-store`, `react-native-keychain`
- AsyncStorage is unencrypted — only for non-sensitive data (Redux state, GraphQL cache)

### Authentication
- Deep links are NOT secure — never send tokens via deep links
- Use PKCE (Proof of Key Code Exchange) with OAuth2 for mobile
- Library: `react-native-app-auth` (wraps AppAuth-iOS and AppAuth-Android)

### Network Security
- Always use HTTPS/SSL encryption
- Consider SSL pinning for high-security apps (be mindful of certificate expiry)

## Core Components
- View, Text, Image, TextInput, ScrollView (basic)
- FlatList, SectionList (performant lists)
- Platform-specific components available for Android and iOS
