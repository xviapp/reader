const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// @reader-release-signing';
const PROPERTIES = {
  storeFile: 'READER_RELEASE_STORE_FILE',
  storePassword: 'READER_RELEASE_STORE_PASSWORD',
  keyAlias: 'READER_RELEASE_KEY_ALIAS',
  keyPassword: 'READER_RELEASE_KEY_PASSWORD',
};

// Release builds use a keystore from Gradle properties or environment variables when
// READER_RELEASE_STORE_FILE is set; otherwise they keep the template's debug signing.
module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;
    if (contents.includes(MARKER)) return config;

    const helper = [
      MARKER,
      'def readerSigningValue = { String name -> findProperty(name) ?: System.getenv(name) }',
      `def readerReleaseSigning = readerSigningValue('${PROPERTIES.storeFile}') != null`,
      '',
    ].join('\n');
    const releaseConfig = [
      '        release {',
      '            if (readerReleaseSigning) {',
      `                storeFile file(readerSigningValue('${PROPERTIES.storeFile}'))`,
      `                storePassword readerSigningValue('${PROPERTIES.storePassword}')`,
      `                keyAlias readerSigningValue('${PROPERTIES.keyAlias}')`,
      `                keyPassword readerSigningValue('${PROPERTIES.keyPassword}')`,
      '            }',
      '        }',
    ].join('\n');

    const releaseBuildType = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
    if (!/signingConfigs\s*\{/.test(contents) || !releaseBuildType.test(contents) || !/^android\s*\{/m.test(contents)) {
      throw new Error('with-release-signing: unexpected android/app/build.gradle layout');
    }

    contents = contents.replace(/^android\s*\{/m, `${helper}android {`);
    contents = contents.replace(/signingConfigs\s*\{/, (match) => `${match}\n${releaseConfig}`);
    contents = contents.replace(
      releaseBuildType,
      '$1signingConfig readerReleaseSigning ? signingConfigs.release : signingConfigs.debug',
    );
    config.modResults.contents = contents;
    return config;
  });
};
