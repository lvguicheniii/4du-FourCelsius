module.exports = ({ config }) => {
  const baseConfig = config;
  const isDevelopment = process.env.APP_VARIANT === 'development';
  // The public local-preview path targets Expo Go. It must not include the
  // expo-dev-client launcher plugin, which is only for a custom dev build.
  const plugins = baseConfig.plugins
    .filter((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) !== 'expo-dev-client')
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
    // Expo Go cannot consume the self-hosted production OTA endpoint during
    // local preview. Keep updates enabled for release builds only.
    updates: { ...baseConfig.updates, enabled: !isDevelopment, url: `${apiOrigin}/api/app-updates/ota` },
    name: isDevelopment ? '肆度 Dev' : baseConfig.name,
    scheme: isDevelopment ? 'communityapp-dev' : baseConfig.scheme,
    ios: {
      ...baseConfig.ios,
      bundleIdentifier: isDevelopment ? 'com.fourcelsius.sidu.dev' : baseConfig.ios.bundleIdentifier,
    },
    android: {
      ...baseConfig.android,
      package: isDevelopment ? 'com.fourcelsius.sidu.dev' : baseConfig.android.package,
    },
    experiments: {
      ...baseConfig.experiments,
      reactCompiler: isDevelopment ? false : baseConfig.experiments?.reactCompiler,
    },
    plugins,
  };
};
