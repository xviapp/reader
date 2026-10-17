const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

const MARKER = '// @reader-locale-filter';
const PROPERTIES = {
  // R8 and resource shrinking for release builds.
  'android.enableMinifyInReleaseBuilds': 'true',
  'android.enableShrinkResourcesInReleaseBuilds': 'true',
  // Compressed native libraries: a much smaller APK, extracted at install time.
  'expo.useLegacyPackaging': 'true',
};

module.exports = function withAndroidReleaseSize(config, { locales = ['zh', 'en'] } = {}) {
  config = withGradleProperties(config, (config) => {
    for (const [key, value] of Object.entries(PROPERTIES)) {
      const existing = config.modResults.find((item) => item.type === 'property' && item.key === key);
      if (existing) existing.value = value;
      else config.modResults.push({ type: 'property', key, value });
    }
    return config;
  });
  // Library translations the app never shows only fill resources.arsc.
  return withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;
    if (contents.includes(MARKER)) return config;
    if (!/defaultConfig\s*\{/.test(contents)) throw new Error('with-android-release-size: defaultConfig not found');
    const filter = `\n        ${MARKER}\n        resConfigs ${locales.map((locale) => `"${locale}"`).join(', ')}`;
    config.modResults.contents = contents.replace(/defaultConfig\s*\{/, (match) => `${match}${filter}`);
    return config;
  });
};
