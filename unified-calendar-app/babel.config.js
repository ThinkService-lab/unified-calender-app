module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // react-native-web babel plugin for tree-shaking
      'react-native-web',
    ],
  };
};
