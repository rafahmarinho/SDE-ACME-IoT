// Metro configuration: Expo defaults plus one release rule.
// SDE T49: bundles built without EXPO_PUBLIC_DEMO_MODE=true never include the demo personas and
// dataset; src/mock/initialData.ts is replaced by src/mock/emptyData.ts (same exports, empty).
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (process.env.EXPO_PUBLIC_DEMO_MODE !== 'true') {
  const demoData = path.resolve(__dirname, 'src', 'mock', 'initialData.ts');
  const emptyData = path.resolve(__dirname, 'src', 'mock', 'emptyData.ts');
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const resolution = context.resolveRequest(context, moduleName, platform);
    if (resolution && resolution.type === 'sourceFile' && path.resolve(resolution.filePath) === demoData) {
      return { type: 'sourceFile', filePath: emptyData };
    }
    return resolution;
  };
}

module.exports = config;
