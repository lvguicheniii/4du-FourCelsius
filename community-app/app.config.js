const baseConfig = require('./app.json').expo;

module.exports = () => {
  const isDevelopment = process.env.APP_VARIANT === 'development';
  const plugins = baseConfig.plugins
    .filter((plugin) => isDevelopment || (Array.isArray(plugin) ? plugin[0] : plugin) !== 'expo-dev-client')
    .map((plugin) => {
    if (!Array.isArray(plugin) || plugin[0] !== 'expo-build-properties') return plugin;
    return [
      plugin[0],
      {
        ...plugin[1],
        android: {
          ...plugin[1]?.android,
          usesCleartextTraffic: isDevelopment,
        },
      },
    ];
    });

  if (!isDevelopment) {
    plugins.push('./plugins/with-production-native-hardening');
  }

  const apiOrigin = String(process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');
  return {
    ...baseConfig,
    updates: { ...baseConfig.updates, url: `${apiOrigin}/api/app-updates/ota` },
    name: isDevelopment ? '肆度 Dev' : baseConfig.name,
    scheme: isDevelopment ? 'communityapp-dev' : baseConfig.scheme,
    ios: {
      ...baseConfig.ios,
      bundleIdentifier: isDevelopment ? 'com.fourcelsius.sidu.dev' : baseConfig.ios.bundleIdentifier,
    },
    android: {
      ...baseConfig.android,
      package: isDevelopment ? 'com.fourcelsius.sidu.dev' : baseConfig.android.package,
      usesCleartextTraffic: isDevelopment,
    },
    plugins,
  };
};
