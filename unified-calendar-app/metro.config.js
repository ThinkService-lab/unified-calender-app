// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Add platform-specific file extensions for significant platform differences
// (SQLite driver, secure storage, push notifications)
config.resolver.sourceExts = [
  ...new Set([
    // Platform-specific extensions (highest priority)
    'web.ts',
    'web.tsx',
    'ios.ts',
    'ios.tsx',
    'android.ts',
    'android.tsx',
    // Standard extensions
    ...config.resolver.sourceExts,
  ]),
];

module.exports = config;
