module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // react-native-web babel plugin for tree-shaking
      'react-native-web',
      // react-native-reanimated plugin MUST be listed last.
      // In reanimated v4 this re-exports react-native-worklets/plugin.
      'react-native-reanimated/plugin',
    ],
  };
};
