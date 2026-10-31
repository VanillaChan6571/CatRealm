module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          alias: {
            '@': './src',
          },
        },
      ],
      // Worklets plugin MUST be last (supersedes react-native-reanimated/plugin).
      // bundleMode avoids Legacy Eval Mode's Hermes memory overhead (RN 0.85+ regression).
      ['react-native-worklets/plugin', { bundleMode: true }],
    ],
  };
};
