const path = require('node:path');
const { AndroidConfig, withFinalizedMod } = require('expo/config-plugins');

const BLOCKED_PERMISSIONS = new Set([
  'android.permission.RECORD_AUDIO',
  'android.permission.SYSTEM_ALERT_WINDOW',
]);

module.exports = function withAndroidManifestCleanup(
  config,
  { fileSystemProvider = false, imagePickerActivity = false } = {}
) {
  config.android = {
    ...config.android,
    permissions: (config.android?.permissions ?? []).filter(
      (permission) => !BLOCKED_PERMISSIONS.has(permission)
    ),
    blockedPermissions: (config.android?.blockedPermissions ?? []).filter(
      (permission) => !BLOCKED_PERMISSIONS.has(permission)
    ),
  };

  return withFinalizedMod(config, ['android', async (config) => {
    const manifestPath = path.join(
      config.modRequest.platformProjectRoot,
      'app/src/main/AndroidManifest.xml'
    );
    const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(manifestPath);
    const root = manifest.manifest;
    const permissions = root['uses-permission'];
    if (Array.isArray(permissions)) {
      root['uses-permission'] = permissions.filter((permission) => {
        const attributes = permission.$ ?? {};
        return attributes['tools:node'] !== 'remove'
          && !BLOCKED_PERMISSIONS.has(attributes['android:name']);
      });
    }

    const application = root.application?.[0];
    if (application) {
      if (fileSystemProvider) {
        const providers = Array.isArray(application.provider) ? application.provider : [];
        const provider = providers.find((item) => (
          item.$?.['android:name'] === 'expo.modules.filesystem.FileSystemFileProvider'
        ));
        const declaration = {
          'android:name': 'expo.modules.filesystem.FileSystemFileProvider',
          'android:authorities': '${applicationId}.FileSystemFileProvider',
          'android:exported': 'false',
          'android:grantUriPermissions': 'true',
          'tools:replace': 'android:authorities',
        };
        if (provider) {
          provider.$ = { ...provider.$, ...declaration };
        } else {
          providers.push({ $: declaration });
        }
        application.provider = providers;
      }
      if (imagePickerActivity) {
        const activities = Array.isArray(application.activity) ? application.activity : [];
        const activity = activities.find((item) => (
          item.$?.['android:name'] === 'expo.modules.imagepicker.ExpoCropImageActivity'
        ));
        const declaration = {
          'android:name': 'expo.modules.imagepicker.ExpoCropImageActivity',
          'android:theme': '@style/Theme.AppCompat.DayNight',
          'android:exported': 'false',
          'tools:replace': 'android:exported',
        };
        if (activity) {
          activity.$ = { ...activity.$, ...declaration };
        } else {
          activities.push({ $: declaration });
        }
        application.activity = activities;
      }
    }

    await AndroidConfig.Manifest.writeAndroidManifestAsync(manifestPath, manifest);
    return config;
  }]);
};

