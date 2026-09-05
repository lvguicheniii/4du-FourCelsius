const { withDangerousMod } = require('expo/config-plugins');
const plist = require('@expo/plist').default;
const fs = require('node:fs/promises');
const path = require('node:path');
const xcode = require('xcode');

const DEVELOPMENT_MODULES = [
  'expo-dev-client',
  'expo-dev-launcher',
  'expo-dev-menu',
  'expo-dev-menu-interface',
];

const IOS_EXCLUSION = `use_expo_modules!(exclude: ${JSON.stringify(DEVELOPMENT_MODULES)})`;
const ANDROID_EXCLUSION = `expoAutolinking.exclude = ${JSON.stringify(DEVELOPMENT_MODULES)}`;
const DEV_LAUNCHER_PHASE = '[Expo Dev Launcher] Strip Local Network Keys for Release';
const DEV_LAUNCHER_NETWORK_DESCRIPTION =
  'Expo Dev Launcher uses the local network to discover and connect to development servers running on your computer.';
const ANDROID_RELEASE_SIGNING_MARKER = 'SIDU_ANDROID_KEYSTORE_PATH';

const ANDROID_RELEASE_SIGNING_CONFIG = `
def siduReleaseKeystorePath = System.getenv('SIDU_ANDROID_KEYSTORE_PATH')
def siduReleaseKeystorePassword = System.getenv('SIDU_ANDROID_KEYSTORE_PASSWORD')
def siduReleaseKeyAlias = System.getenv('SIDU_ANDROID_KEY_ALIAS')
def siduReleaseKeyPassword = System.getenv('SIDU_ANDROID_KEY_PASSWORD')
def siduHasReleaseSigning = [
    siduReleaseKeystorePath,
    siduReleaseKeystorePassword,
    siduReleaseKeyAlias,
    siduReleaseKeyPassword,
].every { it != null && !it.isEmpty() }

gradle.taskGraph.whenReady { graph ->
    def createsReleaseArtifact = graph.allTasks.any {
        it.name ==~ /(?i)(assemble|bundle).*Release/
    }
    if (createsReleaseArtifact && !siduHasReleaseSigning) {
        throw new GradleException('Production Android signing environment is required for release artifacts.')
    }
}
`;

async function replaceFile(filePath, update) {
  const source = await fs.readFile(filePath, 'utf8');
  const next = update(source);
  if (next === source) return;
  await fs.writeFile(filePath, next);
}

function enableIosSimulatorEntitlements(project, projectName) {
  let changed = false;
  const buildConfigurations = project.pbxXCBuildConfigurationSection();
  for (const [key, configuration] of Object.entries(buildConfigurations)) {
    if (key.endsWith('_comment') || !configuration?.buildSettings) continue;
    const infoPlistFile = String(configuration.buildSettings.INFOPLIST_FILE || '').replaceAll('"', '');
    if (infoPlistFile !== `${projectName}/Info.plist`) continue;
    const entitlementSetting = '"ENTITLEMENTS_ALLOWED[sdk=iphonesimulator*]"';
    if (configuration.buildSettings[entitlementSetting] !== 'YES') {
      configuration.buildSettings[entitlementSetting] = 'YES';
      changed = true;
    }
  }
  return changed;
}

async function removeIosDevelopmentArtifacts(platformProjectRoot, projectName) {
  const infoPlistPath = path.join(platformProjectRoot, projectName, 'Info.plist');
  const infoPlist = plist.parse(await fs.readFile(infoPlistPath, 'utf8'));

  infoPlist.CFBundleURLTypes = (infoPlist.CFBundleURLTypes ?? [])
    .map((entry) => ({
      ...entry,
      CFBundleURLSchemes: (entry.CFBundleURLSchemes ?? []).filter(
        (scheme) => typeof scheme !== 'string' || !scheme.startsWith('exp+')
      ),
    }))
    .filter((entry) => entry.CFBundleURLSchemes.length > 0);

  infoPlist.NSBonjourServices = (infoPlist.NSBonjourServices ?? []).filter(
    (service) => typeof service !== 'string' || service.replace(/\.$/, '') !== '_expo._tcp'
  );
  if (infoPlist.NSBonjourServices.length === 0) delete infoPlist.NSBonjourServices;
  if (infoPlist.NSLocalNetworkUsageDescription === DEV_LAUNCHER_NETWORK_DESCRIPTION) {
    delete infoPlist.NSLocalNetworkUsageDescription;
  }
  if (infoPlist.NSAppTransportSecurity?.NSAllowsLocalNetworking === true) {
    delete infoPlist.NSAppTransportSecurity.NSAllowsLocalNetworking;
  }
  if (Object.keys(infoPlist.NSAppTransportSecurity ?? {}).length === 0) {
    delete infoPlist.NSAppTransportSecurity;
  }
  await fs.writeFile(infoPlistPath, plist.build(infoPlist));

  const projectPath = path.join(platformProjectRoot, `${projectName}.xcodeproj`, 'project.pbxproj');
  const project = xcode.project(projectPath);
  project.parseSync();
  let projectChanged = enableIosSimulatorEntitlements(project, projectName);
  const targetId = project.findTargetKey(projectName) ?? project.getFirstTarget().uuid;
  const target = project.pbxNativeTargetSection()[targetId];
  const phase = target?.buildPhases?.find((item) => item.comment === DEV_LAUNCHER_PHASE);
  if (phase) {
    target.buildPhases = target.buildPhases.filter((item) => item.value !== phase.value);
    const section = project.hash.project.objects.PBXShellScriptBuildPhase;
    delete section[phase.value];
    delete section[`${phase.value}_comment`];
    projectChanged = true;
  }
  if (projectChanged) await fs.writeFile(projectPath, project.writeSync());
}

