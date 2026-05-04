module.exports = function (api) {
  api.cache(true);

  const plugins = [
    // react-native-web babel plugin for tree-shaking
    'react-native-web',
  ];

  // Remove all console.* calls in production builds (steering rule: performance)
  if (process.env.NODE_ENV === 'production') {
    plugins.push('transform-remove-console');
  }

  // react-native-reanimated plugin MUST be listed last.
  // In reanimated v4 this re-exports react-native-worklets/plugin.
  plugins.push('react-native-reanimated/plugin');

  return {
    presets: [['babel-preset-expo', { unstable_transformImportMeta: true }]],
    plugins,
  };
};
