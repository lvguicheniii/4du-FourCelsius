export function buildExpoClientConfig(appJson, runtimeVersion) {
  return {
    ...appJson,
    runtimeVersion,
    updates: appJson.updates,
  };
}