async function removeAndroidDevelopmentArtifacts(platformProjectRoot) {
  const { AndroidConfig } = require('expo/config-plugins');
  const manifestPath = path.join(platformProjectRoot, 'app', 'src', 'main', 'AndroidManifest.xml');
  const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(manifestPath);
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);

  for (const activity of application.activity ?? []) {
    for (const intentFilter of activity['intent-filter'] ?? []) {
      intentFilter.data = (intentFilter.data ?? []).filter((item) => {
        const scheme = item.$?.['android:scheme'];
        return typeof scheme !== 'string' || !scheme.startsWith('exp+');
      });
      if (intentFilter.data.length === 0) delete intentFilter.data;
    }
  }

  await AndroidConfig.Manifest.writeAndroidManifestAsync(manifestPath, manifest);

  const buildGradlePath = path.join(platformProjectRoot, 'app', 'build.gradle');
  await replaceFile(buildGradlePath, (source) => {
    if (source.includes(ANDROID_RELEASE_SIGNING_MARKER)) return source;
    const androidBlock = '\nandroid {\n';
    if (!source.includes(androidBlock)) {
      throw new Error('Unable to locate the generated Android build block.');
    }
    let next = source.replace(androidBlock, `${ANDROID_RELEASE_SIGNING_CONFIG}${androidBlock}`);
    const debugSigningBlock = `        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
`;
    if (!next.includes(debugSigningBlock)) {
      throw new Error('Unable to locate the generated Android debug signing configuration.');
    }
    next = next.replace(
      debugSigningBlock,
      `${debugSigningBlock}        if (siduHasReleaseSigning) {
            release {
                storeFile file(siduReleaseKeystorePath)
                storePassword siduReleaseKeystorePassword
                keyAlias siduReleaseKeyAlias
                keyPassword siduReleaseKeyPassword
            }
        }
`
    );
    const releaseDebugSigning = `            signingConfig signingConfigs.debug
            def enableShrinkResources`;
    if (!next.includes(releaseDebugSigning)) {
      throw new Error('Unable to locate the generated Android release signing configuration.');
    }
    return next.replace(
      releaseDebugSigning,
      `            signingConfig siduHasReleaseSigning ? signingConfigs.release : null
            def enableShrinkResources`
    );
  });
}

function withProductionIosAutolinking(config) {
  return withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const podfilePath = path.join(modConfig.modRequest.platformProjectRoot, 'Podfile');
      await replaceFile(podfilePath, (source) => {
        if (source.includes(IOS_EXCLUSION)) return source;
        if (!source.includes('  use_expo_modules!')) {
          throw new Error('Unable to locate use_expo_modules! in the generated Podfile.');
        }
        return source.replace('  use_expo_modules!', `  ${IOS_EXCLUSION}`);
      });
      await removeIosDevelopmentArtifacts(
        modConfig.modRequest.platformProjectRoot,
        modConfig.modRequest.projectName
      );
      return modConfig;
    },
  ]);
}

function withProductionAndroidAutolinking(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const settingsPath = path.join(modConfig.modRequest.platformProjectRoot, 'settings.gradle');
      await replaceFile(settingsPath, (source) => {
        if (source.includes(ANDROID_EXCLUSION)) return source;
        if (!source.includes('expoAutolinking.useExpoModules()')) {
          throw new Error('Unable to locate Expo autolinking in the generated settings.gradle.');
        }
        return source.replace(
          'expoAutolinking.useExpoModules()',
          `${ANDROID_EXCLUSION}\nexpoAutolinking.useExpoModules()`
        );
      });
      await removeAndroidDevelopmentArtifacts(modConfig.modRequest.platformProjectRoot);
      return modConfig;
    },
  ]);
}

module.exports = function withProductionNativeHardening(config) {
  config._internal ??= {};
  config._internal.pluginHistory ??= {};
  for (const name of DEVELOPMENT_MODULES) {
    config._internal.pluginHistory[name] ??= { name, version: 'production-disabled' };
  }
  return withProductionAndroidAutolinking(withProductionIosAutolinking(config));
};

module.exports.enableIosSimulatorEntitlements = enableIosSimulatorEntitlements;
