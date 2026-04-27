# Expo - React Native Framework & Build System

Sources:
- https://docs.expo.dev/get-started/introduction
- https://docs.expo.dev/workflow/web
- https://docs.expo.dev/develop/development-builds/introduction
- https://docs.expo.dev/build/introduction

## Overview
Expo is a React Native framework that simplifies developing Android, iOS, and web apps. It provides file-based routing, a standard library of native modules, and build services (EAS).

## Getting Started
```bash
npx create-expo-app@latest --template default@sdk-55
```

System requirements: Node.js (LTS). Supports macOS, Windows (PowerShell/WSL 2), Linux.

## Web Support
Expo has first-class web support via React Native for Web (RNW).

### Install web dependencies
```bash
npx expo install react-dom react-native-web @expo/metro-runtime
```

### Start dev server
```bash
npx expo start --web
```

### Export for production
```bash
npx expo export --platform web
```

### Key concepts
- `<Text>`, `<View>` from React Native render as `<p>`, `<div>` on web via RNW
- You can also use raw React DOM (`<div>`, `<p>`) for web-only components
- Platform-specific modules: use `.web.js`, `.ios.js`, `.android.js` extensions
- Expo CLI automatically optimizes code per platform ("platform shaking")
- Fast Refresh, debugging, env variables, and bundling are fully universal

## Development Builds vs Expo Go
- **Expo Go**: Playground app for learning. Fixed set of native libraries. Cannot add custom native code.
- **Development Build**: Full-featured dev environment for production apps. Includes `expo-dev-client`.

### When you need a development build
- Using native libraries not in Expo Go (e.g., react-native-firebase)
- Testing app icon, name, splash screen
- Remote push notifications
- App Links / Universal Links
- Any custom native code

## EAS Build (Expo Application Services)
Hosted build service for creating app binaries.

### Quick start
```bash
eas build --platform all
# or per-platform:
eas build --platform ios
eas build --platform android
```

### Key features
- Cloud builds for Android (Linux/GCP) and iOS (macOS)
- Automatic app signing credential management
- Internal distribution builds (share via URL)
- Build profiles in `eas.json`
- Auto-submit to app stores via `--auto-submit`
- First-class `expo-updates` integration
- Dependency caching for faster builds
- Local builds: `eas build --local`

### CI/CD Integration
EAS Build integrates with EAS Workflows and any CI provider:
```yaml
jobs:
  build_ios:
    type: build
    params:
      platform: ios
```

## Best Practices for This Project
1. Use development builds (not Expo Go) since we need custom native modules (SQLite, secure storage, push notifications)
2. Use EAS Build for CI/CD instead of raw Fastlane
3. Use platform-specific file extensions for: secure storage, SQLite driver, push notification handlers
4. Use `Platform.OS` checks for minor UI differences
5. Install web deps (`react-dom`, `react-native-web`, `@expo/metro-runtime`) for PWA target
6. Use `expo-secure-store` for credential storage on mobile
7. Use Expo Router for file-based navigation
