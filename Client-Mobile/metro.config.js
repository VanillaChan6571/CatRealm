const { getDefaultConfig } = require('expo/metro-config');
const { getBundleModeMetroConfig } = require('react-native-worklets/bundleMode');
const path = require('path');

// Worklets Bundle Mode (paired with bundleMode:true in babel.config.js).
const config = getBundleModeMetroConfig(getDefaultConfig(__dirname));

// SVG support
config.transformer.babelTransformerPath = require.resolve('react-native-svg-transformer');
config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== 'svg');
if (!config.resolver.assetExts.includes('ogg')) {
  config.resolver.assetExts.push('ogg');
}
config.resolver.sourceExts = [...config.resolver.sourceExts, 'svg'];

// @livekit/components-react and @livekit/components-core are web-only packages
// pulled in transitively by @livekit/react-native's hooks barrel. We don't use
// any of those hooks — only registerGlobals() — so stub them out to prevent
// Metro from failing on missing peer dependencies.
const LIVEKIT_COMPONENTS_STUB = path.resolve(__dirname, 'livekit-components-stub.js');
const _defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === '@livekit/components-react' ||
    moduleName === '@livekit/components-core'
  ) {
    return { type: 'sourceFile', filePath: LIVEKIT_COMPONENTS_STUB };
  }
  if (_defaultResolveRequest) {
    return _defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
